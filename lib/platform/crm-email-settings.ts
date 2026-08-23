import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertJsonObject, assertRead, assertWrite, runNonCriticalTask, writeAudit } from "./shared";
import {
  CRM_EMAIL_SETTING_KEY,
  type AuditRequest,
  type CrmEmailActor,
  type CrmEmailDatabase,
  normalizeCrmEmailIntegrationSettings,
  readStoredCrmEmailSettingValue,
  serializeCrmEmailIntegrationSettings,
} from "./crm-email-shared";

export {
  CRM_EMAIL_SETTING_KEY,
  DEFAULT_CRM_EMAIL_INTEGRATION_SETTINGS,
  normalizeCrmEmailIntegrationSettings,
  serializeCrmEmailIntegrationSettings,
  type CrmEmailIntegrationSettings,
} from "./crm-email-shared";

export async function getCrmEmailIntegrationSettings(database?: CrmEmailDatabase) {
  return normalizeCrmEmailIntegrationSettings(await readStoredCrmEmailSettingValue(database));
}

export async function readCrmEmailIntegrationSettings(actor: CrmEmailActor) {
  assertRead(actor, "settings");
  return serializeCrmEmailIntegrationSettings(await readStoredCrmEmailSettingValue());
}

export async function saveCrmEmailIntegrationSettings(request: AuditRequest, actor: CrmEmailActor, input: unknown = {}) {
  assertWrite(actor, "settings");
  const body = assertJsonObject(input);
  const before = await prisma.systemSetting.findUnique({ where: { key: CRM_EMAIL_SETTING_KEY } });
  const current = normalizeCrmEmailIntegrationSettings(before?.value);
  const value = normalizeCrmEmailIntegrationSettings({ ...current, ...body });
  const domainChanged = value.mailDomain !== current.mailDomain;
  const { saved, migratedAccountCount } = await prisma.$transaction(async (tx) => {
    const setting = await tx.systemSetting.upsert({
      where: { key: CRM_EMAIL_SETTING_KEY },
      update: { value: value as Prisma.InputJsonValue },
      create: { key: CRM_EMAIL_SETTING_KEY, value: value as Prisma.InputJsonValue },
    });
    if (!domainChanged) return { saved: setting, migratedAccountCount: 0 };
    const accounts = await tx.crmEmailAccount.findMany({ select: { id: true, localPart: true } });
    await Promise.all(accounts.map((account) => tx.crmEmailAccount.update({
      where: { id: account.id },
      data: { emailAddress: `${account.localPart}@${value.mailDomain}` },
    })));
    return { saved: setting, migratedAccountCount: accounts.length };
  });
  await runNonCriticalTask("CRM 邮件设置操作日志写入", () => (
    writeAudit(request, actor, "更新 CRM 邮件设置", "system_settings", CRM_EMAIL_SETTING_KEY, before, {
      ...saved,
      migratedAccountCount,
    })
  ));
  return serializeCrmEmailIntegrationSettings(value);
}
