const INVOICE_FIELD_ALIASES: Record<string, string[]> = {
  invoiceNo: [
    "invoiceNumber",
    "invoiceNo",
    "invoiceNum",
    "invoice_num",
    "发票号码",
    "发票号",
  ],
  invoiceDate: [
    "invoiceDate",
    "invoice_date",
    "date",
    "开票日期",
  ],
  buyer: [
    "purchaserName",
    "buyerName",
    "purchaser",
    "buyer",
    "buyerTitle",
    "购方名称",
    "购方信息名称",
    "购买方名称",
    "购买方信息名称",
    "购买方",
    "受票方名称",
    "购货方名称",
  ],
  buyerTaxNo: [
    "purchaserTaxNumber",
    "purchaserRegisterNum",
    "purchaserTaxNo",
    "buyerTaxNumber",
    "buyerRegisterNum",
    "buyerTaxNo",
    "buyerTaxId",
    "购方税号",
    "购方信息纳税人识别号",
    "购买方纳税人识别号",
    "购买方税号",
    "购买方信息纳税人识别号",
    "受票方税号",
    "受票方纳税人识别号",
  ],
  seller: [
    "sellerName",
    "sellerTitle",
    "seller",
    "salesName",
    "salesPartyName",
    "销方名称",
    "销方信息名称",
    "销售方名称",
    "销售方信息名称",
    "销售方",
    "销货方名称",
    "出售方名称",
    "开票方名称",
  ],
  sellerTaxNo: [
    "sellerTaxNumber",
    "sellerRegisterNum",
    "sellerTaxNo",
    "sellerTaxId",
    "salesTaxNumber",
    "salesTaxNo",
    "销方税号",
    "销方信息纳税人识别号",
    "销售方纳税人识别号",
    "销售方税号",
    "销售方信息纳税人识别号",
    "开票方税号",
    "开票方纳税人识别号",
  ],
  amountWithTax: [
    "totalAmount",
    "amountInFiguers",
    "amountInFigures",
    "totalAmountInFigures",
    "totalAmountWithTax",
    "amountWithTax",
    "价税合计",
    "价税合计小写",
    "小写金额",
    "含税金额",
  ],
  amountWithoutTax: [
    "invoiceAmountPreTax",
    "amountWithoutTax",
    "totalAmountWithoutTax",
    "sumAmount",
    "totalAmountPreTax",
    "合计金额",
    "金额合计",
    "不含税金额",
  ],
  taxAmount: [
    "invoiceTax",
    "totalTax",
    "taxAmount",
    "sumTax",
    "合计税额",
    "税额合计",
  ],
  taxRate: [
    "taxRate",
    "commodityTaxRate",
    "itemTaxRate",
    "税率",
  ],
  productName: [
    "itemName",
    "commodityName",
    "productName",
    "goodsName",
    "serviceName",
    "货物或应税劳务、服务名称",
    "货物或应税劳务服务名称",
    "项目名称",
    "商品名称",
    "产品名称",
    "服务名称",
  ],
  specModel: ["specification", "specModel", "model", "规格型号"],
  unit: ["unit", "单位"],
  quantity: ["quantity", "数量"],
  unitPrice: ["unitPrice", "price", "单价"],
};

const DETAIL_ARRAY_KEYS = [
  "invoiceDetails",
  "details",
  "items",
  "commodities",
  "invoiceItems",
  "货物明细",
  "明细",
];

type KeyValueEntry = {
  key: string;
  normalizedKey: string;
  value: unknown;
};

const PARTY_MARKERS = {
  buyer: ["purchaser", "buyer", "购方", "购买方", "受票方", "购货方"],
  seller: ["seller", "sales", "销方", "销售方", "销货方", "出售方", "开票方"],
};

const PARTY_NAME_MARKERS = ["name", "title", "名称", "纳税人名称"];
const PARTY_TAX_MARKERS = ["taxnumber", "taxno", "taxid", "registernum", "registercode", "纳税人识别号", "统一社会信用代码", "税号"];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s_\-:：,，.。()（）【】\[\]{}《》<>/\\]/g, "");
}

