import { prisma } from "../prisma";
import { extractPdfTextFromPdfBuffer } from "../customs-declaration-parser";
import {
  DEFAULT_OCR_INTEGRATION_SETTINGS,
  OCR_INTEGRATION_SETTING_KEY,
  runNonCriticalTask,
} from "./shared-constants";
import { assertJsonObject, codedError, isPlainRecord, nonEmpty, num } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";

type SettingsActor = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];

export type OcrFeatureKey = "customsDeclaration" | "invoiceText" | "supplierDocumentReturn";

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

function settingValue(setting: unknown) {
  return isPlainRecord(setting) && "value" in setting ? setting.value : setting;
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
  options: { requireText?: boolean } = {},
) {
  const settings = await ensureOcrFeatureEnabled(feature);
  if (!settings.fallbackToPdfText) {
    throw codedError("OCR服务已启用，但当前未配置可用的阿里云OCR适配器。", 501, "OCR_PROVIDER_ADAPTER_NOT_CONFIGURED");
  }
  const text = await extractPdfTextFromPdfBuffer(buffer, options);
  return {
    text,
    source: "OCR_PDF_TEXT_FALLBACK",
    provider: settings.provider,
  };
}
