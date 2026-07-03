import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS,
  DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS,
  LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY,
  LOGISTICS_INVOICE_NOTIFICATION_VARIABLES,
  LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS,
  runNonCriticalTask,
} from "./shared-constants";
import {
  assertJsonObject,
  codedError,
  isPlainRecord,
  nonEmpty,
  normalizeEmail,
  parseEmailList,
  requireValidEmailList,
  validEmail,
} from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";

type ActorLike = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type JsonRecord = Record<string, unknown>;
type NotificationAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};
type NotificationVariableDefinition = {
  key: string;
  label: string;
  required?: boolean;
};
type NotificationTypeDefinition = {
  type: string;
  name: string;
  module: string;
  description: string;
  editable: boolean;
  supportsAttachments: boolean;
  securitySensitive?: boolean;
  defaultEnabled?: boolean;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: NotificationVariableDefinition[];
  recipientConfig?: JsonRecord;
  ccEmails?: string[];
  ccAdminEmails?: boolean;
  extraConfig?: JsonRecord;
};
type SendNotificationEmailInput = {
  type: string;
  recipientEmails: unknown;
  ccEmails?: unknown;
  variables?: JsonRecord;
  attachments?: NotificationAttachment[];
  idempotencyKey?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  relatedOrderId?: string;
  context?: JsonRecord;
  subjectOverride?: string;
  bodyOverride?: string;
  ignoreTemplateCc?: boolean;
  ignoreTemplateEnabled?: boolean;
};

const TEXT_LIMITS = {
  subject: 220,
  body: 16000,
  description: 600,
  error: 1000,
};

const NOTIFICATION_TYPES = {
  USER_EMAIL_VERIFICATION: "USER_EMAIL_VERIFICATION",
  SHIPPING_DOCUMENTS: "SHIPPING_DOCUMENTS",
  SHIPPING_DOCUMENTS_ZH: "SHIPPING_DOCUMENTS_ZH",
  SHIPPING_DOCUMENTS_RU: "SHIPPING_DOCUMENTS_RU",
  LOGISTICS_INVOICE_NOTICE: "LOGISTICS_INVOICE_NOTICE",
  SUPPLIER_DOCUMENT_REQUEST: "SUPPLIER_DOCUMENT_REQUEST",
  WORKBENCH_TODO_OVERDUE: "WORKBENCH_TODO_OVERDUE",
} as const;

const COMMON_SIGNATURE = "NEXTWOOD 供应链协同平台";

