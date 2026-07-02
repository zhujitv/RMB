import { Readable } from "node:stream";
import DocMindClient, {
  AyncTradeDocumentPackageExtractSmartAppRequest,
} from "@alicloud/docmind-api20220711";
import AliyunOcrClient, {
  RecognizeAllTextRequest,
  RecognizeAllTextRequestAdvancedConfig,
  RecognizeAllTextRequestTableConfig,
  RecognizeGeneralStructureRequest,
  RecognizeInvoiceRequest,
} from "@alicloud/ocr-api20210707";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { prisma } from "../prisma";
import {
  customsParseMessage,
  customsParseStatusFromFields,
  extractPdfTextFromPdfBuffer,
  normalizeCustomsDeclarationItemForTaxRefund,
  parseCustomsDeclarationDetailText,
  type CustomsDeclarationItemFields,
} from "../customs-declaration-parser";
import {
  DEFAULT_OCR_INTEGRATION_SETTINGS,
  OCR_INTEGRATION_SETTING_KEY,
  runNonCriticalTask,
} from "./shared-constants";
import { assertJsonObject, codedError, isPlainRecord, nonEmpty, num } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import {
  extractCustomsItemsFromAliyunTableData,
  hasAliyunTableShape,
} from "./aliyun-customs-table-parser";
import { extractAliyunInvoiceRecognitionData } from "./aliyun-invoice-ocr-parser";

type SettingsActor = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];

export type OcrFeatureKey = "customsDeclaration" | "invoiceText" | "supplierDocumentReturn";
export type SupplierOcrDocumentType = "SUPPLIER_PURCHASE_CONTRACT" | "SUPPLIER_INVOICE";

type OcrIntegrationInput = {
  enabled?: unknown;
  provider?: unknown;
  apiBaseUrl?: unknown;
  accessKeyId?: unknown;
  accessKeySecret?: unknown;
  appCode?: unknown;
  customsDeclarationEnabled?: unknown;
  invoiceTextEnabled?: unknown;
  supplierDocumentReturnEnabled?: unknown;
  fallbackToPdfText?: unknown;
  timeoutMs?: unknown;
};

export type OcrRecognitionResult = {
  text: string;
  source: string;
  provider: string;
  rawJson?: unknown;
  extractedFields?: Record<string, unknown>;
  parsedJson?: unknown;
  apiName?: string;
  confidence?: number | null;
  parser?: string;
};

type OcrRecognitionOptions = {
  requireText?: boolean;
  sourceUrl?: string;
  fileName?: string;
};

const SUPPLIER_CONTRACT_KEYS = [
  "供应商",
  "采购方",
  "订单号",
  "合同号",
  "合同金额",
  "产品名称",
  "规格型号",
  "数量",
  "单价",
  "签订日期",
];
const CUSTOMS_DECLARATION_MIN_TIMEOUT_MS = 60000;

function customsTextFallbackParsedJson(text: string) {
  const parsed = parseCustomsDeclarationDetailText(text);
  return {
    ...parsed,
    items: [],
    itemParseSkippedReason: "LOW_CONFIDENCE_PDF_TEXT_FALLBACK",
    itemParseMessage: "PDF全文兜底仅用于报关单基础字段，不自动保存商品明细。",
  };
}

