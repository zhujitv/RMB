import { prisma } from "../prisma";
import { runNonCriticalTask } from "./shared-constants";
import { assertJsonObject, codedError, isPlainRecord, nonEmpty, requireValidEmailList } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import {
  TEXT_LIMITS,
  BILINGUAL_TRACKING_NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_DEFINITIONS,
  NOTIFICATION_TYPES,
  logisticsEmailBodyIsBilingual,
  logisticsEmailSubjectIsEnglish,
  type ActorLike,
  type AuditRequestLike,
  type JsonRecord,
} from "./notification-definitions";
import {
  applyTemplate,
  cleanTemplateText,
  definitionByType,
  ensureNotificationTemplate,
  jsonOrNull,
} from "./notification-helpers";

export function notificationTemplateTypeForShippingLanguage(language: unknown) {
  const normalized = String(language || "").toUpperCase();
  if (normalized === "RU") return NOTIFICATION_TYPES.SHIPPING_DOCUMENTS_RU;
  if (["ZH", "CN"].includes(normalized)) return NOTIFICATION_TYPES.SHIPPING_DOCUMENTS_ZH;
  return NOTIFICATION_TYPES.SHIPPING_DOCUMENTS;
}

export function notificationTypeDefinitions() {
  return NOTIFICATION_TYPE_DEFINITIONS.map((definition) => ({
    type: definition.type,
    name: definition.name,
    module: definition.module,
    description: definition.description,
    editable: definition.editable,
    supportsAttachments: definition.supportsAttachments,
    securitySensitive: Boolean(definition.securitySensitive),
    variables: definition.variables,
  }));
}

export async function getNotificationTemplate(type: unknown) {
  return ensureNotificationTemplate(type);
}

export function renderTemplateText(template: string, variables: JsonRecord = {}) {
  return applyTemplate(template, variables);
}

export async function renderNotificationTemplate(type: unknown, variables: JsonRecord = {}) {
  const template = await ensureNotificationTemplate(type);
  return {
    template,
    subject: applyTemplate(template.subjectTemplate, variables),
    body: applyTemplate(template.bodyTemplate, variables),
  };
}

export function serializeNotificationTemplate(row: unknown) {
  const template = isPlainRecord(row) ? row : {};
  return {
    id: template.id || "",
    type: template.type || "",
    name: template.name || "",
    module: template.module || "",
    description: template.description || "",
    enabled: template.enabled !== false,
    editable: template.editable !== false,
    supportsAttachments: Boolean(template.supportsAttachments),
    securitySensitive: Boolean(template.securitySensitive),
    subjectTemplate: template.subjectTemplate || "",
    bodyTemplate: template.bodyTemplate || "",
    variables: Array.isArray(template.variables) ? template.variables : [],
    recipientConfig: isPlainRecord(template.recipientConfig) ? template.recipientConfig : {},
    ccEmails: Array.isArray(template.ccEmails) ? template.ccEmails : [],
    ccAdminEmails: Boolean(template.ccAdminEmails),
    extraConfig: isPlainRecord(template.extraConfig) ? template.extraConfig : {},
    updatedAt: template.updatedAt || null,
  };
}

export function serializeNotificationDeliveryLog(row: unknown) {
  const log = isPlainRecord(row) ? row : {};
  const template = isPlainRecord(log.template) ? log.template : {};
  return {
    id: log.id || "",
    outboxId: log.outboxId || "",
    type: log.type || "",
    templateName: template.name || "",
    module: template.module || "",
    status: log.status || "",
    recipientEmails: Array.isArray(log.recipientEmails) ? log.recipientEmails : [],
    ccEmails: Array.isArray(log.ccEmails) ? log.ccEmails : [],
    subject: log.subject || "",
    bodyPreview: log.bodyPreview || "",
    relatedEntityType: log.relatedEntityType || "",
    relatedEntityId: log.relatedEntityId || "",
    relatedOrderId: log.relatedOrderId || "",
    errorMessage: log.errorMessage || "",
    provider: log.provider || "",
    sentAt: log.sentAt || null,
    createdAt: log.createdAt || null,
  };
}

export async function readNotificationCenterSettings(actor: ActorLike) {
  assertRead(actor, "settings");
  await Promise.all(NOTIFICATION_TYPE_DEFINITIONS.map((definition) => ensureNotificationTemplate(definition.type)));
  const [templates, logs] = await Promise.all([
    prisma.notificationTemplate.findMany({ orderBy: [{ module: "asc" }, { name: "asc" }], take: 100 }),
    prisma.notificationDeliveryLog.findMany({
      include: { template: { select: { name: true, module: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return {
    types: notificationTypeDefinitions(),
    templates: templates.map(serializeNotificationTemplate),
    logs: logs.map(serializeNotificationDeliveryLog),
  };
}

export async function saveNotificationCenterTemplate(request: AuditRequestLike, actor: ActorLike, input: unknown = {}) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const type = nonEmpty(data.type).toUpperCase();
  const definition = definitionByType(type);
  if (!definition) throw codedError("未知邮件通知类型。", 400, "NOTIFICATION_TYPE_INVALID");
  const before = await ensureNotificationTemplate(type);
  const current = serializeNotificationTemplate(before);
  const editable = definition.editable && current.editable;
  const recipientConfig = definition.securitySensitive
    ? (definition.recipientConfig || {})
    : isPlainRecord(data.recipientConfig)
    ? data.recipientConfig
    : current.recipientConfig;
  const extraConfig = definition.securitySensitive
    ? (definition.extraConfig || {})
    : isPlainRecord(data.extraConfig)
    ? data.extraConfig
    : current.extraConfig;
  const subjectTemplate = editable
    ? cleanTemplateText(data.subjectTemplate, String(current.subjectTemplate || ""), TEXT_LIMITS.subject)
    : String(current.subjectTemplate || "");
  const bodyTemplate = editable
    ? cleanTemplateText(data.bodyTemplate, String(current.bodyTemplate || ""), TEXT_LIMITS.body)
    : String(current.bodyTemplate || "");
  if (BILINGUAL_TRACKING_NOTIFICATION_TYPES.has(type)) {
    if (!logisticsEmailSubjectIsEnglish(subjectTemplate)) {
      throw codedError("物流通知邮件标题必须使用英文。", 400, "LOGISTICS_EMAIL_SUBJECT_ENGLISH_REQUIRED");
    }
    if (!logisticsEmailBodyIsBilingual(bodyTemplate)) {
      throw codedError("物流通知邮件正文必须同时包含英文和中文。", 400, "LOGISTICS_EMAIL_BODY_BILINGUAL_REQUIRED");
    }
  }
  const next = await prisma.notificationTemplate.update({
    where: { type },
    data: {
      enabled: definition.securitySensitive ? true : data.enabled !== false,
      subjectTemplate,
      bodyTemplate,
      ccEmails: jsonOrNull(definition.securitySensitive
        ? []
        : requireValidEmailList(data.ccEmails || [], "通知抄送邮箱")),
      ccAdminEmails: definition.securitySensitive ? false : data.ccAdminEmails === true,
      recipientConfig: jsonOrNull(recipientConfig),
      extraConfig: jsonOrNull(extraConfig),
    },
  });
  await runNonCriticalTask("邮件通知模板操作日志写入", () => (
    writeAudit(request, actor, "更新邮件通知模板", "notification_templates", next.id, before, next)
  ));
  return serializeNotificationTemplate(next);
}
