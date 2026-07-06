import { prisma } from "../prisma";
import {
  parseCustomsDeclarationDetailText,
} from "../customs-declaration-parser";
import {
  DEFAULT_OCR_INTEGRATION_SETTINGS,
  OCR_INTEGRATION_SETTING_KEY,
  runNonCriticalTask,
} from "./shared-constants";
import { assertJsonObject, codedError, isPlainRecord, nonEmpty, num } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";

export type SettingsActor = Parameters<typeof assertRead>[0];
export type AuditRequestLike = Parameters<typeof writeAudit>[0];

export type OcrFeatureKey = "customsDeclaration" | "invoiceText" | "supplierDocumentReturn" | "logisticsInvoice";
export type SupplierOcrDocumentType = "SUPPLIER_PURCHASE_CONTRACT" | "SUPPLIER_INVOICE";
export type CustomsDeclarationRecognitionMode = "AUTO" | "STRICT" | "MANUAL";

export type OcrIntegrationInput = {
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
  logisticsInvoiceEnabled?: unknown;
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
export type OcrTestUploadFile = {
  body: Buffer | Uint8Array | ArrayBuffer;
  originalFileName: string;
  mimeType?: string | null;
};

export const SUPPLIER_CONTRACT_KEYS = [
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

export function cleanTimeoutMs(value: unknown) {
  const timeoutMs = Math.round(num(value, DEFAULT_OCR_INTEGRATION_SETTINGS.timeoutMs));
  return Math.min(60000, Math.max(3000, timeoutMs));
}

export function customsOcrSettings(settings: ReturnType<typeof normalizeOcrIntegrationSettings>) {
  return {
    ...settings,
    timeoutMs: Math.max(settings.timeoutMs, CUSTOMS_DECLARATION_MIN_TIMEOUT_MS),
  };
}

export function ocrErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
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
    customsDeclarationMode,
    customsDeclarationEnabled: customsDeclarationMode !== "MANUAL" && input.customsDeclarationEnabled !== false,
    invoiceTextEnabled: input.invoiceTextEnabled === true,
    supplierDocumentReturnEnabled: input.supplierDocumentReturnEnabled === true,
    logisticsInvoiceEnabled: input.logisticsInvoiceEnabled === true,
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
    logisticsInvoiceEnabled: enabled && normalized.logisticsInvoiceEnabled,
    fallbackToPdfText: normalized.fallbackToPdfText,
    timeoutMs: normalized.timeoutMs,
  };
}

export function ocrFeatureEnabled(settings: ReturnType<typeof normalizeOcrIntegrationSettings>, feature: OcrFeatureKey) {
  if (!settings.enabled) return false;
  const credentialsConfigured = Boolean(settings.appCode || (settings.accessKeyId && settings.accessKeySecret));
  if (!credentialsConfigured) return false;
  if (feature === "customsDeclaration") return settings.customsDeclarationMode !== "MANUAL" && settings.customsDeclarationEnabled;
  if (feature === "invoiceText") return settings.invoiceTextEnabled;
  if (feature === "supplierDocumentReturn") return settings.supplierDocumentReturnEnabled;
  if (feature === "logisticsInvoice") return settings.logisticsInvoiceEnabled;
  return false;
}

export function ocrFeatureLabel(feature: OcrFeatureKey) {
  if (feature === "customsDeclaration") return "报关单识别";
  if (feature === "supplierDocumentReturn") return "产品供应商资料回传 OCR";
  if (feature === "logisticsInvoice") return "物流费用发票 OCR";
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
