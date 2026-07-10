import { prisma } from "../prisma";
import {
  DEFAULT_SHIPSGO_INTEGRATION_SETTINGS,
  SHIPSGO_INTEGRATION_SETTING_KEY,
  runNonCriticalTask,
} from "./shared-constants";
import { assertJsonObject, codedError, isPlainRecord, nonEmpty, num } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";

type SettingsActor = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];

type ShipsgoIntegrationInput = {
  enabled?: unknown;
  activeProvider?: unknown;
  apiBaseUrl?: unknown;
  apiKey?: unknown;
  shipsgoEnabled?: unknown;
  freightowerEnabled?: unknown;
  freightowerApiBaseUrl?: unknown;
  freightowerClientId?: unknown;
  freightowerSecret?: unknown;
  freightowerMapKey?: unknown;
  freightowerWebhookSecret?: unknown;
  freightowerDefaultCarrierCode?: unknown;
  freightowerDefaultPortCode?: unknown;
  freightowerDefaultIsExport?: unknown;
  freightowerDefaultLang?: unknown;
  freightowerHiddenReference?: unknown;
  oceanTrackingEnabled?: unknown;
  airTrackingEnabled?: unknown;
  manualSyncEnabled?: unknown;
  autoSyncEnabled?: unknown;
  dailySyncTime?: unknown;
  webhookEnabled?: unknown;
  webhookSecret?: unknown;
  liveMapEnabled?: unknown;
  customerPushEnabled?: unknown;
  creditWarningThreshold?: unknown;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const SHIPSGO_API_HOSTS = new Set(["api.shipsgo.com"]);
const FREIGHTOWER_API_HOSTS = new Set(["openapi.freightower.com"]);

function cleanSecret(value: unknown, limit = 500) {
  return nonEmpty(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

function normalizeTrackingProvider(value: unknown) {
  const provider = nonEmpty(value).toUpperCase();
  return provider === "FREIGHTOWER" ? "FREIGHTOWER" : "SHIPSGO";
}

function cleanProviderApiUrl(
  value: unknown,
  fallback: string,
  label: string,
  allowedHosts: Set<string>,
  allowedPaths: Set<string>,
) {
  const text = nonEmpty(value || fallback);
  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!["http:", "https:"].includes(url.protocol)) {
      throw codedError(`${label}只支持 HTTPS`, 400, "VALIDATION_INVALID_URL");
    }
    if (url.username || url.password || url.port || !allowedHosts.has(hostname)) {
      throw codedError(`${label}必须使用官方 API 域名`, 400, "VALIDATION_INVALID_URL");
    }
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (!allowedPaths.has(pathname)) {
      throw codedError(`${label}路径不受支持`, 400, "VALIDATION_INVALID_URL");
    }
    // Older deployments stored the official Freightower endpoint as HTTP.
    // Normalize that exact legacy host to HTTPS; never preserve arbitrary HTTP URLs.
    url.protocol = "https:";
    url.hostname = hostname;
    url.pathname = pathname;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (error) {
    if ((error as { status?: number } | null)?.status) throw error;
    throw codedError(`${label}格式错误`, 400, "VALIDATION_INVALID_URL");
  }
}

function cleanProviderCode(value: unknown, fallback = "", limit = 32) {
  return cleanSecret(value || fallback, limit).toUpperCase();
}

function cleanFreightowerLang(value: unknown) {
  const lang = nonEmpty(value || DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.freightowerDefaultLang).toLowerCase();
  return ["zh", "en", "jp"].includes(lang) ? lang : "zh";
}

function cleanFreightowerIsExport(value: unknown) {
  const flag = nonEmpty(value).toUpperCase();
  return flag === "E" || flag === "I" ? flag : "";
}

function cleanDailySyncTime(value: unknown) {
  const text = nonEmpty(value || DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.dailySyncTime);
  if (!TIME_PATTERN.test(text)) {
    throw codedError("每日同步时间格式应为 HH:mm", 400, "VALIDATION_INVALID_TIME");
  }
  return text;
}

function cleanCreditWarningThreshold(value: unknown) {
  const threshold = Math.round(num(value, DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.creditWarningThreshold));
  return Math.min(999999, Math.max(0, threshold));
}

export function normalizeShipsgoIntegrationSettings(value: unknown = {}) {
  const input: ShipsgoIntegrationInput = isPlainRecord(value) ? value : {};
  return {
    enabled: input.enabled === true,
    activeProvider: normalizeTrackingProvider(input.activeProvider),
    apiBaseUrl: cleanProviderApiUrl(
      input.apiBaseUrl,
      DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.apiBaseUrl,
      "ShipsGo API 地址",
      SHIPSGO_API_HOSTS,
      new Set(["/", "/v2"]),
    ),
    apiKey: cleanSecret(input.apiKey),
    shipsgoEnabled: input.shipsgoEnabled !== false,
    freightowerEnabled: input.freightowerEnabled === true,
    freightowerApiBaseUrl: cleanProviderApiUrl(
      input.freightowerApiBaseUrl,
      DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.freightowerApiBaseUrl,
      "飞驼可视 API 地址",
      FREIGHTOWER_API_HOSTS,
      new Set(["/"]),
    ),
    freightowerClientId: cleanSecret(input.freightowerClientId, 128),
    freightowerSecret: cleanSecret(input.freightowerSecret, 500),
    freightowerMapKey: cleanSecret(input.freightowerMapKey, 500),
    freightowerWebhookSecret: cleanSecret(input.freightowerWebhookSecret, 500),
    freightowerDefaultCarrierCode: cleanProviderCode(input.freightowerDefaultCarrierCode, DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.freightowerDefaultCarrierCode),
    freightowerDefaultPortCode: cleanProviderCode(input.freightowerDefaultPortCode, "", 16),
    freightowerDefaultIsExport: cleanFreightowerIsExport(input.freightowerDefaultIsExport),
    freightowerDefaultLang: cleanFreightowerLang(input.freightowerDefaultLang),
    freightowerHiddenReference: input.freightowerHiddenReference === true,
    oceanTrackingEnabled: input.oceanTrackingEnabled !== false,
    airTrackingEnabled: input.airTrackingEnabled === true,
    manualSyncEnabled: input.manualSyncEnabled !== false,
    autoSyncEnabled: input.autoSyncEnabled === true,
    dailySyncTime: cleanDailySyncTime(input.dailySyncTime),
    webhookEnabled: input.webhookEnabled === true,
    webhookSecret: cleanSecret(input.webhookSecret),
    liveMapEnabled: input.liveMapEnabled === true,
    customerPushEnabled: input.customerPushEnabled === true,
    creditWarningThreshold: cleanCreditWarningThreshold(input.creditWarningThreshold),
  };
}

function settingValue(setting: unknown) {
  return isPlainRecord(setting) && "value" in setting ? setting.value : setting;
}

export function serializeShipsgoIntegrationSetting(setting: unknown) {
  const normalized = normalizeShipsgoIntegrationSettings(settingValue(setting) || {});
  return {
    ...normalized,
    apiKey: "",
    freightowerSecret: "",
    freightowerMapKey: "",
    freightowerWebhookSecret: "",
    webhookSecret: "",
    apiKeyConfigured: Boolean(normalized.apiKey),
    freightowerClientIdConfigured: Boolean(normalized.freightowerClientId),
    freightowerSecretConfigured: Boolean(normalized.freightowerSecret),
    freightowerMapKeyConfigured: Boolean(normalized.freightowerMapKey),
    freightowerWebhookSecretConfigured: Boolean(normalized.freightowerWebhookSecret),
    webhookSecretConfigured: Boolean(normalized.webhookSecret),
  };
}

export function serializeShipsgoFeatureFlags(setting: unknown) {
  const normalized = normalizeShipsgoIntegrationSettings(settingValue(setting) || {});
  const shipsgoReady = normalized.shipsgoEnabled && Boolean(normalized.apiKey);
  const freightowerReady = normalized.freightowerEnabled && Boolean(normalized.freightowerClientId && normalized.freightowerSecret);
  const activeProvider = normalized.activeProvider;
  const activeProviderReady = activeProvider === "FREIGHTOWER" ? freightowerReady : shipsgoReady;
  const enabled = normalized.enabled && activeProviderReady;
  return {
    enabled,
    activeProvider,
    providerLabel: activeProvider === "FREIGHTOWER" ? "飞驼可视" : "ShipsGo",
    oceanTrackingEnabled: enabled && normalized.oceanTrackingEnabled,
    airTrackingEnabled: enabled && normalized.airTrackingEnabled,
    manualSyncEnabled: enabled && normalized.manualSyncEnabled,
    autoSyncEnabled: enabled && normalized.autoSyncEnabled,
    dailySyncTime: normalized.dailySyncTime,
    webhookEnabled: enabled && normalized.webhookEnabled,
    liveMapEnabled: enabled && normalized.liveMapEnabled,
    customerPushEnabled: enabled && normalized.customerPushEnabled,
    creditWarningThreshold: normalized.creditWarningThreshold,
  };
}

export async function getShipsgoIntegrationSettings() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: SHIPSGO_INTEGRATION_SETTING_KEY } });
  return normalizeShipsgoIntegrationSettings(setting?.value || DEFAULT_SHIPSGO_INTEGRATION_SETTINGS);
}