const CONTRACT_FIELD_ALIASES: Record<string, string[]> = {
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

const CUSTOMS_DECLARATION_KEYS = [
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

const CUSTOMS_FIELD_ALIASES: Record<string, string[]> = {
  customsDeclarationNo: ["报关单号", "海关编号", "预录入编号", "declarationNo", "customsDeclarationNo"],
  customsDeclarationDate: ["申报日期", "申报时间", "declarationDate"],
  exportDate: ["出口日期", "出口时间", "离境日期", "exportDate"],
  tradeTerm: ["成交方式", "贸易方式", "价格条款", "tradeTerm"],
  currency: ["币制", "币种", "成交币制", "currency"],
  totalAmount: ["报关总金额", "FOB金额", "总价", "成交金额", "fobAmount", "totalAmount"],
};

const CUSTOMS_ITEM_FIELD_ALIASES: Record<string, string[]> = {
  productName: ["商品名称", "中文品名", "商品名称及规格型号", "品名", "productName"],
  quantity: ["数量", "第一数量", "成交数量", "quantity"],
  unit: ["单位", "法定单位", "成交单位", "unit"],
  totalAmount: ["总价", "金额", "成交金额", "totalAmount"],
  currency: ["币制", "币种", "currency"],
};

const CUSTOMS_TRADE_DOCUMENT_EXTRACTION_RANGE = ["出口报关单", "进口报关单"];

function cleanSecret(value: unknown, limit = 500) {
  return nonEmpty(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

function cleanProvider(value: unknown) {
  const provider = nonEmpty(value || DEFAULT_OCR_INTEGRATION_SETTINGS.provider).toUpperCase();
  if (provider !== "ALIYUN") {
    throw codedError("当前仅支持阿里云 OCR 服务。", 400, "OCR_PROVIDER_UNSUPPORTED");
  }
  return "ALIYUN";
}

function cleanOptionalUrl(value: unknown, fallback: string) {
  const text = nonEmpty(value || fallback);
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw codedError("OCR API 地址只支持 http 或 https", 400, "VALIDATION_INVALID_URL");
    }
    return url.toString().replace(/\/+$/, "");
  } catch (error) {
    if ((error as { status?: number } | null)?.status) throw error;
    throw codedError("OCR API 地址格式错误", 400, "VALIDATION_INVALID_URL");
  }
}

function cleanTimeoutMs(value: unknown) {
  const timeoutMs = Math.round(num(value, DEFAULT_OCR_INTEGRATION_SETTINGS.timeoutMs));
  return Math.min(60000, Math.max(3000, timeoutMs));
}

function customsOcrSettings(settings: ReturnType<typeof normalizeOcrIntegrationSettings>) {
  return {
    ...settings,
    timeoutMs: Math.max(settings.timeoutMs, CUSTOMS_DECLARATION_MIN_TIMEOUT_MS),
  };
}

function ocrErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

function settingValue(setting: unknown) {
  return isPlainRecord(setting) && "value" in setting ? setting.value : setting;
}

function bufferFromInput(buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined) {
  if (!buffer) return Buffer.alloc(0);
  if (Buffer.isBuffer(buffer)) return buffer;
  if (buffer instanceof ArrayBuffer) return Buffer.from(buffer);
  return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
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
    const preferred = [
      "value",
      "Value",
      "text",
      "Text",
      "content",
      "Content",
      "word",
      "Word",
      "name",
      "Name",
    ];
    for (const key of preferred) {
      const item = value[key];
      const text = normalizeFieldValue(item);
      if (text) return text;
    }
  }
  return "";
}

function parseJsonMaybe(value: unknown) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return value;
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function responseField(record: unknown, key: string) {
  if (!isPlainRecord(record)) return undefined;
  const direct = record[key];
  if (direct != null) return direct;
  const pascal = `${key.slice(0, 1).toUpperCase()}${key.slice(1)}`;
  if (record[pascal] != null) return record[pascal];
  const upper = key.toUpperCase();
  if (record[upper] != null) return record[upper];
  return undefined;
}

function toPlainJson(value: unknown): unknown {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
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

function matchAliases(fieldName: unknown, aliases: string[]) {
  const normalized = normalizeKey(fieldName);
  if (!normalized) return false;
  return aliases.some((alias) => {
    const candidate = normalizeKey(alias);
    return normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized);
  });
}

function collectFieldsFromObject(
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

function parseNumberText(value: unknown) {
  const text = normalizeFieldValue(value)
    .replace(/[,，\s]/g, "")
    .replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCurrencyCode(value: unknown) {
  const text = normalizeFieldValue(value).toUpperCase();
  if (/美元|USD/.test(text)) return "USD";
  if (/人民币|CNY|RMB/.test(text)) return "CNY";
  if (/欧元|EUR/.test(text)) return "EUR";
  if (/日元|JPY/.test(text)) return "JPY";
  if (/港币|HKD/.test(text)) return "HKD";
  return /^[A-Z]{3}$/.test(text) ? text : "";
}

function normalizeCustomsItemFromFields(fields: Record<string, unknown>): CustomsDeclarationItemFields | null {
  return normalizeCustomsDeclarationItemForTaxRefund({
    productName: normalizeFieldValue(fields.productName),
    quantity: parseNumberText(fields.quantity),
    unit: normalizeFieldValue(fields.unit),
    totalAmount: parseNumberText(fields.totalAmount),
    currency: normalizeCurrencyCode(fields.currency),
  });
}

function collectCustomsItemCandidates(value: unknown, output: CustomsDeclarationItemFields[] = [], depth = 0) {
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

function dedupeCustomsItems(items: CustomsDeclarationItemFields[] = []) {
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

function mergeCustomsParsedData(
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

function aliyunEndpointFromUrl(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

function createAliyunOcrClient(settings: ReturnType<typeof normalizeOcrIntegrationSettings>) {
  if (!settings.accessKeyId || !settings.accessKeySecret) {
    throw codedError("阿里云结构化 OCR 需要配置 AccessKey ID 和 AccessKey Secret。", 400, "OCR_ACCESS_KEY_REQUIRED");
  }
  return new AliyunOcrClient(new $OpenApiUtil.Config({
    accessKeyId: settings.accessKeyId,
    accessKeySecret: settings.accessKeySecret,
    endpoint: aliyunEndpointFromUrl(settings.apiBaseUrl),
    readTimeout: settings.timeoutMs,
    connectTimeout: Math.min(settings.timeoutMs, 10000),
  }));
}

function aliyunDocMindEndpoint() {
  return (process.env.ALIYUN_DOCMIND_ENDPOINT || process.env.DOCMIND_API_ENDPOINT || "docmind-api.cn-hangzhou.aliyuncs.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function createAliyunDocMindClient(settings: ReturnType<typeof normalizeOcrIntegrationSettings>) {
  if (!settings.accessKeyId || !settings.accessKeySecret) {
    throw codedError("阿里云文档智能需要配置 AccessKey ID 和 AccessKey Secret。", 400, "OCR_ACCESS_KEY_REQUIRED");
  }
  return new DocMindClient(new $OpenApiUtil.Config({
    accessKeyId: settings.accessKeyId,
    accessKeySecret: settings.accessKeySecret,
    endpoint: aliyunDocMindEndpoint(),
    readTimeout: settings.timeoutMs,
    connectTimeout: Math.min(settings.timeoutMs, 10000),
  }));
}

async function recognizeWithPdfTextFallback(
  buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined,
  feature: OcrFeatureKey,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  options: OcrRecognitionOptions & { source?: string; error?: unknown } = {},
): Promise<OcrRecognitionResult> {
  if (!settings.fallbackToPdfText) {
    if (options.error) throw options.error;
    throw codedError("OCR服务未配置可用结构化识别，且本地 PDF 文本兜底已关闭。", 501, "OCR_PROVIDER_ADAPTER_NOT_CONFIGURED");
  }
  const text = await extractPdfTextFromPdfBuffer(buffer, options);
  const parsedJson = feature === "customsDeclaration" ? customsTextFallbackParsedJson(text) : undefined;
  return {
    text,
    source: options.source || "OCR_PDF_TEXT_FALLBACK",
    provider: settings.provider,
    apiName: options.source || "OCR_PDF_TEXT_FALLBACK",
    rawJson: {
      source: options.source || "OCR_PDF_TEXT_FALLBACK",
      provider: settings.provider,
      textLength: text.length,
      fallbackReason: options.error instanceof Error ? options.error.message : "",
    },
    parsedJson,
  };
}

async function recognizeAliyunVatInvoice(
  buffer: Buffer,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
): Promise<OcrRecognitionResult> {
  const client = createAliyunOcrClient(settings);
  const response = await client.recognizeInvoice(new RecognizeInvoiceRequest({
    body: Readable.from(buffer),
    pageNo: 1,
  }));
  const rawJson = toPlainJson(response);
  const responseBody = isPlainRecord(rawJson) ? rawJson.body : response.body;
  const { extractedFields, text } = extractAliyunInvoiceRecognitionData(responseBody);
  return {
    text,
    source: "ALIYUN_RECOGNIZE_INVOICE",
    provider: settings.provider,
    apiName: "ALIYUN_RECOGNIZE_INVOICE",
    rawJson,
    extractedFields,
    parsedJson: extractedFields,
    parser: "VAT_INVOICE",
  };
}

async function recognizeAliyunSupplierContract(
  buffer: Buffer,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
): Promise<OcrRecognitionResult> {
  const client = createAliyunOcrClient(settings);
  const response = await client.recognizeGeneralStructure(new RecognizeGeneralStructureRequest({
    body: Readable.from(buffer),
    keys: SUPPLIER_CONTRACT_KEYS,
  }));
  const rawJson = toPlainJson(response);
  const responseBody = isPlainRecord(rawJson) ? rawJson.body : response.body;
  const data = parseJsonMaybe(responseField(responseBody, "data"));
  const extractedFields = collectFieldsFromObject(data, CONTRACT_FIELD_ALIASES);
  const text = collectText(data).join("\n");
  return {
    text,
    source: "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE",
    provider: settings.provider,
    apiName: "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE",
    rawJson,
    extractedFields,
    parsedJson: extractedFields,
    parser: "PURCHASE_CONTRACT",
  };
}

function hasUsefulCustomsParsedData(parsed: unknown) {
  if (!isPlainRecord(parsed)) return false;
  return Boolean(
    parsed.customsDeclarationNo
    || parsed.customsDeclarationDate
    || parsed.exportDate
    || parsed.totalAmount
    || (Array.isArray(parsed.items) && parsed.items.length > 0),
  );
}

async function recognizeAliyunCustomsDeclarationWithDocMind(
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  options: OcrRecognitionOptions = {},
): Promise<OcrRecognitionResult> {
  const fileUrl = nonEmpty(options.sourceUrl);
  if (!fileUrl) {
    throw codedError("文档智能报关单识别需要可下载的文件 URL。", 400, "ALIYUN_DOCMIND_FILE_URL_REQUIRED");
  }
  const client = createAliyunDocMindClient(customsOcrSettings(settings));
  const response = await client.ayncTradeDocumentPackageExtractSmartApp(new AyncTradeDocumentPackageExtractSmartAppRequest({
    fileUrl,
    fileName: nonEmpty(options.fileName) || "customs-declaration.pdf",
    customExtractionRange: CUSTOMS_TRADE_DOCUMENT_EXTRACTION_RANGE,
  }));
  const rawJson = toPlainJson(response);
  const responseBody = isPlainRecord(rawJson) ? rawJson.body : response.body;
  const data = parseJsonMaybe(responseField(responseBody, "data"));
  const text = collectText(data).join("\n");
  const structuredFields = collectFieldsFromObject(data, CUSTOMS_FIELD_ALIASES);
  let items = extractCustomsItemsFromAliyunTableData(data, {
    tradeTerm: normalizeFieldValue(structuredFields.tradeTerm),
    currency: normalizeCurrencyCode(structuredFields.currency),
  });
  if (!items.length) items = collectCustomsItemCandidates(data);
  const parsedJson = mergeCustomsParsedData(text, structuredFields, items);
  if (!hasUsefulCustomsParsedData(parsedJson)) {
    throw codedError("文档智能未返回可用的报关单结构化字段。", 422, "ALIYUN_DOCMIND_CUSTOMS_EMPTY");
  }
  return {
    text,
    source: "ALIYUN_DOCMIND_TRADE_DOCUMENT_CUSTOMS",
    provider: settings.provider,
    apiName: "ALIYUN_DOCMIND_TRADE_DOCUMENT_PACKAGE_EXTRACT",
    rawJson,
    extractedFields: structuredFields,
    parsedJson,
    confidence: null,
    parser: "CUSTOMS_DECLARATION_DOCMIND",
  };
}

async function recognizeAliyunCustomsDeclaration(
  buffer: Buffer,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  options: OcrRecognitionOptions = {},
): Promise<OcrRecognitionResult> {
  const effectiveSettings = customsOcrSettings(settings);
  if (options.sourceUrl) {
    try {
      return await recognizeAliyunCustomsDeclarationWithDocMind(effectiveSettings, options);
    } catch (error) {
      console.error("aliyun-docmind-customs-ocr-failed", {
        code: (error as { code?: string } | null)?.code || "",
        message: ocrErrorText(error),
      });
    }
  }
  const client = createAliyunOcrClient(effectiveSettings);
  let primaryRawJson: unknown = null;
  let primaryData: unknown = null;
  let primaryText = "";
  let primaryError = "";
  try {
    const response = await client.recognizeGeneralStructure(new RecognizeGeneralStructureRequest({
      body: Readable.from(buffer),
      keys: CUSTOMS_DECLARATION_KEYS,
    }));
    primaryRawJson = toPlainJson(response);
    const responseBody = isPlainRecord(primaryRawJson) ? primaryRawJson.body : response.body;
    primaryData = parseJsonMaybe(responseField(responseBody, "data"));
    primaryText = collectText(primaryData).join("\n");
  } catch (error) {
    primaryError = ocrErrorText(error);
    primaryRawJson = {
      error: primaryError,
      apiName: "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE",
      timeoutMs: effectiveSettings.timeoutMs,
    };
    console.error("aliyun-customs-general-structure-failed", {
      message: primaryError,
      timeoutMs: effectiveSettings.timeoutMs,
    });
  }
  const pdfText = primaryText || await extractPdfTextFromPdfBuffer(buffer, { requireText: options.requireText === true }).catch(() => "");
  const primaryFields = collectFieldsFromObject(primaryData, CUSTOMS_FIELD_ALIASES);
  let items = extractCustomsItemsFromAliyunTableData(primaryData, {
    tradeTerm: normalizeFieldValue(primaryFields.tradeTerm),
    currency: normalizeCurrencyCode(primaryFields.currency),
  });
  if (!items.length) items = collectCustomsItemCandidates(primaryData);
  let tableRawJson: unknown = null;
  let tableOnlyRawJson: unknown = null;
  let tableText = "";
  const tableErrors: string[] = [];
  if (!items.length) {
    try {
      const tableResponse = await client.recognizeAllText(new RecognizeAllTextRequest({
        body: Readable.from(buffer),
        type: "Advanced",
        advancedConfig: new RecognizeAllTextRequestAdvancedConfig({
          outputTable: true,
          outputRow: true,
          isLineLessTable: true,
        }),
      }));
      tableRawJson = toPlainJson(tableResponse);
      const tableBody = isPlainRecord(tableRawJson) ? tableRawJson.body : tableResponse.body;
      const tableData = parseJsonMaybe(responseField(tableBody, "data"));
      tableText = collectText(tableData).join("\n");
      items = extractCustomsItemsFromAliyunTableData(tableData, {
        tradeTerm: normalizeFieldValue(primaryFields.tradeTerm),
        currency: normalizeCurrencyCode(primaryFields.currency),
      });
      if (!items.length) items = collectCustomsItemCandidates(tableData);
    } catch (error) {
      tableErrors.push(`Advanced: ${ocrErrorText(error)}`);
    }
  }
  if (!items.length) {
    try {
      const tableOnlyResponse = await client.recognizeAllText(new RecognizeAllTextRequest({
        body: Readable.from(buffer),
        type: "Table",
        tableConfig: new RecognizeAllTextRequestTableConfig({
          isLineLessTable: true,
        }),
      }));
      tableOnlyRawJson = toPlainJson(tableOnlyResponse);
      const tableOnlyBody = isPlainRecord(tableOnlyRawJson) ? tableOnlyRawJson.body : tableOnlyResponse.body;
      const tableOnlyData = parseJsonMaybe(responseField(tableOnlyBody, "data"));
      tableText = [tableText, collectText(tableOnlyData).join("\n")].filter(Boolean).join("\n");
      items = extractCustomsItemsFromAliyunTableData(tableOnlyData, {
        tradeTerm: normalizeFieldValue(primaryFields.tradeTerm),
        currency: normalizeCurrencyCode(primaryFields.currency),
      });
      if (!items.length) items = collectCustomsItemCandidates(tableOnlyData);
    } catch (error) {
      tableErrors.push(`Table: ${ocrErrorText(error)}`);
    }
  }
  if (primaryError && !tableRawJson && !tableOnlyRawJson) {
    throw codedError(
      `阿里云报关单结构化识别超时或失败：${primaryError}`,
      504,
      "ALIYUN_CUSTOMS_OCR_TIMEOUT",
    );
  }
  if (tableRawJson || tableOnlyRawJson) {
    const mergedTableText = [pdfText, tableText].filter(Boolean).join("\n");
    const parsedWithTable = mergeCustomsParsedData(mergedTableText, primaryFields, items);
    return {
      text: mergedTableText,
      source: items.length ? "ALIYUN_RECOGNIZE_TRADE_DOCUMENT_WITH_TABLE" : "ALIYUN_RECOGNIZE_TRADE_DOCUMENT_TABLE_EMPTY",
      provider: settings.provider,
      apiName: items.length ? "ALIYUN_RECOGNIZE_ALL_TEXT_TABLE_FALLBACK" : "ALIYUN_RECOGNIZE_ALL_TEXT_TABLE_EMPTY",
      rawJson: {
        primary: primaryRawJson,
        table: tableOnlyRawJson || tableRawJson,
        advancedTable: tableRawJson,
        tableOnly: tableOnlyRawJson,
        primaryError,
        tableErrors,
      },
      extractedFields: primaryFields,
      parsedJson: parsedWithTable,
      confidence: null,
      parser: "CUSTOMS_DECLARATION",
    };
  }
  const parsedJson = mergeCustomsParsedData(pdfText, primaryFields, items);
  return {
    text: pdfText,
    source: "ALIYUN_RECOGNIZE_TRADE_DOCUMENT",
    provider: settings.provider,
    apiName: items.length ? "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE" : "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE_TABLE_EMPTY",
    rawJson: {
      primary: primaryRawJson,
      table: tableRawJson,
      tableOnly: tableOnlyRawJson,
      primaryError,
      tableErrors,
    },
    extractedFields: primaryFields,
    parsedJson,
    confidence: null,
    parser: "CUSTOMS_DECLARATION",
  };
}

export function normalizeOcrIntegrationSettings(value: unknown = {}) {
  const input: OcrIntegrationInput = isPlainRecord(value) ? value : {};
  return {
    enabled: input.enabled === true,
    provider: cleanProvider(input.provider),
    apiBaseUrl: cleanOptionalUrl(input.apiBaseUrl, DEFAULT_OCR_INTEGRATION_SETTINGS.apiBaseUrl),
    accessKeyId: cleanSecret(input.accessKeyId),
    accessKeySecret: cleanSecret(input.accessKeySecret),
    appCode: cleanSecret(input.appCode),
    customsDeclarationEnabled: input.customsDeclarationEnabled !== false,
    invoiceTextEnabled: input.invoiceTextEnabled === true,
    supplierDocumentReturnEnabled: input.supplierDocumentReturnEnabled === true,
    fallbackToPdfText: input.fallbackToPdfText !== false,
    timeoutMs: cleanTimeoutMs(input.timeoutMs),
  };
}

export function serializeOcrIntegrationSetting(setting: unknown) {
  const normalized = normalizeOcrIntegrationSettings(settingValue(setting) || {});
  return {
    ...normalized,
    accessKeyId: "",
    accessKeySecret: "",
    appCode: "",
    accessKeyIdConfigured: Boolean(normalized.accessKeyId),
    accessKeySecretConfigured: Boolean(normalized.accessKeySecret),
    appCodeConfigured: Boolean(normalized.appCode),
  };
}

export function serializeOcrFeatureFlags(setting: unknown) {
  const normalized = normalizeOcrIntegrationSettings(settingValue(setting) || {});
  const credentialsConfigured = Boolean(normalized.appCode || (normalized.accessKeyId && normalized.accessKeySecret));
  const enabled = normalized.enabled && credentialsConfigured;
  return {
    enabled,
    provider: normalized.provider,
    customsDeclarationEnabled: enabled && normalized.customsDeclarationEnabled,
    invoiceTextEnabled: enabled && normalized.invoiceTextEnabled,
    supplierDocumentReturnEnabled: enabled && normalized.supplierDocumentReturnEnabled,
    fallbackToPdfText: normalized.fallbackToPdfText,
    timeoutMs: normalized.timeoutMs,
  };
}

function ocrFeatureEnabled(settings: ReturnType<typeof normalizeOcrIntegrationSettings>, feature: OcrFeatureKey) {
  if (!settings.enabled) return false;
  const credentialsConfigured = Boolean(settings.appCode || (settings.accessKeyId && settings.accessKeySecret));
  if (!credentialsConfigured) return false;
  if (feature === "customsDeclaration") return settings.customsDeclarationEnabled;
  if (feature === "invoiceText") return settings.invoiceTextEnabled;
  if (feature === "supplierDocumentReturn") return settings.supplierDocumentReturnEnabled;
  return false;
}

function ocrFeatureLabel(feature: OcrFeatureKey) {
  if (feature === "customsDeclaration") return "报关单识别";
  if (feature === "supplierDocumentReturn") return "产品供应商资料回传 OCR";
  return "发票识别";
}

export async function getOcrIntegrationSettings() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: OCR_INTEGRATION_SETTING_KEY } });
  return normalizeOcrIntegrationSettings(setting?.value || DEFAULT_OCR_INTEGRATION_SETTINGS);
}

export async function readOcrIntegrationSettings(actor: SettingsActor) {
  assertRead(actor, "settings");
  const setting = await prisma.systemSetting.findUnique({ where: { key: OCR_INTEGRATION_SETTING_KEY } });
  return serializeOcrIntegrationSetting(setting || DEFAULT_OCR_INTEGRATION_SETTINGS);
}

export async function readOcrFeatureFlags() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: OCR_INTEGRATION_SETTING_KEY } });
  return serializeOcrFeatureFlags(setting || DEFAULT_OCR_INTEGRATION_SETTINGS);
}

