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
  apiBaseUrl?: unknown;
  apiKey?: unknown;
  oceanTrackingEnabled?: unknown;
  airTrackingEnabled?: unknown;
  manualSyncEnabled?: unknown;
  autoSyncEnabled?: unknown;
  dailySyncTime?: unknown;
  webhookEnabled?: unknown;
  webhookSecret?: unknown;
  liveMapEnabled?: unknown;
  liveMapEmbedToken?: unknown;
  customerPushEnabled?: unknown;
  creditWarningThreshold?: unknown;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanSecret(value: unknown, limit = 500) {
  return nonEmpty(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

function cleanOptionalUrl(value: unknown, fallback: string) {
  const text = nonEmpty(value || fallback);
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw codedError("大掌櫃 API 地址只支持 http 或 https", 400, "VALIDATION_INVALID_URL");
    }
    return url.toString().replace(/\/+$/, "");
  } catch (error) {
    if ((error as { status?: number } | null)?.status) throw error;
    throw codedError("大掌櫃 API 地址格式错误", 400, "VALIDATION_INVALID_URL");
  }
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

function shipsgoEmbedUrl(token: string) {
  if (!token) return "";
  return `https://embed.shipsgo.com/?token=${encodeURIComponent(token)}&tabs=ocean`;
}

export function normalizeShipsgoIntegrationSettings(value: unknown = {}) {
  const input: ShipsgoIntegrationInput = isPlainRecord(value) ? value : {};
  return {
    enabled: input.enabled === true,
    apiBaseUrl: cleanOptionalUrl(input.apiBaseUrl, DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.apiBaseUrl),
    apiKey: cleanSecret(input.apiKey),
    oceanTrackingEnabled: input.oceanTrackingEnabled !== false,
    airTrackingEnabled: input.airTrackingEnabled === true,
    manualSyncEnabled: input.manualSyncEnabled !== false,
    autoSyncEnabled: input.autoSyncEnabled === true,
    dailySyncTime: cleanDailySyncTime(input.dailySyncTime),
    webhookEnabled: input.webhookEnabled === true,
    webhookSecret: cleanSecret(input.webhookSecret),
    liveMapEnabled: input.liveMapEnabled === true,
    liveMapEmbedToken: cleanSecret(input.liveMapEmbedToken),
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
    webhookSecret: "",
    liveMapEmbedToken: "",
    apiKeyConfigured: Boolean(normalized.apiKey),
    webhookSecretConfigured: Boolean(normalized.webhookSecret),
    liveMapEmbedTokenConfigured: Boolean(normalized.liveMapEmbedToken),
  };
}

export function serializeShipsgoFeatureFlags(setting: unknown) {
  const normalized = normalizeShipsgoIntegrationSettings(settingValue(setting) || {});
  const enabled = normalized.enabled && Boolean(normalized.apiKey);
  return {
    enabled,
    oceanTrackingEnabled: enabled && normalized.oceanTrackingEnabled,
    airTrackingEnabled: enabled && normalized.airTrackingEnabled,
    manualSyncEnabled: enabled && normalized.manualSyncEnabled,
    autoSyncEnabled: enabled && normalized.autoSyncEnabled,
    dailySyncTime: normalized.dailySyncTime,
    webhookEnabled: enabled && normalized.webhookEnabled,
    liveMapEnabled: enabled && normalized.liveMapEnabled,
    liveMapEmbedUrl: enabled && normalized.liveMapEnabled ? shipsgoEmbedUrl(normalized.liveMapEmbedToken) : "",
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
    webhookSecret: cleanSecret(data.webhookSecret) || current.webhookSecret,
    liveMapEmbedToken: cleanSecret(data.liveMapEmbedToken) || current.liveMapEmbedToken,
  });
  if (value.enabled && !value.apiKey) {
    throw codedError("启用大掌櫃前请先填写 API Key", 400, "SHIPSGO_API_KEY_REQUIRED");
  }
  if (value.webhookEnabled && !value.webhookSecret) {
    throw codedError("启用 Webhook 前请先填写 Webhook Secret", 400, "SHIPSGO_WEBHOOK_SECRET_REQUIRED");
  }
  if (value.liveMapEnabled && !value.liveMapEmbedToken) {
    throw codedError("启用 Live Map 前请先填写 ShipsGo Embed Token", 400, "SHIPSGO_LIVE_MAP_TOKEN_REQUIRED");
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
