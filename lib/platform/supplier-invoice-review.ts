import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { readR2Object } from "../r2";
import { assertWrite } from "./shared-access";
import { codedError } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import { matchSupplierInvoiceToContract } from "./supplier-invoice-contract-match";
import { normalizeManualSupplierInvoice } from "./supplier-invoice-manual-values";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import { recognizeTencentVatInvoice } from "./tencent-vat-invoice-ocr";
import { supplierDocumentRequestInclude, type ActorLike, type AuditRequestLike } from "./supplier-document-request-types";
import { serializeSupplierDocumentRequest } from "./supplier-document-request-serialization";

export { reviewSupplierInvoice } from "./supplier-invoice-review-decision";

function approvedContract(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("退税合同尚未人工审核确认，不能识别发票。", 409, "SUPPLIER_TAX_CONTRACT_NOT_APPROVED");
  }
  return value as unknown as SupplierTaxContractDraft;
}

type ProcessSupplierInvoiceOcrOptions = {
  preserveManualFromTaskId?: string;
};

export async function processSupplierInvoiceOcr(
  requestId: string,
  documentId: string,
  body: Buffer,
  options: ProcessSupplierInvoiceOcrOptions = {},
) {
  const row = await prisma.supplierDocumentRequest.findUnique({ where: { id: requestId } });
  if (!row || row.deletedAt) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (row.contractStatus !== "APPROVED") throw codedError("退税合同尚未审核通过，不能上传发票。", 409, "SUPPLIER_TAX_CONTRACT_NOT_APPROVED");
  if (row.invoiceMatchStatus === "CONFIRMED" || row.invoiceConfirmedAt) {
    throw codedError("该发票已人工确认，不能重新识别或替换。", 409, "SUPPLIER_INVOICE_ALREADY_CONFIRMED");
  }
  const preservedTask = options.preserveManualFromTaskId
    ? await prisma.ocrTask.findFirst({
      where: {
        id: options.preserveManualFromTaskId,
        requestId: row.id,
        documentType: "SUPPLIER_INVOICE",
      },
    })
    : null;
  const preservedInvoice = preservedTask?.manualResultJson
    ? normalizeManualSupplierInvoice(preservedTask.manualResultJson, preservedTask.manualResultJson)
    : null;
  const preservedMatch = preservedInvoice
    ? matchSupplierInvoiceToContract(preservedInvoice, approvedContract(row.contractApproved))
    : null;
  if (preservedInvoice?.header.invoiceNo) {
    const duplicate = await prisma.supplierDocumentRequest.findFirst({
      where: { invoiceNo: preservedInvoice.header.invoiceNo, deletedAt: null, id: { not: requestId } },
      select: { id: true },
    });
    if (duplicate && preservedMatch) {
      preservedMatch.matched = false;
      preservedMatch.issues.push("该发票号码已用于其他资料回传任务");
    }
  }
  const task = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "supplier_document_requests" WHERE "id" = ${requestId} FOR UPDATE
    `);
    const current = await tx.supplierDocumentRequest.findFirst({ where: { id: requestId, deletedAt: null } });
    if (!current) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
    if (current.contractStatus !== "APPROVED") {
      throw codedError("退税合同尚未审核通过，不能执行发票OCR。", 409, "SUPPLIER_TAX_CONTRACT_NOT_APPROVED");
    }
    if (current.invoiceMatchStatus === "CONFIRMED" || current.invoiceConfirmedAt) {
      throw codedError("该发票已人工确认，不能重新识别或替换。", 409, "SUPPLIER_INVOICE_ALREADY_CONFIRMED");
    }
    const created = await tx.ocrTask.create({
      data: {
        module: "SUPPLIER_TAX_INVOICE",
        documentId,
        requestId,
        orderId: current.orderId,
        supplierId: current.supplierId,
        documentType: "SUPPLIER_INVOICE",
        status: "OCR识别中",
        validationStatus: "PROCESSING",
        ...(preservedInvoice && preservedMatch && preservedTask?.manualEditedById && preservedTask.manualEditedAt ? {
          manualResultJson: preservedInvoice as unknown as Prisma.InputJsonValue,
          manualValidationJson: preservedMatch as unknown as Prisma.InputJsonValue,
          reviewRevision: preservedTask.reviewRevision,
          manualEditedById: preservedTask.manualEditedById,
          manualEditedAt: preservedTask.manualEditedAt,
        } : {}),
      },
    });
    await tx.supplierDocumentRequest.update({
      where: { id: current.id },
      data: {
        invoiceMatchStatus: "PROCESSING",
        invoiceOcrTaskId: created.id,
        invoiceNo: preservedInvoice?.header.invoiceNo || null,
        invoiceRejectReason: null,
      },
    });
    return created;
  });
  try {
    const invoice = await recognizeTencentVatInvoice(body);
    const rawMatch = matchSupplierInvoiceToContract(invoice, approvedContract(row.contractApproved));
    if (invoice.header.invoiceNo) {
      const duplicate = await prisma.supplierDocumentRequest.findFirst({
        where: { invoiceNo: invoice.header.invoiceNo, deletedAt: null, id: { not: requestId } },
        select: { id: true },
      });
      if (duplicate) {
        rawMatch.matched = false;
        rawMatch.issues.push("该发票号码已用于其他资料回传任务");
      }
    }
    const effectiveMatch = preservedMatch || rawMatch;
    const effectiveInvoice = preservedInvoice || invoice;
    const matchStatus = effectiveMatch.matched ? "AWAITING_REVIEW" : "MISMATCH";
    await prisma.$transaction([
      prisma.ocrTask.update({
        where: { id: task.id },
        data: {
          status: "OCR识别完成",
          validationStatus: effectiveMatch.matched ? "PASSED" : "EXCEPTION",
          resultJson: invoice as unknown as Prisma.InputJsonValue,
          validationJson: rawMatch as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.supplierDocumentRequest.updateMany({
        where: { id: requestId, invoiceOcrTaskId: task.id },
        data: {
          invoiceMatchStatus: matchStatus,
          invoiceMatchJson: effectiveMatch as unknown as Prisma.InputJsonValue,
          invoiceNo: effectiveInvoice.header.invoiceNo || null,
          invoiceRejectReason: null,
        },
      }),
    ]);
    return effectiveMatch;
  } catch (error) {
    const message = error instanceof Error ? error.message : "腾讯云发票OCR失败";
    const effectiveStatus = preservedMatch
      ? (preservedMatch.matched ? "AWAITING_REVIEW" : "MISMATCH")
      : "FAILED";
    const effectiveValidation = preservedMatch
      ? (preservedMatch.matched ? "PASSED" : "EXCEPTION")
      : "FAILED";
    const failureMatch = preservedMatch || { matched: false, issues: [message], checkedAt: new Date().toISOString() };
    await prisma.$transaction([
      prisma.ocrTask.update({
        where: { id: task.id },
        data: {
          status: preservedMatch ? "OCR识别失败，已保留人工核对结果" : "OCR识别失败",
          validationStatus: effectiveValidation,
          errorMessage: message.slice(0, 1000),
        },
      }),
      prisma.supplierDocumentRequest.updateMany({
        where: { id: requestId, invoiceOcrTaskId: task.id },
        data: {
          invoiceMatchStatus: effectiveStatus,
          invoiceMatchJson: failureMatch as unknown as Prisma.InputJsonValue,
          invoiceNo: preservedInvoice?.header.invoiceNo || null,
        },
      }),
    ]);
    return failureMatch;
  }
}

export async function retrySupplierInvoiceOcr(
  request: AuditRequestLike,
  actor: ActorLike,
  requestId: string,
) {
  if (actor?.role !== "管理员") throw codedError("只有管理员可以重新执行发票OCR。", 403, "SUPPLIER_INVOICE_RETRY_ADMIN_ONLY");
  assertWrite(actor, "supplierDocuments");
  const row = await prisma.supplierDocumentRequest.findFirst({ where: { id: requestId, deletedAt: null } });
  if (!row) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (row.contractStatus !== "APPROVED" || !row.contractApproved) {
    throw codedError("退税合同尚未人工审核通过，不能执行发票OCR。", 409, "SUPPLIER_TAX_CONTRACT_NOT_APPROVED");
  }
  if (row.invoiceMatchStatus === "PROCESSING") {
    throw codedError("发票OCR正在识别，请稍后刷新。", 409, "SUPPLIER_INVOICE_OCR_PROCESSING");
  }
  if (row.invoiceMatchStatus === "CONFIRMED" || row.invoiceConfirmedAt) {
    throw codedError("发票已人工确认，不能重新执行OCR。", 409, "SUPPLIER_INVOICE_ALREADY_CONFIRMED");
  }
  const document = await prisma.orderDocument.findFirst({
    where: {
      factoryDocumentRequestId: row.id,
      documentType: "SUPPLIER_INVOICE",
      uploadStatus: "SUCCESS",
      deletedAt: null,
    },
    orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, storageKey: true },
  });
  if (!document?.storageKey) {
    throw codedError("尚未找到可识别的供应商发票，请先上传PDF。", 409, "SUPPLIER_INVOICE_DOCUMENT_MISSING");
  }
  const body = await readR2Object(document.storageKey, { maxBytes: 10 * 1024 * 1024 });
  const result = await processSupplierInvoiceOcr(row.id, document.id, body, {
    preserveManualFromTaskId: row.invoiceOcrTaskId || undefined,
  });
  await writeAudit(request, actor, "重新执行供应商发票腾讯云OCR", "supplier_document_requests", row.id, null, {
    documentId: document.id,
    matched: Boolean(result.matched),
    issueCount: result.issues?.length || 0,
  });
  const refreshed = await prisma.supplierDocumentRequest.findUnique({
    where: { id: row.id },
    include: supplierDocumentRequestInclude(),
  });
  return refreshed ? serializeSupplierDocumentRequest(refreshed, actor) : null;
}
