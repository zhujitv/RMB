import { Prisma } from "../generated/prisma/client.js";
import { readR2Object } from "../r2";
import { prisma } from "../prisma";
import { recognizeLogisticsInvoiceWithOcr } from "./ocr-integration";
import { saveOcrRawResult } from "./ocr-raw-results";
import { looselyMatches, parseVatInvoiceFields, supplierDocumentLabels, visibleResultFields } from "./supplier-document-ocr-shared";
import { invoiceParserIssues } from "./supplier-document-ocr-validation";
import { getLogisticsInvoiceValidationRules } from "./logistics-invoice-validation-rules";
import { extractLogisticsForeignCurrencyAmount } from "./logistics-invoice-amount-parser";
import {
  logisticsInvoiceGroupCurrencies,
  logisticsInvoiceGroupForExpense,
  logisticsInvoiceGroupForKey,
  OCEAN_FREIGHT_INVOICE_GROUP_KEY,
  type LogisticsInvoiceGroupDefinition,
} from "./logistics-invoice-groups";
import { codedError, dateFromInput, nonEmpty, num, optional, runNonCriticalTask, scheduleTaxRefundCompletenessRefresh, writeAudit } from "./shared";
import { DEFAULT_COMPANY_PROFILE_SETTINGS } from "./shared-constants";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";

export const LOGISTICS_INVOICE_OCR_MODULE = "LOGISTICS_INVOICE";
export const LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE = "LOGISTICS_INVOICE";
export const LOGISTICS_INVOICE_VALIDATION_NOT_UPLOADED = "未上传";
export const LOGISTICS_INVOICE_VALIDATION_UPLOADED = "已上传待识别";
export const LOGISTICS_INVOICE_VALIDATION_PROCESSING = "识别中";
export const LOGISTICS_INVOICE_VALIDATION_PASSED = "校验通过";
export const LOGISTICS_INVOICE_VALIDATION_AMOUNT_MISMATCH = "金额不一致";
export const LOGISTICS_INVOICE_VALIDATION_NAME_MISMATCH = "品名不匹配";
export const LOGISTICS_INVOICE_VALIDATION_PARTY_MISMATCH = "抬头不匹配";
export const LOGISTICS_INVOICE_VALIDATION_FAILED = "识别失败";
export const LOGISTICS_INVOICE_VALIDATION_MANUAL_PASSED = "人工确认通过";
export const LOGISTICS_INVOICE_OCR_TIMEOUT_MESSAGE = "OCR识别超时，请重新识别或人工确认。";
export const DEFAULT_LOGISTICS_INVOICE_OCR_TASK_TIMEOUT_MS = 50 * 1000;

export const LOGISTICS_INVOICE_VALIDATION_PASSING_STATUSES = [
  LOGISTICS_INVOICE_VALIDATION_PASSED,
  LOGISTICS_INVOICE_VALIDATION_MANUAL_PASSED,
];

type ActorLike = {
  id?: string | null;
  role?: string | null;
} | null | undefined;

type AuditRequestLike = Parameters<typeof writeAudit>[0];

