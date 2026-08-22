import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { assertWrite } from "./shared-access";
import { codedError, nonEmpty } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import { matchSupplierInvoiceToContract } from "./supplier-invoice-contract-match";
import { normalizeManualSupplierInvoice } from "./supplier-invoice-manual-values";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import {
  supplierDocumentRequestInclude,
  type ActorLike,
  type AuditRequestLike,
} from "./supplier-document-request-types";
import { serializeSupplierDocumentRequest } from "./supplier-document-request-serialization";

function approvedContract(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("退税合同尚未人工审核确认，不能保存发票核对结果。", 409, "SUPPLIER_TAX_CONTRACT_NOT_APPROVED");
  }
  return value as unknown as SupplierTaxContractDraft;
}

function positiveInteger(value: unknown, label: string) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw codedError(`${label}无效，请刷新后重试。`, 409, "SUPPLIER_INVOICE_MANUAL_REVISION_INVALID");
  }
  return result;
}

export async function saveSupplierInvoiceManualReview(
  request: AuditRequestLike,
  actor: ActorLike,
  requestId: string,
  input: Record<string, unknown>,
) {
  if (actor?.role !== "管理员") {
    throw codedError("只有管理员可以保存发票人工核对结果。", 403, "SUPPLIER_INVOICE_MANUAL_ADMIN_ONLY");
  }
  assertWrite(actor, "supplierDocuments");
  const actorId = nonEmpty(actor.id);
  const expectedRevision = positiveInteger(input.expectedRevision, "发票核对版本");
  const expectedOcrTaskId = nonEmpty(input.expectedOcrTaskId);
  if (!expectedOcrTaskId) {
    throw codedError("发票识别任务已变化，请刷新后重试。", 409, "SUPPLIER_INVOICE_MANUAL_TASK_REQUIRED");
  }

  const hint = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    select: { orderId: true },
  });
  if (!hint) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      hint.orderId,
      "该订单已提交退税或归档，不能再修改发票人工核对结果。",
    );
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "supplier_document_requests" WHERE "id" = ${requestId} FOR UPDATE
    `);
    const row = await tx.supplierDocumentRequest.findFirst({
      where: { id: requestId, deletedAt: null },
    });
    if (!row) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
    if (row.orderId !== hint.orderId) {
      throw codedError("资料回传任务已变化，请刷新后重试。", 409, "SUPPLIER_INVOICE_MANUAL_REQUEST_CONFLICT");
    }
    if (row.contractStatus !== "APPROVED") {
      throw codedError("退税合同尚未人工审核确认，不能保存发票核对结果。", 409, "SUPPLIER_TAX_CONTRACT_NOT_APPROVED");
    }
    if (row.invoiceMatchStatus === "PROCESSING") {
      throw codedError("发票OCR仍在识别，请稍后刷新。", 409, "SUPPLIER_INVOICE_OCR_PROCESSING");
    }
    if (row.invoiceMatchStatus === "CONFIRMED" || row.invoiceConfirmedAt) {
      throw codedError("该发票已人工确认，不能再修改。", 409, "SUPPLIER_INVOICE_ALREADY_CONFIRMED");
    }
    if (row.invoiceOcrTaskId !== expectedOcrTaskId) {
      throw codedError("发票已重新上传或重新扫描，请刷新后再编辑。", 409, "SUPPLIER_INVOICE_MANUAL_TASK_CONFLICT");
    }

    const task = await tx.ocrTask.findFirst({
      where: {
        id: expectedOcrTaskId,
        requestId: row.id,
        documentType: "SUPPLIER_INVOICE",
      },
    });
    if (!task) throw codedError("发票识别记录不存在，请重新执行OCR。", 404, "SUPPLIER_INVOICE_OCR_TASK_NOT_FOUND");
    if (task.reviewRevision !== expectedRevision) {
      throw codedError("发票人工核对结果已被其他人修改，请刷新后重试。", 409, "SUPPLIER_INVOICE_MANUAL_REVISION_CONFLICT");
    }
    if (task.confirmedAt) {
      throw codedError("该发票已人工确认，不能再修改。", 409, "SUPPLIER_INVOICE_ALREADY_CONFIRMED");
    }

    const beforeEffective = task.manualResultJson || task.resultJson || {};
    const manualInvoice = normalizeManualSupplierInvoice(input.invoice, beforeEffective);
    const match = matchSupplierInvoiceToContract(manualInvoice, approvedContract(row.contractApproved));
    if (manualInvoice.header.invoiceNo) {
      const duplicate = await tx.supplierDocumentRequest.findFirst({
        where: {
          invoiceNo: manualInvoice.header.invoiceNo,
          deletedAt: null,
          id: { not: row.id },
        },
        select: { id: true },
      });
      if (duplicate) {
        match.matched = false;
        match.issues.push("该发票号码已用于其他资料回传任务");
      }
    }
    const nextStatus = match.matched ? "AWAITING_REVIEW" : "MISMATCH";
    const editedAt = new Date();
    const claimedTask = await tx.ocrTask.updateMany({
      where: {
        id: task.id,
        reviewRevision: expectedRevision,
        confirmedAt: null,
      },
      data: {
        manualResultJson: manualInvoice as unknown as Prisma.InputJsonValue,
        manualValidationJson: match as unknown as Prisma.InputJsonValue,
        reviewRevision: { increment: 1 },
        manualEditedById: actorId,
        manualEditedAt: editedAt,
        validationStatus: match.matched ? "PASSED" : "EXCEPTION",
        status: "人工核对已保存",
      },
    });
    if (claimedTask.count !== 1) {
      throw codedError("发票人工核对结果已被其他人修改，请刷新后重试。", 409, "SUPPLIER_INVOICE_MANUAL_REVISION_CONFLICT");
    }
    const claimedRequest = await tx.supplierDocumentRequest.updateMany({
      where: {
        id: row.id,
        invoiceOcrTaskId: task.id,
        invoiceConfirmedAt: null,
      },
      data: {
        invoiceMatchStatus: nextStatus,
        invoiceMatchJson: match as unknown as Prisma.InputJsonValue,
        invoiceNo: manualInvoice.header.invoiceNo || null,
        invoiceConfirmedById: null,
        invoiceConfirmedAt: null,
        invoiceRejectReason: null,
      },
    });
    if (claimedRequest.count !== 1) {
      throw codedError("发票已重新上传或重新扫描，请刷新后再编辑。", 409, "SUPPLIER_INVOICE_MANUAL_TASK_CONFLICT");
    }
    await writeAudit(
      request,
      { id: actorId },
      "保存供应商发票人工核对结果",
      "ocr_tasks",
      task.id,
      { revision: expectedRevision, invoice: beforeEffective },
      {
        revision: expectedRevision + 1,
        invoice: manualInvoice,
        matched: match.matched,
        issues: match.issues,
        originalOcrRetained: Boolean(task.resultJson),
      },
      tx,
    );
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  const refreshed = await prisma.supplierDocumentRequest.findUnique({
    where: { id: requestId },
    include: supplierDocumentRequestInclude(),
  });
  return refreshed ? serializeSupplierDocumentRequest(refreshed, actor) : null;
}
