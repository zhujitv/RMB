import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, safeFileName, uploadToR2 } from "../r2";
import { assertWrite } from "./shared-access";
import { codedError, nonEmpty } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import { type SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import { applySupplierTaxContractDraftEdits } from "./supplier-tax-contract-draft-edit";
import { generateSupplierTaxContractXlsx } from "./supplier-tax-contract-xlsx";
import { refreshSupplierTaxContractBuyer } from "./supplier-tax-contract-buyer";
import {
  actorId,
  serializeSupplierDocumentRequest,
} from "./supplier-document-request-serialization";
import {
  supplierDocumentRequestInclude,
  type ActorLike,
  type AuditRequestLike,
} from "./supplier-document-request-types";
import { upsertFileAssetForSupplierRequestTemplate } from "./shared";
import { resendSupplierDocumentRequestNotice } from "./supplier-document-request-notice";
import {
  FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE,
} from "./supplier-transition-settlement";

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
  const draft = await refreshSupplierTaxContractBuyer(contractDraft(row.contractDraft));
  if (!draft.items.length || !draft.totalAmountWithTax || !draft.customsDocumentId) {
    throw codedError("合同草稿数据不完整，不能通过审核。", 409, "SUPPLIER_TAX_CONTRACT_DRAFT_INVALID");
  }
  if (draft.blockingIssues?.length) {
    throw codedError(`合同存在不能放行的报关匹配问题：${draft.blockingIssues.join("；")}`, 409, "SUPPLIER_TAX_CONTRACT_COMPLIANCE_BLOCKED");
  }
  if (!draft.supplierTaxNumber || !draft.buyerTaxNumber) {
    throw codedError("请先在供应商和业务主体设置中完整填写纳税人识别号。", 409, "SUPPLIER_TAX_ID_REQUIRED");
  }
  const [latestCustoms, settlement, transitionSettlement] = await Promise.all([
    prisma.orderDocument.findFirst({
      where: { orderId: row.orderId, documentType: "CUSTOMS_ENTRY_FORM", uploadStatus: "SUCCESS", deletedAt: null },
      orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    }),
    prisma.factoryPurchaseOrderSettlement.findUnique({ where: { purchaseOrderId: draft.purchaseOrderId }, select: { baseAmount: true } }),
    draft.transitionSettlementId
      ? prisma.factoryPurchaseTransitionSettlement.findUnique({
          where: { id: draft.transitionSettlementId },
          select: { costId: true, orderId: true, supplierId: true, customsDocumentId: true, goodsAmountWithTax: true },
        })
      : Promise.resolve(null),
  ]);
  if (latestCustoms?.id !== draft.customsDocumentId) {
    throw codedError("报关单已更新，请删除当前草稿并重新生成合同。", 409, "SUPPLIER_TAX_CONTRACT_CUSTOMS_CHANGED");
  }
  if (draft.sourceType === FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE) {
    if (
      !transitionSettlement
      || transitionSettlement.costId !== row.costId
      || transitionSettlement.orderId !== row.orderId
      || transitionSettlement.supplierId !== row.supplierId
      || transitionSettlement.customsDocumentId !== draft.customsDocumentId
      || !new Prisma.Decimal(draft.totalAmountWithTax).eq(transitionSettlement.goodsAmountWithTax)
    ) {
      throw codedError("历史过渡结算凭证与合同草稿不一致，不能通过审核。", 409, "SUPPLIER_TAX_CONTRACT_TRANSITION_CHANGED");
    }
  } else if (!settlement || !new Prisma.Decimal(draft.totalAmountWithTax).eq(settlement.baseAmount)) {
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

export async function saveSupplierTaxContractDraftEdits(
  request: AuditRequestLike,
  actor: ActorLike,
  requestId: string,
  input: Record<string, unknown>,
) {
  requireAdmin(actor);
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw codedError("合同草稿版本无效，请刷新后重试。", 400, "SUPPLIER_TAX_CONTRACT_REVISION_INVALID");
  }
  const row = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    include: supplierDocumentRequestInclude(),
  });
  if (!row) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (row.contractStatus !== "PENDING_REVIEW") {
    throw codedError("只有待审核合同草稿可以修改。", 409, "SUPPLIER_TAX_CONTRACT_NOT_PENDING");
  }
  const currentDraft = contractDraft(row.contractDraft);
  if (currentDraft.sourceType === FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE) {
    throw codedError("过渡结算合同的商品行已与冻结凭证绑定，如需修改请驳回并按纠错流程处理。", 409, "SUPPLIER_TAX_CONTRACT_TRANSITION_IMMUTABLE");
  }
  const edited = applySupplierTaxContractDraftEdits(
    currentDraft,
    Array.isArray(input.items) ? input.items as Array<Record<string, unknown>> : [],
  );
  const claimed = await prisma.supplierDocumentRequest.updateMany({
    where: { id: row.id, deletedAt: null, contractStatus: "PENDING_REVIEW", contractRevision: expectedRevision },
    data: {
      contractDraft: edited.draft as unknown as Prisma.InputJsonValue,
      contractRevision: { increment: 1 },
      contractReviewRemark: "合同商品信息已人工核查并保存",
    },
  });
  if (claimed.count !== 1) {
    throw codedError("合同草稿已被其他人修改，请刷新后重新核查。", 409, "SUPPLIER_TAX_CONTRACT_EDIT_CONFLICT");
  }
  const saved = await prisma.supplierDocumentRequest.findUnique({
    where: { id: row.id },
    include: supplierDocumentRequestInclude(),
  });
  if (!saved) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  await writeAudit(request, actor, "人工修正退税合同草稿", "supplier_document_requests", row.id, null, {
    contractNo: row.contractNo,
    previousRevision: expectedRevision,
    revision: expectedRevision + 1,
    changes: edited.changes,
    calculatedTotal: edited.calculatedTotal,
  });
  return serializeSupplierDocumentRequest(saved, actor);
}
