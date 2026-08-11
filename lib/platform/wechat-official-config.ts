import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertJsonObject, codedError, isPlainRecord, nonEmpty } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import { runNonCriticalTask } from "./shared-constants";
import { decryptSystemSettingSecrets, encryptSystemSettingSecrets } from "./system-setting-secrets";

export const WECHAT_OFFICIAL_SETTING_KEY = "wechat_official_integration";
const WECHAT_SECRET_FIELDS = ["appSecret"] as const;

type SettingsActor = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];

type WechatOfficialInput = {
  enabled?: unknown;
  accountCertified?: unknown;
  appId?: unknown;
  appSecret?: unknown;
  templateId?: unknown;
};

function cleanText(value: unknown, limit: number) {
  return nonEmpty(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, limit).trim();
}

function cleanAppId(value: unknown) {
  const appId = cleanText(value, 64);
  if (appId && !/^wx[a-zA-Z0-9]{16}$/.test(appId)) {
    throw codedError("公众号 AppID 格式不正确", 400, "WECHAT_OFFICIAL_APP_ID_INVALID");
  }
  return appId;
}

function cleanTemplateId(value: unknown) {
  const templateId = cleanText(value, 160);
  if (templateId && !/^[a-zA-Z0-9_-]{8,160}$/.test(templateId)) {
    throw codedError("公众号模板消息 ID 格式不正确", 400, "WECHAT_OFFICIAL_TEMPLATE_ID_INVALID");
  }
  return templateId;
}

export function normalizeWechatOfficialSettings(value: unknown = {}) {
  const input: WechatOfficialInput = isPlainRecord(value) ? value : {};
  return {
    enabled: input.enabled === true,
    accountCertified: input.accountCertified === true,
    appId: cleanAppId(input.appId),
    appSecret: cleanText(input.appSecret, 256),
    templateId: cleanTemplateId(input.templateId),
  };
}

function settingValue(setting: unknown) {
  return isPlainRecord(setting) && "value" in setting ? setting.value : setting;
}

async function readStoredValue() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: WECHAT_OFFICIAL_SETTING_KEY } });
  return decryptSystemSettingSecrets(setting?.value || {}, WECHAT_OFFICIAL_SETTING_KEY, WECHAT_SECRET_FIELDS);
}

export function serializeWechatOfficialSettings(value: unknown) {
  const settings = normalizeWechatOfficialSettings(settingValue(value));
  const credentialsReady = Boolean(settings.appId && settings.appSecret && settings.templateId);
  return {
    ...settings,
    appSecret: "",
    appSecretConfigured: Boolean(settings.appSecret),
    credentialsReady,
    ready: settings.enabled && settings.accountCertified && credentialsReady,
    callbackUrl: "https://www.nextwood.net/api/wechat-official/subscription/callback",
    accountRequirement: "公众号须完成认证，并在后台开通模板消息能力、添加物流通知模板",
  };
}

export async function getWechatOfficialSettings() {
  return normalizeWechatOfficialSettings(await readStoredValue());
}

export async function readWechatOfficialSettings(actor: SettingsActor) {
  assertRead(actor, "settings");
  return serializeWechatOfficialSettings(await readStoredValue());
}

export async function saveWechatOfficialSettings(
  request: AuditRequestLike,
  actor: SettingsActor,
  input: unknown = {},
) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const before = await prisma.systemSetting.findUnique({ where: { key: WECHAT_OFFICIAL_SETTING_KEY } });
  const current = normalizeWechatOfficialSettings(
    decryptSystemSettingSecrets(before?.value || {}, WECHAT_OFFICIAL_SETTING_KEY, WECHAT_SECRET_FIELDS),
  );
  const value = normalizeWechatOfficialSettings({
    ...current,
    ...data,
    appSecret: cleanText(data.appSecret, 256) || current.appSecret,
  });
  if (value.enabled && !value.accountCertified) {
    throw codedError("微信官方限制：启用前必须确认公众号为企业主体已认证账号", 400, "WECHAT_OFFICIAL_CERTIFICATION_REQUIRED");
  }
  if (value.enabled && (!value.appId || !value.appSecret || !value.templateId)) {
    throw codedError("启用微信通知前请填写 AppID、AppSecret 和模板 ID", 400, "WECHAT_OFFICIAL_CREDENTIAL_REQUIRED");
  }
  const storedValue = encryptSystemSettingSecrets(
    value,
    WECHAT_OFFICIAL_SETTING_KEY,
    WECHAT_SECRET_FIELDS,
  );
  const setting = await prisma.systemSetting.upsert({
    where: { key: WECHAT_OFFICIAL_SETTING_KEY },
    update: { value: storedValue as Prisma.InputJsonValue },
    create: { key: WECHAT_OFFICIAL_SETTING_KEY, value: storedValue as Prisma.InputJsonValue },
  });
  await runNonCriticalTask("微信公众号设置操作日志写入", () => (
    writeAudit(request, actor, "更新微信公众号通知设置", "system_settings", WECHAT_OFFICIAL_SETTING_KEY, before, setting)
  ));
  return serializeWechatOfficialSettings(value);
}
