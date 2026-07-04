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
  NOTIFICATION_TYPE_DEFINITIONS,
  NOTIFICATION_TYPES,
} from "./notification-definitions";

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

export function notificationMailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || process.env.MAIL_FROM;
  const endpoint = process.env.RESEND_EMAIL_ENDPOINT || "https://api.resend.com/emails";
  if (!apiKey || !from) {
    throw codedError("Resend 邮件服务未配置，未发送。", 500, "MAIL_SERVICE_NOT_CONFIGURED");
  }
  return { apiKey, from, endpoint };
}

export function resendAttachmentPayload(attachments: NotificationAttachment[] = []) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    content: Buffer.isBuffer(attachment.content)
      ? attachment.content.toString("base64")
      : Buffer.from(String(attachment.content || "")).toString("base64"),
  }));
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

export async function legacyLogisticsTemplateOverrides(definition: NotificationTypeDefinition) {
  if (definition.type !== NOTIFICATION_TYPES.LOGISTICS_INVOICE_NOTICE) return {};
  const setting = await prisma.systemSetting.findUnique({ where: { key: LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY } }).catch(() => null);
  const value = isPlainRecord(setting?.value) ? setting.value : {};
  return {
    defaultEnabled: value.autoSendOnApproval !== false,
    subjectTemplate: cleanTemplateText(value.singleSubjectTemplate, definition.subjectTemplate, TEXT_LIMITS.subject),
    bodyTemplate: cleanTemplateText(value.bodyTemplate, definition.bodyTemplate, TEXT_LIMITS.body),
    recipientConfig: {
      recipientEmailFields: Array.isArray(value.recipientEmailFields) && value.recipientEmailFields.length
        ? value.recipientEmailFields
        : DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS,
    },
    ccEmails: requireValidEmailList(value.ccEmails || [], "通知抄送邮箱"),
    ccAdminEmails: value.ccAdminEmails !== false,
    extraConfig: {
      autoSendOnApproval: value.autoSendOnApproval !== false,
      batchSubjectTemplate: cleanTemplateText(value.batchSubjectTemplate, DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.batchSubjectTemplate, TEXT_LIMITS.subject),
      invoiceRequirements: cleanTemplateText(value.invoiceRequirements, DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.invoiceRequirements, 4000),
      uploadUrl: cleanTemplateText(value.uploadUrl, "", 300),
      signature: cleanTemplateText(value.signature, DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.signature, 180),
      recipientEmailOptions: LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS,
    },
  };
}

export async function ensureNotificationTemplate(type: unknown) {
  const definition = definitionByType(type);
  if (!definition) throw codedError("未知邮件通知类型。", 400, "NOTIFICATION_TYPE_INVALID");
  const existing = await prisma.notificationTemplate.findUnique({ where: { type: definition.type } });
  if (existing) {
    if (!templateMetadataNeedsSync(existing as unknown as JsonRecord, definition)) return existing;
    const metadata = templateMetadataSyncData(definition);
    return prisma.notificationTemplate.update({
      where: { id: existing.id },
      data: {
        ...metadata,
        variables: jsonOrNull(metadata.variables),
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

export async function sendResendEmail({
  recipientEmails,
  ccEmails,
  subject,
  body,
  attachments = [],
  idempotencyKey,
}: {
  recipientEmails: string[];
  ccEmails: string[];
  subject: string;
  body: string;
  attachments?: NotificationAttachment[];
  idempotencyKey?: string | null;
}) {
  const { apiKey, from, endpoint } = notificationMailConfig();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to: recipientEmails,
      cc: ccEmails.length ? ccEmails : undefined,
      subject,
      text: body,
      attachments: attachments.length ? resendAttachmentPayload(attachments) : undefined,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as unknown;
    const errorData = isPlainRecord(data) ? data : {};
    const nestedError = isPlainRecord(errorData.error) ? errorData.error : {};
    const reason = errorData.message || nestedError.message || errorData.error || `HTTP ${response.status}`;
    throw codedError(`Resend 邮件发送失败：${reason}`, response.status, "RESEND_SEND_FAILED");
  }
}
