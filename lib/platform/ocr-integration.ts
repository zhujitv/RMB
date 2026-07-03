import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import DocMindClient, {
  AyncTradeDocumentPackageExtractSmartAppRequest,
  GetDocParserResultRequest,
  QueryDocParserStatusRequest,
} from "@alicloud/docmind-api20220711";
import AliyunOcrClient, {
  RecognizeAllTextRequest,
  RecognizeAllTextRequestAdvancedConfig,
  RecognizeAllTextRequestTableConfig,
  RecognizeDocumentStructureRequest,
  RecognizeGeneralStructureRequest,
  RecognizeInvoiceRequest,
} from "@alicloud/ocr-api20210707";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { prisma } from "../prisma";
import { deleteR2Object, safeFileName, signedObjectReadUrl, uploadToR2 } from "../r2";
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
export type CustomsDeclarationRecognitionMode = "AUTO" | "STRICT" | "MANUAL";

type OcrIntegrationInput = {
  enabled?: unknown;
  provider?: unknown;
  apiBaseUrl?: unknown;
  accessKeyId?: unknown;
  accessKeySecret?: unknown;
  appCode?: unknown;
  customsDeclarationMode?: unknown;
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
  diagnostics?: Record<string, unknown>;
};

type OcrRecognitionOptions = {
  requireText?: boolean;
  sourceUrl?: string;
  fileName?: string;
};
type RasterizedPdfPage = {
  buffer: Buffer;
  width: number;
  height: number;
  pageCount: number;
};
type OcrTestUploadFile = {
  body: Buffer | Uint8Array | ArrayBuffer;
  originalFileName: string;
  mimeType?: string | null;
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
const SUPPLIER_INVOICE_KEYS = [
  "发票代码",
  "发票号码",
  "开票日期",
  "购买方名称",
  "购买方税号",
  "销售方名称",
  "销售方税号",
  "项目名称",
  "规格型号",
  "单位",
  "数量",
  "单价",
  "金额",
  "税率",
  "税额",
  "价税合计",
];
const CUSTOMS_DECLARATION_MIN_TIMEOUT_MS = 60000;
const DOCMIND_CUSTOMS_POLL_INTERVAL_MS = 1500;
const DOCMIND_CUSTOMS_MAX_POLLS = 12;

function customsTextFallbackParsedJson(text: string) {
  const parsed = parseCustomsDeclarationDetailText(text);
  return {
    ...parsed,
    items: [],
    itemParseSkippedReason: "LOW_CONFIDENCE_PDF_TEXT_FALLBACK",
    itemParseMessage: "PDF全文兜底仅用于报关单基础字段，不自动保存商品明细。",
  };
}

async function rasterizeFirstPdfPageForOcr(buffer: Buffer): Promise<RasterizedPdfPage | null> {
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return null;
  try {
    const canvasModule = await import("@napi-rs/canvas");
    const { createCanvas, DOMMatrix, ImageData, Path2D } = canvasModule;
    const globalScope = globalThis as Record<string, unknown>;
    globalScope.DOMMatrix ||= DOMMatrix;
    globalScope.ImageData ||= ImageData;
    globalScope.Path2D ||= Path2D;
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as {
      getDocument: (params: Record<string, unknown>) => { promise: Promise<Record<string, unknown>>; destroy?: () => Promise<void> };
    };
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise as Record<string, unknown> & {
      numPages?: number;
      getPage: (pageNumber: number) => Promise<Record<string, unknown> & {
        getViewport: (params: { scale: number }) => { width: number; height: number };
        render: (params: Record<string, unknown>) => { promise: Promise<void> };
      }>;
      destroy?: () => Promise<void>;
    };
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const longestSide = Math.max(baseViewport.width, baseViewport.height);
    const scale = Math.min(3, Math.max(1.5, 2200 / Math.max(longestSide, 1)));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: null, canvasContext: context, viewport }).promise;
    const pngBuffer = canvas.toBuffer("image/png");
    const pageCount = Number(pdf.numPages || 1);
    await pdf.destroy?.().catch(() => undefined);
    await loadingTask.destroy?.().catch(() => undefined);
    return {
      buffer: Buffer.from(pngBuffer),
      width: canvas.width,
      height: canvas.height,
      pageCount,
    };
  } catch (error) {
    console.error("customs-pdf-rasterize-for-ocr-failed", { message: ocrErrorText(error) });
    return null;
  }
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