export async function saveOcrIntegrationSettings(request: AuditRequestLike, actor: SettingsActor, input: unknown = {}) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const before = await prisma.systemSetting.findUnique({ where: { key: OCR_INTEGRATION_SETTING_KEY } });
  const current = normalizeOcrIntegrationSettings(before?.value || DEFAULT_OCR_INTEGRATION_SETTINGS);
  const value = normalizeOcrIntegrationSettings({
    ...current,
    ...data,
    accessKeyId: cleanSecret(data.accessKeyId) || current.accessKeyId,
    accessKeySecret: cleanSecret(data.accessKeySecret) || current.accessKeySecret,
    appCode: cleanSecret(data.appCode) || current.appCode,
  });
  if (value.enabled && !value.appCode && !(value.accessKeyId && value.accessKeySecret)) {
    throw codedError("启用 OCR 前请先填写 AppCode，或同时填写 AccessKey ID 和 AccessKey Secret。", 400, "OCR_CREDENTIAL_REQUIRED");
  }
  const setting = await prisma.systemSetting.upsert({
    where: { key: OCR_INTEGRATION_SETTING_KEY },
    update: { value },
    create: { key: OCR_INTEGRATION_SETTING_KEY, value },
  });
  await runNonCriticalTask("OCR集成设置操作日志写入", () => (
    writeAudit(request, actor, "更新OCR集成设置", "system_settings", OCR_INTEGRATION_SETTING_KEY, before, setting)
  ));
  return serializeOcrIntegrationSetting(setting);
}

