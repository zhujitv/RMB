import { prisma } from "../prisma";
import {
  DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS,
  DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS,
  LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY,
  LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS,
  LOGISTICS_INVOICE_NOTIFICATION_VARIABLES,
  runNonCriticalTask,
} from "./shared-constants";
import {
  assertJsonObject,
  isPlainRecord,
  nonEmpty,
  normalizeEmail,
  parseEmailList,
  requireValidEmailList,
  validEmail,
} from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import { NOTIFICATION_TEMPLATE_TYPES } from "./notification-definitions";
import {
  getNotificationTemplate,
  saveNotificationCenterTemplate,
  serializeNotificationTemplate,
} from "./notification-settings";

const TEXT_LIMITS = {
  subject: 220,
  body: 12000,
  requirements: 4000,
  uploadUrl: 300,
  signature: 180,
};

type LogisticsInvoiceNotificationSettingsInput = {
  autoSendOnApproval?: unknown;
  recipientEmailFields?: unknown;
  ccAdminEmails?: unknown;
  ccEmails?: unknown;
  singleSubjectTemplate?: unknown;
  batchSubjectTemplate?: unknown;
  bodyTemplate?: unknown;
  invoiceRequirements?: unknown;
  uploadUrl?: unknown;
  signature?: unknown;
  resetToDefault?: unknown;
};

type SettingsActor = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type SystemSettingLike = { value?: unknown } | null | undefined;

function cleanRecipientEmailFields(value: unknown) {
  const allowed = new Set(LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS.map((item) => item.value));
  const input = Array.isArray(value) ? value : DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS;
  const fields = input
    .map((item) => String(item || "").trim())
    .filter((item, index, arr) => allowed.has(item) && arr.indexOf(item) === index);
  return fields.length ? fields : [...DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS];
}

