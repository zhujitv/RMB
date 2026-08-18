import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { NOTIFICATION_TEMPLATE_TYPES, renderNotificationTemplate } from "./notification-engine";
import { assertWrite } from "./shared-access";
import { codedError, nonEmpty } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import { runNonCriticalTask } from "./shared";
import { assertSupplierDocumentRequestCostAvailable } from "./supplier-document-request-availability";
import { duplicateSupplierDocumentRequestError, supplierDocumentRequestInclude, type ActorLike, type AuditRequestLike, type SupplierDocumentRequestInput } from "./supplier-document-request-types";
import { actorId, adminCcEmails, dateFromInput, loadFactorySupplierReturnCostForRequest, requiredDocumentTypes, serializeSupplierDocumentRequest, supplierDocumentRequestTemplateVariables, supplierRecipientEmails } from "./supplier-document-request-serialization";
import { buildSupplierTaxContractDraft, type SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import { assertFactoryPurchaseTransitionAllocationAvailable, FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE, prepareFactoryPurchaseTransitionSettlement } from "./supplier-transition-settlement";

const REQUIRED_TYPES = ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"];

function requireAdmin(actor: ActorLike) {
  if (actor?.role !== "管理员") throw codedError("只有管理员可以生成退税合同。", 403, "SUPPLIER_TAX_CONTRACT_ADMIN_ONLY");
  assertWrite(actor, "supplierDocuments");
  return actorId(actor);
}

export async function createSupplierTaxContractRequest(request: AuditRequestLike, actor: ActorLike, input: SupplierDocumentRequestInput) {
  const requestedById = requireAdmin(actor);
  const factoryCost = await loadFactorySupplierReturnCostForRequest(input);
  const order = factoryCost.order;
  const supplier = factoryCost.supplier;
  if (!order || !supplier) throw codedError("请选择有效的工厂结算成本。", 404, "SUPPLIER_TAX_CONTRACT_COST_NOT_FOUND");
  if (!supplier.allowFactoryDocumentUpload) throw codedError("该供应商未开通资料回传权限。", 400, "SUPPLIER_DOCUMENT_UPLOAD_DISABLED");
  await assertSupplierDocumentRequestCostAvailable(factoryCost);
  const recipients = supplierRecipientEmails(supplier);
  if (!recipients.length) throw codedError("供应商没有可用邮箱，无法发送合同。", 400, "SUPPLIER_EMAIL_REQUIRED");
  const preparedTransition = factoryCost.sourceType !== "FACTORY_PURCHASE_SETTLEMENT"
    ? await prepareFactoryPurchaseTransitionSettlement(factoryCost.id, {
        items: input.transitionItems,
        increaseAmount: input.transitionIncreaseAmount,
        decreaseAmount: input.transitionDecreaseAmount,
        reason: input.transitionReason,
        confirmed: input.transitionConfirmed,
      })
    : null;
  let draft: SupplierTaxContractDraft = preparedTransition?.draft || await buildSupplierTaxContractDraft(factoryCost.id);
  const dueDate = dateFromInput(input.dueDate);
  const message = nonEmpty(input.message).slice(0, 1000);
  const requiredTypes = requiredDocumentTypes(input.requiredDocumentTypes);
  if (!REQUIRED_TYPES.every((type) => requiredTypes.includes(type as never))) throw codedError("自动退税资料任务必须同时回传盖章合同和增值税发票。", 400, "SUPPLIER_TAX_DOCUMENTS_REQUIRED");
  const ccEmails = await adminCcEmails();
  const variables = supplierDocumentRequestTemplateVariables({ supplierName: supplier.supplierName, orderNo: order.orderNo || order.id, requiredTypes, dueDate, templateAttached: true, paymentVoucherAttached: false, companyName: draft.buyerName, message });
  const rendered = await renderNotificationTemplate(NOTIFICATION_TEMPLATE_TYPES.SUPPLIER_DOCUMENT_REQUEST, variables);
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      await assertBusinessOrderWritableInTransaction(tx, order.id, "该订单已提交退税或归档，不能创建退税合同。");
      await assertSupplierDocumentRequestCostAvailable(factoryCost, tx);
      if (preparedTransition?.settlementData) {
        await assertFactoryPurchaseTransitionAllocationAvailable(tx, preparedTransition.settlementData);
        const transitionId = randomUUID();
        await tx.factoryPurchaseTransitionSettlement.create({ data: { id: transitionId, ...preparedTransition.settlementData, confirmedById: requestedById } });
        const linked = await tx.orderCost.updateMany({
          where: { id: factoryCost.id, sourceType: "MANUAL", sourceId: null, deletedAt: null, status: "ACTIVE" },
          data: { sourceType: FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE, sourceId: transitionId, remark: `历史过渡结算确认：${preparedTransition.settlementData.reason}`.slice(0, 1000), updatedById: requestedById },
        });
        if (linked.count !== 1) throw codedError("成本状态已变化，请刷新后重试。", 409, "FACTORY_TRANSITION_COST_CONFLICT");
        draft = { ...draft, transitionSettlementId: transitionId };
      }
      return tx.supplierDocumentRequest.create({
        data: {
          orderId: order.id, purchaseOrderNo: order.orderNo || order.id, supplierId: supplier.id, costId: factoryCost.id, requestedById,
          requiredDocumentTypes: REQUIRED_TYPES, status: "待上传", dueDate, message: message || null, recipientEmails: recipients, ccEmails,
          sendStatus: "pending_review", emailSubject: rendered.subject, emailBody: rendered.body, contractNo: draft.contractNo,
          contractStatus: "PENDING_REVIEW", contractDraft: draft as unknown as Prisma.InputJsonValue, contractGeneratedById: requestedById, contractGeneratedAt: new Date(),
        },
        include: supplierDocumentRequestInclude(),
      });
    });
  } catch (error: unknown) {
    if (["P2002", "P2034"].includes(String((error as { code?: string })?.code || ""))) throw duplicateSupplierDocumentRequestError();
    throw error;
  }
  if (preparedTransition?.settlementData && draft.transitionSettlementId) {
    const data = preparedTransition.settlementData;
    await runNonCriticalTask("过渡结算审计", () => writeAudit(request, actor, "确认历史过渡结算", "factory_purchase_transition_settlements", draft.transitionSettlementId!, null, {
      costId: factoryCost.id, orderId: order.id, supplierId: supplier.id, customsDocumentId: data.customsDocumentId,
      goodsAmountWithTax: data.goodsAmountWithTax.toFixed(2), increaseAmount: data.increaseAmount.toFixed(2), decreaseAmount: data.decreaseAmount.toFixed(2), finalPayableAmount: data.finalPayableAmount.toFixed(2), reason: data.reason,
    }));
  }
  await runNonCriticalTask("退税合同草稿审计", () => writeAudit(request, actor, "生成退税合同草稿", "supplier_document_requests", created.id, null, {
    orderNo: order.orderNo, costId: factoryCost.id, supplierId: supplier.id, contractNo: draft.contractNo, warnings: draft.warnings,
    sourceType: draft.sourceType || "FACTORY_PURCHASE_SETTLEMENT", transitionSettlementId: draft.transitionSettlementId || null,
  }));
  return serializeSupplierDocumentRequest(created, actor);
}
