import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  DEFAULT_OCR_INTEGRATION_SETTINGS,
  OCR_INTEGRATION_SETTING_KEY,
  runNonCriticalTask,
} from "./shared-constants";
import { assertJsonObject, codedError } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import {
  decryptSystemSettingSecrets,
  encryptSystemSettingSecrets,
} from "./system-setting-secrets";
import { readSystemSettingWithEncryptedSecrets } from "./system-setting-secret-migration";
import { assertAliyunOcrApiUrlSafe } from "./outbound-request-security";
import {
  cleanSecret,
  normalizeOcrIntegrationSettings,
  ocrFeatureEnabled,
  ocrFeatureLabel,
  serializeOcrFeatureFlags,
  serializeOcrIntegrationSetting,
  type OcrFeatureKey,
} from "./ocr-integration-config";

export type SettingsActor = Parameters<typeof assertRead>[0];
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
const OCR_SECRET_FIELDS = ["accessKeyId", "accessKeySecret", "appCode", "tencentSecretId", "tencentSecretKey"] as const;

function decryptedOcrSettingValue(value: unknown) {
  return decryptSystemSettingSecrets(value, OCR_INTEGRATION_SETTING_KEY, OCR_SECRET_FIELDS);
}

export async function getOcrIntegrationSettings() {
  const value = await readSystemSettingWithEncryptedSecrets(
    OCR_INTEGRATION_SETTING_KEY,
    DEFAULT_OCR_INTEGRATION_SETTINGS,
    OCR_SECRET_FIELDS,
  );
  return normalizeOcrIntegrationSettings(value);
}

export async function readOcrIntegrationSettings(actor: SettingsActor) {
  assertRead(actor, "settings");
  const value = await readSystemSettingWithEncryptedSecrets(
    OCR_INTEGRATION_SETTING_KEY,
    DEFAULT_OCR_INTEGRATION_SETTINGS,
    OCR_SECRET_FIELDS,
  );
  return serializeOcrIntegrationSetting(value);
}

export async function readOcrFeatureFlags() {
  const value = await readSystemSettingWithEncryptedSecrets(
    OCR_INTEGRATION_SETTING_KEY,
    DEFAULT_OCR_INTEGRATION_SETTINGS,
    OCR_SECRET_FIELDS,
  );
  return serializeOcrFeatureFlags(value);
}

export async function saveOcrIntegrationSettings(request: AuditRequestLike, actor: SettingsActor, input: unknown = {}) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const before = await prisma.systemSetting.findUnique({ where: { key: OCR_INTEGRATION_SETTING_KEY } });
  const current = normalizeOcrIntegrationSettings(decryptedOcrSettingValue(before?.value || DEFAULT_OCR_INTEGRATION_SETTINGS));
  const value = normalizeOcrIntegrationSettings({
    ...current,
    ...data,
    accessKeyId: cleanSecret(data.accessKeyId) || current.accessKeyId,
    accessKeySecret: cleanSecret(data.accessKeySecret) || current.accessKeySecret,
    appCode: cleanSecret(data.appCode) || current.appCode,
    tencentSecretId: cleanSecret(data.tencentSecretId) || current.tencentSecretId,
    tencentSecretKey: cleanSecret(data.tencentSecretKey) || current.tencentSecretKey,
  });
  if (value.enabled && !value.appCode && !(value.accessKeyId && value.accessKeySecret)) {
    throw codedError("启用 OCR 前请先填写 AppCode，或同时填写 AccessKey ID 和 AccessKey Secret。", 400, "OCR_CREDENTIAL_REQUIRED");
  }
  if (value.enabled && value.customsDeclarationMode === "STRICT" && !(value.accessKeyId && value.accessKeySecret)) {
    throw codedError("报关单严格结构化模式需要配置 AccessKey ID 和 AccessKey Secret。", 400, "OCR_ACCESS_KEY_REQUIRED");
  }
  const storedValue = encryptSystemSettingSecrets(value, OCR_INTEGRATION_SETTING_KEY, OCR_SECRET_FIELDS);
  const setting = await prisma.systemSetting.upsert({
    where: { key: OCR_INTEGRATION_SETTING_KEY },
    update: { value: storedValue as Prisma.InputJsonValue },
    create: { key: OCR_INTEGRATION_SETTING_KEY, value: storedValue as Prisma.InputJsonValue },
  });
  await runNonCriticalTask("OCR集成设置操作日志写入", () => (
    writeAudit(request, actor, "更新OCR集成设置", "system_settings", OCR_INTEGRATION_SETTING_KEY, before, setting)
  ));
  return serializeOcrIntegrationSetting(value);
}

export async function ensureOcrFeatureEnabled(feature: OcrFeatureKey) {
  const settings = await getOcrIntegrationSettings();
  if (ocrFeatureEnabled(settings, feature)) {
    await assertAliyunOcrApiUrlSafe(settings.apiBaseUrl);
    return settings;
  }
  throw codedError(`${ocrFeatureLabel(feature)}功能已关闭，请到系统设置启用 OCR。`, 403, "OCR_FEATURE_DISABLED");
}

export async function isOcrFeatureEnabled(feature: OcrFeatureKey) {
  const settings = await getOcrIntegrationSettings();
  return ocrFeatureEnabled(settings, feature);
}
