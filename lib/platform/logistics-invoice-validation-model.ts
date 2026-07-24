import { Prisma } from "../generated/prisma/client.js";
import { parseVatInvoiceFields } from "./vat-invoice-ocr-shared";
import { extractLogisticsForeignCurrencyAmount } from "./logistics-invoice-amount-parser";
import {
  OCEAN_FREIGHT_INVOICE_GROUP_KEY,
  type LogisticsInvoiceGroupDefinition,
} from "./logistics-invoice-groups";
import {
  num,
  writeAudit,
} from "./shared";

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

export type ActorLike = {
  id?: string | null;
  role?: string | null;
} | null | undefined;

export type AuditRequestLike = Parameters<typeof writeAudit>[0];

export type LogisticsInvoiceValidationRow = {
  id: string;
  orderId: string;
  supplierId: string;
  costType?: string | null;
  currency?: string | null;
  amount?: Prisma.Decimal | number | string | null;
  invoiceDocumentId?: string | null;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function cleanText(value: unknown) {
  return String(value || "").trim();
}

export function normalizeComparable(value: unknown) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[（）()【】\[\]{}《》<>，,。.\s·\-_/\\:：;；"'“”‘’*]/g, "");
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function groupCurrency(rows: LogisticsInvoiceValidationRow[]) {
  const currencies = [...new Set(rows.map((row) => cleanText(row.currency || "CNY").toUpperCase()).filter(Boolean))];
  return currencies.length === 1 ? currencies[0] : "CNY";
}

export function expectedGroupAmount(rows: LogisticsInvoiceValidationRow[]) {
  return roundMoney(rows.reduce((sum, row) => sum + num(row.amount, 0), 0));
}

export function amountMatches(actual: number, expected: number) {
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

export function matchesAnyKeyword(productName: unknown, keywords: string[]) {
  const product = normalizeComparable(productName);
  if (!product) return false;
  return keywords.some((keyword) => {
    const normalized = normalizeComparable(keyword);
    return Boolean(normalized && (product.includes(normalized) || normalized.includes(product)));
  });
}

export function issueMessage(issues: Array<{ message: string }>) {
  return issues.map((issue) => issue.message).filter(Boolean).join("；");
}

export function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export function logisticsOcrErrorMessage(error: unknown, fallback = "物流发票识别失败") {
  return error instanceof Error ? error.message : String(error || fallback);
}

export function validationRowIds(value: unknown) {
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