export type LogisticsInvoiceValidationRow = {
  id: string;
  orderId: string;
  supplierId: string;
  costType?: string | null;
  currency?: string | null;
  amount?: Prisma.Decimal | number | string | null;
  invoiceDocumentId?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeComparable(value: unknown) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[（）()【】\[\]{}《》<>，,。.\s·\-_/\\:：;；"'“”‘’*]/g, "");
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function groupCurrency(rows: LogisticsInvoiceValidationRow[]) {
  const currencies = [...new Set(rows.map((row) => cleanText(row.currency || "CNY").toUpperCase()).filter(Boolean))];
  return currencies.length === 1 ? currencies[0] : "CNY";
}

function expectedGroupAmount(rows: LogisticsInvoiceValidationRow[]) {
  return roundMoney(rows.reduce((sum, row) => sum + num(row.amount, 0), 0));
}

function amountMatches(actual: number, expected: number) {
  return Math.abs(roundMoney(actual) - roundMoney(expected)) <= 0.01;
}

export function recognizedLogisticsInvoiceAmount(input: {
  fields: ReturnType<typeof parseVatInvoiceFields>;
  rawText: string;
  invoiceGroup: LogisticsInvoiceGroupDefinition;
  currency: string;
  expectedAmount: number;
}) {
  if (input.invoiceGroup.key === OCEAN_FREIGHT_INVOICE_GROUP_KEY && cleanText(input.currency).toUpperCase() === "USD") {
    const foreignAmount = extractLogisticsForeignCurrencyAmount(input.rawText, input.currency, input.expectedAmount);
    if (foreignAmount) {
      return {
        amount: foreignAmount,
        source: "FOREIGN_CURRENCY_REMARK",
        taxInvoiceAmount: num(input.fields.amountWithTax, 0),
      };
    }
    return {
      amount: 0,
      source: "FOREIGN_CURRENCY_MISSING",
      taxInvoiceAmount: num(input.fields.amountWithTax, 0),
    };
  }
  return {
    amount: num(input.fields.amountWithTax, 0),
    source: "TAX_INVOICE_TOTAL",
    taxInvoiceAmount: num(input.fields.amountWithTax, 0),
  };
}

function matchesAnyKeyword(productName: unknown, keywords: string[]) {
  const product = normalizeComparable(productName);
  if (!product) return false;
  return keywords.some((keyword) => {
    const normalized = normalizeComparable(keyword);
    return Boolean(normalized && (product.includes(normalized) || normalized.includes(product)));
  });
}

function issueMessage(issues: Array<{ message: string }>) {
  return issues.map((issue) => issue.message).filter(Boolean).join("；");
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function logisticsOcrErrorMessage(error: unknown, fallback = "物流发票识别失败") {
  return error instanceof Error ? error.message : String(error || fallback);
}

function validationRowIds(value: unknown) {
  const validation = asRecord(value);
  return Array.isArray(validation.rowIds)
    ? validation.rowIds.map((item) => String(item || "")).filter(Boolean)
    : [];
}

export function invoiceValidationStatusCanContinue(status: unknown) {
  return LOGISTICS_INVOICE_VALIDATION_PASSING_STATUSES.includes(cleanText(status));
}

export function summarizeInvoiceValidationBlockReason(rows: Array<{ invoiceValidationStatus?: string | null; invoiceValidationMessage?: string | null }> = []) {
  const invalid = rows.find((row) => !invoiceValidationStatusCanContinue(row.invoiceValidationStatus));
  if (!invalid) return "";
  const status = cleanText(invalid.invoiceValidationStatus) || LOGISTICS_INVOICE_VALIDATION_NOT_UPLOADED;
  if (status === LOGISTICS_INVOICE_VALIDATION_NOT_UPLOADED) return "物流费用发票尚未上传，不能继续。";
  if (status === LOGISTICS_INVOICE_VALIDATION_UPLOADED || status === LOGISTICS_INVOICE_VALIDATION_PROCESSING) {
    return "物流费用发票尚未完成校验，不能继续。";
  }
  return invalid.invoiceValidationMessage || `物流费用发票${status}，不能继续。`;
}

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
}) {
  const documentId = nonEmpty(input.documentId);
  const invoiceGroup = logisticsInvoiceGroupForKey(input.invoiceGroupKey);
  const rows = input.rows.filter((row) => row.id);
  const rowIds = rows.map((row) => row.id);
  if (!documentId || !invoiceGroup || !rowIds.length) {
    throw codedError("物流发票识别任务参数不完整。", 400, "LOGISTICS_INVOICE_OCR_TASK_INVALID");
  }
  const document = await prisma.orderDocument.findFirst({
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
  });
  const task = await prisma.ocrTask.create({
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
  await updateRowsWithValidationResult({
    rowIds,
    actor: input.actor,
    status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
    message: "",
    validationJson,
    taskId: task.id,
  });
  return task;
}

async function cancelProcessingLogisticsInvoiceOcrTasks(input: {
  documentId: string;
  rowIds?: string[];
  reason: string;
}) {
  const rowIds = (input.rowIds || []).filter(Boolean);
  const updated = await prisma.ocrTask.updateMany({
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

async function updateRowsWithValidationResult(input: {
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

export async function recognizeAndValidateLogisticsInvoiceGroup(input: {
  documentId: string;
  invoiceGroupKey: string;
  rows: LogisticsInvoiceValidationRow[];
  actor: ActorLike;
  taskId?: string;
}) {
  const rows = input.rows.filter((row) => row.id);
  const rowIds = rows.map((row) => row.id);
  const documentId = nonEmpty(input.documentId);
  const invoiceGroup = logisticsInvoiceGroupForKey(input.invoiceGroupKey);
  if (!documentId || !rowIds.length || !invoiceGroup) return null;
  const document = await prisma.orderDocument.findFirst({
    where: { id: documentId, deletedAt: null },
    include: { order: { include: { businessEntity: true } }, supplier: true, cost: true },
  });
  if (!document || !document.storageKey) {
    await updateRowsWithValidationResult({
      rowIds,
      actor: input.actor,
      status: LOGISTICS_INVOICE_VALIDATION_FAILED,
      message: "发票文件不存在或无法读取。",
      validationJson: { documentId, invoiceGroupKey: input.invoiceGroupKey },
    });
    return null;
  }
  const task = input.taskId
    ? await (async () => {
        const claimed = await prisma.ocrTask.updateMany({
          where: {
            id: input.taskId,
            module: LOGISTICS_INVOICE_OCR_MODULE,
            status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
            validationStatus: "PROCESSING",
          },
          data: {
            errorMessage: null,
            validationJson: {
              documentId,
              invoiceGroupKey: invoiceGroup.key,
              rowIds,
            },
          },
        });
        const current = await prisma.ocrTask.findUnique({ where: { id: input.taskId }, include: { results: true } });
        if (!current) throw codedError("物流发票识别任务不存在。", 404, "LOGISTICS_INVOICE_OCR_TASK_NOT_FOUND");
        if (!claimed.count) {
          console.info("logistics-invoice-ocr-run-skipped-non-processing", {
            taskId: input.taskId,
            status: current.status,
            validationStatus: current.validationStatus,
            documentId,
            invoiceGroupKey: invoiceGroup.key,
          });
          return current;
        }
        return current;
      })()
    : await prisma.ocrTask.create({
        data: {
          module: LOGISTICS_INVOICE_OCR_MODULE,
          documentId,
          orderId: document.orderId,
          supplierId: document.supplierId,
          documentType: LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE,
          status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
          validationStatus: "PROCESSING",
          validationJson: {
            documentId,
            invoiceGroupKey: invoiceGroup.key,
            rowIds,
          },
        },
        include: { results: true },
      });
  if (task.status !== LOGISTICS_INVOICE_VALIDATION_PROCESSING || task.validationStatus !== "PROCESSING") return task;
  await updateRowsWithValidationResult({
    rowIds,
    actor: input.actor,
    status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
    message: "",
    validationJson: { documentId, invoiceGroupKey: input.invoiceGroupKey, rowIds },
    taskId: task.id,
    expectedTaskId: task.id,
    expectedStatus: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
  });
  let latestRawText = "";
  let latestRawJson: unknown = null;
  let latestApiName = "";
  let latestProvider = "ALIYUN";
  try {
    const fileBuffer = await readR2Object(document.storageKey);
    const recognized = await recognizeLogisticsInvoiceWithOcr(fileBuffer);
    const text = cleanText(recognized.text);
    const structuredFields = recognized.extractedFields || {};
    latestRawText = text;
    latestRawJson = recognized.rawJson || { source: recognized.source, provider: recognized.provider, textLength: text.length };
    latestApiName = recognized.apiName || recognized.source || "ALIYUN_RECOGNIZE_INVOICE";
    latestProvider = recognized.provider || "ALIYUN";
    const fields = parseVatInvoiceFields(text, structuredFields);
    const expectedSellerName = nonEmpty(document.supplier?.invoiceTitle || document.supplier?.supplierName);
    const expectedBuyerName = nonEmpty(
      document.order.businessEntity?.name
      || document.order.businessEntityNameSnapshot
      || DEFAULT_COMPANY_PROFILE_SETTINGS.companyNameZh,
    );
    const rules = await getLogisticsInvoiceValidationRules();
    const validation = validateLogisticsInvoiceFields({
      fields,
      rawText: text,
      rows,
      invoiceGroup,
      keywords: rules[invoiceGroup.key]?.keywords || [],
      expectedSellerName,
      expectedBuyerName,
    });
    const parserIssues = invoiceParserIssues(fields).filter((issue) => ["productName", "seller", "buyer"].includes(issue.field || ""));
    const issues = mergeValidationIssues(validation.issues, parserIssues);
    const status = validationStatusFromIssues(issues, validation.status);
    const message = issueMessage(issues);
    const fieldRows = visibleResultFields(
      fields as unknown as Record<string, unknown>,
      supplierDocumentLabels("SUPPLIER_INVOICE") as unknown as Record<string, string>,
    );
    const validationJson = {
      invoiceGroupKey: invoiceGroup.key,
      invoiceGroupLabel: invoiceGroup.label,
      systemAmount: validation.expectedAmount,
      systemCurrency: validation.currency,
      recognizedAmount: validation.recognizedAmount,
      recognizedAmountSource: validation.recognizedAmountSource,
      taxInvoiceAmount: validation.taxInvoiceAmount,
      recognizedName: fields.productName || "",
      expectedSellerName,
      recognizedSeller: fields.seller || "",
      expectedBuyerName,
      recognizedBuyer: fields.buyer || "",
      allowedKeywords: rules[invoiceGroup.key]?.keywords || [],
      issues,
      fields,
      structuredFields,
      source: recognized.source,
      provider: recognized.provider,
    };
    const saved = await prisma.$transaction(async (tx) => {
      const writable = await tx.ocrTask.updateMany({
        where: {
          id: task.id,
          module: LOGISTICS_INVOICE_OCR_MODULE,
          status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
          validationStatus: "PROCESSING",
        },
        data: {
          status,
          validationStatus: status === LOGISTICS_INVOICE_VALIDATION_PASSED ? "PASSED" : "EXCEPTION",
          errorMessage: message || null,
          rawText: text.slice(0, 120000),
          resultJson: fields as unknown as Prisma.InputJsonValue,
          validationJson: validationJson as Prisma.InputJsonValue,
        },
      });
      if (!writable.count) {
        const current = await tx.ocrTask.findUnique({ where: { id: task.id }, include: { results: true } });
        if (current) return current;
        throw codedError("物流发票识别任务不存在。", 404, "LOGISTICS_INVOICE_OCR_TASK_NOT_FOUND");
      }
      await saveOcrRawResult({
        documentId,
        orderId: document.orderId,
        documentType: LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE,
        provider: latestProvider,
        apiName: latestApiName,
        rawJson: latestRawJson,
        parsedJson: {
          fields,
          structuredFields,
          validation: validationJson,
          parser: recognized.parser || "VAT_INVOICE",
        },
        confidence: recognized.confidence ?? null,
        status: status === LOGISTICS_INVOICE_VALIDATION_PASSED ? "SUCCESS" : "EXCEPTION",
        errorMessage: message,
      }, tx);
      await tx.ocrResult.deleteMany({ where: { taskId: task.id } });
      if (fieldRows.length) {
        await tx.ocrResult.createMany({
          data: fieldRows.map((field) => ({
            taskId: task.id,
            fieldKey: field.key,
            label: field.label,
            value: field.value,
            rawValue: field.value,
          })),
        });
      }
      await tx.logisticsExpense.updateMany({
        where: {
          id: { in: rowIds },
          deletedAt: null,
          invoiceOcrTaskId: task.id,
          invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
        },
        data: {
          invoiceValidationStatus: status,
          invoiceValidationMessage: message || null,
          invoiceValidationJson: validationJson as Prisma.InputJsonValue,
          invoiceOcrTaskId: task.id,
          invoiceRecognizedNo: fields.invoiceNo || null,
          invoiceRecognizedDate: dateFromInput(fields.invoiceDate),
          invoiceRecognizedSeller: fields.seller || null,
          invoiceRecognizedBuyer: fields.buyer || null,
          invoiceRecognizedAmount: validation.recognizedAmount || null,
          invoiceRecognizedName: fields.productName || null,
          updatedById: input.actor?.id || null,
        },
      });
      return tx.ocrTask.findUnique({ where: { id: task.id }, include: { results: true } });
    });
    console.info("logistics-invoice-validation-complete", {
      documentId,
      taskId: task.id,
      invoiceGroupKey: invoiceGroup.key,
      status,
      systemAmount: validation.expectedAmount,
      recognizedAmount: validation.recognizedAmount,
      recognizedName: fields.productName || "",
      rowIds,
    });
    invalidateWorkbenchTodosCache();
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "识别失败");
    const validationJson = {
      invoiceGroupKey: input.invoiceGroupKey,
      documentId,
      issues: [{ level: "error", message }],
      rawText: latestRawText,
      provider: latestProvider,
      apiName: latestApiName || "LOGISTICS_INVOICE_OCR",
    };
    const saved = await prisma.$transaction(async (tx) => {
      const writable = await tx.ocrTask.updateMany({
        where: {
          id: task.id,
          module: LOGISTICS_INVOICE_OCR_MODULE,
          status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
          validationStatus: "PROCESSING",
        },
        data: {
          status: LOGISTICS_INVOICE_VALIDATION_FAILED,
          validationStatus: "FAILED",
          errorMessage: message.slice(0, 1000),
          rawText: latestRawText ? latestRawText.slice(0, 120000) : null,
          validationJson: validationJson as Prisma.InputJsonValue,
        },
      });
      if (!writable.count) {
        return tx.ocrTask.findUnique({ where: { id: task.id }, include: { results: true } });
      }
      await saveOcrRawResult({
        documentId,
        orderId: document.orderId,
        documentType: LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE,
        provider: latestProvider,
        apiName: latestApiName || "LOGISTICS_INVOICE_OCR",
        rawJson: latestRawJson || (latestRawText ? { text: latestRawText } : null),
        parsedJson: latestRawText ? { rawText: latestRawText } : null,
        status: "FAILED",
        errorMessage: message,
      }, tx).catch(() => null);
      await tx.logisticsExpense.updateMany({
        where: {
          id: { in: rowIds },
          deletedAt: null,
          invoiceOcrTaskId: task.id,
          invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
        },
        data: {
          invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_FAILED,
          invoiceValidationMessage: message.slice(0, 1000),
          invoiceValidationJson: validationJson as Prisma.InputJsonValue,
          invoiceOcrTaskId: task.id,
          updatedById: input.actor?.id || null,
        },
      });
      return tx.ocrTask.findUnique({ where: { id: task.id }, include: { results: true } });
    });
    console.error("logistics-invoice-validation-failed", {
      documentId,
      taskId: task.id,
      invoiceGroupKey: input.invoiceGroupKey,
      rowIds,
      message,
    });
    invalidateWorkbenchTodosCache();
    return saved;
  }
}

export async function runLogisticsInvoiceOcrTask(taskId: string) {
  const task = await prisma.ocrTask.findUnique({ where: { id: taskId } });
  if (!task) throw codedError("物流发票识别任务不存在。", 404, "LOGISTICS_INVOICE_OCR_TASK_NOT_FOUND");
  if (task.module !== LOGISTICS_INVOICE_OCR_MODULE) {
    throw codedError("该 OCR 任务不是物流发票识别任务。", 400, "LOGISTICS_INVOICE_OCR_TASK_MODULE_INVALID");
  }
  const validation = asRecord(task.validationJson);
  const rowIds = Array.isArray(validation.rowIds)
    ? validation.rowIds.map((item) => String(item || "")).filter(Boolean)
    : [];
  const rows = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      ...(rowIds.length
        ? { id: { in: rowIds }, invoiceDocumentId: task.documentId }
        : { invoiceDocumentId: task.documentId }),
    },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      costType: true,
      currency: true,
      amount: true,
      invoiceDocumentId: true,
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const mappedRows = rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    supplierId: row.supplierId,
    costType: row.costType,
    currency: row.currency,
    amount: row.amount,
    invoiceDocumentId: row.invoiceDocumentId,
  }));
  const invoiceGroupKey = nonEmpty(validation.invoiceGroupKey) || logisticsInvoiceGroupForExpense(mappedRows[0])?.key || "";
  if (!mappedRows.length || !invoiceGroupKey) {
    await prisma.ocrTask.update({
      where: { id: task.id },
      data: {
        status: LOGISTICS_INVOICE_VALIDATION_FAILED,
        validationStatus: "FAILED",
        errorMessage: "未找到物流发票对应的费用分组。",
      },
    });
    throw codedError("未找到物流发票对应的费用分组。", 404, "LOGISTICS_INVOICE_OCR_ROWS_NOT_FOUND");
  }
  return recognizeAndValidateLogisticsInvoiceGroup({
    documentId: task.documentId,
    invoiceGroupKey,
    rows: mappedRows,
    actor: null,
    taskId: task.id,
  });
}

async function markLogisticsInvoiceOcrTaskFailed(taskId: string, error: unknown, parserStatus = "物流发票识别失败") {
  const current = await prisma.ocrTask.findUnique({ where: { id: taskId }, include: { results: true } });
  if (!current) throw codedError("物流发票识别任务不存在。", 404, "LOGISTICS_INVOICE_OCR_TASK_NOT_FOUND");
  const message = logisticsOcrErrorMessage(error).slice(0, 1000);
  const validation = asRecord(current.validationJson);
  const rowIds = validationRowIds(current.validationJson);
  const validationJson = {
    ...validation,
    issues: [{ level: "manual", message }],
    parserStatus,
  };
  const updated = await prisma.ocrTask.updateMany({
    where: {
      id: taskId,
      module: LOGISTICS_INVOICE_OCR_MODULE,
      status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
      validationStatus: "PROCESSING",
    },
    data: {
      status: LOGISTICS_INVOICE_VALIDATION_FAILED,
      validationStatus: "FAILED",
      errorMessage: message,
      validationJson: validationJson as Prisma.InputJsonValue,
    },
  });
  if (updated.count && rowIds.length) {
    await prisma.logisticsExpense.updateMany({
      where: {
        id: { in: rowIds },
        deletedAt: null,
        invoiceOcrTaskId: taskId,
        invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
      },
      data: {
        invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_FAILED,
        invoiceValidationMessage: message,
        invoiceValidationJson: validationJson as Prisma.InputJsonValue,
      },
    });
  }
  const saved = await prisma.ocrTask.findUnique({ where: { id: taskId }, include: { results: true } });
  if (!saved) throw codedError("物流发票识别任务不存在。", 404, "LOGISTICS_INVOICE_OCR_TASK_NOT_FOUND");
  if (!updated.count) {
    console.info("logistics-invoice-ocr-late-failure-ignored", {
      taskId,
      status: saved.status,
      validationStatus: saved.validationStatus,
      documentId: saved.documentId,
    });
  }
  invalidateWorkbenchTodosCache();
  return saved;
}

export async function runLogisticsInvoiceOcrTaskWithTimeout(taskId: string, timeoutMs = DEFAULT_LOGISTICS_INVOICE_OCR_TASK_TIMEOUT_MS) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runLogisticsInvoiceOcrTask(taskId),
      new Promise<Awaited<ReturnType<typeof runLogisticsInvoiceOcrTask>>>((_, reject) => {
        timeout = setTimeout(() => {
          reject(codedError(LOGISTICS_INVOICE_OCR_TIMEOUT_MESSAGE, 504, "LOGISTICS_INVOICE_OCR_TASK_TIMEOUT"));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "LOGISTICS_INVOICE_OCR_TASK_TIMEOUT") {
      console.error("logistics-invoice-ocr-timeout", { taskId, timeoutMs });
      return markLogisticsInvoiceOcrTaskFailed(taskId, error, "物流发票识别超时");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function logisticsInvoiceOcrApiResult(ocrTask: Awaited<ReturnType<typeof runLogisticsInvoiceOcrTaskWithTimeout>> | null | undefined) {
  const validationStatus = String(ocrTask?.validationStatus || "");
  const statusText = String(ocrTask?.status || "");
  const validationJson = ocrTask?.validationJson && typeof ocrTask.validationJson === "object" && !Array.isArray(ocrTask.validationJson)
    ? ocrTask.validationJson as Record<string, unknown>
    : {};
  const issues = Array.isArray(validationJson.issues)
    ? validationJson.issues.map((issue) => asRecord(issue)).map((issue) => String(issue.message || "")).filter(Boolean)
    : [];
  const errorMessage = String(ocrTask?.errorMessage || issues[0] || "");
  const timeout = /超时|TIMEOUT/i.test([errorMessage, ...issues].join(" "));
  if (timeout) {
    return {
      status: "TIMEOUT",
      message: LOGISTICS_INVOICE_OCR_TIMEOUT_MESSAGE,
      result: ocrTask,
      error: errorMessage || "OCR识别超时",
    };
  }
  if (validationStatus === "PASSED" || statusText === LOGISTICS_INVOICE_VALIDATION_PASSED) {
    return {
      status: "PASSED",
      message: "OCR校验通过",
      result: ocrTask,
    };
  }
  if (validationStatus === "FAILED" || statusText === LOGISTICS_INVOICE_VALIDATION_FAILED || !ocrTask) {
    return {
      status: "FAILED",
      message: "OCR识别失败，请人工核对或重新上传",
      result: ocrTask,
      error: errorMessage || "具体失败原因未返回",
    };
  }
  return {
    status: "NEEDS_REVIEW",
    message: "OCR已识别，但部分字段需人工确认",
    result: ocrTask,
    error: errorMessage || "",
  };
}

export async function runPendingLogisticsInvoiceOcrTasks(limit = 5, minAgeMs = 60_000) {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 5), 1), 20);
  const readyBefore = new Date(Date.now() - Math.max(Math.trunc(Number(minAgeMs) || 60_000), 15_000));
  const tasks = await prisma.ocrTask.findMany({
    where: {
      module: LOGISTICS_INVOICE_OCR_MODULE,
      status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
      validationStatus: "PROCESSING",
      updatedAt: { lt: readyBefore },
    },
    select: { id: true, documentId: true, orderId: true, supplierId: true, documentType: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
    take: safeLimit,
  });
  const result = {
    scanned: tasks.length,
    processed: 0,
    failed: 0,
    skipped: 0,
    taskIds: tasks.map((task) => task.id),
  };
  for (const task of tasks) {
    try {
      const claimed = await prisma.ocrTask.updateMany({
        where: {
          id: task.id,
          status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
          validationStatus: "PROCESSING",
          updatedAt: { lte: task.updatedAt },
        },
        data: { updatedAt: new Date(), errorMessage: null },
      });
      if (!claimed.count) {
        result.skipped += 1;
        continue;
      }
      await runLogisticsInvoiceOcrTaskWithTimeout(task.id);
      result.processed += 1;
    } catch (error) {
      result.failed += 1;
      const message = logisticsOcrErrorMessage(error, "物流发票识别失败");
      await markLogisticsInvoiceOcrTaskFailed(task.id, error, "物流发票后台识别失败").catch(() => null);
      console.error("logistics-invoice-ocr-pending-worker-failed", {
        taskId: task.id,
        documentId: task.documentId,
        orderId: task.orderId,
        supplierId: task.supplierId,
        documentType: task.documentType,
        message,
      });
    }
  }
  if (tasks.length) {
    console.info("logistics-invoice-ocr-pending-worker", result);
  }
  return result;
}

function validateLogisticsInvoiceFields(input: {
  fields: ReturnType<typeof parseVatInvoiceFields>;
  rawText: string;
  rows: LogisticsInvoiceValidationRow[];
  invoiceGroup: LogisticsInvoiceGroupDefinition;
  keywords: string[];
  expectedSellerName?: string;
  expectedBuyerName?: string;
}) {
  const expectedAmount = expectedGroupAmount(input.rows);
  const currencies = logisticsInvoiceGroupCurrencies(input.rows);
  const currency = currencies.length === 1 ? currencies[0] : groupCurrency(input.rows);
  const issues: Array<{ level: "error" | "manual"; field: string; message: string }> = [];
  if (currencies.length > 1) {
    issues.push({
      level: "error",
      field: "amountWithTax",
      message: `同一发票分组包含多个币种（${currencies.join(" / ")}），请按币种拆分发票后再校验。`,
    });
  }
  const recognizedAmountResult = recognizedLogisticsInvoiceAmount({
    fields: input.fields,
    rawText: input.rawText,
    invoiceGroup: input.invoiceGroup,
    currency,
    expectedAmount,
  });
  const recognizedAmount = recognizedAmountResult.amount;
  if (currencies.length > 1) {
    // Mixed-currency groups cannot be compared to one invoice amount.
  } else if (!recognizedAmount) {
    issues.push({
      level: "manual",
      field: "amountWithTax",
      message: recognizedAmountResult.source === "FOREIGN_CURRENCY_MISSING"
        ? "未识别到发票外币金额"
        : "未识别到发票价税合计金额",
    });
  } else if (!amountMatches(recognizedAmount, expectedAmount)) {
    issues.push({
      level: "error",
      field: "amountWithTax",
      message: `金额不一致：系统金额 ${currency} ${expectedAmount.toFixed(2)}，发票金额 ${currency} ${recognizedAmount.toFixed(2)}`,
    });
  }
  if (!input.fields.productName) {
    issues.push({ level: "manual", field: "productName", message: "未识别到货物或应税劳务/服务名称" });
  } else if (!matchesAnyKeyword(input.fields.productName, input.keywords)) {
    issues.push({
      level: "error",
      field: "productName",
      message: `品名不匹配：系统费用分组 ${input.invoiceGroup.label}，识别品名 ${input.fields.productName}`,
    });
  }
  if (input.expectedSellerName) {
    if (!input.fields.seller) {
      issues.push({ level: "manual", field: "seller", message: "未识别到发票销售方，需人工确认" });
    } else if (!looselyMatches(input.fields.seller, input.expectedSellerName)) {
      issues.push({
        level: "error",
        field: "seller",
        message: `销售方不匹配：物流供应商 ${input.expectedSellerName}，识别销售方 ${input.fields.seller}`,
      });
    }
  }
  if (input.expectedBuyerName) {
    if (!input.fields.buyer) {
      issues.push({ level: "manual", field: "buyer", message: "未识别到发票购买方，需人工确认" });
    } else if (!looselyMatches(input.fields.buyer, input.expectedBuyerName)) {
      issues.push({
        level: "error",
        field: "buyer",
        message: `购买方不匹配：系统抬头 ${input.expectedBuyerName}，识别购买方 ${input.fields.buyer}`,
      });
    }
  }
  const status = issues.some((issue) => issue.field === "amountWithTax")
    ? LOGISTICS_INVOICE_VALIDATION_AMOUNT_MISMATCH
    : issues.some((issue) => issue.field === "productName")
      ? LOGISTICS_INVOICE_VALIDATION_NAME_MISMATCH
      : issues.some((issue) => issue.field === "seller" || issue.field === "buyer")
        ? LOGISTICS_INVOICE_VALIDATION_PARTY_MISMATCH
        : LOGISTICS_INVOICE_VALIDATION_PASSED;
  return {
    expectedAmount,
    currency,
    issues,
    status,
    recognizedAmount,
    recognizedAmountSource: recognizedAmountResult.source,
    taxInvoiceAmount: recognizedAmountResult.taxInvoiceAmount,
  };
}

function validationStatusFromIssues(
  issues: Array<{ field?: string; level?: string }>,
  fallback: string,
) {
  if (!issues.length) return LOGISTICS_INVOICE_VALIDATION_PASSED;
  if (issues.some((issue) => issue.field === "amountWithTax")) return LOGISTICS_INVOICE_VALIDATION_AMOUNT_MISMATCH;
  if (issues.some((issue) => issue.field === "productName")) return LOGISTICS_INVOICE_VALIDATION_NAME_MISMATCH;
  if (issues.some((issue) => issue.field === "seller" || issue.field === "buyer")) return LOGISTICS_INVOICE_VALIDATION_PARTY_MISMATCH;
  return fallback || LOGISTICS_INVOICE_VALIDATION_FAILED;
}

function mergeValidationIssues<T extends { field?: string; message?: string }>(
  primary: T[] = [],
  secondary: T[] = [],
) {
  const result = [...primary];
  for (const issue of secondary) {
    const exists = result.some((item) => item.field === issue.field && item.message === issue.message);
    if (!exists) result.push(issue);
  }
  return result;
}

export async function manuallyConfirmLogisticsInvoiceValidation(
  request: AuditRequestLike,
  actor: ActorLike,
  id: string,
  input: Record<string, unknown> = {},
) {
  if (!actor?.id || !["管理员", "财务"].includes(String(actor.role || ""))) {
    throw codedError("只有管理员或财务可以人工确认物流发票校验。", 403, "LOGISTICS_INVOICE_VALIDATION_CONFIRM_DENIED");
  }
  const reason = nonEmpty(input.reason || input.manualConfirmReason);
  if (!reason) throw codedError("人工确认原因不能为空。", 400, "LOGISTICS_INVOICE_VALIDATION_CONFIRM_REASON_REQUIRED");
  const invoiceGroup = logisticsInvoiceGroupForKey(input.invoiceGroup || input.invoiceGroupKey);
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const { loadLogisticsExpenseBillRowsForAction } = await import("./logistics-expense-workflow-core");
  const { logisticsInvoiceExpenseMatchesGroup } = await import("./logistics-invoice-groups");
  const { serializeLogisticsExpense, serializeLogisticsExpenseBill } = await import("./logistics-expense-access-serialization");
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  const targetRows = rows.filter((row) => logisticsInvoiceExpenseMatchesGroup(row, invoiceGroup));
  const targetIds = targetRows.map((row) => row.id).filter(Boolean);
  if (!targetIds.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
  const before = targetRows.map(serializeLogisticsExpense);
  const confirmedAt = new Date();
  const documentIds = [...new Set(targetRows.map((row) => nonEmpty(row.invoiceDocumentId)).filter(Boolean))];
  for (const documentId of documentIds) {
    await cancelProcessingLogisticsInvoiceOcrTasks({
      documentId,
      rowIds: targetIds,
      reason: "已人工确认通过，旧识别任务已取消。",
    });
  }
  await prisma.logisticsExpense.updateMany({
    where: { id: { in: targetIds }, deletedAt: null },
    data: {
      invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_MANUAL_PASSED,
      invoiceValidationMessage: reason,
      invoiceManualConfirmedById: actor.id,
      invoiceManualConfirmedAt: confirmedAt,
      invoiceManualConfirmReason: reason,
      updatedById: actor.id,
    },
  });
  await runNonCriticalTask("物流发票校验人工确认日志写入", () => writeAudit(request, actor, "人工确认物流发票校验", "logistics_bills", rows[0]?.billId || id, before, {
    invoiceGroup: invoiceGroup.key,
    reason,
    confirmedAt,
    rowIds: targetIds,
  }));
  for (const orderId of [...new Set(targetRows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(String(orderId), "物流发票校验人工确认后退税完整度刷新");
  }
  invalidateWorkbenchTodosCache();
  const finalRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: finalRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
  };
}
