import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, safeFileName, uploadToR2 } from "../r2";
import { NOTIFICATION_TEMPLATE_TYPES, renderNotificationTemplate } from "./notification-engine";
import { assertWrite } from "./shared-access";
import { codedError, nonEmpty } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import { buildSupplierTaxContractDraft, type SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import { generateSupplierTaxContractXlsx } from "./supplier-tax-contract-xlsx";
import {
  actorId,
  adminCcEmails,
  dateFromInput,
  loadFactorySupplierReturnCostForRequest,
  requiredDocumentTypes,
  serializeSupplierDocumentRequest,
  supplierDocumentRequestTemplateVariables,
  supplierRecipientEmails,
} from "./supplier-document-request-serialization";
import {
  duplicateSupplierDocumentRequestError,
  supplierDocumentRequestInclude,
  type ActorLike,
  type AuditRequestLike,
  type SupplierDocumentRequestInput,
} from "./supplier-document-request-types";
import { runNonCriticalTask, upsertFileAssetForSupplierRequestTemplate } from "./shared";
import { resendSupplierDocumentRequestNotice } from "./supplier-document-request-notice";
import { assertSupplierDocumentRequestCostAvailable } from "./supplier-document-request-availability";

const REQUIRED_TYPES = ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"];
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function requireAdmin(actor: ActorLike) {
  if (actor?.role !== "管理员") throw codedError("只有管理员可以生成和审核退税合同。", 403, "SUPPLIER_TAX_CONTRACT_ADMIN_ONLY");
  assertWrite(actor, "supplierDocuments");
  return actorId(actor);
}

function contractDraft(value: Prisma.JsonValue | null): SupplierTaxContractDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("合同草稿不存在，请重新创建任务。", 409, "SUPPLIER_TAX_CONTRACT_DRAFT_MISSING");
  }
  return value as unknown as SupplierTaxContractDraft;
}

export async function createSupplierTaxContractRequest(
  request: AuditRequestLike,
  actor: ActorLike,
  input: SupplierDocumentRequestInput,
) {
  const requestedById = requireAdmin(actor);
  const factoryCost = await loadFactorySupplierReturnCostForRequest(input);
  const order = factoryCost.order;
  const supplier = factoryCost.supplier;
  if (!order || !supplier) throw codedError("请选择有效的工厂结算成本。", 404, "SUPPLIER_TAX_CONTRACT_COST_NOT_FOUND");
  if (!supplier.allowFactoryDocumentUpload) throw codedError("该供应商未开通资料回传权限。", 400, "SUPPLIER_DOCUMENT_UPLOAD_DISABLED");
  await assertSupplierDocumentRequestCostAvailable(factoryCost);
  const recipients = supplierRecipientEmails(supplier);
  if (!recipients.length) throw codedError("供应商没有可用邮箱，无法发送合同。", 400, "SUPPLIER_EMAIL_REQUIRED");
  const draft = await buildSupplierTaxContractDraft(factoryCost.id);
  const dueDate = dateFromInput(input.dueDate);
  const message = nonEmpty(input.message).slice(0, 1000);
  const requiredTypes = requiredDocumentTypes(input.requiredDocumentTypes);
  if (!REQUIRED_TYPES.every((type) => requiredTypes.includes(type as never))) {
    throw codedError("自动退税资料任务必须同时回传盖章合同和增值税发票。", 400, "SUPPLIER_TAX_DOCUMENTS_REQUIRED");
  }
  const ccEmails = await adminCcEmails();
  const variables = supplierDocumentRequestTemplateVariables({
    supplierName: supplier.supplierName,
    orderNo: order.orderNo || order.id,
    requiredTypes,
    dueDate,
    templateAttached: true,
    paymentVoucherAttached: false,
    companyName: draft.buyerName,
    message,
  });
  const rendered = await renderNotificationTemplate(NOTIFICATION_TEMPLATE_TYPES.SUPPLIER_DOCUMENT_REQUEST, variables);
  let created;
  try {
    created = await prisma.supplierDocumentRequest.create({
      data: {
        orderId: order.id,
        purchaseOrderNo: order.orderNo || order.id,
        supplierId: supplier.id,
        costId: factoryCost.id,
        requestedById,
        requiredDocumentTypes: REQUIRED_TYPES,
        status: "待上传",
        dueDate,
        message: message || null,
        recipientEmails: recipients,
        ccEmails,
        sendStatus: "pending_review",
        emailSubject: rendered.subject,
        emailBody: rendered.body,
        contractNo: draft.contractNo,
        contractStatus: "PENDING_REVIEW",
        contractDraft: draft as unknown as Prisma.InputJsonValue,
        contractGeneratedById: requestedById,
        contractGeneratedAt: new Date(),
      },
      include: supplierDocumentRequestInclude(),
    });
  } catch (error: unknown) {
    if (["P2002", "P2034"].includes(String((error as { code?: string })?.code || ""))) throw duplicateSupplierDocumentRequestError();
    throw error;
  }
  await runNonCriticalTask("退税合同草稿审计", () => writeAudit(request, actor, "生成退税合同草稿", "supplier_document_requests", created.id, null, {
    orderNo: order.orderNo,
    costId: factoryCost.id,
    supplierId: supplier.id,
    contractNo: draft.contractNo,
    warnings: draft.warnings,
  }));
  return serializeSupplierDocumentRequest(created, actor);
}