const SUPPLIER_INVOICE_FIELD_ALIASES: Record<string, string[]> = {
  invoiceCode: ["发票代码", "InvoiceCode"],
  invoiceNo: ["发票号码", "发票号", "InvoiceNo", "InvoiceNumber"],
  invoiceDate: ["开票日期", "日期", "InvoiceDate"],
  buyer: ["购买方名称", "购买方", "购方名称", "Buyer", "BuyerName"],
  buyerTaxNo: ["购买方税号", "购买方纳税人识别号", "购方税号", "BuyerTaxNo"],
  seller: ["销售方名称", "销售方", "销方名称", "Seller", "SellerName"],
  sellerTaxNo: ["销售方税号", "销售方纳税人识别号", "销方税号", "SellerTaxNo"],
  productName: ["项目名称", "货物或应税劳务、服务名称", "商品名称", "品名", "ProductName", "ItemName"],
  specModel: ["规格型号", "规格", "型号", "Spec", "Specification"],
  unit: ["单位", "Unit"],
  quantity: ["数量", "Quantity"],
  unitPrice: ["单价", "UnitPrice"],
  amountWithoutTax: ["金额", "不含税金额", "AmountWithoutTax"],
  taxRate: ["税率", "TaxRate"],
  taxAmount: ["税额", "TaxAmount"],
  amountWithTax: ["价税合计", "含税金额", "合计金额", "TotalAmount", "AmountWithTax"],
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

function cleanCustomsDeclarationMode(value: unknown, input: OcrIntegrationInput = {}): CustomsDeclarationRecognitionMode {
  const mode = nonEmpty(value).toUpperCase();
  if (mode === "AUTO" || mode === "STRICT" || mode === "MANUAL") return mode;
  return input.customsDeclarationEnabled === false ? "MANUAL" : "AUTO";
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

function ocrErrorDetails(error: unknown) {
  return isPlainRecord(error) && "details" in error && isPlainRecord(error.details) ? error.details : {};
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function collectDocMindText(value: unknown, output: string[] = [], depth = 0) {
  if (depth > 10 || value == null) return output;
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return collectDocMindText(parsed, output, depth + 1);
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || /^https?:\/\//i.test(text)) return output;
    if (/[报关单申报日期商品名称数量单位总价成交方式币制海关编号]/.test(text) || text.length <= 2000) {
      output.push(text.slice(0, 200000));
    }
    return output;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDocMindText(item, output, depth + 1));
    return output;
  }
  if (isPlainRecord(value)) Object.values(value).forEach((item) => collectDocMindText(item, output, depth + 1));
  return output;
}

function collectDocMindOutputFileUrls(value: unknown, output: string[] = [], depth = 0) {
  if (depth > 8 || value == null) return output;
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return collectDocMindOutputFileUrls(parsed, output, depth + 1);
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && !output.includes(value)) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDocMindOutputFileUrls(item, output, depth + 1));
    return output;
  }
  if (!isPlainRecord(value)) return output;
  const outputFileUrl = normalizeFieldValue(responseField(value, "outputFileUrl"));
  if (/^https?:\/\//i.test(outputFileUrl) && !output.includes(outputFileUrl)) output.push(outputFileUrl);
  Object.values(value).forEach((item) => collectDocMindOutputFileUrls(item, output, depth + 1));
  return output;
}

async function readDocMindOutputFiles(rawStatusJson: unknown[]) {
  const urls = [...new Set(rawStatusJson.flatMap((item) => collectDocMindOutputFileUrls(item)).slice(0, 3))];
  const outputs: unknown[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      outputs.push(parseJsonMaybe(text));
    } catch (error) {
      console.error("aliyun-docmind-customs-output-file-read-failed", {
        message: ocrErrorText(error),
      });
    }
  }
  return outputs;
}

