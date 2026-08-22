import { Prisma } from "../generated/prisma/client.js";
import type { TencentVatInvoiceResult } from "./tencent-vat-invoice-ocr";
import { codedError } from "./shared-base-utils";

type JsonRecord = Record<string, unknown>;

const HEADER_TEXT_FIELDS = [
  "invoiceName",
  "invoiceCode",
  "invoiceNo",
  "invoiceDate",
  "sellerName",
  "sellerTaxNo",
  "buyerName",
  "buyerTaxNo",
  "checkCode",
] as const;

const HEADER_AMOUNT_FIELDS = ["amountWithoutTax", "taxAmount", "amountWithTax"] as const;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown, label: string, maxLength = 300) {
  const result = String(value ?? "").normalize("NFKC").trim();
  if (result.length > maxLength) {
    throw codedError(`${label}最多${maxLength}个字符。`, 400, "SUPPLIER_INVOICE_MANUAL_TEXT_TOO_LONG");
  }
  return result;
}

function decimalText(value: unknown, label: string) {
  const result = String(value ?? "").normalize("NFKC").replace(/[￥¥,，\s]/g, "").trim();
  if (!result) return "";
  try {
    return new Prisma.Decimal(result).toString();
  } catch {
    throw codedError(`${label}必须是有效数字。`, 400, "SUPPLIER_INVOICE_MANUAL_NUMBER_INVALID");
  }
}

function rowId(value: unknown, fallback = "") {
  const result = text(value, "发票商品行标识", 100);
  if (/^[A-Za-z0-9:_-]{1,100}$/.test(result)) return result;
  return fallback || crypto.randomUUID();
}

export function normalizeManualSupplierInvoice(
  value: unknown,
  baseValue: unknown,
): TencentVatInvoiceResult & { items: Array<TencentVatInvoiceResult["items"][number] & { rowId: string; amountWithTax: string }> } {
  const input = record(value);
  const base = record(baseValue);
  const baseHeader = record(base.header);
  const header: JsonRecord = {};

  for (const field of HEADER_TEXT_FIELDS) {
    header[field] = text(baseHeader[field], `发票${field}`, field.includes("Name") ? 300 : 100);
  }
  for (const field of HEADER_AMOUNT_FIELDS) {
    header[field] = decimalText(baseHeader[field], `发票${field}`);
  }

  if (!Array.isArray(input.items)) {
    throw codedError("请提交发票商品明细。", 400, "SUPPLIER_INVOICE_MANUAL_ITEMS_REQUIRED");
  }
  if (input.items.length > 500) {
    throw codedError("一张发票最多保存500行商品。", 400, "SUPPLIER_INVOICE_MANUAL_ITEMS_TOO_MANY");
  }

  const baseItems = Array.isArray(base.items) ? base.items.map((item) => record(item)) : [];
  const baseByRowId = new Map(baseItems.map((item, index) => [rowId(item.rowId, `ocr:${index + 1}`), item]));
  const items = input.items.map((rawItem, index) => {
    const item = record(rawItem);
    const explicitRowId = text(item.rowId, "发票商品行标识", 100);
    const submittedRowId = rowId(explicitRowId, baseItems[index] ? `ocr:${index + 1}` : "");
    // Existing rows keep their own hidden OCR evidence by stable row id. A newly
    // inserted row must not inherit tax/spec fields from an unrelated row merely
    // because earlier rows were deleted or reordered in the editor.
    const before = explicitRowId
      ? baseByRowId.get(submittedRowId) || {}
      : baseItems[index] || {};
    return {
      rowId: submittedRowId,
      lineNo: String(index + 1),
      name: text(item.name ?? before.name, `第${index + 1}行品名`, 300),
      spec: text(before.spec, `第${index + 1}行规格型号`, 300),
      unit: text(item.unit ?? before.unit, `第${index + 1}行单位`, 60),
      quantity: decimalText(item.quantity ?? before.quantity, `第${index + 1}行数量`),
      unitPrice: decimalText(item.unitPrice ?? before.unitPrice, `第${index + 1}行单价`),
      amountWithoutTax: decimalText(before.amountWithoutTax, `第${index + 1}行不含税金额`),
      taxRate: text(before.taxRate, `第${index + 1}行税率`, 40),
      taxAmount: decimalText(before.taxAmount, `第${index + 1}行税额`),
      amountWithTax: decimalText(item.amountWithTax, `第${index + 1}行总价`),
      taxClassifyCode: text(before.taxClassifyCode, `第${index + 1}行税收分类编码`, 80),
    };
  });
  const duplicateRowId = items.find((item, index) => items.findIndex((candidate) => candidate.rowId === item.rowId) !== index);
  if (duplicateRowId) {
    throw codedError("发票商品行标识重复，请刷新后重新编辑。", 400, "SUPPLIER_INVOICE_MANUAL_ROW_DUPLICATE");
  }

  return {
    provider: text(base.provider || "MANUAL_REVIEW", "识别服务", 100),
    apiName: text(base.apiName || "VatInvoiceOCR", "识别接口", 100),
    requestId: text(base.requestId, "识别请求号", 200),
    pageCount: Number(base.pageCount || 1),
    header: header as TencentVatInvoiceResult["header"],
    items,
    rawJson: {},
  };
}

export function supplierInvoiceForClient(value: unknown) {
  const invoice = record(value);
  const items = Array.isArray(invoice.items) ? invoice.items.map((item, index) => {
    const normalized = record(item);
    return { ...normalized, rowId: rowId(normalized.rowId, `ocr:${index + 1}`) };
  }) : [];
  return {
    provider: String(invoice.provider || ""),
    apiName: String(invoice.apiName || ""),
    requestId: String(invoice.requestId || ""),
    header: record(invoice.header),
    items,
  };
}
