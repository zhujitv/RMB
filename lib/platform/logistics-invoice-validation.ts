import { Prisma } from "../generated/prisma/client.js";
import { readR2Object } from "../r2";
import { prisma } from "../prisma";
import { recognizeLogisticsInvoiceWithOcr } from "./ocr-integration";
import { saveOcrRawResult } from "./ocr-raw-results";
import { parseVatInvoiceFields, supplierDocumentLabels, visibleResultFields } from "./supplier-document-ocr-shared";
import { invoiceParserIssues } from "./supplier-document-ocr-validation";
import { getLogisticsInvoiceValidationRules } from "./logistics-invoice-validation-rules";
import { logisticsInvoiceGroupForKey, type LogisticsInvoiceGroupDefinition } from "./logistics-invoice-groups";
import { codedError, dateFromInput, nonEmpty, num, optional, runNonCriticalTask, writeAudit } from "./shared";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";

export const LOGISTICS_INVOICE_OCR_MODULE = "SUPPLIER_DOCUMENT_RETURN";
export const LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE = "LOGISTICS_INVOICE";
export const LOGISTICS_INVOICE_VALIDATION_NOT_UPLOADED = "未上传";
export const LOGISTICS_INVOICE_VALIDATION_UPLOADED = "已上传待识别";
export const LOGISTICS_INVOICE_VALIDATION_PROCESSING = "识别中";
export const LOGISTICS_INVOICE_VALIDATION_PASSED = "校验通过";
export const LOGISTICS_INVOICE_VALIDATION_AMOUNT_MISMATCH = "金额不一致";
export const LOGISTICS_INVOICE_VALIDATION_NAME_MISMATCH = "品名不匹配";
export const LOGISTICS_INVOICE_VALIDATION_FAILED = "识别失败";
export const LOGISTICS_INVOICE_VALIDATION_MANUAL_PASSED = "人工确认通过";

export const LOGISTICS_INVOICE_VALIDATION_PASSING_STATUSES = [
  LOGISTICS_INVOICE_VALIDATION_PASSED,
  LOGISTICS_INVOICE_VALIDATION_MANUAL_PASSED,
];

type ActorLike = {
  id?: string | null;
  role?: string | null;
} | null | undefined;

type AuditRequestLike = Parameters<typeof writeAudit>[0];

type LogisticsInvoiceValidationRow = {
  id: string;
  orderId: string;
  supplierId: string;
  costType?: string | null;
  currency?: string | null;
  amount?: Prisma.Decimal | number | string | null;
  invoiceDocumentId?: string | null;
};

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
}) {
  const fields = input.fields || null;
  await prisma.logisticsExpense.updateMany({
    where: { id: { in: input.rowIds }, deletedAt: null },
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
  await updateRowsWithValidationResult({
    rowIds,
    actor: input.actor,
    status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
    message: "",
    validationJson: { documentId, invoiceGroupKey: input.invoiceGroupKey },
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
    },
    include: { results: true },
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
    const rules = await getLogisticsInvoiceValidationRules();
    const validation = validateLogisticsInvoiceFields({
      fields,
      rows,
      invoiceGroup,
      keywords: rules[invoiceGroup.key]?.keywords || [],
    });
    const parserIssues = invoiceParserIssues(fields).filter((issue) => issue.field === "productName");
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
      recognizedAmount: fields.amountWithTax || 0,
      recognizedName: fields.productName || "",
      allowedKeywords: rules[invoiceGroup.key]?.keywords || [],
      issues,
      fields,
      structuredFields,
      source: recognized.source,
      provider: recognized.provider,
    };
    const saved = await prisma.$transaction(async (tx) => {
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
      await tx.ocrTask.update({
        where: { id: task.id },
        data: {
          status,
          validationStatus: status === LOGISTICS_INVOICE_VALIDATION_PASSED ? "PASSED" : "EXCEPTION",
          errorMessage: message || null,
          rawText: text.slice(0, 120000),
          resultJson: fields as unknown as Prisma.InputJsonValue,
          validationJson: validationJson as Prisma.InputJsonValue,
        },
      });
      await tx.logisticsExpense.updateMany({
        where: { id: { in: rowIds }, deletedAt: null },
        data: {
          invoiceValidationStatus: status,
          invoiceValidationMessage: message || null,
          invoiceValidationJson: validationJson as Prisma.InputJsonValue,
          invoiceOcrTaskId: task.id,
          invoiceRecognizedNo: fields.invoiceNo || null,
          invoiceRecognizedDate: dateFromInput(fields.invoiceDate),
          invoiceRecognizedSeller: fields.seller || null,
          invoiceRecognizedBuyer: fields.buyer || null,
          invoiceRecognizedAmount: fields.amountWithTax || null,
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
      recognizedAmount: fields.amountWithTax || 0,
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
    await prisma.$transaction(async (tx) => {
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
      await tx.ocrTask.update({
        where: { id: task.id },
        data: {
          status: LOGISTICS_INVOICE_VALIDATION_FAILED,
          validationStatus: "FAILED",
          errorMessage: message.slice(0, 1000),
          rawText: latestRawText ? latestRawText.slice(0, 120000) : null,
          validationJson: validationJson as Prisma.InputJsonValue,
        },
      });
      await tx.logisticsExpense.updateMany({
        where: { id: { in: rowIds }, deletedAt: null },
        data: {
          invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_FAILED,
          invoiceValidationMessage: message.slice(0, 1000),
          invoiceValidationJson: validationJson as Prisma.InputJsonValue,
          invoiceOcrTaskId: task.id,
          updatedById: input.actor?.id || null,
        },
      });
    });
    console.error("logistics-invoice-validation-failed", {
      documentId,
      taskId: task.id,
      invoiceGroupKey: input.invoiceGroupKey,
      rowIds,
      message,
    });
    invalidateWorkbenchTodosCache();
    return null;
  }
}

function validateLogisticsInvoiceFields(input: {
  fields: ReturnType<typeof parseVatInvoiceFields>;
  rows: LogisticsInvoiceValidationRow[];
  invoiceGroup: LogisticsInvoiceGroupDefinition;
  keywords: string[];
}) {
  const expectedAmount = expectedGroupAmount(input.rows);
  const currency = groupCurrency(input.rows);
  const issues: Array<{ level: "error" | "manual"; field: string; message: string }> = [];
  const recognizedAmount = num(input.fields.amountWithTax, 0);
  if (!recognizedAmount) {
    issues.push({ level: "manual", field: "amountWithTax", message: "未识别到发票价税合计金额" });
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
  const status = issues.some((issue) => issue.field === "amountWithTax")
    ? LOGISTICS_INVOICE_VALIDATION_AMOUNT_MISMATCH
    : issues.some((issue) => issue.field === "productName")
      ? LOGISTICS_INVOICE_VALIDATION_NAME_MISMATCH
      : LOGISTICS_INVOICE_VALIDATION_PASSED;
  return { expectedAmount, currency, issues, status };
}

function validationStatusFromIssues(
  issues: Array<{ field?: string; level?: string }>,
  fallback: string,
) {
  if (!issues.length) return LOGISTICS_INVOICE_VALIDATION_PASSED;
  if (issues.some((issue) => issue.field === "amountWithTax")) return LOGISTICS_INVOICE_VALIDATION_AMOUNT_MISMATCH;
  if (issues.some((issue) => issue.field === "productName")) return LOGISTICS_INVOICE_VALIDATION_NAME_MISMATCH;
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
  invalidateWorkbenchTodosCache();
  const finalRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: finalRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
  };
}
