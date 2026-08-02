import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  DEFAULT_SHIPSGO_INTEGRATION_SETTINGS,
  SHIPSGO_INTEGRATION_SETTING_KEY,
  runNonCriticalTask,
} from "./shared-constants";
import { assertJsonObject, codedError, isPlainRecord, nonEmpty } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import { decryptSystemSettingSecrets, encryptSystemSettingSecrets } from "./system-setting-secrets";
import { readSystemSettingWithEncryptedSecrets } from "./system-setting-secret-migration";
import { testFreightowerConnection } from "./freightower-api";

type SettingsActor = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];

type ShipsgoIntegrationInput = {
  enabled?: unknown;
  freightowerApiBaseUrl?: unknown;
  freightowerApiKey?: unknown;
  freightowerClientId?: unknown;
  freightowerIframeKey?: unknown;
  freightowerWebhookAccessSecret?: unknown;
  // Deprecated token-mode fields are only read for safe migration.
  freightowerSecret?: unknown;
  freightowerAppId?: unknown;
  freightowerAppSecret?: unknown;
  freightowerDataSecret?: unknown;
  freightowerTokenSecret?: unknown;
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
  liveMapEnabled?: unknown;
  customerPushEnabled?: unknown;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const FREIGHTOWER_API_HOSTS = new Set(["openapi.freightower.com"]);
const FREIGHTOWER_SECRET_FIELDS = [
  "freightowerAppId",
  "freightowerAppSecret",
  "freightowerApiKey",
  "freightowerClientId",
  "freightowerTokenSecret",
  "freightowerDataSecret",
  "freightowerIframeKey",
  "freightowerWebhookAccessSecret",
  // Keep legacy AAD field names decryptable until the next settings save migrates them.
  "freightowerSecret",
  "freightowerMapKey",
  "freightowerWebhookSecret",
] as const;

function cleanSecret(value: unknown, limit = 500) {
  return nonEmpty(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

function migratedFreightowerApiKey(input: ShipsgoIntegrationInput) {
  const directApiKey = cleanSecret(input.freightowerApiKey, 500);
  if (directApiKey) return directApiKey;
  const legacyValue = cleanSecret(
    input.freightowerSecret
    || input.freightowerTokenSecret
    || input.freightowerAppSecret,
    500,
  );
  // Old releases stored API keys under token-oriented names. Do not reinterpret
  // short account passwords (for example a six-digit secret) as an API key.
  return legacyValue.length >= 20 ? legacyValue : "";
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

export function normalizeShipsgoIntegrationSettings(value: unknown = {}) {
  const input: ShipsgoIntegrationInput = isPlainRecord(value) ? value : {};
  return {
    enabled: input.enabled === true,
    activeProvider: "FREIGHTOWER" as const,
    freightowerEnabled: true,
    freightowerApiBaseUrl: cleanProviderApiUrl(
      input.freightowerApiBaseUrl,
      DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.freightowerApiBaseUrl,
      "飞驼可视 API 地址",
      FREIGHTOWER_API_HOSTS,
      new Set(["/"]),
    ),
    freightowerApiKey: migratedFreightowerApiKey(input),
    freightowerClientId: cleanSecret(input.freightowerClientId, 128),
    freightowerIframeKey: cleanSecret(input.freightowerIframeKey || input.freightowerMapKey, 500),
    freightowerWebhookAccessSecret: cleanSecret(input.freightowerWebhookAccessSecret || input.freightowerWebhookSecret, 500),
    freightowerDefaultCarrierCode: cleanProviderCode(input.freightowerDefaultCarrierCode, DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.freightowerDefaultCarrierCode),
    freightowerDefaultPortCode: cleanProviderCode(input.freightowerDefaultPortCode, "", 16),
    freightowerDefaultIsExport: cleanFreightowerIsExport(input.freightowerDefaultIsExport),
    freightowerDefaultLang: cleanFreightowerLang(input.freightowerDefaultLang),
    freightowerHiddenReference: input.freightowerHiddenReference === true,
    oceanTrackingEnabled: input.oceanTrackingEnabled !== false,
    airTrackingEnabled: false,
    manualSyncEnabled: input.manualSyncEnabled !== false,
    autoSyncEnabled: true,
    dailySyncTime: cleanDailySyncTime(input.dailySyncTime),
    webhookEnabled: input.webhookEnabled === true,
    liveMapEnabled: input.liveMapEnabled === true,
    customerPushEnabled: false,
  };
}

function settingValue(setting: unknown) {
  return isPlainRecord(setting) && "value" in setting ? setting.value : setting;
}

function decryptedShipsgoSettingValue(value: unknown) {
  return decryptSystemSettingSecrets(value, SHIPSGO_INTEGRATION_SETTING_KEY, FREIGHTOWER_SECRET_FIELDS);
}

function readStoredShipsgoSettingValue() {
  return readSystemSettingWithEncryptedSecrets(SHIPSGO_INTEGRATION_SETTING_KEY, DEFAULT_SHIPSGO_INTEGRATION_SETTINGS, FREIGHTOWER_SECRET_FIELDS);
}

export function serializeShipsgoIntegrationSetting(setting: unknown) {
  const normalized = normalizeShipsgoIntegrationSettings(settingValue(setting) || {});
  return {
    ...normalized,
    freightowerApiKey: "",
    freightowerClientId: "",
    freightowerIframeKey: "",
    freightowerWebhookAccessSecret: "",
    freightowerApiKeyConfigured: Boolean(normalized.freightowerApiKey),
    freightowerClientIdConfigured: Boolean(normalized.freightowerClientId),
    freightowerIframeKeyConfigured: Boolean(normalized.freightowerIframeKey),
    freightowerWebhookAccessSecretConfigured: Boolean(normalized.freightowerWebhookAccessSecret),
  };
}

export function serializeShipsgoFeatureFlags(setting: unknown) {
  const normalized = normalizeShipsgoIntegrationSettings(settingValue(setting) || {});
  const freightowerReady = normalized.freightowerEnabled
    && Boolean(normalized.freightowerApiKey);
  const enabled = normalized.enabled && freightowerReady;
  return {
    enabled,
    activeProvider: "FREIGHTOWER",
    providerLabel: "飞驼可视",
    oceanTrackingEnabled: enabled && normalized.oceanTrackingEnabled,
    airTrackingEnabled: enabled && normalized.airTrackingEnabled,
    manualSyncEnabled: enabled && normalized.manualSyncEnabled,
    autoSyncEnabled: enabled && normalized.autoSyncEnabled,
    dailySyncTime: normalized.dailySyncTime,
    webhookEnabled: enabled && normalized.webhookEnabled,
    liveMapEnabled: enabled && normalized.liveMapEnabled,
    customerPushEnabled: enabled && normalized.customerPushEnabled,
  };
}

export async function getShipsgoIntegrationSettings() {
  return normalizeShipsgoIntegrationSettings(await readStoredShipsgoSettingValue());
}

export async function readShipsgoIntegrationSettings(actor: SettingsActor) {
  assertRead(actor, "settings");
  return serializeShipsgoIntegrationSetting(await readStoredShipsgoSettingValue());
}

export async function readShipsgoFeatureFlags() {
  return serializeShipsgoFeatureFlags(await readStoredShipsgoSettingValue());
}

export async function testShipsgoIntegrationConnection(actor: SettingsActor, input: unknown = {}) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const stored = await readStoredShipsgoSettingValue();
  const current = normalizeShipsgoIntegrationSettings(stored);
  const candidate = normalizeShipsgoIntegrationSettings({
    ...current,
    ...data,
    freightowerApiKey: cleanSecret(data.freightowerApiKey, 500) || current.freightowerApiKey,
    freightowerClientId: cleanSecret(data.freightowerClientId, 128) || current.freightowerClientId,
  });
  return testFreightowerConnection(candidate);
}

export async function saveShipsgoIntegrationSettings(request: AuditRequestLike, actor: SettingsActor, input: unknown = {}) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const before = await prisma.systemSetting.findUnique({ where: { key: SHIPSGO_INTEGRATION_SETTING_KEY } });
  const current = normalizeShipsgoIntegrationSettings(decryptedShipsgoSettingValue(before?.value || DEFAULT_SHIPSGO_INTEGRATION_SETTINGS));
  const value = normalizeShipsgoIntegrationSettings({
    ...current,
    ...data,
    freightowerApiKey: cleanSecret(data.freightowerApiKey) || current.freightowerApiKey,
    freightowerClientId: cleanSecret(data.freightowerClientId, 128) || current.freightowerClientId,
    freightowerIframeKey: cleanSecret(data.freightowerIframeKey || data.freightowerMapKey) || current.freightowerIframeKey,
    freightowerWebhookAccessSecret: cleanSecret(data.freightowerWebhookAccessSecret || data.freightowerWebhookSecret) || current.freightowerWebhookAccessSecret,
  });
  if (value.enabled && !value.freightowerApiKey) {
    throw codedError("启用飞驼可视前请填写 API Key", 400, "FREIGHTOWER_CREDENTIAL_REQUIRED");
  }
  if (value.liveMapEnabled && (!value.freightowerClientId || !value.freightowerIframeKey)) {
    throw codedError("启用可视化地图前请先填写 Client ID 和 iframe Key", 400, "FREIGHTOWER_IFRAME_KEY_REQUIRED");
  }
  const storedValue = encryptSystemSettingSecrets(value, SHIPSGO_INTEGRATION_SETTING_KEY, FREIGHTOWER_SECRET_FIELDS);
  const setting = await prisma.systemSetting.upsert({
    where: { key: SHIPSGO_INTEGRATION_SETTING_KEY },
    update: { value: storedValue as Prisma.InputJsonValue },
    create: { key: SHIPSGO_INTEGRATION_SETTING_KEY, value: storedValue as Prisma.InputJsonValue },
  });
  await runNonCriticalTask("飞驼可视集成设置操作日志写入", () => (
    writeAudit(request, actor, "更新飞驼可视集成设置", "system_settings", SHIPSGO_INTEGRATION_SETTING_KEY, before, setting)
  ));
  return serializeShipsgoIntegrationSetting(value);
}
