import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  DEFAULT_SHIPSGO_INTEGRATION_SETTINGS,
  SHIPSGO_INTEGRATION_SETTING_KEY,
  runNonCriticalTask,
} from "./shared-constants";
import { assertJsonObject, codedError, isPlainRecord } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import { decryptSystemSettingSecrets, encryptSystemSettingSecrets } from "./system-setting-secrets";
import { readSystemSettingWithEncryptedSecrets } from "./system-setting-secret-migration";
import { testFreightowerConnection } from "./freightower-api";
import { testFreightowerTokenConnection } from "./freightower-token-api";
import {
  cleanFreightowerSecret,
  FREIGHTOWER_SECRET_FIELDS,
  normalizeShipsgoIntegrationSettings,
} from "./freightower-integration-normalize";

export { normalizeShipsgoIntegrationSettings } from "./freightower-integration-normalize";

type SettingsActor = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];

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
    freightowerApiSecret: "",
    freightowerIframeKey: "",
    freightowerWebhookAccessSecret: "",
    freightowerApiKeyConfigured: Boolean(normalized.freightowerApiKey),
    freightowerClientIdConfigured: Boolean(normalized.freightowerClientId),
    freightowerApiSecretConfigured: Boolean(normalized.freightowerApiSecret),
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
    customsTrackingEnabled: enabled && normalized.customsTrackingEnabled,
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
    freightowerApiKey: cleanFreightowerSecret(data.freightowerApiKey) || current.freightowerApiKey,
    freightowerClientId: cleanFreightowerSecret(data.freightowerClientId, 128) || current.freightowerClientId,
    freightowerApiSecret: cleanFreightowerSecret(data.freightowerApiSecret) || current.freightowerApiSecret,
  });
  if (!candidate.customsTrackingEnabled) return testFreightowerConnection(candidate);
  const [directResult, tokenResult] = await Promise.all([
    testFreightowerConnection(candidate),
    testFreightowerTokenConnection(candidate),
  ]);
  return {
    success: true,
    message: `${directResult.message} ${tokenResult.message}`,
  };
}

export async function saveShipsgoIntegrationSettings(request: AuditRequestLike, actor: SettingsActor, input: unknown = {}) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const before = await prisma.systemSetting.findUnique({ where: { key: SHIPSGO_INTEGRATION_SETTING_KEY } });
  const current = normalizeShipsgoIntegrationSettings(decryptedShipsgoSettingValue(before?.value || DEFAULT_SHIPSGO_INTEGRATION_SETTINGS));
  const value = normalizeShipsgoIntegrationSettings({
    ...current,
    ...data,
    freightowerApiKey: cleanFreightowerSecret(data.freightowerApiKey) || current.freightowerApiKey,
    freightowerClientId: cleanFreightowerSecret(data.freightowerClientId, 128) || current.freightowerClientId,
    freightowerApiSecret: cleanFreightowerSecret(data.freightowerApiSecret) || current.freightowerApiSecret,
    freightowerIframeKey: cleanFreightowerSecret(data.freightowerIframeKey || data.freightowerMapKey) || current.freightowerIframeKey,
    freightowerWebhookAccessSecret: cleanFreightowerSecret(data.freightowerWebhookAccessSecret || data.freightowerWebhookSecret) || current.freightowerWebhookAccessSecret,
  });
  if (value.enabled && !value.freightowerApiKey) {
    throw codedError("启用飞驼可视前请填写 API Key", 400, "FREIGHTOWER_CREDENTIAL_REQUIRED");
  }
  if (value.customsTrackingEnabled && (!value.freightowerClientId || !value.freightowerApiSecret)) {
    throw codedError(
      "启用中国海关跟踪前请填写 Client ID 和 API Secret",
      400,
      "FREIGHTOWER_CUSTOMS_CREDENTIAL_REQUIRED",
    );
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
