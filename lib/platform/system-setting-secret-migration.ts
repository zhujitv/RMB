import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { isPlainRecord } from "./shared-base-utils";
import { logServerError } from "./shared-base-errors";
import {
  decryptSystemSettingSecrets,
  encryptSystemSettingSecrets,
  settingsEncryptionKeyConfigured,
  systemSettingSecretsNeedMigration,
} from "./system-setting-secrets";

export async function readSystemSettingWithEncryptedSecrets(
  settingKey: string,
  fallback: Record<string, unknown>,
  secretFields: readonly string[],
  retryOnConflict = true,
): Promise<unknown> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: settingKey } });
  if (!setting) return fallback;
  const decrypted = decryptSystemSettingSecrets(setting.value, settingKey, secretFields);
  if (
    !settingsEncryptionKeyConfigured()
    || !isPlainRecord(decrypted)
    || !systemSettingSecretsNeedMigration(setting.value, secretFields)
  ) return decrypted;

  const encrypted = encryptSystemSettingSecrets(decrypted, settingKey, secretFields);
  try {
    const migrated = await prisma.systemSetting.updateMany({
      where: { key: settingKey, updatedAt: setting.updatedAt },
      data: { value: encrypted as Prisma.InputJsonValue },
    });
    if (migrated.count === 1) {
      console.info("system-setting-secrets-migrated", { settingKey, secretFieldCount: secretFields.length });
      return decrypted;
    }
    if (retryOnConflict) {
      return readSystemSettingWithEncryptedSecrets(settingKey, fallback, secretFields, false);
    }
  } catch (error) {
    logServerError("system-setting-secrets-migration-failed", error, { settingKey });
  }
  return decrypted;
}