export async function ensureOcrFeatureEnabled(feature: OcrFeatureKey) {
  const settings = await getOcrIntegrationSettings();
  if (ocrFeatureEnabled(settings, feature)) return settings;
  throw codedError(`${ocrFeatureLabel(feature)}功能已关闭，请到系统设置启用 OCR。`, 403, "OCR_FEATURE_DISABLED");
}

export async function isOcrFeatureEnabled(feature: OcrFeatureKey) {
  const settings = await getOcrIntegrationSettings();
  return ocrFeatureEnabled(settings, feature);
}

export async function recognizePdfTextWithOcr(
  buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined,
  feature: OcrFeatureKey,
  options: OcrRecognitionOptions = {},
) {
  const settings = await ensureOcrFeatureEnabled(feature);
  const fileBuffer = bufferFromInput(buffer);
  if (feature === "customsDeclaration") {
    try {
      return await recognizeAliyunCustomsDeclaration(fileBuffer, settings, options);
    } catch (error) {
      console.error("aliyun-customs-ocr-structured-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return recognizeWithPdfTextFallback(fileBuffer, feature, settings, {
        ...options,
        source: "ALIYUN_CUSTOMS_FALLBACK_PDF_TEXT",
        error,
      });
    }
  }
  return recognizeWithPdfTextFallback(buffer, feature, settings, options);
}

export async function recognizeSupplierDocumentWithOcr(
  buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined,
  documentType: SupplierOcrDocumentType,
  options: { requireText?: boolean } = {},
): Promise<OcrRecognitionResult> {
  const settings = await ensureOcrFeatureEnabled("supplierDocumentReturn");
  const fileBuffer = bufferFromInput(buffer);
  try {
    if (documentType === "SUPPLIER_INVOICE") {
      return await recognizeAliyunVatInvoice(fileBuffer, settings);
    }
    return await recognizeAliyunSupplierContract(fileBuffer, settings);
  } catch (error) {
    console.error("aliyun-ocr-structured-failed", {
      documentType,
      message: error instanceof Error ? error.message : String(error),
    });
    return recognizeWithPdfTextFallback(fileBuffer, "supplierDocumentReturn", settings, {
      ...options,
      source: documentType === "SUPPLIER_INVOICE" ? "ALIYUN_INVOICE_FALLBACK_PDF_TEXT" : "ALIYUN_CONTRACT_FALLBACK_PDF_TEXT",
      error,
    });
  }
}