function normalizedMarkers(values: string[]) {
  return values.map(normalizeKey).filter(Boolean);
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

function parseJsonMaybe(value: unknown): unknown {
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

function normalizedAliasSet(aliases: string[]) {
  return new Set(aliases.map(normalizeKey).filter(Boolean));
}

function matchesAlias(key: unknown, aliases: string[]) {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  const exactAliases = normalizedAliasSet(aliases);
  if (exactAliases.has(normalized)) return true;
  return aliases.some((alias) => {
    const candidate = normalizeKey(alias);
    return Boolean(candidate) && normalized.endsWith(candidate);
  });
}

function officialDataCandidates(payload: unknown) {
  const candidates: unknown[] = [];
  const parsed = parseJsonMaybe(payload);
  if (isPlainRecord(parsed)) {
    if (isPlainRecord(parsed.data)) candidates.push(parsed.data);
    if (Array.isArray(parsed.data)) candidates.push(...parsed.data);
    if (Array.isArray(parsed.subImages)) {
      for (const image of parsed.subImages) {
        if (isPlainRecord(image) && isPlainRecord(image.data)) candidates.push(image.data);
      }
    }
    candidates.push(parsed);
  } else if (Array.isArray(parsed)) {
    candidates.push(...parsed);
  }
  return candidates;
}

function keyValuePairsFromPayload(payload: unknown) {
  const pairs = new Map<string, unknown>();
  function addPair(key: unknown, value: unknown) {
    const normalized = normalizeKey(key);
    if (!normalized || value == null || pairs.has(normalized)) return;
    pairs.set(normalized, value);
  }
  function walk(value: unknown, depth = 0) {
    if (depth > 7 || value == null) return;
    const parsed = parseJsonMaybe(value);
    if (parsed !== value) {
      walk(parsed, depth + 1);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (!isPlainRecord(value)) return;

    const key = value.key ?? value.Key ?? value.field ?? value.Field ?? value.fieldName ?? value.FieldName ?? value.name ?? value.Name ?? value.label ?? value.Label;
    const val = value.value ?? value.Value ?? value.fieldValue ?? value.FieldValue ?? value.text ?? value.Text ?? value.content ?? value.Content ?? value.word ?? value.Word;
    if (key != null && val != null) addPair(key, val);

    for (const nestedKey of ["prism_keyValueInfo", "keyValueInfo", "keyValueInfos", "kvInfo", "kvDetails", "keyValues"]) {
      const nested = value[nestedKey];
      if (Array.isArray(nested)) walk(nested, depth + 1);
    }
    for (const item of Object.values(value)) walk(item, depth + 1);
  }
  walk(payload);
  return pairs;
}

function keyValueEntriesFromPayload(payload: unknown) {
  const entries: KeyValueEntry[] = [];
  function addEntry(key: unknown, value: unknown) {
    const textKey = normalizeFieldValue(key);
    const normalizedKey = normalizeKey(textKey);
    if (!textKey || !normalizedKey || value == null) return;
    entries.push({ key: textKey, normalizedKey, value });
  }
  function walk(value: unknown, depth = 0) {
    if (depth > 7 || value == null) return;
    const parsed = parseJsonMaybe(value);
    if (parsed !== value) {
      walk(parsed, depth + 1);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (!isPlainRecord(value)) return;

    const key = value.key ?? value.Key ?? value.field ?? value.Field ?? value.fieldName ?? value.FieldName ?? value.name ?? value.Name ?? value.label ?? value.Label;
    const val = value.value ?? value.Value ?? value.fieldValue ?? value.FieldValue ?? value.text ?? value.Text ?? value.content ?? value.Content ?? value.word ?? value.Word;
    if (key != null && val != null) addEntry(key, val);

    for (const [recordKey, recordValue] of Object.entries(value)) {
      if (!["key", "Key", "field", "Field", "fieldName", "FieldName", "name", "Name", "label", "Label", "value", "Value", "fieldValue", "FieldValue", "text", "Text", "content", "Content", "word", "Word"].includes(recordKey)) {
        addEntry(recordKey, recordValue);
      }
      walk(recordValue, depth + 1);
    }
  }
  walk(payload);
  return entries;
}

function valueByAliasesFromRecord(record: unknown, aliases: string[]) {
  if (!isPlainRecord(record)) return "";
  for (const [key, value] of Object.entries(record)) {
    if (matchesAlias(key, aliases)) {
      const text = normalizeFieldValue(value);
      if (text) return text;
    }
  }
  return "";
}

function valueByAliasesFromPairs(pairs: Map<string, unknown>, aliases: string[]) {
  const aliasKeys = aliases.map(normalizeKey).filter(Boolean);
  for (const alias of aliasKeys) {
    const direct = pairs.get(alias);
    const text = normalizeFieldValue(direct);
    if (text) return text;
  }
  for (const [key, value] of pairs) {
    if (aliasKeys.some((alias) => key === alias || key.endsWith(alias))) {
      const text = normalizeFieldValue(value);
      if (text) return text;
    }
  }
  return "";
}

function contextualPartyValue(entries: KeyValueEntry[], party: "buyer" | "seller", kind: "name" | "taxNo") {
  const partyMarkers = normalizedMarkers(PARTY_MARKERS[party]);
  const fieldMarkers = normalizedMarkers(kind === "name" ? PARTY_NAME_MARKERS : PARTY_TAX_MARKERS);
  for (const entry of entries) {
    if (
      partyMarkers.some((marker) => entry.normalizedKey.includes(marker))
      && fieldMarkers.some((marker) => entry.normalizedKey.includes(marker))
    ) {
      const text = normalizeFieldValue(entry.value);
      if (text) return text;
    }
  }
  return "";
}

function genericPartyValueBySequence(entries: KeyValueEntry[], party: "buyer" | "seller", kind: "name" | "taxNo") {
  const exactKeys = normalizedMarkers(kind === "name" ? ["名称", "name"] : ["纳税人识别号", "统一社会信用代码", "税号", "taxNo", "taxNumber"]);
  const values = entries
    .filter((entry) => exactKeys.includes(entry.normalizedKey))
    .map((entry) => normalizeFieldValue(entry.value))
    .filter(Boolean);
  const uniqueValues = Array.from(new Set(values));
  return party === "buyer" ? uniqueValues[0] || "" : uniqueValues[1] || "";
}

function partyValueFromStructuredEntries(entries: KeyValueEntry[], party: "buyer" | "seller", kind: "name" | "taxNo") {
  return contextualPartyValue(entries, party, kind) || genericPartyValueBySequence(entries, party, kind);
}

function detailRowsFromPayload(payload: unknown, candidates: unknown[], pairs: Map<string, unknown>) {
  const rows: Record<string, unknown>[] = [];
  function addRows(value: unknown) {
    const parsed = parseJsonMaybe(value);
    if (Array.isArray(parsed)) {
      for (const item of parsed) if (isPlainRecord(item)) rows.push(item);
      return;
    }
    if (isPlainRecord(parsed)) rows.push(parsed);
  }
  for (const candidate of candidates) {
    if (!isPlainRecord(candidate)) continue;
    for (const key of DETAIL_ARRAY_KEYS) {
      if (candidate[key] != null) addRows(candidate[key]);
    }
  }
  for (const key of DETAIL_ARRAY_KEYS) {
    const value = pairs.get(normalizeKey(key));
    if (value != null) addRows(value);
  }
  if (!rows.length && isPlainRecord(payload)) {
    for (const value of Object.values(payload)) {
      const parsed = parseJsonMaybe(value);
      if (isPlainRecord(parsed) || Array.isArray(parsed)) rows.push(...detailRowsFromPayload(parsed, officialDataCandidates(parsed), keyValuePairsFromPayload(parsed)));
    }
  }
  return rows;
}

function fieldFromDetails(rows: Record<string, unknown>[], canonicalKey: string) {
  const aliases = INVOICE_FIELD_ALIASES[canonicalKey] || [];
  const values = rows
    .map((row) => valueByAliasesFromRecord(row, aliases))
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return Array.from(new Set(values)).join("；");
}

function genericFieldFallback(payload: unknown, aliases: string[]) {
  let found = "";
  function walk(value: unknown, depth = 0) {
    if (found || depth > 7 || value == null) return;
    const parsed = parseJsonMaybe(value);
    if (parsed !== value) {
      walk(parsed, depth + 1);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (!isPlainRecord(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (matchesAlias(key, aliases)) {
        const text = normalizeFieldValue(item);
        if (text) {
          found = text;
          return;
        }
      }
    }
    for (const item of Object.values(value)) walk(item, depth + 1);
  }
  walk(payload);
  return found;
}

function collectText(value: unknown, output: string[] = [], depth = 0) {
  if (depth > 8 || value == null) return output;
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return collectText(parsed, output, depth + 1);
  if (typeof value === "string") {
    const text = value.trim();
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
  const candidates = officialDataCandidates(data);
  const pairs = keyValuePairsFromPayload(data);
  const entries = keyValueEntriesFromPayload(data);
  const details = detailRowsFromPayload(data, candidates, pairs);
  const extractedFields: Record<string, unknown> = {};

  for (const [canonicalKey, aliases] of Object.entries(INVOICE_FIELD_ALIASES)) {
    const official = candidates.map((candidate) => valueByAliasesFromRecord(candidate, aliases)).find(Boolean);
    const detail = canonicalKey === "productName" || canonicalKey === "taxRate" || canonicalKey === "specModel" || canonicalKey === "unit" || canonicalKey === "quantity" || canonicalKey === "unitPrice"
      ? fieldFromDetails(details, canonicalKey)
      : "";
    const kv = valueByAliasesFromPairs(pairs, aliases);
    const fallback = genericFieldFallback(data, aliases);
    const value = official || detail || kv || fallback;
    if (value) extractedFields[canonicalKey] = value;
  }

  extractedFields.buyer ||= partyValueFromStructuredEntries(entries, "buyer", "name");
  extractedFields.seller ||= partyValueFromStructuredEntries(entries, "seller", "name");
  extractedFields.buyerTaxNo ||= partyValueFromStructuredEntries(entries, "buyer", "taxNo");
  extractedFields.sellerTaxNo ||= partyValueFromStructuredEntries(entries, "seller", "taxNo");

  return {
    data,
    extractedFields,
    text: collectText(data).join("\n"),
  };
}
