import {
  customsParseMessage,
  customsParseStatusFromFields,
  normalizeCustomsDeclarationItemForTaxRefund,
  parseCustomsDeclarationDetailText,
  type CustomsDeclarationItemFields,
} from "../customs-declaration-parser";
import { isPlainRecord } from "./shared-base-utils";
import { hasAliyunTableShape } from "./aliyun-customs-table-parser";
import { normalizeFieldValue, normalizeKey, parseJsonMaybe } from "./ocr-integration-shared";

export const CONTRACT_FIELD_ALIASES: Record<string, string[]> = {
  supplier: ["供应商", "供方", "卖方", "乙方", "Supplier", "Seller"],
  buyer: ["采购方", "需方", "买方", "甲方", "Buyer", "Purchaser"],
  orderNo: ["订单号", "采购订单号", "PO", "PO号", "PurchaseOrderNo"],
  contractNo: ["合同号", "合同编号", "ContractNo"],
  amount: ["合同金额", "总金额", "价税合计", "金额", "Amount", "TotalAmount"],
  productName: ["产品名称", "货物名称", "品名", "ProductName", "ItemName"],
  specModel: ["规格型号", "规格", "型号", "Spec", "Specification"],
  quantity: ["数量", "Quantity"],
  unitPrice: ["单价", "UnitPrice"],
  signingDate: ["签订日期", "合同日期", "日期", "SigningDate", "ContractDate"],
};

export const CUSTOMS_DECLARATION_KEYS = [
  "报关单号",
  "申报日期",
  "出口日期",
  "成交方式",
  "币制",
  "报关总金额",
  "总价",
  "商品名称",
  "数量",
  "单位",
];

export const CUSTOMS_FIELD_ALIASES: Record<string, string[]> = {
  customsDeclarationNo: ["报关单号", "海关编号", "预录入编号", "declarationNo", "customsDeclarationNo"],
  customsDeclarationDate: ["申报日期", "申报时间", "declarationDate"],
  exportDate: ["出口日期", "出口时间", "离境日期", "exportDate"],
  tradeTerm: ["成交方式", "贸易方式", "价格条款", "tradeTerm"],
  currency: ["币制", "币种", "成交币制", "currency"],
  totalAmount: ["报关总金额", "FOB金额", "总价", "成交金额", "fobAmount", "totalAmount"],
};

export const CUSTOMS_ITEM_FIELD_ALIASES: Record<string, string[]> = {
  productName: ["商品名称", "中文品名", "商品名称及规格型号", "品名", "productName"],
  quantity: ["数量", "第一数量", "成交数量", "quantity"],
  unit: ["单位", "法定单位", "成交单位", "unit"],
  totalAmount: ["总价", "金额", "成交金额", "totalAmount"],
  currency: ["币制", "币种", "currency"],
};

export const CUSTOMS_TRADE_DOCUMENT_EXTRACTION_RANGE = ["出口报关单", "进口报关单"];

export function collectText(value: unknown, output: string[] = [], depth = 0) {
  if (depth > 8 || value == null) return output;
  if (typeof value === "string") {
    const text = value.trim();
    const parsed = parseJsonMaybe(text);
    if (parsed !== text) return collectText(parsed, output, depth + 1);
    if (text && text.length <= 1000) output.push(text);
    return output;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, output, depth + 1));
    return output;
  }
  if (isPlainRecord(value)) {
    Object.values(value).forEach((item) => collectText(item, output, depth + 1));
  }
  return output;
}

export function addMatchedField(fields: Record<string, unknown>, canonicalKey: string, value: unknown) {
  const text = normalizeFieldValue(value);
  if (!text || fields[canonicalKey]) return;
  fields[canonicalKey] = text;
}

export function maybeFieldName(record: Record<string, unknown>) {
  return normalizeFieldValue(
    record.key
    || record.Key
    || record.field
    || record.Field
    || record.fieldName
    || record.FieldName
    || record.name
    || record.Name
    || record.label
    || record.Label,
  );
}

export function maybeFieldValue(record: Record<string, unknown>) {
  return (
    record.value
    || record.Value
    || record.fieldValue
    || record.FieldValue
    || record.text
    || record.Text
    || record.content
    || record.Content
    || record.word
    || record.Word
    || record.data
    || record.Data
  );
}

export function matchAliases(fieldName: unknown, aliases: string[]) {
  const normalized = normalizeKey(fieldName);
  if (!normalized) return false;
  return aliases.some((alias) => {
    const candidate = normalizeKey(alias);
    return normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized);
  });
}