const NOTIFICATION_TYPE_DEFINITIONS: NotificationTypeDefinition[] = [
  {
    type: NOTIFICATION_TYPES.USER_EMAIL_VERIFICATION,
    name: "账号邮箱验证",
    module: "账号安全",
    description: "用户自助注册后发送邮箱验证链接。模板只允许查看，验证链接变量由系统安全生成。",
    editable: false,
    supportsAttachments: false,
    securitySensitive: true,
    subjectTemplate: "NEXTWOOD 供应链协同平台邮箱验证",
    bodyTemplate: [
      "{name}：",
      "",
      "请点击以下链接完成邮箱验证。",
      "",
      "{verifyUrl}",
      "",
      "邮箱验证完成后，管理员审核通过后方可登录平台。",
      "",
      "如果您并未申请注册 NEXTWOOD 供应链协同平台，请忽略本邮件。",
    ].join("\n"),
    variables: [
      { key: "name", label: "用户姓名" },
      { key: "verifyUrl", label: "邮箱验证链接", required: true },
    ],
  },
  {
    type: NOTIFICATION_TYPES.SHIPPING_DOCUMENTS,
    name: "清关资料通知",
    module: "客户沟通",
    description: "向客户发送商业发票、装箱单、报关单等清关资料附件。",
    editable: true,
    supportsAttachments: true,
    subjectTemplate: "Shipping Documents for Order {orderNo} / B/L {blNo}",
    bodyTemplate: [
      "Dear Customer,",
      "",
      "Please find attached the shipping documents for your customs clearance:",
      "",
      "{documentLines}",
      "",
      "This email also serves as the shipment notification.",
      "",
      "Best regards,",
      "NEXTWOOD",
    ].join("\n"),
    variables: [
      { key: "customerName", label: "客户名称" },
      { key: "orderNo", label: "订单号", required: true },
      { key: "blNo", label: "提单号" },
      { key: "documentLines", label: "附件资料清单" },
      { key: "customsDeclarationDate", label: "申报日期" },
    ],
  },
  {
    type: NOTIFICATION_TYPES.SHIPPING_DOCUMENTS_ZH,
    name: "清关资料通知（中文）",
    module: "客户沟通",
    description: "中文客户清关资料邮件模板，附件逻辑与清关资料通知一致。",
    editable: true,
    supportsAttachments: true,
    subjectTemplate: "订单 {orderNo} / 提单 {blNo} 清关资料",
    bodyTemplate: [
      "{customerName}：",
      "",
      "您好！",
      "",
      "请查收本邮件附件中的清关资料：",
      "",
      "{documentLines}",
      "",
      "提单号：{blNo}",
      "申报日期：{customsDeclarationDate}",
      "",
      "如需补充资料，请及时与我们联系。",
      "",
      "NEXTWOOD",
    ].join("\n"),
    variables: [
      { key: "customerName", label: "客户名称" },
      { key: "orderNo", label: "订单号", required: true },
      { key: "blNo", label: "提单号" },
      { key: "documentLines", label: "附件资料清单" },
      { key: "customsDeclarationDate", label: "申报日期" },
    ],
  },
  {
    type: NOTIFICATION_TYPES.SHIPPING_DOCUMENTS_RU,
    name: "清关资料通知（俄语）",
    module: "客户沟通",
    description: "俄罗斯客户清关资料邮件模板，附件逻辑与清关资料通知一致。",
    editable: true,
    supportsAttachments: true,
    subjectTemplate: "Отгрузочные документы по заказу {orderNo} / коносамент {blNo}",
    bodyTemplate: [
      "Здравствуйте!",
      "",
      "Во вложении направляем отгрузочные документы по заказу {orderNo}.",
      "",
      "Документы во вложении:",
      "{documentLines}",
      "",
      "Номер коносамента: {blNo}",
      "Дата декларации: {customsDeclarationDate}",
      "",
      "Пожалуйста, проверьте документы и сообщите нам, если потребуется дополнительная информация.",
      "",
      "С уважением,",
      "Zhejiang Lainuo Building Materials Co., Ltd.",
    ].join("\n"),
    variables: [
      { key: "customerName", label: "客户名称" },
      { key: "orderNo", label: "订单号", required: true },
      { key: "blNo", label: "提单号" },
      { key: "documentLines", label: "附件资料清单" },
      { key: "customsDeclarationDate", label: "申报日期" },
    ],
  },
  {
    type: NOTIFICATION_TYPES.LOGISTICS_INVOICE_NOTICE,
    name: "物流费用开票通知",
    module: "物流费用",
    description: "物流费用审核通过后，通知物流供应商开票并上传发票。",
    editable: true,
    supportsAttachments: false,
    subjectTemplate: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.singleSubjectTemplate,
    bodyTemplate: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.bodyTemplate,
    variables: LOGISTICS_INVOICE_NOTIFICATION_VARIABLES.map((key) => ({ key, label: key })),
    recipientConfig: { recipientEmailFields: DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS },
    ccEmails: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.ccEmails,
    ccAdminEmails: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.ccAdminEmails,
    extraConfig: {
      autoSendOnApproval: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.autoSendOnApproval,
      batchSubjectTemplate: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.batchSubjectTemplate,
      invoiceRequirements: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.invoiceRequirements,
      uploadUrl: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.uploadUrl,
      signature: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.signature,
      recipientEmailOptions: LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS,
    },
  },
  {
    type: NOTIFICATION_TYPES.SUPPLIER_DOCUMENT_REQUEST,
    name: "产品供应商资料回传通知",
    module: "资料回传",
    description: "通知产品供应商回传合同、增值税发票等资料，可附合同样本和汇款水单。",
    editable: true,
    supportsAttachments: true,
    subjectTemplate: "NEXTWOOD 产品供应商资料回传通知：{orderNo}",
    bodyTemplate: [
      "尊敬的 {supplierName}：",
      "",
      "您好！",
      "",
      "您有一份订单资料需要回传，请按以下要求及时办理。",
      "",
      "订单信息",
      "",
      "* 订单号： {orderNo}",
      "* 需回传资料：",
      "{requiredDocumentLines}",
      "* 截止日期： {dueDate}",
      "",
      "操作要求",
      "",
      "{sampleInstruction}",
      "2. 请严格按照附件中的合同内容开具工厂增值税发票，确保发票内容与合同内容一致。",
      "3. 登录 {companyName}供应链协同平台，进入 「资料回传」 模块上传资料。",
      "4. 所有上传文件仅支持 PDF 格式。",
      "{paymentVoucherInstruction}",
      "{messageBlock}",
      "",
      "感谢您的配合！",
      "",
      "{companyName}",
      "本邮件由系统自动发送，请勿直接回复。",
    ].join("\n"),
    variables: [
      { key: "supplierName", label: "供应商名称", required: true },
      { key: "orderNo", label: "订单号", required: true },
      { key: "requiredDocumentLines", label: "需回传资料清单" },
      { key: "dueDate", label: "截止日期" },
      { key: "sampleInstruction", label: "合同样本说明" },
      { key: "paymentVoucherInstruction", label: "汇款水单说明" },
      { key: "messageBlock", label: "补充说明" },
      { key: "companyName", label: "公司名称" },
    ],
  },
  {
    type: NOTIFICATION_TYPES.WORKBENCH_TODO_OVERDUE,
    name: "Work Center 逾期待办提醒",
    module: "工作台",
    description: "每天定时提醒负责人处理已逾期超过 5 天的待办事项。",
    editable: true,
    supportsAttachments: false,
    subjectTemplate: "【NEXTWOOD ERP】待办事项已逾期超过 5 天",
    bodyTemplate: [
      "您好，",
      "",
      "以下待办事项已逾期超过 5 天，请尽快处理。",
      "",
      "- 待办事项：{todoTitle}",
      "- 来源模块：{module}",
      "- 关联订单号：{orderNo}",
      "- 客户简称：{customerShortName}",
      "- 截止时间：{dueAt}",
      "- 已逾期天数：{overdueDays}",
      "",
      "处理入口：{actionUrl}",
      "",
      COMMON_SIGNATURE,
    ].join("\n"),
    variables: [
      { key: "ownerName", label: "负责人" },
      { key: "todoTitle", label: "待办标题", required: true },
      { key: "module", label: "来源模块" },
      { key: "orderNo", label: "关联订单号" },
      { key: "customerShortName", label: "客户简称" },
      { key: "dueAt", label: "截止时间" },
      { key: "overdueDays", label: "逾期天数" },
      { key: "actionUrl", label: "处理入口" },
    ],
  },
];

