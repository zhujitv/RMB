import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  syncCostInvoiceStatus,
} from "./shared";
import { assertWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError, nonEmpty } from "./shared-base-utils";
import { safeRefreshSupplierDocumentRequestCompletion } from "./supplier-document-request-completion";
import { serializeSupplierDocumentRequest } from "./supplier-document-request-serialization";
import {
  supplierDocumentRequestInclude,
  type ActorLike,
  type AuditRequestLike,
} from "./supplier-document-request-types";

function expectedInvoiceReviewRevision(value: unknown) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) {
    throw codedError("发票核对版本无效，请刷新后重试。", 409, "SUPPLIER_INVOICE_REVIEW_REVISION_INVALID");
  }
  return revision;
}

export async function reviewSupplierInvoice(
  request: AuditRequestLike,
  actor: ActorLike,
  requestId: string,
  input: Record<string, unknown>,
) {
  if (actor?.role !== "管理员") {
    throw codedError(
      "只有管理员可以确认发票OCR核验结果。",
      403,
      "SUPPLIER_INVOICE_REVIEW_ADMIN_ONLY",
    );
  }
  assertWrite(actor, "supplierDocuments");
  const actorId = nonEmpty(actor.id);
  const decision = nonEmpty(input.decision).toUpperCase();
  let row = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
  });
  if (!row) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (decision === "CONFIRMED") {
    const expectedOcrTaskId = nonEmpty(input.expectedOcrTaskId);
    const expectedRevision = expectedInvoiceReviewRevision(input.expectedRevision);
    if (!expectedOcrTaskId) {
      throw codedError("发票识别任务已变化，请刷新后重试。", 409, "SUPPLIER_INVOICE_REVIEW_TASK_REQUIRED");
    }
    const confirmedRow = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "supplier_document_requests" WHERE "id" = ${requestId} FOR UPDATE
      `);
      const current = await tx.supplierDocumentRequest.findFirst({
        where: { id: requestId, deletedAt: null },
      });
      if (!current) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
      if (current.invoiceOcrTaskId !== expectedOcrTaskId) {
        throw codedError("发票已重新上传或重新扫描，请刷新后再确认。", 409, "SUPPLIER_INVOICE_REVIEW_TASK_CONFLICT");
      }
      if (current.invoiceMatchStatus !== "AWAITING_REVIEW") {
        throw codedError("只有OCR或人工核对结果完整匹配的发票才能确认。", 409, "SUPPLIER_INVOICE_NOT_MATCHED");
      }
      const match = current.invoiceMatchJson as { matched?: boolean; issues?: unknown[] } | null;
      if (!match?.matched || match.issues?.length) {
        throw codedError("发票仍存在不匹配项，不能确认。", 409, "SUPPLIER_INVOICE_HAS_ISSUES");
      }
      const task = await tx.ocrTask.findFirst({
        where: { id: expectedOcrTaskId, requestId: current.id, documentType: "SUPPLIER_INVOICE" },
      });
      if (!task) throw codedError("发票识别记录不存在，请刷新后重试。", 404, "SUPPLIER_INVOICE_OCR_TASK_NOT_FOUND");
      if (task.reviewRevision !== expectedRevision) {
        throw codedError(
          "发票人工核对结果已被其他人修改，请刷新后重试。",
          409,
          "SUPPLIER_INVOICE_REVIEW_REVISION_CONFLICT",
        );
      }
      if (task.confirmedAt || current.invoiceConfirmedAt) {
        throw codedError("该发票已人工确认，不能重复确认。", 409, "SUPPLIER_INVOICE_ALREADY_CONFIRMED");
      }
      const confirmedAt = new Date();
      const claimedRequest = await tx.supplierDocumentRequest.updateMany({
        where: {
          id: current.id,
          invoiceMatchStatus: "AWAITING_REVIEW",
          invoiceOcrTaskId: expectedOcrTaskId,
          invoiceConfirmedAt: null,
        },
        data: {
          invoiceMatchStatus: "CONFIRMED",
          invoiceConfirmedById: actorId,
          invoiceConfirmedAt: confirmedAt,
          invoiceRejectReason: null,
        },
      });
      if (claimedRequest.count !== 1) {
        throw codedError("发票已被其他人处理，请刷新后查看。", 409, "SUPPLIER_INVOICE_REVIEW_CONFLICT");
      }
      const claimedTask = await tx.ocrTask.updateMany({
        where: { id: task.id, reviewRevision: expectedRevision, confirmedAt: null },
        data: { confirmedById: actorId, confirmedAt, validationStatus: "CONFIRMED" },
      });
      if (claimedTask.count !== 1) {
        throw codedError("发票核对版本已变化，请刷新后重试。", 409, "SUPPLIER_INVOICE_REVIEW_REVISION_CONFLICT");
      }
      return current;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    row = confirmedRow;
    await safeRefreshSupplierDocumentRequestCompletion(confirmedRow.id, { completedById: actorId });
    if (confirmedRow.costId) {
      await runNonCriticalTask("确认发票后同步成本状态", () => syncCostInvoiceStatus(confirmedRow.costId as string));
    }
    scheduleTaxRefundCompletenessRefresh(confirmedRow.orderId);
  } else if (decision === "REJECTED") {
    if (row.invoiceMatchStatus === "CONFIRMED" || row.invoiceConfirmedAt) {
      throw codedError("该发票已人工确认，不能驳回或重新打开。", 409, "SUPPLIER_INVOICE_ALREADY_CONFIRMED");
    }
    const reason = nonEmpty(input.reason).slice(0, 1000);
    if (!reason) throw codedError("请填写发票驳回原因。", 400, "SUPPLIER_INVOICE_REJECT_REASON_REQUIRED");
    const rejected = await prisma.supplierDocumentRequest.updateMany({
      where: { id: row.id, invoiceConfirmedAt: null, invoiceMatchStatus: { not: "CONFIRMED" } },
      data: { invoiceMatchStatus: "REJECTED", invoiceRejectReason: reason },
    });
    if (rejected.count !== 1) {
      throw codedError("发票已被其他人处理，请刷新后查看。", 409, "SUPPLIER_INVOICE_REVIEW_CONFLICT");
    }
  } else {
    throw codedError("发票审核决定无效。", 400, "SUPPLIER_INVOICE_REVIEW_DECISION_INVALID");
  }
  await writeAudit(
    request,
    actor,
    decision === "CONFIRMED" ? "确认供应商发票OCR核验" : "驳回供应商发票",
    "supplier_document_requests",
    row.id,
    null,
    { invoiceNo: row.invoiceNo || "", reason: nonEmpty(input.reason) },
  );
  const refreshed = await prisma.supplierDocumentRequest.findUnique({
    where: { id: row.id },
    include: supplierDocumentRequestInclude(),
  });
  return refreshed ? serializeSupplierDocumentRequest(refreshed, actor) : null;
}