function findDocMindTaskId(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return "";
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return findDocMindTaskId(parsed, depth + 1);
  if (typeof value === "string") {
    const text = value.trim();
    if (/^docmind-[\w-]+$/i.test(text)) return text;
    const matched = text.match(/docmind-[\w-]+/i);
    return matched?.[0] || "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findDocMindTaskId(item, depth + 1);
      if (id) return id;
    }
    return "";
  }
  if (!isPlainRecord(value)) return "";
  const preferredKeys = ["id", "Id", "ID", "taskId", "TaskId", "jobId", "JobId", "parserId", "ParserId"];
  for (const key of preferredKeys) {
    const id = findDocMindTaskId(value[key], depth + 1);
    if (id) return id;
  }
  for (const item of Object.values(value)) {
    const id = findDocMindTaskId(item, depth + 1);
    if (id) return id;
  }
  return "";
}

function docMindResponseError(body: unknown) {
  const code = normalizeFieldValue(responseField(body, "code"));
  const message = normalizeFieldValue(responseField(body, "message"));
  if (code && !["success", "ok", "200"].includes(code.toLowerCase())) {
    return [code, message].filter(Boolean).join(": ");
  }
  return "";
}

function docMindStatusReady(data: unknown) {
  const status = normalizeFieldValue(responseField(data, "status")).toLowerCase();
  const processing = parseNumberText(responseField(data, "processing"));
  const successful = parseNumberText(responseField(data, "numberOfSuccessfulParsing"));
  if (processing >= 100 || successful > 0) return true;
  if (!status) return false;
  return ["success", "succeeded", "completed", "complete", "finish", "finished", "done"].some((item) => status.includes(item));
}

function docMindResultHasData(data: unknown) {
  const parsed = parseJsonMaybe(data);
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (isPlainRecord(parsed)) return Object.keys(parsed).length > 0;
  return Boolean(normalizeFieldValue(parsed));
}