function definitionByType(type: unknown) {
  const normalizedType = nonEmpty(type).toUpperCase();
  return NOTIFICATION_TYPE_DEFINITIONS.find((item) => item.type === normalizedType) || null;
}

function cleanTemplateText(value: unknown, fallback = "", limit = 1000) {
  if (value === undefined || value === null) return fallback;
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

function applyTemplate(template = "", variables: JsonRecord = {}) {
  return String(template || "").replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] ?? "") : match
  ));
}

function templateValue(value: unknown, fallback = "-") {
  return nonEmpty(value) || fallback;
}

function notificationMailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || process.env.MAIL_FROM;
  const endpoint = process.env.RESEND_EMAIL_ENDPOINT || "https://api.resend.com/emails";
  if (!apiKey || !from) {
    throw codedError("Resend 邮件服务未配置，未发送。", 500, "MAIL_SERVICE_NOT_CONFIGURED");
  }
  return { apiKey, from, endpoint };
}

function resendAttachmentPayload(attachments: NotificationAttachment[] = []) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    content: Buffer.isBuffer(attachment.content)
      ? attachment.content.toString("base64")
      : Buffer.from(String(attachment.content || "")).toString("base64"),
  }));
}

function attachmentMetadata(attachments: NotificationAttachment[] = []) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType || "",
    size: Buffer.isBuffer(attachment.content) ? attachment.content.byteLength : Buffer.byteLength(String(attachment.content || "")),
  }));
}