function cleanTemplateText(value: unknown, fallback = "", limit = 1000) {
  if (value === undefined || value === null) return fallback;
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

function cleanOptionalUrl(value: unknown) {
  const text = cleanTemplateText(value, "", TEXT_LIMITS.uploadUrl);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function logisticsInvoiceNotificationUploadUrl(
  settings: LogisticsInvoiceNotificationSettingsInput = {},
) {
  return nonEmpty(settings.uploadUrl)
    || process.env.NEXT_PUBLIC_APP_URL
    || process.env.APP_BASE_URL
    || "https://www.nextwood.net";
}

export function normalizeLogisticsInvoiceNotificationSettings(value: unknown = {}) {
  const input: LogisticsInvoiceNotificationSettingsInput = isPlainRecord(value) ? value : {};
  return {
    ...DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS,
    autoSendOnApproval: input.autoSendOnApproval !== false,
    recipientEmailFields: cleanRecipientEmailFields(input.recipientEmailFields),
    ccAdminEmails: typeof input.ccAdminEmails === "boolean"
      ? input.ccAdminEmails
      : DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.ccAdminEmails,
    ccEmails: requireValidEmailList(input.ccEmails || [], "通知抄送邮箱"),
    singleSubjectTemplate: cleanTemplateText(
      input.singleSubjectTemplate,
      DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.singleSubjectTemplate,
      TEXT_LIMITS.subject,
    ),
    batchSubjectTemplate: cleanTemplateText(
      input.batchSubjectTemplate,
      DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.batchSubjectTemplate,
      TEXT_LIMITS.subject,
    ),
    bodyTemplate: cleanTemplateText(
      input.bodyTemplate,
      DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.bodyTemplate,
      TEXT_LIMITS.body,
    ),
    invoiceRequirements: cleanTemplateText(
      input.invoiceRequirements,
      DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.invoiceRequirements,
      TEXT_LIMITS.requirements,
    ),
    uploadUrl: cleanOptionalUrl(input.uploadUrl),
    signature: cleanTemplateText(
      input.signature,
      DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.signature,
      TEXT_LIMITS.signature,
    ),
    variables: LOGISTICS_INVOICE_NOTIFICATION_VARIABLES,
    recipientEmailOptions: LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS,
  };
}

export function serializeLogisticsInvoiceNotificationSetting(setting: SystemSettingLike) {
  return normalizeLogisticsInvoiceNotificationSettings(setting?.value || setting || {});
}

function logisticsSettingsFromNotificationTemplate(row: unknown = {}) {
  const template = serializeNotificationTemplate(row);
  const recipientConfig = isPlainRecord(template.recipientConfig) ? template.recipientConfig : {};
  const extraConfig = isPlainRecord(template.extraConfig) ? template.extraConfig : {};
  return normalizeLogisticsInvoiceNotificationSettings({
    autoSendOnApproval: template.enabled !== false && extraConfig.autoSendOnApproval !== false,
    recipientEmailFields: recipientConfig.recipientEmailFields,
    ccAdminEmails: template.ccAdminEmails,
    ccEmails: template.ccEmails,
    singleSubjectTemplate: template.subjectTemplate,
    batchSubjectTemplate: extraConfig.batchSubjectTemplate,
    bodyTemplate: template.bodyTemplate,
    invoiceRequirements: extraConfig.invoiceRequirements,
    uploadUrl: extraConfig.uploadUrl,
    signature: extraConfig.signature,
  });
}

export async function getLogisticsInvoiceNotificationSettings() {
  const template = await getNotificationTemplate(NOTIFICATION_TEMPLATE_TYPES.LOGISTICS_INVOICE_NOTICE);
  return logisticsSettingsFromNotificationTemplate(template);
}

export async function readLogisticsInvoiceNotificationSettings(actor: SettingsActor) {
  assertRead(actor, "settings");
  return getLogisticsInvoiceNotificationSettings();
}

export async function saveLogisticsInvoiceNotificationSettings(
  request: AuditRequestLike,
  actor: SettingsActor,
  input: unknown = {},
) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const value = data.resetToDefault === true
    ? normalizeLogisticsInvoiceNotificationSettings(DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS)
    : normalizeLogisticsInvoiceNotificationSettings(data);
  const saved = await saveNotificationCenterTemplate(request, actor, {
    type: NOTIFICATION_TEMPLATE_TYPES.LOGISTICS_INVOICE_NOTICE,
    enabled: value.autoSendOnApproval,
    subjectTemplate: value.singleSubjectTemplate,
    bodyTemplate: value.bodyTemplate,
    ccEmails: value.ccEmails,
    ccAdminEmails: value.ccAdminEmails,
    recipientConfig: { recipientEmailFields: value.recipientEmailFields },
    extraConfig: {
      autoSendOnApproval: value.autoSendOnApproval,
      batchSubjectTemplate: value.batchSubjectTemplate,
      invoiceRequirements: value.invoiceRequirements,
      uploadUrl: value.uploadUrl,
      signature: value.signature,
      recipientEmailOptions: LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS,
    },
  });
  await runNonCriticalTask("物流费用通知模板兼容设置写入", () => prisma.systemSetting.upsert({
    where: { key: LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY },
    update: { value },
    create: { key: LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY, value },
  }));
  await runNonCriticalTask("物流费用通知模板操作日志写入", () => (
    writeAudit(
      request,
      actor,
      "更新物流费用通知模板",
      "system_settings",
      LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY,
      null,
      saved,
    )
  ));
  return logisticsSettingsFromNotificationTemplate(saved);
}

export async function logisticsInvoiceNotificationAdminEmails() {
  const users = await prisma.user.findMany({
    where: { role: "管理员", approvalStatus: "APPROVED", isActive: true },
    select: { email: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return users
    .map((user) => normalizeEmail(user.email))
    .filter((email) => email && validEmail(email))
    .filter((email, index, arr) => arr.indexOf(email) === index);
}

export async function logisticsInvoiceNotificationCcEmails(
  settings: unknown = {},
  recipientEmails: unknown[] = [],
) {
  const normalizedSettings = normalizeLogisticsInvoiceNotificationSettings(settings);
  const recipients = new Set(parseEmailList(recipientEmails));
  const configured = parseEmailList(normalizedSettings.ccEmails || []);
  const admins = normalizedSettings.ccAdminEmails
    ? await logisticsInvoiceNotificationAdminEmails()
    : [];
  return [...configured, ...admins]
    .map((email) => normalizeEmail(email))
    .filter((email) => email && validEmail(email) && !recipients.has(email))
    .filter((email, index, arr) => arr.indexOf(email) === index);
}
