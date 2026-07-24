import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { parseVatInvoiceFields } from "./vat-invoice-ocr-shared";
import { logisticsInvoiceGroupForKey } from "./logistics-invoice-groups";
import {
  codedError,
  dateFromInput,
  nonEmpty,
  optional,
} from "./shared";
import {
  LOGISTICS_INVOICE_OCR_MODULE,
  LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE,
  LOGISTICS_INVOICE_VALIDATION_NOT_UPLOADED,
  LOGISTICS_INVOICE_VALIDATION_UPLOADED,
  LOGISTICS_INVOICE_VALIDATION_PROCESSING,
  LOGISTICS_INVOICE_VALIDATION_FAILED,
  type ActorLike,
  type LogisticsInvoiceValidationRow,
  jsonInput,
} from "./logistics-invoice-validation-model";
export async function markLogisticsInvoiceValidationUploaded(rowIds: string[], actor: ActorLike) {
  const ids = rowIds.filter(Boolean);
  if (!ids.length) return;
  await prisma.logisticsExpense.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data: {
      invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_UPLOADED,
      invoiceValidationMessage: null,
      invoiceValidationJson: Prisma.JsonNull,
      invoiceOcrTaskId: null,
      invoiceRecognizedNo: null,
      invoiceRecognizedDate: null,
      invoiceRecognizedSeller: null,
      invoiceRecognizedBuyer: null,
      invoiceRecognizedAmount: null,
      invoiceRecognizedName: null,
      invoiceManualConfirmedById: null,
      invoiceManualConfirmedAt: null,
      invoiceManualConfirmReason: null,
      updatedById: actor?.id || null,
    },
  });
}

export async function createLogisticsInvoiceRecognitionTask(input: {
  documentId: string;
  invoiceGroupKey: string;
  rows: LogisticsInvoiceValidationRow[];
  actor: ActorLike;
}, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const documentId = nonEmpty(input.documentId);
  const invoiceGroup = logisticsInvoiceGroupForKey(input.invoiceGroupKey);
  const rows = input.rows.filter((row) => row.id);
  const rowIds = rows.map((row) => row.id);
  if (!documentId || !invoiceGroup || !rowIds.length) {
    throw codedError("物流发票识别任务参数不完整。", 400, "LOGISTICS_INVOICE_OCR_TASK_INVALID");
  }
  const document = await db.orderDocument.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { id: true, orderId: true, supplierId: true },
  });
  if (!document) throw codedError("物流发票文件不存在或已删除。", 404, "LOGISTICS_INVOICE_DOCUMENT_NOT_FOUND");
  const validationJson = {
    documentId,
    invoiceGroupKey: invoiceGroup.key,
    rowIds,
  };
  await cancelProcessingLogisticsInvoiceOcrTasks({
    documentId,
    rowIds,
    reason: "已重新发起识别，旧识别任务已取消。",
  }, db);
  const task = await db.ocrTask.create({
    data: {
      module: LOGISTICS_INVOICE_OCR_MODULE,
      documentId,
      orderId: document.orderId,
      supplierId: document.supplierId,
      documentType: LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE,
      status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
      validationStatus: "PROCESSING",
      validationJson,
    },
    include: { results: true },
  });
  const reserved = await db.logisticsExpense.updateMany({
    where: {
      id: { in: rowIds },
      deletedAt: null,
      invoiceDocumentId: documentId,
      invoiceStatus: "已上传",
      invoiceConfirmedAt: null,
      invoiceValidationStatus: "识别中",
    },
    data: {
      invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
      invoiceValidationMessage: null,
      invoiceValidationJson: validationJson,
      invoiceOcrTaskId: task.id,
      invoiceRecognizedNo: null,
      invoiceRecognizedDate: null,
      invoiceRecognizedSeller: null,
      invoiceRecognizedBuyer: null,
      invoiceRecognizedAmount: null,
      invoiceRecognizedName: null,
      invoiceManualConfirmedById: null,
      invoiceManualConfirmedAt: null,
      invoiceManualConfirmReason: null,
      updatedById: input.actor?.id || null,
    },
  });
  if (reserved.count !== rowIds.length) {
    throw codedError("发票状态已变化，识别任务已取消，请刷新后重试。", 409, "LOGISTICS_INVOICE_OCR_RESERVATION_CHANGED");
  }
  return task;
}

export async function cancelProcessingLogisticsInvoiceOcrTasks(input: {
  documentId: string;
  rowIds?: string[];
  reason: string;
}, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const rowIds = (input.rowIds || []).filter(Boolean);
  const updated = await db.ocrTask.updateMany({
    where: {
      module: LOGISTICS_INVOICE_OCR_MODULE,
      documentId: input.documentId,
      OR: [
        { status: LOGISTICS_INVOICE_VALIDATION_PROCESSING },
        { validationStatus: "PROCESSING" },
      ],
    },
    data: {
      status: LOGISTICS_INVOICE_VALIDATION_FAILED,
      validationStatus: "FAILED",
      errorMessage: input.reason,
      validationJson: {
        documentId: input.documentId,
        rowIds,
        issues: [{ level: "manual", message: input.reason }],
        parserStatus: "物流发票识别任务已取消",
      },
    },
  });
  return updated.count;
}

export async function clearLogisticsInvoiceValidation(rowIds: string[], actor: ActorLike) {
  const ids = rowIds.filter(Boolean);
  if (!ids.length) return;
  await prisma.logisticsExpense.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data: {
      invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_NOT_UPLOADED,
      invoiceValidationMessage: null,
      invoiceValidationJson: Prisma.JsonNull,
      invoiceOcrTaskId: null,
      invoiceRecognizedNo: null,
      invoiceRecognizedDate: null,
      invoiceRecognizedSeller: null,
      invoiceRecognizedBuyer: null,
      invoiceRecognizedAmount: null,
      invoiceRecognizedName: null,
      invoiceManualConfirmedById: null,
      invoiceManualConfirmedAt: null,
      invoiceManualConfirmReason: null,
      updatedById: actor?.id || null,
    },
  });
}

export async function updateRowsWithValidationResult(input: {
  rowIds: string[];
  actor: ActorLike;
  status: string;
  message?: string;
  validationJson?: unknown;
  taskId?: string | null;
  fields?: ReturnType<typeof parseVatInvoiceFields> | null;
  expectedTaskId?: string;
  expectedStatus?: string;
}) {
  const fields = input.fields || null;
  await prisma.logisticsExpense.updateMany({
    where: {
      id: { in: input.rowIds },
      deletedAt: null,
      ...(input.expectedTaskId ? { invoiceOcrTaskId: input.expectedTaskId } : {}),
      ...(input.expectedStatus ? { invoiceValidationStatus: input.expectedStatus } : {}),
    },
    data: {
      invoiceValidationStatus: input.status,
      invoiceValidationMessage: optional(input.message),
      invoiceValidationJson: jsonInput(input.validationJson || null),
      invoiceOcrTaskId: input.taskId || null,
      invoiceRecognizedNo: fields?.invoiceNo || null,
      invoiceRecognizedDate: dateFromInput(fields?.invoiceDate),
      invoiceRecognizedSeller: fields?.seller || null,
      invoiceRecognizedBuyer: fields?.buyer || null,
      invoiceRecognizedAmount: fields?.amountWithTax || null,
      invoiceRecognizedName: fields?.productName || null,
      updatedById: input.actor?.id || null,
    },
  });
}
