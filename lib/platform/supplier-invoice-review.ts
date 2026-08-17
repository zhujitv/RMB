import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { codedError, nonEmpty } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import { safeRefreshSupplierDocumentRequestCompletion } from "./supplier-document-request-completion";
import { matchSupplierInvoiceToContract } from "./supplier-invoice-contract-match";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import { recognizeTencentVatInvoice } from "./tencent-vat-invoice-ocr";
import { supplierDocumentRequestInclude, type ActorLike, type AuditRequestLike } from "./supplier-document-request-types";
import { serializeSupplierDocumentRequest } from "./supplier-document-request-serialization";
import { runNonCriticalTask, scheduleTaxRefundCompletenessRefresh, syncCostInvoiceStatus } from "./shared";

function approvedContract(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("退税合同尚未人工审核确认，不能识别发票。", 409, "SUPPLIER_TAX_CONTRACT_NOT_APPROVED");
  }
  return value as unknown as SupplierTaxContractDraft;
}

export async function processSupplierInvoiceOcr(requestId: string, documentId: string, body: Buffer) {
  const row = await prisma.supplierDocumentRequest.findUnique({ where: { id: requestId } });
  if (!row || row.deletedAt) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (row.contractStatus !== "APPROVED") throw codedError("退税合同尚未审核通过，不能上传发票。", 409, "SUPPLIER_TAX_CONTRACT_NOT_APPROVED");
  const task = await prisma.ocrTask.create({
    data: {
      module: "SUPPLIER_TAX_INVOICE",
      documentId,
      requestId,
      orderId: row.orderId,
      supplierId: row.supplierId,
      documentType: "SUPPLIER_INVOICE",
      status: "OCR识别中",
      validationStatus: "PROCESSING",
    },
  });
  await prisma.supplierDocumentRequest.update({ where: { id: requestId }, data: { invoiceMatchStatus: "PROCESSING", invoiceOcrTaskId: task.id, invoiceNo: null } });
  try {
    const invoice = await recognizeTencentVatInvoice(body);
    const match = matchSupplierInvoiceToContract(invoice, approvedContract(row.contractApproved));
    if (invoice.header.invoiceNo) {
      const duplicate = await prisma.supplierDocumentRequest.findFirst({
        where: { invoiceNo: invoice.header.invoiceNo, deletedAt: null, id: { not: requestId } },
        select: { id: true },
      });
      if (duplicate) {
        match.matched = false;
        match.issues.push("该发票号码已用于其他资料回传任务");
      }
    }
    const matchStatus = match.matched ? "AWAITING_REVIEW" : "MISMATCH";
    await prisma.$transaction([
      prisma.ocrTask.update({
        where: { id: task.id },
        data: {
          status: "OCR识别完成",
          validationStatus: match.matched ? "PASSED" : "EXCEPTION",
          resultJson: invoice as unknown as Prisma.InputJsonValue,
          validationJson: match as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.supplierDocumentRequest.updateMany({
        where: { id: requestId, invoiceOcrTaskId: task.id },
        data: {
          invoiceMatchStatus: matchStatus,
          invoiceMatchJson: match as unknown as Prisma.InputJsonValue,
          invoiceNo: invoice.header.invoiceNo || null,
          invoiceConfirmedById: null,
          invoiceConfirmedAt: null,
          invoiceRejectReason: null,
        },
      }),
    ]);
    return match;
  } catch (error) {
    const message = error instanceof Error ? error.message : "腾讯云发票OCR失败";
    await prisma.$transaction([
      prisma.ocrTask.update({ where: { id: task.id }, data: { status: "OCR识别失败", validationStatus: "FAILED", errorMessage: message.slice(0, 1000) } }),
      prisma.supplierDocumentRequest.updateMany({ where: { id: requestId, invoiceOcrTaskId: task.id }, data: { invoiceMatchStatus: "FAILED", invoiceMatchJson: { matched: false, issues: [message], checkedAt: new Date().toISOString() } } }),
    ]);
    return { matched: false, issues: [message], checkedAt: new Date().toISOString() };
  }
}

export async function reviewSupplierInvoice(
  request: AuditRequestLike,
  actor: ActorLike,
  requestId: string,
  input: Record<string, unknown>,
) {
  if (actor?.role !== "管理员") throw codedError("只有管理员可以确认发票OCR核验结果。", 403, "SUPPLIER_INVOICE_REVIEW_ADMIN_ONLY");
  assertWrite(actor, "supplierDocuments");
  const actorId = nonEmpty(actor.id);
  const decision = nonEmpty(input.decision).toUpperCase();
  const row = await prisma.supplierDocumentRequest.findFirst({ where: { id: requestId, deletedAt: null } });
  if (!row) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (decision === "CONFIRMED") {
    if (row.invoiceMatchStatus !== "AWAITING_REVIEW") throw codedError("只有OCR完整匹配的发票才能人工确认。", 409, "SUPPLIER_INVOICE_NOT_MATCHED");
    const match = row.invoiceMatchJson as { matched?: boolean; issues?: unknown[] } | null;
    if (!match?.matched || match.issues?.length) throw codedError("发票仍存在不匹配项，不能确认。", 409, "SUPPLIER_INVOICE_HAS_ISSUES");
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.supplierDocumentRequest.updateMany({ where: { id: row.id, invoiceMatchStatus: "AWAITING_REVIEW", invoiceOcrTaskId: row.invoiceOcrTaskId }, data: { invoiceMatchStatus: "CONFIRMED", invoiceConfirmedById: actorId, invoiceConfirmedAt: new Date(), invoiceRejectReason: null } });
      if (claimed.count !== 1) throw codedError("发票已被其他人处理，请刷新后查看。", 409, "SUPPLIER_INVOICE_REVIEW_CONFLICT");
      if (row.invoiceOcrTaskId) await tx.ocrTask.update({ where: { id: row.invoiceOcrTaskId }, data: { confirmedById: actorId, confirmedAt: new Date(), validationStatus: "CONFIRMED" } });
    });
    await safeRefreshSupplierDocumentRequestCompletion(row.id, { completedById: actorId });
    if (row.costId) await runNonCriticalTask("确认发票后同步成本状态", () => syncCostInvoiceStatus(row.costId as string));
    scheduleTaxRefundCompletenessRefresh(row.orderId);
  } else if (decision === "REJECTED") {
    const reason = nonEmpty(input.reason).slice(0, 1000);
    if (!reason) throw codedError("请填写发票驳回原因。", 400, "SUPPLIER_INVOICE_REJECT_REASON_REQUIRED");
    await prisma.supplierDocumentRequest.update({ where: { id: row.id }, data: { invoiceMatchStatus: "REJECTED", invoiceRejectReason: reason, invoiceConfirmedById: null, invoiceConfirmedAt: null } });
  } else throw codedError("发票审核决定无效。", 400, "SUPPLIER_INVOICE_REVIEW_DECISION_INVALID");
  await writeAudit(request, actor, decision === "CONFIRMED" ? "确认供应商发票OCR核验" : "驳回供应商发票", "supplier_document_requests", row.id, null, { invoiceNo: row.invoiceNo || "", reason: nonEmpty(input.reason) });
  const refreshed = await prisma.supplierDocumentRequest.findUnique({ where: { id: row.id }, include: supplierDocumentRequestInclude() });
  return refreshed ? serializeSupplierDocumentRequest(refreshed, actor) : null;
}