export async function readShipsgoIntegrationSettings(actor: SettingsActor) {
  assertRead(actor, "settings");
  const setting = await prisma.systemSetting.findUnique({ where: { key: SHIPSGO_INTEGRATION_SETTING_KEY } });
  return serializeShipsgoIntegrationSetting(setting || DEFAULT_SHIPSGO_INTEGRATION_SETTINGS);
}

export async function readShipsgoFeatureFlags() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: SHIPSGO_INTEGRATION_SETTING_KEY } });
  return serializeShipsgoFeatureFlags(setting || DEFAULT_SHIPSGO_INTEGRATION_SETTINGS);
}

export async function saveShipsgoIntegrationSettings(request: AuditRequestLike, actor: SettingsActor, input: unknown = {}) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const before = await prisma.systemSetting.findUnique({ where: { key: SHIPSGO_INTEGRATION_SETTING_KEY } });
  const current = normalizeShipsgoIntegrationSettings(before?.value || DEFAULT_SHIPSGO_INTEGRATION_SETTINGS);
  const value = normalizeShipsgoIntegrationSettings({
    ...current,
    ...data,
    apiKey: cleanSecret(data.apiKey) || current.apiKey,
    freightowerClientId: cleanSecret(data.freightowerClientId, 128) || current.freightowerClientId,
    freightowerSecret: cleanSecret(data.freightowerSecret) || current.freightowerSecret,
    freightowerMapKey: cleanSecret(data.freightowerMapKey) || current.freightowerMapKey,
    freightowerWebhookSecret: cleanSecret(data.freightowerWebhookSecret) || current.freightowerWebhookSecret,
    webhookSecret: cleanSecret(data.webhookSecret) || current.webhookSecret,
  });
  if (value.enabled && value.activeProvider === "SHIPSGO" && (!value.shipsgoEnabled || !value.apiKey)) {
    throw codedError("启用大掌櫃前请先填写 API Key", 400, "SHIPSGO_API_KEY_REQUIRED");
  }
  if (value.enabled && value.activeProvider === "FREIGHTOWER" && (!value.freightowerEnabled || !value.freightowerClientId || !value.freightowerSecret)) {
    throw codedError("启用飞驼可视前请先填写 Client ID 和 Secret", 400, "FREIGHTOWER_CREDENTIAL_REQUIRED");
  }
  if (value.webhookEnabled && value.activeProvider === "SHIPSGO" && !value.webhookSecret) {
    throw codedError("启用 Webhook 前请先填写 Webhook Secret", 400, "SHIPSGO_WEBHOOK_SECRET_REQUIRED");
  }
  if (value.webhookEnabled && value.activeProvider === "FREIGHTOWER" && !value.freightowerWebhookSecret) {
    throw codedError("启用飞驼可视推送前请先填写推送 Access Secret", 400, "FREIGHTOWER_WEBHOOK_SECRET_REQUIRED");
  }
  const setting = await prisma.systemSetting.upsert({
    where: { key: SHIPSGO_INTEGRATION_SETTING_KEY },
    update: { value },
    create: { key: SHIPSGO_INTEGRATION_SETTING_KEY, value },
  });
  await runNonCriticalTask("大掌櫃集成设置操作日志写入", () => (
    writeAudit(request, actor, "更新大掌櫃集成设置", "system_settings", SHIPSGO_INTEGRATION_SETTING_KEY, before, setting)
  ));
  return serializeShipsgoIntegrationSetting(setting);
}
