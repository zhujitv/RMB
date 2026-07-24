import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { saveOcrRawResult } from "./ocr-raw-results";
import { codedError, dateFromInput } from "./shared";
import { parseVatInvoiceFields } from "./vat-invoice-ocr-shared";
import {
  LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE,
  LOGISTICS_INVOICE_OCR_MODULE,
  LOGISTICS_INVOICE_VALIDATION_FAILED,
  LOGISTICS_INVOICE_VALIDATION_PASSED,
  LOGISTICS_INVOICE_VALIDATION_PROCESSING,
} from "./logistics-invoice-validation-model";

type VatInvoiceFields = ReturnType<typeof parseVatInvoiceFields>;
type OcrFieldRow = { key: string; label: string; value: string };

export async function persistLogisticsInvoiceRecognitionSuccess(input: {
  taskId: string;
  documentId: string;
  documentOrderId: string;
  rowIds: string[];
  actorId: string | null;
  status: string;
  message: string;
  text: string;
  fields: VatInvoiceFields;
  validationJson: Record<string, unknown>;
  recognizedAmount: number;
  fieldRows: OcrFieldRow[];
  rawJson: unknown;
  provider: string;
  apiName: string;
  structuredFields: Record<string, unknown>;
  parser: string;
  confidence: number | null;
}) {
  return prisma.$transaction(async (tx) => {
    const writable = await tx.ocrTask.updateMany({
      where: {
        id: input.taskId,
        module: LOGISTICS_INVOICE_OCR_MODULE,
        status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
        validationStatus: "PROCESSING",
      },
      data: {
        status: input.status,
        validationStatus: input.status === LOGISTICS_INVOICE_VALIDATION_PASSED ? "PASSED" : "EXCEPTION",
        errorMessage: input.message || null,
        rawText: input.text.slice(0, 120000),
        resultJson: input.fields as unknown as Prisma.InputJsonValue,
        validationJson: input.validationJson as Prisma.InputJsonValue,
      },
    });
    if (!writable.count) {
      const current = await tx.ocrTask.findUnique({ where: { id: input.taskId }, include: { results: true } });
      if (current) return current;
      throw codedError("物流发票识别任务不存在。", 404, "LOGISTICS_INVOICE_OCR_TASK_NOT_FOUND");
    }
    await saveOcrRawResult({
      documentId: input.documentId,
      orderId: input.documentOrderId,
      documentType: LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE,
      provider: input.provider,
      apiName: input.apiName,
      rawJson: input.rawJson,
      parsedJson: {
        fields: input.fields,
        structuredFields: input.structuredFields,
        validation: input.validationJson,
        parser: input.parser,
      },
      confidence: input.confidence,
      status: input.status === LOGISTICS_INVOICE_VALIDATION_PASSED ? "SUCCESS" : "EXCEPTION",
      errorMessage: input.message,
    }, tx);
    await tx.ocrResult.deleteMany({ where: { taskId: input.taskId } });
    if (input.fieldRows.length) {
      await tx.ocrResult.createMany({
        data: input.fieldRows.map((field) => ({
          taskId: input.taskId,
          fieldKey: field.key,
          label: field.label,
          value: field.value,
          rawValue: field.value,
        })),
      });
    }
    await tx.logisticsExpense.updateMany({
      where: {
        id: { in: input.rowIds },
        deletedAt: null,
        invoiceOcrTaskId: input.taskId,
        invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
      },
      data: {
        invoiceValidationStatus: input.status,
        invoiceValidationMessage: input.message || null,
        invoiceValidationJson: input.validationJson as Prisma.InputJsonValue,
        invoiceOcrTaskId: input.taskId,
        invoiceRecognizedNo: input.fields.invoiceNo || null,
        invoiceRecognizedDate: dateFromInput(input.fields.invoiceDate),
        invoiceRecognizedSeller: input.fields.seller || null,
        invoiceRecognizedBuyer: input.fields.buyer || null,
        invoiceRecognizedAmount: input.recognizedAmount || null,
        invoiceRecognizedName: input.fields.productName || null,
        updatedById: input.actorId,
      },
    });
    return tx.ocrTask.findUnique({ where: { id: input.taskId }, include: { results: true } });
  });
}

export async function persistLogisticsInvoiceRecognitionFailure(input: {
  taskId: string;
  documentId: string;
  documentOrderId: string;
  rowIds: string[];
  actorId: string | null;
  message: string;
  validationJson: Record<string, unknown>;
  rawText: string;
  rawJson: unknown;
  provider: string;
  apiName: string;
}) {
  return prisma.$transaction(async (tx) => {
    const writable = await tx.ocrTask.updateMany({
      where: {
        id: input.taskId,
        module: LOGISTICS_INVOICE_OCR_MODULE,
        status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
        validationStatus: "PROCESSING",
      },
      data: {
        status: LOGISTICS_INVOICE_VALIDATION_FAILED,
        validationStatus: "FAILED",
        errorMessage: input.message.slice(0, 1000),
        rawText: input.rawText ? input.rawText.slice(0, 120000) : null,
        validationJson: input.validationJson as Prisma.InputJsonValue,
      },
    });
    if (!writable.count) {
      return tx.ocrTask.findUnique({ where: { id: input.taskId }, include: { results: true } });
    }
    await saveOcrRawResult({
      documentId: input.documentId,
      orderId: input.documentOrderId,
      documentType: LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE,
      provider: input.provider,
      apiName: input.apiName,
      rawJson: input.rawJson || (input.rawText ? { text: input.rawText } : null),
      parsedJson: input.rawText ? { rawText: input.rawText } : null,
      status: "FAILED",
      errorMessage: input.message,
    }, tx).catch(() => null);
    await tx.logisticsExpense.updateMany({
      where: {
        id: { in: input.rowIds },
        deletedAt: null,
        invoiceOcrTaskId: input.taskId,
        invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
      },
      data: {
        invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_FAILED,
        invoiceValidationMessage: input.message.slice(0, 1000),
        invoiceValidationJson: input.validationJson as Prisma.InputJsonValue,
        invoiceOcrTaskId: input.taskId,
        updatedById: input.actorId,
      },
    });
    return tx.ocrTask.findUnique({ where: { id: input.taskId }, include: { results: true } });
  });
}