async function getAliyunDocMindParserResult(
  client: DocMindClient,
  taskId: string,
): Promise<{ data: unknown; resultRawJson: unknown; statusRawJson: unknown[] }> {
  const statusRawJson: unknown[] = [];
  let lastError = "";
  for (let attempt = 0; attempt < DOCMIND_CUSTOMS_MAX_POLLS; attempt += 1) {
    let ready = attempt === 0;
    try {
      const statusResponse = await client.queryDocParserStatus(new QueryDocParserStatusRequest({ id: taskId }));
      const statusJson = toPlainJson(statusResponse);
      statusRawJson.push(statusJson);
      const statusBody = isPlainRecord(statusJson) ? statusJson.body : statusResponse.body;
      const statusError = docMindResponseError(statusBody);
      if (statusError) throw codedError(`阿里云文档智能任务状态查询失败：${statusError}`, 502, "ALIYUN_DOCMIND_STATUS_FAILED");
      ready = docMindStatusReady(responseField(statusBody, "data"));
    } catch (error) {
      lastError = ocrErrorText(error);
      console.error("aliyun-docmind-customs-status-failed", { taskId, attempt, message: lastError });
    }

    if (ready || attempt > 0) {
      try {
        const resultResponse = await client.getDocParserResult(new GetDocParserResultRequest({ id: taskId }));
        const resultRawJson = toPlainJson(resultResponse);
        const resultBody = isPlainRecord(resultRawJson) ? resultRawJson.body : resultResponse.body;
        const resultError = docMindResponseError(resultBody);
        if (resultError) throw codedError(`阿里云文档智能结果查询失败：${resultError}`, 502, "ALIYUN_DOCMIND_RESULT_FAILED");
        const data = parseJsonMaybe(responseField(resultBody, "data"));
        if (docMindResultHasData(data)) return { data, resultRawJson, statusRawJson };
      } catch (error) {
        lastError = ocrErrorText(error);
        console.error("aliyun-docmind-customs-result-pending", { taskId, attempt, message: lastError });
      }
      if (ready) {
        const outputFiles = await readDocMindOutputFiles(statusRawJson);
        if (outputFiles.length) return { data: { outputFiles }, resultRawJson: null, statusRawJson };
      }
    }
    if (attempt < DOCMIND_CUSTOMS_MAX_POLLS - 1) await sleep(DOCMIND_CUSTOMS_POLL_INTERVAL_MS);
  }
  throw codedError(
    `阿里云文档智能报关单任务未在限定时间内返回结果${lastError ? `：${lastError}` : ""}`,
    504,
    "ALIYUN_DOCMIND_RESULT_TIMEOUT",
  );
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

async function recognizeAliyunSupplierInvoiceWithGeneralStructure(
  buffer: Buffer,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  primaryError: unknown,
): Promise<OcrRecognitionResult> {
  const client = createAliyunOcrClient(settings);
  const response = await client.recognizeGeneralStructure(new RecognizeGeneralStructureRequest({
    body: Readable.from(buffer),
    keys: SUPPLIER_INVOICE_KEYS,
  }));
  const rawJson = toPlainJson(response);
  const responseBody = isPlainRecord(rawJson) ? rawJson.body : response.body;
  const data = parseJsonMaybe(responseField(responseBody, "data"));
  const extractedFields = collectFieldsFromObject(data, SUPPLIER_INVOICE_FIELD_ALIASES);
  const text = collectText(data).join("\n");
  return {
    text,
    source: "ALIYUN_INVOICE_GENERAL_STRUCTURE_FALLBACK",
    provider: settings.provider,
    apiName: "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE",
    rawJson: {
      fallbackFrom: "ALIYUN_RECOGNIZE_INVOICE",
      fallbackReason: ocrErrorText(primaryError).slice(0, 1000),
      generalStructure: rawJson,
    },
    extractedFields,
    parsedJson: extractedFields,
    parser: "VAT_INVOICE_GENERAL_STRUCTURE",
    diagnostics: { fallbackUsed: true, fallbackFrom: "ALIYUN_RECOGNIZE_INVOICE" },
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

function buildAliyunCustomsStructureRawJson(rawJson: unknown, data: unknown) {
  return {
    primary: rawJson,
    data,
  };
}

function throwAliyunCustomsStructureEmptyError(params: {
  rawJson: unknown;
  data: unknown;
  text: string;
  structuredFields: Record<string, unknown>;
  items: CustomsDeclarationItemFields[];
  parsedJson: unknown;
}) {
  const error = codedError("阿里云 OCR 文档结构化接口未返回可用的报关单商品明细。", 422, "ALIYUN_DOCUMENT_STRUCTURE_CUSTOMS_EMPTY");
  error.details = {
    source: "ALIYUN_RECOGNIZE_DOCUMENT_STRUCTURE_CUSTOMS",
    provider: "ALIYUN",
    apiName: "ALIYUN_RECOGNIZE_DOCUMENT_STRUCTURE",
    parser: "CUSTOMS_DECLARATION_DOCUMENT_STRUCTURE",
    textLength: params.text.length,
    textPreview: params.text.slice(0, 4000),
    dataType: Array.isArray(params.data) ? "array" : typeof params.data,
    dataKeys: safeObjectKeys(params.data),
    extractedFields: params.structuredFields,
    itemsCount: params.items.length,
    parsedJson: params.parsedJson,
    rawJsonPreview: jsonPreview(buildAliyunCustomsStructureRawJson(params.rawJson, params.data)),
  };
  throw error;
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

function hasStructuredCustomsItems(parsed: unknown) {
  return isPlainRecord(parsed) && Array.isArray(parsed.items) && parsed.items.length > 0;
}

async function recognizeAliyunCustomsDeclarationWithDocumentStructure(
  buffer: Buffer,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  options: OcrRecognitionOptions = {},
): Promise<OcrRecognitionResult> {
  const client = createAliyunOcrClient(customsOcrSettings(settings));
  const rasterized = await rasterizeFirstPdfPageForOcr(buffer);
  const request = new RecognizeDocumentStructureRequest({
    body: rasterized ? Readable.from(rasterized.buffer) : (options.sourceUrl ? undefined : Readable.from(buffer)),
    url: rasterized ? undefined : (nonEmpty(options.sourceUrl) || undefined),
    outputTable: true,
    row: true,
    paragraph: true,
    page: true,
    needRotate: true,
    needSortPage: true,
    useNewStyleOutput: true,
  });
  const response = await client.recognizeDocumentStructure(request);
  const rawJson = toPlainJson(response);
  const responseBody = isPlainRecord(rawJson) ? rawJson.body : response.body;
  const responseError = docMindResponseError(responseBody);
  if (responseError) {
    throw codedError(`阿里云 OCR 文档结构化识别失败：${responseError}`, 502, "ALIYUN_DOCUMENT_STRUCTURE_FAILED");
  }
  const data = parseJsonMaybe(responseField(responseBody, "data"));
  const text = collectText(data).join("\n");
  const structuredFields = collectFieldsFromObject(data, CUSTOMS_FIELD_ALIASES);
  let items = extractCustomsItemsFromAliyunTableData(data, {
    tradeTerm: normalizeFieldValue(structuredFields.tradeTerm),
    currency: normalizeCurrencyCode(structuredFields.currency),
  });
  if (!items.length) items = collectCustomsItemCandidates(data);
  const parsedJson = mergeCustomsParsedData(text, structuredFields, items);
  if (!hasStructuredCustomsItems(parsedJson)) {
    throwAliyunCustomsStructureEmptyError({
      rawJson,
      data,
      text,
      structuredFields,
      items,
      parsedJson,
    });
  }
  return {
    text,
    source: "ALIYUN_RECOGNIZE_DOCUMENT_STRUCTURE_CUSTOMS",
    provider: settings.provider,
    apiName: "ALIYUN_RECOGNIZE_DOCUMENT_STRUCTURE",
    rawJson: buildAliyunCustomsStructureRawJson(rawJson, data),
    extractedFields: structuredFields,
    parsedJson,
    confidence: null,
    parser: "CUSTOMS_DECLARATION_DOCUMENT_STRUCTURE",
    diagnostics: {
      docMindAttempted: true,
      docMindSucceeded: true,
      pdfRasterized: Boolean(rasterized),
      rasterizedPageWidth: rasterized?.width || null,
      rasterizedPageHeight: rasterized?.height || null,
      rasterizedPageCount: rasterized?.pageCount || null,
      docMindErrorCode: "",
      docMindErrorMessage: "",
      fallbackUsed: false,
    },
  };
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
  const submitRawJson = toPlainJson(response);
  const responseBody = isPlainRecord(submitRawJson) ? submitRawJson.body : response.body;
  const submitError = docMindResponseError(responseBody);
  if (submitError) {
    throw codedError(`阿里云文档智能整票识别提交失败：${submitError}`, 502, "ALIYUN_DOCMIND_SUBMIT_FAILED");
  }
  const submitData = parseJsonMaybe(responseField(responseBody, "data"));
  const taskId = findDocMindTaskId(submitData) || findDocMindTaskId(responseBody);
  const result = taskId
    ? await getAliyunDocMindParserResult(client, taskId)
    : { data: submitData, resultRawJson: null, statusRawJson: [] };
  const data = parseJsonMaybe(result.data);
  const docMindText = collectDocMindText(data).join("\n");
  const text = [docMindText, collectText(data).join("\n")].filter(Boolean).join("\n");
  const structuredFields = collectFieldsFromObject(data, CUSTOMS_FIELD_ALIASES);
  let items = extractCustomsItemsFromAliyunTableData(data, {
    tradeTerm: normalizeFieldValue(structuredFields.tradeTerm),
    currency: normalizeCurrencyCode(structuredFields.currency),
  });
  if (!items.length) items = collectCustomsItemCandidates(data);
  const parsedJson = mergeCustomsParsedData(text, structuredFields, items);
  if (!hasUsefulCustomsParsedData(parsedJson)) {
    throwDocMindCustomsEmptyError({
      submitRawJson,
      statusRawJson: result.statusRawJson,
      resultRawJson: result.resultRawJson,
      taskId,
      data,
      text,
      structuredFields,
      items,
      parsedJson,
    });
  }
  const rawJson = buildDocMindCustomsRawJson(submitRawJson, result.statusRawJson, result.resultRawJson, taskId, data);
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
    diagnostics: {
      docMindAttempted: true,
      docMindSucceeded: true,
      docMindErrorCode: "",
      docMindErrorMessage: "",
      fallbackUsed: false,
    },
  };
}

async function recognizeAliyunCustomsDeclaration(
  buffer: Buffer,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  options: OcrRecognitionOptions = {},
): Promise<OcrRecognitionResult> {
  const effectiveSettings = customsOcrSettings(settings);
  let structuredError: unknown = null;
  let structuredErrorCode = "";
  let structuredErrorMessage = "";
  try {
    return await recognizeAliyunCustomsDeclarationWithDocumentStructure(buffer, effectiveSettings, options);
  } catch (error) {
    structuredError = error;
    structuredErrorCode = (error as { code?: string } | null)?.code || "ALIYUN_DOCUMENT_STRUCTURE_CUSTOMS_FAILED";
    structuredErrorMessage = ocrErrorText(error);
    console.error("aliyun-document-structure-customs-ocr-failed", {
      code: structuredErrorCode,
      message: structuredErrorMessage,
      mode: effectiveSettings.customsDeclarationMode,
    });
  }
  let docMindError: unknown = null;
  let docMindErrorCode = "";
  let docMindErrorMessage = "";
  if (options.sourceUrl) {
    try {
      return await recognizeAliyunCustomsDeclarationWithDocMind(effectiveSettings, options);
    } catch (error) {
      docMindError = error;
      docMindErrorCode = (error as { code?: string } | null)?.code || "ALIYUN_DOCMIND_CUSTOMS_FAILED";
      docMindErrorMessage = ocrErrorText(error);
      console.error("aliyun-docmind-customs-ocr-failed", {
        code: docMindErrorCode,
        message: docMindErrorMessage,
        mode: effectiveSettings.customsDeclarationMode,
      });
    }
  }
  const structuredFailure = [
    structuredErrorMessage && `文档结构化：${structuredErrorMessage}`,
    docMindErrorMessage && `贸易单证结构化：${docMindErrorMessage}`,
  ].filter(Boolean).join("；");
  const finalStructuredError = docMindError || structuredError;
  if (effectiveSettings.customsDeclarationMode === "STRICT") {
    const strictError = codedError(
      `阿里云报关单严格结构化识别失败：${structuredFailure || "结构化接口未返回可用报关单数据。"}`,
      (finalStructuredError as { status?: number } | null)?.status || 502,
      docMindErrorCode || structuredErrorCode || "ALIYUN_CUSTOMS_STRUCTURED_OCR_FAILED",
    );
    strictError.details = {
      documentStructure: {
        code: structuredErrorCode,
        message: structuredErrorMessage,
        details: ocrErrorDetails(structuredError),
      },
      tradeDocument: {
        attempted: Boolean(options.sourceUrl),
        code: docMindErrorCode,
        message: docMindErrorMessage,
        details: ocrErrorDetails(docMindError),
      },
    };
    throw strictError;
  }
  const docMindDiagnostics: Record<string, unknown> = {
    docMindAttempted: Boolean(options.sourceUrl),
    docMindSucceeded: false,
    docMindErrorCode: docMindErrorCode || structuredErrorCode,
    docMindErrorMessage: structuredFailure || structuredErrorMessage || docMindErrorMessage,
    fallbackUsed: true,
  };
  if (finalStructuredError) {
    return recognizeWithPdfTextFallback(buffer, "customsDeclaration", effectiveSettings, {
      ...options,
      source: "ALIYUN_CUSTOMS_STRUCTURE_FAILED_PDF_TEXT",
      error: finalStructuredError,
    });
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
    const responseBody = responseField(primaryRawJson, "body") || response.body;
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
      const tableBody = responseField(tableRawJson, "body") || tableResponse.body;
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
      const tableOnlyBody = responseField(tableOnlyRawJson, "body") || tableOnlyResponse.body;
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
        docMind: docMindDiagnostics,
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
      diagnostics: docMindDiagnostics,
    };
  }
  const parsedJson = mergeCustomsParsedData(pdfText, primaryFields, items);
  return {
    text: pdfText,
    source: "ALIYUN_RECOGNIZE_TRADE_DOCUMENT",
    provider: settings.provider,
    apiName: items.length ? "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE" : "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE_TABLE_EMPTY",
    rawJson: {
      docMind: docMindDiagnostics,
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
    diagnostics: docMindDiagnostics,
  };
}

export function normalizeOcrIntegrationSettings(value: unknown = {}) {
  const input: OcrIntegrationInput = isPlainRecord(value) ? value : {};
  const customsDeclarationMode = cleanCustomsDeclarationMode(input.customsDeclarationMode, input);
  return {
    enabled: input.enabled === true,
    provider: cleanProvider(input.provider),
    apiBaseUrl: cleanOptionalUrl(input.apiBaseUrl, DEFAULT_OCR_INTEGRATION_SETTINGS.apiBaseUrl),
    accessKeyId: cleanSecret(input.accessKeyId),
    accessKeySecret: cleanSecret(input.accessKeySecret),
    appCode: cleanSecret(input.appCode),
    customsDeclarationMode,
    customsDeclarationEnabled: customsDeclarationMode !== "MANUAL" && input.customsDeclarationEnabled !== false,
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
    customsDeclarationMode: normalized.customsDeclarationMode,
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
  if (feature === "customsDeclaration") return settings.customsDeclarationMode !== "MANUAL" && settings.customsDeclarationEnabled;
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
  if (value.enabled && value.customsDeclarationMode === "STRICT" && !(value.accessKeyId && value.accessKeySecret)) {
    throw codedError("报关单严格结构化模式需要配置 AccessKey ID 和 AccessKey Secret。", 400, "OCR_ACCESS_KEY_REQUIRED");
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

function customsItemsFromParsedJson(parsedJson: unknown) {
  if (!isPlainRecord(parsedJson) || !Array.isArray(parsedJson.items)) return [];
  return parsedJson.items;
}

function jsonPreview(value: unknown, limit = 50000) {
  try {
    const text = JSON.stringify(value ?? null, null, 2);
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}\n... 已截断，完整结果请查看服务端日志。`;
  } catch {
    return String(value ?? "");
  }
}

function safeObjectKeys(value: unknown) {
  if (Array.isArray(value)) return [`array(${value.length})`];
  if (!isPlainRecord(value)) return [];
  return Object.keys(value).slice(0, 50);
}

function buildDocMindCustomsRawJson(
  submit: unknown,
  status: unknown[],
  result: unknown,
  taskId: string,
  data: unknown,
) {
  return {
    submit,
    status,
    result,
    taskId,
    data,
  };
}

function throwDocMindCustomsEmptyError(params: {
  submitRawJson: unknown;
  statusRawJson: unknown[];
  resultRawJson: unknown;
  taskId: string;
  data: unknown;
  text: string;
  structuredFields: Record<string, unknown>;
  items: CustomsDeclarationItemFields[];
  parsedJson: unknown;
}) {
  const rawJson = buildDocMindCustomsRawJson(
    params.submitRawJson,
    params.statusRawJson,
    params.resultRawJson,
    params.taskId,
    params.data,
  );
  const error = codedError("文档智能未返回可用的报关单结构化字段。", 422, "ALIYUN_DOCMIND_CUSTOMS_EMPTY");
  error.details = {
    source: "ALIYUN_DOCMIND_TRADE_DOCUMENT_CUSTOMS",
    provider: "ALIYUN",
    apiName: "ALIYUN_DOCMIND_TRADE_DOCUMENT_PACKAGE_EXTRACT",
    parser: "CUSTOMS_DECLARATION_DOCMIND",
    taskId: params.taskId,
    textLength: params.text.length,
    textPreview: params.text.slice(0, 4000),
    dataType: Array.isArray(params.data) ? "array" : typeof params.data,
    dataKeys: safeObjectKeys(params.data),
    statusCount: params.statusRawJson.length,
    extractedFields: params.structuredFields,
    itemsCount: params.items.length,
    parsedJson: params.parsedJson,
    rawJsonPreview: jsonPreview(rawJson),
  };
  throw error;
}

function customsDiagnosticResultFromError(fileName: string, error: unknown) {
  const details = ocrErrorDetails(error);
  const parsedJson = isPlainRecord(details.parsedJson) ? details.parsedJson : {};
  const extractedFields = isPlainRecord(details.extractedFields) ? details.extractedFields : {};
  return {
    fileName,
    source: normalizeFieldValue(details.source) || "ALIYUN_DOCMIND_TRADE_DOCUMENT_CUSTOMS",
    provider: normalizeFieldValue(details.provider) || "ALIYUN",
    apiName: normalizeFieldValue(details.apiName) || "ALIYUN_DOCMIND_TRADE_DOCUMENT_PACKAGE_EXTRACT",
    parser: normalizeFieldValue(details.parser) || "CUSTOMS_DECLARATION_DOCMIND",
    confidence: null,
    textLength: parseNumberText(details.textLength),
    docMindAttempted: true,
    docMindSucceeded: false,
    docMindErrorCode: normalizeFieldValue((error as { code?: unknown } | null)?.code) || "ALIYUN_DOCMIND_CUSTOMS_FAILED",
    docMindErrorMessage: ocrErrorText(error),
    fallbackUsed: false,
    fields: {
      customsDeclarationNo: parsedJson.customsDeclarationNo || extractedFields.customsDeclarationNo || "",
      customsDeclarationDate: parsedJson.customsDeclarationDate || extractedFields.customsDeclarationDate || "",
      exportDate: parsedJson.exportDate || extractedFields.exportDate || "",
      tradeTerm: parsedJson.tradeTerm || extractedFields.tradeTerm || "",
      currency: parsedJson.currency || extractedFields.currency || "",
      totalAmount: parsedJson.totalAmount || extractedFields.totalAmount || "",
    },
    itemsCount: parseNumberText(details.itemsCount),
    itemsPreview: [],
    extractedFields,
    parsedJson,
    rawJsonPreview: normalizeFieldValue(details.rawJsonPreview) || jsonPreview({
      error: {
        code: (error as { code?: unknown } | null)?.code || "",
        message: ocrErrorText(error),
      },
      details,
    }),
  };
}

export async function testCustomsDeclarationOcr(actor: SettingsActor, file: OcrTestUploadFile) {
  assertWrite(actor, "settings");
  const fileBuffer = bufferFromInput(file.body);
  const fileName = safeFileName(file.originalFileName || "customs-declaration-test.pdf");
  const actorId = nonEmpty(actor?.id) || "system";
  const tempKey = `ocr-tests/customs/${actorId}/${Date.now()}-${randomUUID()}-${fileName}`;
  await uploadToR2({
    key: tempKey,
    body: fileBuffer,
    contentType: file.mimeType || "application/pdf",
  });
  try {
    const sourceUrl = await signedObjectReadUrl(tempKey, 900);
    const recognized = await recognizePdfTextWithOcr(fileBuffer, "customsDeclaration", {
      sourceUrl,
      fileName,
      requireText: true,
    });
    const parsedJson = recognized.parsedJson;
    const items = customsItemsFromParsedJson(parsedJson);
    const fields = isPlainRecord(parsedJson) ? parsedJson : {};
    return {
      fileName,
      source: recognized.source,
      provider: recognized.provider,
      apiName: recognized.apiName || recognized.source,
      parser: recognized.parser || "",
      confidence: recognized.confidence ?? null,
      textLength: recognized.text.length,
      docMindAttempted: recognized.diagnostics?.docMindAttempted === true,
      docMindSucceeded: recognized.diagnostics?.docMindSucceeded === true,
      docMindErrorCode: String(recognized.diagnostics?.docMindErrorCode || ""),
      docMindErrorMessage: String(recognized.diagnostics?.docMindErrorMessage || ""),
      fallbackUsed: recognized.diagnostics?.fallbackUsed === true,
      fields: {
        customsDeclarationNo: fields.customsDeclarationNo || "",
        customsDeclarationDate: fields.customsDeclarationDate || "",
        exportDate: fields.exportDate || "",
        tradeTerm: fields.tradeTerm || "",
        currency: fields.currency || "",
        totalAmount: fields.totalAmount || "",
      },
      itemsCount: items.length,
      itemsPreview: items.slice(0, 20),
      extractedFields: recognized.extractedFields || {},
      parsedJson,
      rawJsonPreview: jsonPreview(recognized.rawJson),
    };
  } catch (error) {
    const code = normalizeFieldValue((error as { code?: unknown } | null)?.code);
    if (code.startsWith("ALIYUN_DOCMIND_") || code.startsWith("ALIYUN_DOCUMENT_STRUCTURE_")) {
      return customsDiagnosticResultFromError(fileName, error);
    }
    throw error;
  } finally {
    await deleteR2Object(tempKey).catch((error) => {
      console.error("ocr-test-temp-file-delete-failed", {
        key: tempKey,
        message: ocrErrorText(error),
      });
    });
  }
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
      if (settings.customsDeclarationMode === "STRICT") throw error;
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
      try {
        return await recognizeAliyunVatInvoice(fileBuffer, settings);
      } catch (invoiceError) {
        console.warn("aliyun-invoice-ocr-specialized-failed-fallback-general-structure", {
          message: ocrErrorText(invoiceError),
        });
        return await recognizeAliyunSupplierInvoiceWithGeneralStructure(fileBuffer, settings, invoiceError);
      }
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
