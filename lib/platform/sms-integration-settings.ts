import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  DEFAULT_SMS_INTEGRATION_SETTINGS,
  SMS_INTEGRATION_SETTING_KEY,
  runNonCriticalTask,
} from "./shared-constants";
import { assertJsonObject } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import {
  applySmsRuntimeCredentials,
  assertSmsSettingsCanBeEnabled,
  cleanSmsSecret,
  normalizeSmsIntegrationSettings,
  serializeSmsIntegrationSetting,
  SMS_SECRET_FIELDS,
  type RuntimeSmsIntegrationSettings,
} from "./sms-integration-config";
import {
  decryptSystemSettingSecrets,
  encryptSystemSettingSecrets,
} from "./system-setting-secrets";
import { readSystemSettingWithEncryptedSecrets } from "./system-setting-secret-migration";

export { normalizeChinaMobilePhone } from "./sms-phone-utils";

export type SmsSettingsActor = Parameters<typeof assertRead>[0];
export type SmsAuditRequestLike = Parameters<typeof writeAudit>[0];
export type SmsSettingsDatabase = Prisma.TransactionClient | typeof prisma;

function decryptStoredSmsSetting(value: unknown) {
  return decryptSystemSettingSecrets(value, SMS_INTEGRATION_SETTING_KEY, SMS_SECRET_FIELDS);
}

async function readStoredSmsSettingValue(database?: SmsSettingsDatabase) {
  if (!database || database === prisma) {
    return readSystemSettingWithEncryptedSecrets(
      SMS_INTEGRATION_SETTING_KEY,
      DEFAULT_SMS_INTEGRATION_SETTINGS,
      SMS_SECRET_FIELDS,
    );
  }
  const setting = await database.systemSetting.findUnique({ where: { key: SMS_INTEGRATION_SETTING_KEY } });
  return setting
    ? decryptStoredSmsSetting(setting.value)
    : DEFAULT_SMS_INTEGRATION_SETTINGS;
}

export async function getSmsIntegrationSettings(
  database?: SmsSettingsDatabase,
): Promise<RuntimeSmsIntegrationSettings> {
  const stored = normalizeSmsIntegrationSettings(await readStoredSmsSettingValue(database));
  return applySmsRuntimeCredentials(stored);
}

export async function readSmsIntegrationSettings(actor: SmsSettingsActor) {
  assertRead(actor, "settings");
  return serializeSmsIntegrationSetting(await readStoredSmsSettingValue());
}

export async function saveSmsIntegrationSettings(
  request: SmsAuditRequestLike,
  actor: SmsSettingsActor,
  input: unknown = {},
) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const before = await prisma.systemSetting.findUnique({ where: { key: SMS_INTEGRATION_SETTING_KEY } });
  const current = normalizeSmsIntegrationSettings(
    decryptStoredSmsSetting(before?.value || DEFAULT_SMS_INTEGRATION_SETTINGS),
  );
  const value = normalizeSmsIntegrationSettings({
    ...current,
    ...data,
    secretId: cleanSmsSecret(data.secretId) || current.secretId,
    secretKey: cleanSmsSecret(data.secretKey) || current.secretKey,
  });
  assertSmsSettingsCanBeEnabled(applySmsRuntimeCredentials(value));
  const storedValue = encryptSystemSettingSecrets(value, SMS_INTEGRATION_SETTING_KEY, SMS_SECRET_FIELDS);
  const setting = await prisma.systemSetting.upsert({
    where: { key: SMS_INTEGRATION_SETTING_KEY },
    update: { value: storedValue as Prisma.InputJsonValue },
    create: { key: SMS_INTEGRATION_SETTING_KEY, value: storedValue as Prisma.InputJsonValue },
  });
  await runNonCriticalTask("短信集成设置操作日志写入", () => (
    writeAudit(request, actor, "更新短信集成设置", "system_settings", SMS_INTEGRATION_SETTING_KEY, before, setting)
  ));
  return serializeSmsIntegrationSetting(value);
}
