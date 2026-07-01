const INVOICE_FIELD_ALIASES: Record<string, string[]> = {
  invoiceNo: ["发票号码", "发票号", "invoiceNo", "invoiceNumber", "InvoiceNo", "InvoiceNumber"],
  invoiceDate: ["开票日期", "日期", "invoiceDate", "InvoiceDate"],
  buyer: ["购买方名称", "购买方", "购方名称", "受票方名称", "buyerName", "BuyerName", "PurchaserName", "purchaserName"],
  buyerTaxNo: ["购买方纳税人识别号", "购方税号", "受票方税号", "buyerTaxNo", "BuyerTaxNo", "PurchaserTaxNo", "purchaserTaxNumber"],
  seller: ["销售方名称", "销售方", "销方名称", "sellerName", "SellerName"],
  sellerTaxNo: ["销售方纳税人识别号", "销方税号", "sellerTaxNo", "SellerTaxNo", "sellerTaxNumber"],
  amountWithTax: ["价税合计", "价税合计小写", "小写金额", "含税金额", "发票金额", "totalAmount", "TotalAmount", "AmountWithTax"],
  amountWithoutTax: ["不含税金额", "金额合计", "合计金额", "发票金额不含税", "amountWithoutTax", "AmountWithoutTax", "SumAmount", "invoiceAmountPreTax"],
  taxAmount: ["税额合计", "合计税额", "税额", "发票税额", "taxAmount", "TaxAmount", "SumTax", "invoiceTax"],
  taxRate: ["税率", "taxRate", "TaxRate"],
  productName: ["货物或应税劳务、服务名称", "货物或应税劳务服务名称", "项目名称", "商品名称", "产品名称", "服务名称", "ItemName", "itemName", "CommodityName", "ProductName"],
  specModel: ["规格型号", "Spec", "Specification", "specification", "Model"],
  unit: ["单位", "Unit"],
  quantity: ["数量", "Quantity"],
  unitPrice: ["单价", "UnitPrice"],
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s_\-:：,，.。()（）【】\[\]{}《》<>/\\]/g, "");
}

function normalizeFieldValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return value.map(normalizeFieldValue).filter(Boolean).join("；");
  if (isPlainRecord(value)) {
    for (const key of ["value", "Value", "text", "Text", "content", "Content", "word", "Word", "name", "Name"]) {
      const text = normalizeFieldValue(value[key]);
      if (text) return text;
    }
  }
  return "";
}

function parseJsonMaybe(value: unknown) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function responseField(record: unknown, key: string) {
  if (!isPlainRecord(record)) return undefined;
  if (record[key] != null) return record[key];
  const pascal = `${key.slice(0, 1).toUpperCase()}${key.slice(1)}`;
  if (record[pascal] != null) return record[pascal];
  const upper = key.toUpperCase();
  if (record[upper] != null) return record[upper];
  return undefined;
}

function matchAliases(fieldName: unknown, aliases: string[]) {
  const normalized = normalizeKey(fieldName);
  if (!normalized) return false;
  return aliases.some((alias) => {
    const candidate = normalizeKey(alias);
    return normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized);
  });
}

function addMatchedField(fields: Record<string, unknown>, canonicalKey: string, value: unknown) {
  const text = normalizeFieldValue(value);
  if (!text || fields[canonicalKey]) return;
  fields[canonicalKey] = text;
}

function maybeFieldName(record: Record<string, unknown>) {
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

function maybeFieldValue(record: Record<string, unknown>) {
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

function collectFieldsFromObject(
  value: unknown,
  output: Record<string, unknown> = {},
  path: string[] = [],
  depth = 0,
) {
  if (depth > 8 || value == null) return output;
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return collectFieldsFromObject(parsed, output, path, depth + 1);
  if (Array.isArray(value)) {
    value.forEach((item) => collectFieldsFromObject(item, output, path, depth + 1));
    return output;
  }
  if (!isPlainRecord(value)) return output;

  const namedField = maybeFieldName(value);
  if (namedField) {
    for (const [canonicalKey, aliases] of Object.entries(INVOICE_FIELD_ALIASES)) {
      if (matchAliases(namedField, aliases)) addMatchedField(output, canonicalKey, maybeFieldValue(value));
    }
  }

  for (const [key, item] of Object.entries(value)) {
    for (const [canonicalKey, aliases] of Object.entries(INVOICE_FIELD_ALIASES)) {
      if (matchAliases([...path, key].join("."), aliases) || matchAliases(key, aliases)) {
        addMatchedField(output, canonicalKey, item);
      }
    }
    collectFieldsFromObject(item, output, [...path, key], depth + 1);
  }
  return output;
}

function collectProductNames(rawData: unknown) {
  const names = new Set<string>();
  function walk(value: unknown, depth = 0) {
    if (depth > 8 || value == null) return;
    const parsed = parseJsonMaybe(value);
    if (parsed !== value) {
      walk(parsed, depth + 1);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, depth + 1));
      return;
    }
    if (!isPlainRecord(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (matchAliases(key, INVOICE_FIELD_ALIASES.productName)) {
        const text = normalizeFieldValue(item);
        if (text) names.add(text);
      }
      walk(item, depth + 1);
    }
  }
  walk(rawData);
  return Array.from(names).join("；");
}

function collectText(value: unknown, output: string[] = [], depth = 0) {
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

export function extractAliyunInvoiceRecognitionData(responseBody: unknown) {
  const data = parseJsonMaybe(responseField(responseBody, "data"));
  const extractedFields = collectFieldsFromObject(data);
  const productName = collectProductNames(data);
  if (productName && !extractedFields.productName) extractedFields.productName = productName;
  return {
    data,
    extractedFields,
    text: collectText(data).join("\n"),
  };
}