function uniqueEmails(values: unknown[] = []) {
  return values
    .flatMap((value) => parseEmailList(value))
    .map((email) => normalizeEmail(email))
    .filter((email) => email && validEmail(email))
    .filter((email, index, arr) => arr.indexOf(email) === index);
}

function bodyPreview(body: unknown) {
  return String(body || "").slice(0, 2000);
}

function persistedNotificationBody(template: { securitySensitive?: boolean | null }, body: string) {
  return template.securitySensitive ? "[安全敏感邮件正文已隐藏]" : body;
}

function persistedNotificationContext(
  template: { securitySensitive?: boolean | null },
  context: JsonRecord = {},
  variables: JsonRecord = {},
) {
  if (template.securitySensitive) return { ...context, variablesRedacted: true };
  return { ...context, variables };
}

function publicSendError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, TEXT_LIMITS.error) : "邮件发送失败";
}

function jsonOrNull(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return value as Prisma.InputJsonValue;
}

function defaultTemplateData(definition: NotificationTypeDefinition, overrides: Partial<NotificationTypeDefinition> = {}) {
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

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function templateMetadataSyncData(definition: NotificationTypeDefinition) {
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

function templateMetadataNeedsSync(existing: JsonRecord, definition: NotificationTypeDefinition) {
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

async function legacyLogisticsTemplateOverrides(definition: NotificationTypeDefinition) {
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

async function ensureNotificationTemplate(type: unknown) {
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

async function enabledAdminEmails() {
  const users = await prisma.user.findMany({
    where: { role: "管理员", approvalStatus: "APPROVED", isActive: true },
    select: { email: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return uniqueEmails(users.map((user) => user.email));
}

async function sendResendEmail({
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
  const recipientConfig = isPlainRecord(data.recipientConfig)
    ? data.recipientConfig
    : current.recipientConfig;
  const extraConfig = isPlainRecord(data.extraConfig)
    ? data.extraConfig
    : current.extraConfig;
  const next = await prisma.notificationTemplate.update({
    where: { type },
    data: {
      enabled: definition.securitySensitive ? true : data.enabled !== false,
      subjectTemplate: editable
        ? cleanTemplateText(data.subjectTemplate, String(current.subjectTemplate || ""), TEXT_LIMITS.subject)
        : String(current.subjectTemplate || ""),
      bodyTemplate: editable
        ? cleanTemplateText(data.bodyTemplate, String(current.bodyTemplate || ""), TEXT_LIMITS.body)
        : String(current.bodyTemplate || ""),
      ccEmails: jsonOrNull(requireValidEmailList(data.ccEmails || [], "通知抄送邮箱")),
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

export async function sendNotificationEmail(input: SendNotificationEmailInput) {
  const template = await ensureNotificationTemplate(input.type);
  if (template.enabled === false && input.ignoreTemplateEnabled !== true) {
    return { sent: false, skipped: true, outboxId: "", error: "通知模板已停用" };
  }
  const recipientEmails = uniqueEmails([input.recipientEmails]);
  if (!recipientEmails.length) {
    throw codedError("邮件收件人不能为空或格式错误。", 400, "NOTIFICATION_RECIPIENT_REQUIRED");
  }
  const templateCc = input.ignoreTemplateCc ? [] : uniqueEmails([template.ccEmails || []]);
  const directCc = uniqueEmails([input.ccEmails || []]);
  const adminCc = !input.ignoreTemplateCc && template.ccAdminEmails ? await enabledAdminEmails() : [];
  const recipientSet = new Set(recipientEmails);
  const ccEmails = uniqueEmails([...directCc, ...templateCc, ...adminCc])
    .filter((email) => !recipientSet.has(email));
  const variables = input.variables || {};
  const subject = cleanTemplateText(input.subjectOverride, applyTemplate(template.subjectTemplate, variables), TEXT_LIMITS.subject);
  const body = cleanTemplateText(input.bodyOverride, applyTemplate(template.bodyTemplate, variables), TEXT_LIMITS.body);
  const storedBody = persistedNotificationBody(template, body);
  const storedContext = persistedNotificationContext(template, input.context || {}, variables);
  const idempotencyKey = nonEmpty(input.idempotencyKey);
  const existing = idempotencyKey
    ? await prisma.notificationOutbox.findUnique({ where: { idempotencyKey } })
    : null;
  if (existing?.status === "sent") {
    return { sent: true, skipped: true, outboxId: existing.id, error: "" };
  }
  const attachments = input.attachments || [];
  const outbox = existing
    ? await prisma.notificationOutbox.update({
        where: { id: existing.id },
        data: {
          status: "pending",
          templateId: template.id,
          recipientEmails,
          ccEmails,
          subject,
          body: storedBody,
          attachments: jsonOrNull(attachmentMetadata(attachments)),
          context: jsonOrNull(storedContext),
          relatedEntityType: nonEmpty(input.relatedEntityType) || null,
          relatedEntityId: nonEmpty(input.relatedEntityId) || null,
          relatedOrderId: nonEmpty(input.relatedOrderId) || null,
          lastError: null,
          failedAt: null,
        },
      })
    : await prisma.notificationOutbox.create({
        data: {
          type: template.type,
          templateId: template.id,
          idempotencyKey: idempotencyKey || null,
          status: "pending",
          recipientEmails,
          ccEmails,
          subject,
          body: storedBody,
          attachments: jsonOrNull(attachmentMetadata(attachments)),
          context: jsonOrNull(storedContext),
          relatedEntityType: nonEmpty(input.relatedEntityType) || null,
          relatedEntityId: nonEmpty(input.relatedEntityId) || null,
          relatedOrderId: nonEmpty(input.relatedOrderId) || null,
        },
      });
  try {
    await prisma.notificationOutbox.update({
      where: { id: outbox.id },
      data: { status: "sending", attempts: { increment: 1 }, lastError: null },
    });
    await sendResendEmail({
      recipientEmails,
      ccEmails,
      subject,
      body,
      attachments,
      idempotencyKey: idempotencyKey || outbox.id,
    });
    const sentAt = new Date();
    await prisma.$transaction([
      prisma.notificationOutbox.update({
        where: { id: outbox.id },
        data: { status: "sent", sentAt, failedAt: null, lastError: null },
      }),
      prisma.notificationDeliveryLog.create({
        data: {
          outboxId: outbox.id,
          templateId: template.id,
          type: template.type,
          status: "sent",
          recipientEmails,
          ccEmails,
          subject,
          bodyPreview: bodyPreview(storedBody),
          relatedEntityType: nonEmpty(input.relatedEntityType) || null,
          relatedEntityId: nonEmpty(input.relatedEntityId) || null,
          relatedOrderId: nonEmpty(input.relatedOrderId) || null,
          provider: "resend",
          sentAt,
        },
      }),
    ]);
    return { sent: true, skipped: false, outboxId: outbox.id, error: "" };
  } catch (error: unknown) {
    const message = publicSendError(error);
    await prisma.$transaction([
      prisma.notificationOutbox.update({
        where: { id: outbox.id },
        data: { status: "failed", failedAt: new Date(), lastError: message },
      }),
      prisma.notificationDeliveryLog.create({
        data: {
          outboxId: outbox.id,
          templateId: template.id,
          type: template.type,
          status: "failed",
          recipientEmails,
          ccEmails,
          subject,
          bodyPreview: bodyPreview(storedBody),
          relatedEntityType: nonEmpty(input.relatedEntityType) || null,
          relatedEntityId: nonEmpty(input.relatedEntityId) || null,
          relatedOrderId: nonEmpty(input.relatedOrderId) || null,
          errorMessage: message,
          provider: "resend",
        },
      }),
    ]);
    throw error;
  }
}

export async function sendNotificationTemplateTest(request: AuditRequestLike, actor: ActorLike, input: unknown = {}) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const type = nonEmpty(data.type).toUpperCase();
  const definition = definitionByType(type);
  if (!definition) throw codedError("未知邮件通知类型。", 400, "NOTIFICATION_TYPE_INVALID");
  const template = await ensureNotificationTemplate(type);
  const actorEmail = normalizeEmail((actor as { email?: string | null } | null | undefined)?.email);
  const recipients = requireValidEmailList(data.recipientEmails || actorEmail, "测试收件邮箱");
  if (!recipients.length) throw codedError("当前用户邮箱为空，请填写测试收件邮箱。", 400, "TEST_EMAIL_REQUIRED");
  const sampleVariables = Object.fromEntries(definition.variables.map((item) => [item.key, sampleVariableValue(item.key)]));
  const editable = definition.editable && template.editable && !definition.securitySensitive;
  const subjectTemplate = editable
    ? cleanTemplateText(data.subjectTemplate, template.subjectTemplate, TEXT_LIMITS.subject)
    : template.subjectTemplate;
  const bodyTemplate = editable
    ? cleanTemplateText(data.bodyTemplate, template.bodyTemplate, TEXT_LIMITS.body)
    : template.bodyTemplate;
  const result = await sendNotificationEmail({
    type,
    recipientEmails: recipients,
    variables: sampleVariables,
    subjectOverride: applyTemplate(subjectTemplate, sampleVariables),
    bodyOverride: applyTemplate(bodyTemplate, sampleVariables),
    idempotencyKey: `notification-template-test-${type}-${Date.now()}`,
    relatedEntityType: "notification_templates",
    relatedEntityId: type,
    context: { test: true },
    ignoreTemplateCc: true,
    ignoreTemplateEnabled: true,
  });
  await runNonCriticalTask("邮件通知模板测试日志写入", () => (
    writeAudit(request, actor, "测试发送邮件通知模板", "notification_templates", type, null, result)
  ));
  return result;
}

function sampleVariableValue(key: string) {
  const samples: Record<string, string> = {
    name: "张三",
    verifyUrl: "https://www.nextwood.net/api/auth/verify-email?token=example",
    customerName: "ABC Customer",
    supplierName: "浙江示例供应商有限公司",
    orderNo: "PV252",
    blNo: "STSHVS76979",
    documentLines: "- Commercial Invoice\n- Packing List\n- Customs Declaration",
    customsDeclarationDate: "2026-07-01",
    billCount: "2",
    customerShortName: "ABC",
    containerSummary: "40HQ×2",
    amountCny: "CNY ¥12,000.00",
    expenseDetails: "1. 拖车费，数量 2，CNY 8,000.00",
    invoiceGroups: "拖车及其他费用合并发票：CNY ¥8,000.00",
    remark: "-",
    billRows: "1. 订单号：PV252\n   提单号：STSHVS76979\n   费用合计：CNY ¥12,000.00",
    invoiceRequirements: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.invoiceRequirements,
    uploadUrl: "https://www.nextwood.net",
    signature: COMMON_SIGNATURE,
    requiredDocumentLines: "    * 工厂采购合同\n    * 工厂增值税发票",
    dueDate: "2026-07-08",
    sampleInstruction: "1. 本邮件已附上预填好的 Excel 合同样本，请打印合同并加盖公司公章，扫描后回传。",
    paymentVoucherInstruction: "5. 已付款的汇款水单已随邮件附件发送，请核对后回传对应资料。",
    messageBlock: "补充说明\n\n请优先回传盖章合同。",
    companyName: "浙江莱诺",
    ownerName: "李四",
    todoTitle: "物流费用待审核",
    module: "物流费用",
    dueAt: "2026-07-01 23:59",
    overdueDays: "6",
    actionUrl: "https://www.nextwood.net/workbench",
  };
  return templateValue(samples[key], `{${key}}`);
}

export const NOTIFICATION_TEMPLATE_TYPES = NOTIFICATION_TYPES;
