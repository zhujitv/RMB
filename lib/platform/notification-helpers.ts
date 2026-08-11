import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS,
  DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS,
  LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY,
  LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS,
} from "./shared-constants";
import {
  codedError,
  isPlainRecord,
  nonEmpty,
  normalizeEmail,
  parseEmailList,
  requireValidEmailList,
  validEmail,
} from "./shared-base-utils";
import {
  TEXT_LIMITS,
  type JsonRecord,
  type NotificationAttachment,
  type NotificationTypeDefinition,
  logisticsEmailBodyIsChinese,
  NOTIFICATION_TYPE_DEFINITIONS,
  NOTIFICATION_TYPES,
} from "./notification-definitions";

export { notificationMailConfig, resendAttachmentPayload, sendResendEmail } from "./notification-email-transport";

export function definitionByType(type: unknown) {
  const normalizedType = nonEmpty(type).toUpperCase();
  return NOTIFICATION_TYPE_DEFINITIONS.find((item) => item.type === normalizedType) || null;
}

export function cleanTemplateText(value: unknown, fallback = "", limit = 1000) {
  if (value === undefined || value === null) return fallback;
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

export function applyTemplate(template = "", variables: JsonRecord = {}) {
  return String(template || "").replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] ?? "") : match
  ));
}

export function templateValue(value: unknown, fallback = "-") {
  return nonEmpty(value) || fallback;
}

export function attachmentMetadata(attachments: NotificationAttachment[] = []) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType || "",
    size: Buffer.isBuffer(attachment.content) ? attachment.content.byteLength : Buffer.byteLength(String(attachment.content || "")),
  }));
}

export function uniqueEmails(values: unknown[] = []) {
  return values
    .flatMap((value) => parseEmailList(value))
    .map((email) => normalizeEmail(email))
    .filter((email) => email && validEmail(email))
    .filter((email, index, arr) => arr.indexOf(email) === index);
}

export function bodyPreview(body: unknown) {
  return String(body || "").slice(0, 2000);
}

export function persistedNotificationBody(template: { securitySensitive?: boolean | null }, body: string) {
  return template.securitySensitive ? "[安全敏感邮件正文已隐藏]" : body;
}

export function persistedNotificationContext(
  template: { securitySensitive?: boolean | null },
  context: JsonRecord = {},
  variables: JsonRecord = {},
) {
  if (template.securitySensitive) return { ...context, variablesRedacted: true };
  return { ...context, variables };
}

export function publicSendError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, TEXT_LIMITS.error) : "邮件发送失败";
}

export function jsonOrNull(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return value as Prisma.InputJsonValue;
}

export function defaultTemplateData(definition: NotificationTypeDefinition, overrides: Partial<NotificationTypeDefinition> = {}) {
  return {
    type: definition.type,
    name: definition.name,
    module: definition.module,
    description: cleanTemplateText(definition.description, "", TEXT_LIMITS.description),
    enabled: overrides.defaultEnabled ?? definition.defaultEnabled ?? true,
    editable: definition.editable,
    supportsAttachments: definition.supportsAttachments,
    securitySensitive: Boolean(definition.securitySensitive),
    subjectTemplate: cleanTemplateText(overrides.subjectTemplate ?? definition.subjectTemplate, definition.subjectTemplate, TEXT_LIMITS.subject),
    bodyTemplate: cleanTemplateText(overrides.bodyTemplate ?? definition.bodyTemplate, definition.bodyTemplate, TEXT_LIMITS.body),
    variables: jsonOrNull(definition.variables),
    recipientConfig: jsonOrNull(overrides.recipientConfig ?? definition.recipientConfig),
    ccEmails: jsonOrNull(overrides.ccEmails ?? definition.ccEmails ?? []),
    ccAdminEmails: Boolean(overrides.ccAdminEmails ?? definition.ccAdminEmails),
    extraConfig: jsonOrNull({ ...(definition.extraConfig || {}), ...(overrides.extraConfig || {}) }),
  };
}

export function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function templateMetadataSyncData(definition: NotificationTypeDefinition) {
  return {
    name: definition.name,
    module: definition.module,
    description: cleanTemplateText(definition.description, "", TEXT_LIMITS.description),
    editable: definition.editable,
    supportsAttachments: definition.supportsAttachments,
    securitySensitive: Boolean(definition.securitySensitive),
    variables: definition.variables,
  };
}

export function templateMetadataNeedsSync(existing: JsonRecord, definition: NotificationTypeDefinition) {
  const data = templateMetadataSyncData(definition);
  return (
    existing.name !== data.name
    || existing.module !== data.module
    || existing.description !== data.description
    || existing.editable !== data.editable
    || existing.supportsAttachments !== data.supportsAttachments
    || existing.securitySensitive !== data.securitySensitive
    || !jsonEqual(existing.variables, data.variables)
  );
}

const LEGACY_LOGISTICS_INVOICE_SUBJECT = "物流费用已审核通过，请开票并上传发票 - {orderNo}/{blNo}";
const LEGACY_LOGISTICS_INVOICE_BATCH_SUBJECT = "待开票物流费用清单（{billCount} 票）";
const LEGACY_LOGISTICS_INVOICE_RECIPIENT_FIELDS = ["operatorUsers.email", "contactEmail", "email", "financeEmail"];

function isLegacyLogisticsTemplateFingerprint(subject: unknown, recipientFields: unknown, batchSubject: unknown) {
  return subject === LEGACY_LOGISTICS_INVOICE_SUBJECT
    && jsonEqual(recipientFields, LEGACY_LOGISTICS_INVOICE_RECIPIENT_FIELDS)
    && batchSubject === LEGACY_LOGISTICS_INVOICE_BATCH_SUBJECT;
}

