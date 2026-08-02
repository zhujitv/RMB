import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertJsonObject, codedError, isPlainRecord, nonEmpty } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import { runNonCriticalTask } from "./shared-constants";
import { decryptSystemSettingSecrets, encryptSystemSettingSecrets } from "./system-setting-secrets";

export const WECHAT_MINI_SETTING_KEY = "wechat_mini_program_integration";
const SECRET_FIELDS = ["appSecret"] as const;

type SettingsActor = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];

type SettingsInput = {
  enabled?: unknown;
  appId?: unknown;
  appSecret?: unknown;
  trackingTemplateId?: unknown;
  orderField?: unknown;
  statusField?: unknown;
  eventTimeField?: unknown;
  eventField?: unknown;
};

function cleanText(value: unknown, limit: number) {
  return nonEmpty(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, limit).trim();
}

function cleanAppId(value: unknown) {
  const appId = cleanText(value, 64);
  if (appId && !/^wx[a-zA-Z0-9]{16}$/.test(appId)) {
    throw codedError("小程序 AppID 格式不正确", 400, "WECHAT_MINI_APP_ID_INVALID");
  }
  return appId;
}

function cleanTemplateId(value: unknown) {
  const id = cleanText(value, 160);
  if (id && !/^[a-zA-Z0-9_-]{8,160}$/.test(id)) {
    throw codedError("小程序订阅消息模板 ID 格式不正确", 400, "WECHAT_MINI_TEMPLATE_ID_INVALID");
  }
  return id;
}

function cleanField(value: unknown, fallback: string) {
  const field = cleanText(value, 32) || fallback;
  if (!/^[a-zA-Z]+\d+$/.test(field)) {
    throw codedError("订阅模板字段名格式不正确", 400, "WECHAT_MINI_TEMPLATE_FIELD_INVALID");
  }
  return field;
}

export function normalizeWechatMiniSettings(value: unknown = {}) {
  const input: SettingsInput = isPlainRecord(value) ? value : {};
  return {
    enabled: input.enabled === true,
    appId: cleanAppId(input.appId),
    appSecret: cleanText(input.appSecret, 256),
    trackingTemplateId: cleanTemplateId(input.trackingTemplateId),
    orderField: cleanField(input.orderField, "thing1"),
    statusField: cleanField(input.statusField, "phrase2"),
    eventTimeField: cleanField(input.eventTimeField, "time3"),
    eventField: cleanField(input.eventField, "thing4"),
  };
}

async function storedSettings() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: WECHAT_MINI_SETTING_KEY } });
  return decryptSystemSettingSecrets(setting?.value || {}, WECHAT_MINI_SETTING_KEY, SECRET_FIELDS);
}

function envSettings() {
  return normalizeWechatMiniSettings({
    enabled: process.env.WECHAT_MINI_ENABLED === "true",
    appId: process.env.WECHAT_MINI_APP_ID,
    appSecret: process.env.WECHAT_MINI_APP_SECRET,
    trackingTemplateId: process.env.WECHAT_MINI_TRACKING_TEMPLATE_ID,
    orderField: process.env.WECHAT_MINI_ORDER_FIELD,
    statusField: process.env.WECHAT_MINI_STATUS_FIELD,
    eventTimeField: process.env.WECHAT_MINI_EVENT_TIME_FIELD,
    eventField: process.env.WECHAT_MINI_EVENT_FIELD,
  });
}

export async function getWechatMiniSettings() {
  const stored = normalizeWechatMiniSettings(await storedSettings());
  const env = envSettings();
  return normalizeWechatMiniSettings({
    ...env,
    ...stored,
    enabled: stored.enabled || env.enabled,
    appId: stored.appId || env.appId,
    appSecret: stored.appSecret || env.appSecret,
    trackingTemplateId: stored.trackingTemplateId || env.trackingTemplateId,
  });
}

export function serializeWechatMiniSettings(value: unknown) {
  const settings = normalizeWechatMiniSettings(value);
  const credentialsReady = Boolean(settings.appId && settings.appSecret && settings.trackingTemplateId);
  return {
    ...settings,
    appSecret: "",
    appSecretConfigured: Boolean(settings.appSecret),
    credentialsReady,
    ready: settings.enabled && credentialsReady,
    requestDomain: "https://www.nextwood.net",
  };
}

export async function readWechatMiniSettings(actor: SettingsActor) {
  assertRead(actor, "settings");
  return serializeWechatMiniSettings(await getWechatMiniSettings());
}

export async function saveWechatMiniSettings(request: AuditRequestLike, actor: SettingsActor, input: unknown = {}) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const before = await prisma.systemSetting.findUnique({ where: { key: WECHAT_MINI_SETTING_KEY } });
  const current = normalizeWechatMiniSettings(
    decryptSystemSettingSecrets(before?.value || {}, WECHAT_MINI_SETTING_KEY, SECRET_FIELDS),
  );
  const value = normalizeWechatMiniSettings({
    ...current,
    ...data,
    appSecret: cleanText(data.appSecret, 256) || current.appSecret,
  });
  if (value.enabled && (!value.appId || !value.appSecret || !value.trackingTemplateId)) {
    throw codedError("启用小程序前请填写 AppID、AppSecret 和物流订阅模板 ID", 400, "WECHAT_MINI_CREDENTIAL_REQUIRED");
  }
  const storedValue = encryptSystemSettingSecrets(value, WECHAT_MINI_SETTING_KEY, SECRET_FIELDS);
  const setting = await prisma.systemSetting.upsert({
    where: { key: WECHAT_MINI_SETTING_KEY },
    update: { value: storedValue as Prisma.InputJsonValue },
    create: { key: WECHAT_MINI_SETTING_KEY, value: storedValue as Prisma.InputJsonValue },
  });
  await runNonCriticalTask("微信小程序设置操作日志写入", () => (
    writeAudit(request, actor, "更新微信小程序设置", "system_settings", WECHAT_MINI_SETTING_KEY, before, setting)
  ));
  return serializeWechatMiniSettings(value);
}