export function collectFieldsFromObject(
  value: unknown,
  aliases: Record<string, string[]>,
  output: Record<string, unknown> = {},
  path: string[] = [],
  depth = 0,
) {
  if (depth > 8 || value == null) return output;
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return collectFieldsFromObject(parsed, aliases, output, path, depth + 1);
  if (Array.isArray(value)) {
    value.forEach((item) => collectFieldsFromObject(item, aliases, output, path, depth + 1));
    return output;
  }
  if (!isPlainRecord(value)) return output;

  const namedField = maybeFieldName(value);
  if (namedField) {
    for (const [canonicalKey, fieldAliases] of Object.entries(aliases)) {
      if (matchAliases(namedField, fieldAliases)) addMatchedField(output, canonicalKey, maybeFieldValue(value));
    }
  }

  for (const [key, item] of Object.entries(value)) {
    for (const [canonicalKey, fieldAliases] of Object.entries(aliases)) {
      if (matchAliases([...path, key].join("."), fieldAliases) || matchAliases(key, fieldAliases)) {
        addMatchedField(output, canonicalKey, item);
      }
    }
    collectFieldsFromObject(item, aliases, output, [...path, key], depth + 1);
  }
  return output;
}

export function parseNumberText(value: unknown) {
  const text = normalizeFieldValue(value)
    .replace(/[,，\s]/g, "")
    .replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeCurrencyCode(value: unknown) {
  const text = normalizeFieldValue(value).toUpperCase();
  if (/美元|USD/.test(text)) return "USD";
  if (/人民币|CNY|RMB/.test(text)) return "CNY";
  if (/欧元|EUR/.test(text)) return "EUR";
  if (/日元|JPY/.test(text)) return "JPY";
  if (/港币|HKD/.test(text)) return "HKD";
  return /^[A-Z]{3}$/.test(text) ? text : "";
}

export function normalizeCustomsItemFromFields(fields: Record<string, unknown>): CustomsDeclarationItemFields | null {
  return normalizeCustomsDeclarationItemForTaxRefund({
    productName: normalizeFieldValue(fields.productName),
    quantity: parseNumberText(fields.quantity),
    unit: normalizeFieldValue(fields.unit),
    totalAmount: parseNumberText(fields.totalAmount),
    currency: normalizeCurrencyCode(fields.currency),
  });
}

export function collectCustomsItemCandidates(value: unknown, output: CustomsDeclarationItemFields[] = [], depth = 0) {
  if (depth > 8 || value == null) return output;
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return collectCustomsItemCandidates(parsed, output, depth + 1);
  if (Array.isArray(value)) {
    for (const item of value) collectCustomsItemCandidates(item, output, depth + 1);
    return output;
  }
  if (!isPlainRecord(value)) return output;
  if (!hasAliyunTableShape(value)) {
    const fields = collectFieldsFromObject(value, CUSTOMS_ITEM_FIELD_ALIASES);
    if (fields.productName && fields.quantity && fields.unit && fields.totalAmount) {
      const item = normalizeCustomsItemFromFields(fields);
      if (item) output.push(item);
    }
  }
  for (const itemValue of Object.values(value)) collectCustomsItemCandidates(itemValue, output, depth + 1);
  return output;
}

export function dedupeCustomsItems(items: CustomsDeclarationItemFields[] = []) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [
      item.productName,
      item.quantity || 0,
      item.unit || "",
      item.currency || "",
      item.totalAmount || item.fobAmount || 0,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeCustomsParsedData(
  text: string,
  structuredFields: Record<string, unknown> = {},
  structuredItems: CustomsDeclarationItemFields[] = [],
) {
  const fallback = parseCustomsDeclarationDetailText(text);
  const fields = {
    customsDeclarationNo: normalizeFieldValue(structuredFields.customsDeclarationNo) || fallback.customsDeclarationNo,
    customsDeclarationDate: normalizeFieldValue(structuredFields.customsDeclarationDate) || fallback.customsDeclarationDate,
    exportDate: normalizeFieldValue(structuredFields.exportDate) || fallback.exportDate,
    tradeTerm: normalizeFieldValue(structuredFields.tradeTerm) || fallback.tradeTerm,
    currency: normalizeCurrencyCode(structuredFields.currency) || fallback.currency,
    totalAmount: parseNumberText(structuredFields.totalAmount) || fallback.totalAmount,
  };
  const items = dedupeCustomsItems(structuredItems
    .map((item) => normalizeCustomsDeclarationItemForTaxRefund(item, { tradeTerm: fields.tradeTerm, currency: fields.currency }))
    .filter((item): item is CustomsDeclarationItemFields => Boolean(item)));
  const status = customsParseStatusFromFields(fields);
  return {
    ...fields,
    customsDeclarationParseStatus: status,
    customsDeclarationParseSource: fallback.customsDeclarationParseSource,
    customsDeclarationParseMessage: customsParseMessage(fields, status),
    items,
  };
}