export async function legacyLogisticsTemplateOverrides(definition: NotificationTypeDefinition) {
  if (definition.type !== NOTIFICATION_TYPES.LOGISTICS_INVOICE_NOTICE) return {};
  const setting = await prisma.systemSetting.findUnique({ where: { key: LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY } }).catch(() => null);
  const value = isPlainRecord(setting?.value) ? setting.value : {};
  const subjectTemplate = cleanTemplateText(value.singleSubjectTemplate, definition.subjectTemplate, TEXT_LIMITS.subject);
  const recipientEmailFields = Array.isArray(value.recipientEmailFields) && value.recipientEmailFields.length
    ? value.recipientEmailFields
    : DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS;
  const batchSubjectTemplate = cleanTemplateText(
    value.batchSubjectTemplate,
    DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.batchSubjectTemplate,
    TEXT_LIMITS.subject,
  );
  const usesLegacyDefaults = isLegacyLogisticsTemplateFingerprint(subjectTemplate, recipientEmailFields, batchSubjectTemplate);
  return {
    defaultEnabled: value.autoSendOnApproval !== false,
    subjectTemplate: usesLegacyDefaults ? definition.subjectTemplate : subjectTemplate,
    bodyTemplate: cleanTemplateText(value.bodyTemplate, definition.bodyTemplate, TEXT_LIMITS.body),
    recipientConfig: {
      recipientEmailFields: usesLegacyDefaults ? DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS : recipientEmailFields,
    },
    ccEmails: requireValidEmailList(value.ccEmails || [], "通知抄送邮箱"),
    ccAdminEmails: usesLegacyDefaults
      ? DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.ccAdminEmails
      : typeof value.ccAdminEmails === "boolean"
      ? value.ccAdminEmails
      : DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.ccAdminEmails,
    extraConfig: {
      autoSendOnApproval: value.autoSendOnApproval !== false,
      batchSubjectTemplate: usesLegacyDefaults
        ? DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.batchSubjectTemplate
        : batchSubjectTemplate,
      invoiceRequirements: cleanTemplateText(value.invoiceRequirements, DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.invoiceRequirements, 4000),
      uploadUrl: cleanTemplateText(value.uploadUrl, "", 300),
      signature: cleanTemplateText(value.signature, DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.signature, 180),
      recipientEmailOptions: LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS,
    },
  };
}

function legacyLogisticsTemplateSyncData(existing: JsonRecord, definition: NotificationTypeDefinition) {
  if (definition.type !== NOTIFICATION_TYPES.LOGISTICS_INVOICE_NOTICE) return {};
  const update: JsonRecord = {};
  const recipientConfig = isPlainRecord(existing.recipientConfig) ? existing.recipientConfig : {};
  const extraConfig = isPlainRecord(existing.extraConfig) ? existing.extraConfig : {};
  if (!isLegacyLogisticsTemplateFingerprint(
    existing.subjectTemplate,
    recipientConfig.recipientEmailFields,
    extraConfig.batchSubjectTemplate,
  )) return update;
  update.subjectTemplate = definition.subjectTemplate;
  update.recipientConfig = jsonOrNull({ recipientEmailFields: DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS });
  update.ccAdminEmails = DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.ccAdminEmails;
  update.extraConfig = jsonOrNull({
    ...extraConfig,
    batchSubjectTemplate: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.batchSubjectTemplate,
  });
  return update;
}

function legacyFreightowerTemplateSyncData(existing: JsonRecord, definition: NotificationTypeDefinition) {
  if (definition.type !== NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE) return {};
  const update: JsonRecord = {};
  // The legacy tracking template combined Chinese and English in one long plain-text
  // message. Tracking notifications now have separate internal/customer templates.
  if (/Shipment Tracking Update/i.test(String(existing.subjectTemplate || ""))) {
    update.subjectTemplate = definition.subjectTemplate;
  }
  if (!logisticsEmailBodyIsChinese(existing.bodyTemplate)
    || /Shipment Information|Container Rollover Alert/i.test(String(existing.bodyTemplate || ""))) {
    update.bodyTemplate = definition.bodyTemplate;
  }
  return update;
}

export async function ensureNotificationTemplate(type: unknown) {
  const definition = definitionByType(type);
  if (!definition) throw codedError("未知邮件通知类型。", 400, "NOTIFICATION_TYPE_INVALID");
  const existing = await prisma.notificationTemplate.findUnique({ where: { type: definition.type } });
  if (existing) {
    const existingRecord = existing as unknown as JsonRecord;
    const metadata: JsonRecord = templateMetadataNeedsSync(existingRecord, definition) ? templateMetadataSyncData(definition) : {};
    const legacySync = {
      ...legacyLogisticsTemplateSyncData(existingRecord, definition),
      ...legacyFreightowerTemplateSyncData(existingRecord, definition),
    };
    if (!Object.keys(metadata).length && !Object.keys(legacySync).length) return existing;
    return prisma.notificationTemplate.update({
      where: { id: existing.id },
      data: {
        ...metadata,
        ...legacySync,
        ...(Object.prototype.hasOwnProperty.call(metadata, "variables")
          ? { variables: jsonOrNull(metadata.variables) }
          : {}),
      },
    });
  }
  const overrides = await legacyLogisticsTemplateOverrides(definition);
  return prisma.notificationTemplate.create({ data: defaultTemplateData(definition, overrides) });
}

export async function enabledAdminEmails() {
  const users = await prisma.user.findMany({
    where: { role: "管理员", approvalStatus: "APPROVED", isActive: true },
    select: { email: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return uniqueEmails(users.map((user) => user.email));
}