export async function reviewSupplierTaxContract(
  request: AuditRequestLike,
  actor: ActorLike,
  requestId: string,
  input: Record<string, unknown>,
) {
  const reviewedById = requireAdmin(actor);
  const decision = nonEmpty(input.decision).toUpperCase();
  const remark = nonEmpty(input.remark).slice(0, 1000);
  const row = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    include: supplierDocumentRequestInclude(),
  });
  if (!row) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (row.contractStatus !== "PENDING_REVIEW") throw codedError("当前合同不在待审核状态。", 409, "SUPPLIER_TAX_CONTRACT_NOT_PENDING");
  if (decision === "REJECTED") {
    const updated = await prisma.supplierDocumentRequest.update({
      where: { id: row.id },
      data: { contractStatus: "REJECTED", contractReviewedById: reviewedById, contractReviewedAt: new Date(), contractReviewRemark: remark || "人工审核未通过" },
      include: supplierDocumentRequestInclude(),
    });
    await writeAudit(request, actor, "退税合同审核不通过", "supplier_document_requests", row.id, null, { remark });
    return serializeSupplierDocumentRequest(updated, actor);
  }
  if (decision !== "APPROVED" || input.confirmed !== true) {
    throw codedError("请人工核查全部商品行及金额后勾选确认。", 400, "SUPPLIER_TAX_CONTRACT_CONFIRM_REQUIRED");
  }
  const draft = contractDraft(row.contractDraft);
  if (!draft.items.length || !draft.totalAmountWithTax || !draft.customsDocumentId) {
    throw codedError("合同草稿数据不完整，不能通过审核。", 409, "SUPPLIER_TAX_CONTRACT_DRAFT_INVALID");
  }
  if (draft.blockingIssues?.length) {
    throw codedError(`合同存在不能放行的报关匹配问题：${draft.blockingIssues.join("；")}`, 409, "SUPPLIER_TAX_CONTRACT_COMPLIANCE_BLOCKED");
  }
  if (!draft.supplierTaxNumber || !draft.buyerTaxNumber) {
    throw codedError("请先在供应商和业务主体设置中完整填写纳税人识别号。", 409, "SUPPLIER_TAX_ID_REQUIRED");
  }
  const [latestCustoms, settlement] = await Promise.all([
    prisma.orderDocument.findFirst({
      where: { orderId: row.orderId, documentType: "CUSTOMS_ENTRY_FORM", uploadStatus: "SUCCESS", deletedAt: null },
      orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    }),
    prisma.factoryPurchaseOrderSettlement.findUnique({ where: { purchaseOrderId: draft.purchaseOrderId }, select: { baseAmount: true } }),
  ]);
  if (latestCustoms?.id !== draft.customsDocumentId) {
    throw codedError("报关单已更新，请删除当前草稿并重新生成合同。", 409, "SUPPLIER_TAX_CONTRACT_CUSTOMS_CHANGED");
  }
  if (!settlement || !new Prisma.Decimal(draft.totalAmountWithTax).eq(settlement.baseAmount)) {
    throw codedError("采购结算金额已变化，请重新生成合同草稿。", 409, "SUPPLIER_TAX_CONTRACT_SETTLEMENT_CHANGED");
  }
  const body = await generateSupplierTaxContractXlsx(draft);
  const { bucket } = ensureR2Configured();
  const fileName = safeFileName(`${draft.contractNo}-退税合同.xlsx`);
  const storageKey = buildOrderDocumentKey({
    orderId: row.orderId,
    documentType: "SUPPLIER_PURCHASE_CONTRACT_TEMPLATE",
    relatedModule: "SUPPLIER",
    supplierId: row.supplierId,
    fileName: `${randomUUID()}-${fileName}`,
  });
  await uploadToR2({ key: storageKey, body, contentType: XLSX_MIME });
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.supplierDocumentRequest.updateMany({
        where: { id: row.id, deletedAt: null, contractStatus: "PENDING_REVIEW" },
        data: {
          contractStatus: "APPROVED",
          contractApproved: draft as unknown as Prisma.InputJsonValue,
          contractReviewedById: reviewedById,
          contractReviewedAt: new Date(),
          contractReviewRemark: remark || null,
          templateFileName: fileName,
          templateOriginalName: fileName,
          templateMimeType: XLSX_MIME,
          templateFileSize: body.length,
          templateStorageKey: storageKey,
          templateBucket: bucket,
          sendStatus: "pending",
        },
      });
      if (claimed.count !== 1) throw codedError("合同已被其他人审核，请刷新后查看。", 409, "SUPPLIER_TAX_CONTRACT_REVIEW_CONFLICT");
      const saved = await tx.supplierDocumentRequest.findUnique({ where: { id: row.id }, include: supplierDocumentRequestInclude() });
      if (!saved) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
      await upsertFileAssetForSupplierRequestTemplate(tx, saved);
      return saved;
    });
  } catch (error) {
    await deleteR2Object(storageKey).catch(() => null);
    throw error;
  }
  await writeAudit(request, actor, "退税合同审核通过", "supplier_document_requests", row.id, null, {
    contractNo: draft.contractNo,
    totalAmountWithTax: draft.totalAmountWithTax,
    itemCount: draft.items.length,
  });
  return resendSupplierDocumentRequestNotice(request, actor, updated.id);
}
