import { parseCustomsDeclarationDetailText } from "../customs-declaration-parser";
import { DEFAULT_OCR_INTEGRATION_SETTINGS } from "./shared-constants";
import { codedError, isPlainRecord, nonEmpty, num, redactSensitiveText } from "./shared-base-utils";
import { normalizeAliyunOcrApiUrl } from "./outbound-request-security";
import { normalizeCustomsProductWhitelist } from "./customs-product-whitelist";

export type OcrFeatureKey = "customsDeclaration" | "invoiceText" | "logisticsInvoice";
export type CustomsDeclarationRecognitionMode = "AUTO" | "STRICT" | "MANUAL";

export type OcrIntegrationInput = {
  enabled?: unknown;
  provider?: unknown;
  apiBaseUrl?: unknown;
  accessKeyId?: unknown;
  accessKeySecret?: unknown;
  appCode?: unknown;
  tencentSecretId?: unknown;
  tencentSecretKey?: unknown;
  tencentRegion?: unknown;
  customsDeclarationMode?: unknown;
  customsDeclarationEnabled?: unknown;
  invoiceTextEnabled?: unknown;
  logisticsInvoiceEnabled?: unknown;
  customsProductWhitelistEnabled?: unknown;
  customsProductWhitelist?: unknown;
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

export type OcrRecognitionOptions = {
  requireText?: boolean;
  sourceUrl?: string;
  fileName?: string;
};
export type RasterizedPdfPage = {
  buffer: Buffer;
  width: number;
  height: number;
  pageCount: number;
};
export const CUSTOMS_DECLARATION_MIN_TIMEOUT_MS = 60000;
export const DOCMIND_CUSTOMS_POLL_INTERVAL_MS = 1500;
export const DOCMIND_CUSTOMS_MAX_POLLS = 12;

export function customsTextFallbackParsedJson(text: string) {
  const parsed = parseCustomsDeclarationDetailText(text);
  return {
    ...parsed,
    items: [],
    itemParseSkippedReason: "LOW_CONFIDENCE_PDF_TEXT_FALLBACK",
    itemParseMessage: "PDF全文兜底仅用于报关单基础字段，不自动保存商品明细。",
  };
}

export function cleanSecret(value: unknown, limit = 500) {
  return nonEmpty(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

export function cleanProvider(value: unknown) {
  const provider = nonEmpty(value || DEFAULT_OCR_INTEGRATION_SETTINGS.provider).toUpperCase();
  if (provider !== "ALIYUN") {
    throw codedError("当前仅支持阿里云 OCR 服务。", 400, "OCR_PROVIDER_UNSUPPORTED");
  }
  return "ALIYUN";
}

export function cleanCustomsDeclarationMode(value: unknown, input: OcrIntegrationInput = {}): CustomsDeclarationRecognitionMode {
  const mode = nonEmpty(value).toUpperCase();
  if (mode === "AUTO" || mode === "STRICT" || mode === "MANUAL") return mode;
  return input.customsDeclarationEnabled === false ? "MANUAL" : "AUTO";
}

export function cleanOptionalUrl(value: unknown, fallback: string) {
  return normalizeAliyunOcrApiUrl(value, fallback);
}

export function cleanTimeoutMs(value: unknown) {
  const timeoutMs = Math.round(num(value, DEFAULT_OCR_INTEGRATION_SETTINGS.timeoutMs));
  return Math.min(60000, Math.max(3000, timeoutMs));
}

export function cleanTencentOcrRegion(value: unknown) {
  const region = nonEmpty(value || DEFAULT_OCR_INTEGRATION_SETTINGS.tencentRegion).toLowerCase();
  if (!/^ap-[a-z]+(?:-[0-9]+)?$/.test(region)) {
    throw codedError("腾讯云 OCR 地域格式不正确。", 400, "TENCENT_OCR_REGION_INVALID");
  }
  return region;
}

export function customsOcrSettings(settings: ReturnType<typeof normalizeOcrIntegrationSettings>) {
  return {
    ...settings,
    timeoutMs: Math.max(settings.timeoutMs, CUSTOMS_DECLARATION_MIN_TIMEOUT_MS),
  };
}

export function ocrErrorText(error: unknown) {
  return redactSensitiveText(error instanceof Error ? error.message : String(error || ""), 500);
}

export function ocrErrorDetails(error: unknown) {
  return isPlainRecord(error) && "details" in error && isPlainRecord(error.details) ? error.details : {};
}

export function settingValue(setting: unknown) {
  return isPlainRecord(setting) && "value" in setting ? setting.value : setting;
}

export function bufferFromInput(buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined) {
  if (!buffer) return Buffer.alloc(0);
  if (Buffer.isBuffer(buffer)) return buffer;
  if (buffer instanceof ArrayBuffer) return Buffer.from(buffer);
  return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export function normalizeKey(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s_\-:：,，.。()（）【】\[\]{}《》<>/\\]/g, "");
}

export function normalizeFieldValue(value: unknown) {
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

export function parseJsonMaybe(value: unknown) {
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

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function responseField(record: unknown, key: string) {
  if (!isPlainRecord(record)) return undefined;
  const direct = record[key];
  if (direct != null) return direct;
  const pascal = `${key.slice(0, 1).toUpperCase()}${key.slice(1)}`;
  if (record[pascal] != null) return record[pascal];
  const upper = key.toUpperCase();
  if (record[upper] != null) return record[upper];
  return undefined;
}

export function toPlainJson(value: unknown): unknown {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
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
    tencentSecretId: cleanSecret(input.tencentSecretId),
    tencentSecretKey: cleanSecret(input.tencentSecretKey),
    tencentRegion: cleanTencentOcrRegion(input.tencentRegion),
    customsDeclarationMode,
    customsDeclarationEnabled: customsDeclarationMode !== "MANUAL" && input.customsDeclarationEnabled !== false,
    invoiceTextEnabled: input.invoiceTextEnabled === true,
    logisticsInvoiceEnabled: input.logisticsInvoiceEnabled === true,
    customsProductWhitelistEnabled: input.customsProductWhitelistEnabled === true,
    customsProductWhitelist: normalizeCustomsProductWhitelist(input.customsProductWhitelist),
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
    tencentSecretId: "",
    tencentSecretKey: "",
    accessKeyIdConfigured: Boolean(normalized.accessKeyId),
    accessKeySecretConfigured: Boolean(normalized.accessKeySecret),
    appCodeConfigured: Boolean(normalized.appCode),
    tencentSecretIdConfigured: Boolean(normalized.tencentSecretId),
    tencentSecretKeyConfigured: Boolean(normalized.tencentSecretKey),
  };
}

export function serializeOcrFeatureFlags(setting: unknown) {
  const normalized = normalizeOcrIntegrationSettings(settingValue(setting) || {});
  const aliyunCredentialsConfigured = Boolean(normalized.appCode || (normalized.accessKeyId && normalized.accessKeySecret));
  const tencentCredentialsConfigured = Boolean(normalized.tencentSecretId && normalized.tencentSecretKey);
  const enabled = normalized.enabled && (aliyunCredentialsConfigured || tencentCredentialsConfigured);
  return {
    enabled,
    provider: normalized.provider,
    customsDeclarationMode: normalized.customsDeclarationMode,
    customsDeclarationEnabled: normalized.enabled && aliyunCredentialsConfigured && normalized.customsDeclarationEnabled,
    invoiceTextEnabled: normalized.enabled && aliyunCredentialsConfigured && normalized.invoiceTextEnabled,
    logisticsInvoiceEnabled: normalized.enabled && tencentCredentialsConfigured && normalized.logisticsInvoiceEnabled,
    fallbackToPdfText: normalized.fallbackToPdfText,
    timeoutMs: normalized.timeoutMs,
  };
}

export function ocrFeatureEnabled(settings: ReturnType<typeof normalizeOcrIntegrationSettings>, feature: OcrFeatureKey) {
  if (!settings.enabled) return false;
  const aliyunCredentialsConfigured = Boolean(settings.appCode || (settings.accessKeyId && settings.accessKeySecret));
  const tencentCredentialsConfigured = Boolean(settings.tencentSecretId && settings.tencentSecretKey);
  if (feature === "customsDeclaration") {
    return aliyunCredentialsConfigured && settings.customsDeclarationMode !== "MANUAL" && settings.customsDeclarationEnabled;
  }
  if (feature === "invoiceText") return aliyunCredentialsConfigured && settings.invoiceTextEnabled;
  if (feature === "logisticsInvoice") return tencentCredentialsConfigured && settings.logisticsInvoiceEnabled;
  return false;
}

export function ocrFeatureLabel(feature: OcrFeatureKey) {
  if (feature === "customsDeclaration") return "报关单识别";
  if (feature === "logisticsInvoice") return "物流费用发票 OCR";
  return "发票识别";
}
