import * as customsDeclarationParser from "../customs-declaration-parser";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { readR2Object } from "../r2";
import {
  DEFAULT_SHIPPING_DOCUMENT_TYPES,
  SHIPPING_DOCUMENT_TYPE_CONFIG,
  SHIPPING_EMAIL_LANGUAGE_LABELS,
  assertRead,
  assertWrite,
  canWrite,
  codedError,
  customerFullName,
  customerShortName,
  dateToInput,
  includeOrderRelations,
  isPlainRecord,
  logServerError,
  nonEmpty,
  normalizeClearanceEmailLanguage,
  normalizeShippingDocumentTypes,
  parseEmailList,
  permissionError,
  requireValidEmailList,
  runNonCriticalTask,
  serializeOrder,
  standardFilenameForDocument,
  writeAudit,
} from "./shared";
import { orderAccessWhere } from "./order-access";
import {
  notificationTemplateTypeForShippingLanguage,
  renderNotificationTemplate,
  sendNotificationEmail,
} from "./notification-engine";

type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type ShippingCustomerLike = {
  country?: string | null;
  contactEmail?: string | null;
  shippingDocsEmails?: unknown;
  shippingDocsCcEmails?: unknown;
  autoSendDocumentTypes?: unknown;
  clearanceEmailLanguage?: string | null;
  enableAutoShippingDocsNotification?: boolean | null;
  shortName?: string | null;
  name?: string | null;
};
type ShippingDocumentLike = {
  id?: string;
  documentType?: string | null;
  uploadStatus?: string | null;
  deletedAt?: Date | string | null;
  mimeType?: string | null;
  uploadedAt?: Date | string | null;
  createdAt?: Date | string | null;
  storageKey?: string | null;
  originalFilename?: string | null;
  originalName?: string | null;
  fileName?: string | null;
};
type ShippingNotificationLike = {
  id?: string;
  sendMode?: string | null;
  sendStatus?: string | null;
  createdAt?: Date | string | null;
};
type ShippingOrderLike = {
  id?: string;
  customerId?: string | null;
  customer?: ShippingCustomerLike | null;
  documents?: ShippingDocumentLike[] | null;
  shippingDocumentNotifications?: ShippingNotificationLike[] | null;
  country?: string | null;
  blNo?: string | null;
  billOfLadingNo?: string | null;
  customsDeclarationDate?: Date | null;
  orderNo?: string | null;
  customerNameSnapshot?: string | null;
  customsDeclarationParseSource?: string | null;
  customsParseStatus?: string | null;
};
type ShippingBundleItem = {
  typeKey: string;
  label: string;
  emailLabel: string;
  documentType: string;
  document: ShippingDocumentLike | null;
};
type ShippingBundle = {
  documentTypes: string[];
  items: ShippingBundleItem[];
  documents: ShippingDocumentLike[];
  missing: ShippingBundleItem[];
};
type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};
type SendShippingDocumentsEmailInput = {
  recipientEmails: string[];
  ccEmails: string[];
  attachments: EmailAttachment[];
  subject: string;
  body: string;
  notificationId?: string | null;
};
type ManualShippingEmailInput = Record<string, unknown>;
type RenderedShippingEmail = {
  language: string;
  type: string;
  subject: string;
  body: string;
  variables: Record<string, unknown>;
};
type NotificationRecordOptions = {
  sentById?: string;
  documentTypes?: string[];
  emailLanguage?: string;
  emailSubject?: string;
  emailBody?: string;
};
type ShippingBundleItemWithDocument = ShippingBundleItem & {
  document: ShippingDocumentLike & { storageKey: string };
};

const CUSTOMER_COMMUNICATION_ENABLED_ORDER_WHERE: Prisma.ReceivableOrderWhereInput = {
  customer: {
    is: {
      enableAutoShippingDocsNotification: true,
      deletedAt: null,
    },
  },
};

function customerCommunicationEnabledOrderWhere(where: Prisma.ReceivableOrderWhereInput): Prisma.ReceivableOrderWhereInput {
  return { AND: [where, CUSTOMER_COMMUNICATION_ENABLED_ORDER_WHERE] };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

function hasShippingDocument(item: ShippingBundleItem): item is ShippingBundleItemWithDocument {
  return Boolean(item.document?.storageKey);
}

function selectedShippingDocumentTypes(customer: ShippingCustomerLike = {}) {
  return normalizeShippingDocumentTypes(customer.autoSendDocumentTypes);
}

function shippingRecipientEmails(customer: ShippingCustomerLike = {}) {
  const configured = parseEmailList(customer.shippingDocsEmails || []);
  return configured.length ? configured : parseEmailList(customer.contactEmail || "");
}

function latestSuccessfulDocumentByType(order: ShippingOrderLike = {}, documentType = "") {
  return (order.documents || [])
    .filter((document) => (
      document.documentType === documentType
      && document.uploadStatus === "SUCCESS"
      && !document.deletedAt
      && String(document.mimeType || "").toLowerCase() === "application/pdf"
    ))
    .sort((a, b) => new Date(b.uploadedAt || b.createdAt || 0).getTime() - new Date(a.uploadedAt || a.createdAt || 0).getTime())[0] || null;
}

function shippingDocumentBundle(order: ShippingOrderLike = {}, options: { documentTypes?: unknown } = {}): ShippingBundle {
  const customer = order.customer || {};
  const documentTypes = normalizeShippingDocumentTypes(options.documentTypes || selectedShippingDocumentTypes(customer));
  const configMap = SHIPPING_DOCUMENT_TYPE_CONFIG as Record<string, Omit<ShippingBundleItem, "typeKey" | "document">>;
  const items = documentTypes.filter((typeKey) => Boolean(configMap[typeKey])).map((typeKey) => {
    const config = configMap[typeKey];
    const document = latestSuccessfulDocumentByType(order, config.documentType);
    return { typeKey, ...config, document };
  });
  return {
    documentTypes,
    items,
    documents: items.map((item) => item.document).filter((document): document is ShippingDocumentLike => Boolean(document)),
    missing: items.filter((item) => !item.document),
  };
}

function shippingDocumentManualBundle(order: ShippingOrderLike = {}) {
  return shippingDocumentBundle(order, { documentTypes: DEFAULT_SHIPPING_DOCUMENT_TYPES });
}

function latestShippingNotification(order: ShippingOrderLike = {}) {
  return (order.shippingDocumentNotifications || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null;
}

function hasSentAutoShippingNotification(order: ShippingOrderLike = {}) {
  return (order.shippingDocumentNotifications || []).some((item) => item.sendMode === "auto" && item.sendStatus === "sent");
}

function customsDocumentsConfirmed(order: ShippingOrderLike = {}) {
  return order.customsDeclarationParseSource === customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL
    || order.customsParseStatus === "MANUAL";
}

async function loadOrderForShippingNotification(orderId: string, actor: ActorLike = null) {
  const order = await prisma.receivableOrder.findFirst({
    where: {
      id: orderId,
      deletedAt: null,
      ...(actor ? orderAccessWhere(actor) : {}),
    },
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("订单不存在或无权查看", 404);
  return order;
}

async function loadOrderForManualShippingNotification(orderId: string, actor: ActorLike = null) {
  assertWrite(actor, "customerCommunication");
  const order = await prisma.receivableOrder.findFirst({
    where: customerCommunicationEnabledOrderWhere({
      id: orderId,
      deletedAt: null,
      ...customerCommunicationOrderAccessWhere(actor),
    }),
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("订单不存在或无权发送清关资料", 404);
  return order;
}

function customerCommunicationOrderAccessWhere(actor: ActorLike = null) {
  const actorRole = String(actor?.role || "");
  if (actorRole === "管理员" || actorRole === "物流资料录入员") return {};
  if (actorRole === "业务员") return orderAccessWhere(actor);
  if (actorRole === "物流供应商") {
    const supplierId = nonEmpty(actor?.supplierId);
    return supplierId ? { logisticsSuppliers: { some: { supplierId } } } : { id: "__no_customer_communication_access__" };
  }
  return orderAccessWhere(actor);
}

function resendMailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || process.env.MAIL_FROM;
  const endpoint = process.env.RESEND_EMAIL_ENDPOINT || "https://api.resend.com/emails";
  if (!apiKey || !from) {
    throw codedError("Resend 邮件服务未配置，未发送。", 500, "MAIL_SERVICE_NOT_CONFIGURED");
  }
  return { apiKey, from, endpoint };
}

function resendAttachmentPayload(attachments: EmailAttachment[] = []) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    content: Buffer.isBuffer(attachment.content)
      ? attachment.content.toString("base64")
      : Buffer.from(String(attachment.content || "")).toString("base64"),
  }));
}

function shippingDocumentEmailTemplate(order: ShippingOrderLike = {}, bundle: ShippingBundle = shippingDocumentBundle(order), language = "EN") {
  const normalizedLanguage = normalizeClearanceEmailLanguage(language, order.customer?.country || order.country || "");
  const billOfLadingNo = order.blNo || order.billOfLadingNo || "-";
  const customsDeclarationDate = dateToInput(order.customsDeclarationDate) || "-";
  const labels = (bundle.items || []).filter((item) => item.document).map((item) => item.emailLabel);
  if (normalizedLanguage === "ZH") {
    return {
      language: "ZH",
      subject: `订单 ${order.orderNo || "-"} / 提单 ${billOfLadingNo} 清关资料`,
      body: [
        `${customerFullName(order.customer || {}, order.customerNameSnapshot || "") || "客户"}：`,
        "",
        "您好！",
        "",
        "请查收本邮件附件中的清关资料：",
        "",
        ...(labels.length ? labels : ["Commercial Invoice", "Packing List", "Customs Declaration"]).map((label) => `- ${label}`),
        "",
        `提单号：${billOfLadingNo}`,
        `申报日期：${customsDeclarationDate}`,
        "",
        "如需补充资料，请及时与我们联系。",
        "",
        "NEXTWOOD",
      ].join("\n"),
    };
  }
  if (normalizedLanguage === "RU") {
    return {
      language: "RU",
      subject: `Отгрузочные документы по заказу ${order.orderNo || "-"} / коносамент ${billOfLadingNo}`,
      body: [
        "Здравствуйте!",
        "",
        `Во вложении направляем отгрузочные документы по заказу ${order.orderNo || "-"}.`,
        "",
        "Документы во вложении:",
        ...(labels.length ? labels : ["Commercial Invoice", "Packing List", "Customs Declaration"]).map((label) => `- ${label}`),
        "",
        `Номер коносамента: ${billOfLadingNo}`,
        `Дата декларации: ${customsDeclarationDate}`,
        "",
        "Пожалуйста, проверьте документы и сообщите нам, если потребуется дополнительная информация.",
        "",
        "С уважением,",
        "Zhejiang Lainuo Building Materials Co., Ltd.",
      ].join("\n"),
    };
  }
  return {
    language: "EN",
    subject: `Shipping Documents for Order ${order.orderNo || "-"} / B/L ${billOfLadingNo}`,
    body: [
      "Dear Customer,",
      "",
      "Please find attached the shipping documents for your customs clearance:",
      "",
      ...labels.map((label) => `- ${label}`),
      "",
      "This email also serves as the shipment notification.",
      "",
      "Best regards,",
      "NEXTWOOD",
    ].join("\n"),
  };
}

function shippingDocumentTemplateVariables(order: ShippingOrderLike = {}, bundle: ShippingBundle = shippingDocumentBundle(order), language = "EN") {
  const normalizedLanguage = normalizeClearanceEmailLanguage(language, order.customer?.country || order.country || "");
  const billOfLadingNo = order.blNo || order.billOfLadingNo || "-";
  const customsDeclarationDate = dateToInput(order.customsDeclarationDate) || "-";
  const labels = (bundle.items || [])
    .filter((item) => item.document)
    .map((item) => item.emailLabel);
  const fallbackLabels = ["Commercial Invoice", "Packing List", "Customs Declaration"];
  return {
    language: normalizedLanguage,
    customerName: customerFullName(order.customer || {}, order.customerNameSnapshot || "") || customerShortName(order.customer || {}) || "Customer",
    orderNo: order.orderNo || "-",
    blNo: billOfLadingNo,
    customsDeclarationDate,
    documentLines: (labels.length ? labels : fallbackLabels).map((label) => `- ${label}`).join("\n"),
  };
}

async function renderShippingDocumentEmail(order: ShippingOrderLike = {}, bundle: ShippingBundle = shippingDocumentBundle(order), language = "EN"): Promise<RenderedShippingEmail> {
  const variables = shippingDocumentTemplateVariables(order, bundle, language);
  const type = notificationTemplateTypeForShippingLanguage(variables.language);
  const rendered = await renderNotificationTemplate(type, variables);
  return {
    language: variables.language,
    type,
    subject: rendered.subject,
    body: rendered.body,
    variables,
  };
}

async function shippingDocumentDraft(order: ShippingOrderLike = {}) {
  const customer = order.customer || {};
  const bundle = shippingDocumentManualBundle(order);
  const template = await renderShippingDocumentEmail(order, bundle, customer.clearanceEmailLanguage || "EN");
  const recipientEmails = shippingRecipientEmails(customer);
  const ccEmails = parseEmailList(customer.shippingDocsCcEmails || []);
  return {
    customerShortName: customerShortName(customer) || customerFullName(customer, order.customerNameSnapshot || ""),
    orderNo: order.orderNo || "",
    billOfLadingNo: order.blNo || order.billOfLadingNo || "-",
    blNo: order.blNo || order.billOfLadingNo || "-",
    customsDeclarationDate: dateToInput(order.customsDeclarationDate) || "-",
    recipientEmails,
    ccEmails,
    language: template.language,
    languageLabel: (SHIPPING_EMAIL_LANGUAGE_LABELS as Record<string, string>)[template.language],
    subject: template.subject,
    body: template.body,
    documents: bundle.items.map((item) => ({
      typeKey: item.typeKey,
      label: item.label,
      emailLabel: item.emailLabel,
      documentId: item.document?.id || "",
      fileName: item.document ? standardFilenameForDocument(item.document, order) : "",
      originalFilename: item.document?.originalFilename || item.document?.originalName || item.document?.fileName || "",
      exists: Boolean(item.document),
    })),
    missingLabels: bundle.missing.map((item) => item.label),
    attachmentCount: bundle.documents.length,
    canSendWithIncomplete: false,
    incompleteMessage: bundle.missing.length ? `当前资料不完整，缺少${bundle.missing.map((item) => item.label).join("、")}。` : "",
  };
}

function normalizeShippingEmailLanguage(value = "", order: ShippingOrderLike = {}) {
  return normalizeClearanceEmailLanguage(String(value || ""), order.customer?.country || order.country || "");
}

async function normalizeManualShippingEmailInput(input: ManualShippingEmailInput = {}, order: ShippingOrderLike = {}, bundle: ShippingBundle = shippingDocumentBundle(order)) {
  const language = normalizeShippingEmailLanguage(String(input.emailLanguage || input.language || order.customer?.clearanceEmailLanguage || "EN"), order);
  const template = await renderShippingDocumentEmail(order, bundle, language);
  const recipientEmails = requireValidEmailList(input.recipientEmails, "收件邮箱");
  const ccEmails = requireValidEmailList(input.ccEmails, "抄送邮箱");
  const subject = nonEmpty(input.emailSubject || input.subject || template.subject);
  const body = nonEmpty(input.emailBody || input.body || template.body);
  if (!subject) throw codedError("邮件标题不能为空", 400, "SHIPPING_EMAIL_SUBJECT_REQUIRED");
  if (!body) throw codedError("邮件正文不能为空", 400, "SHIPPING_EMAIL_BODY_REQUIRED");
  return { language, recipientEmails, ccEmails, subject, body, type: template.type, variables: template.variables };
}

export async function sendShippingDocumentsEmail({ recipientEmails, ccEmails, attachments, subject, body, notificationId }: SendShippingDocumentsEmailInput) {
  const { apiKey, from, endpoint } = resendMailConfig();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(notificationId ? { "Idempotency-Key": `shipping-docs-${notificationId}` } : {}),
    },
    body: JSON.stringify({
      from,
      to: recipientEmails,
      cc: ccEmails.length ? ccEmails : undefined,
      subject,
      text: body,
      attachments: resendAttachmentPayload(attachments),
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

async function notificationRecordData(order: ShippingOrderLike, bundle: ShippingBundle, recipientEmails: string[], ccEmails: string[], sendMode: string, sendStatus: string, errorMessage = "", options: NotificationRecordOptions = {}) {
  const commercialInvoice = bundle.items.find((item) => item.typeKey === "commercialInvoice")?.document || null;
  return {
    orderId: order.id || "",
    customerId: order.customerId || "",
    invoiceId: commercialInvoice?.id || null,
    sentById: options.sentById || null,
    recipientEmails,
    ccEmails,
    documentTypes: options.documentTypes || bundle.documentTypes,
    attachmentFileIds: bundle.documents.flatMap((document) => (document.id ? [document.id] : [])),
    sendStatus,
    sendMode,
    emailLanguage: options.emailLanguage || null,
    emailSubject: options.emailSubject || null,
    emailBody: options.emailBody || null,
    errorMessage: errorMessage || null,
    sentAt: ["sent", "SUCCESS"].includes(sendStatus) ? new Date() : null,
  };
}

async function upsertAutoShippingNotification(order: ShippingOrderLike, data: Parameters<typeof prisma.shippingDocumentNotification.create>[0]["data"]) {
  const existing = latestShippingNotification({
    shippingDocumentNotifications: (order.shippingDocumentNotifications || []).filter((item) => item.sendMode === "auto" && item.sendStatus !== "sent"),
  });
  if (existing) {
    return prisma.shippingDocumentNotification.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.shippingDocumentNotification.create({ data });
}

function publicShippingError(error: unknown) {
  const message = errorMessage(error);
  const code = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  if (code === "MAIL_SERVICE_NOT_CONFIGURED") return "Resend 邮件服务未配置，未发送。";
  if (/Resend|mail|email|邮件|ECONN|ETIMEDOUT|EAUTH|ENOTFOUND|fetch/i.test(message)) return `邮件发送失败：${message.slice(0, 120)}`;
  return message || "邮件发送失败。";
}

async function attemptShippingDocumentsNotification(request: AuditRequestLike, actor: ActorLike, orderId: string, sendMode = "auto") {
  const manual = sendMode === "manual";
  const loadOrder = () => manual
    ? loadOrderForManualShippingNotification(orderId, actor)
    : loadOrderForShippingNotification(orderId, null);
  const order = await loadOrder();
  const customer = order.customer || {};
  if (!manual) {
    if (!customer.enableAutoShippingDocsNotification) return serializeOrder(order);
    if (!customsDocumentsConfirmed(order)) return serializeOrder(order);
    if (hasSentAutoShippingNotification(order)) return serializeOrder(order);
  }
  const bundle = shippingDocumentBundle(order);
  const recipientEmails = shippingRecipientEmails(customer);
  const ccEmails = parseEmailList(customer.shippingDocsCcEmails || []);
  const missingLabels = bundle.missing.map((item) => item.label);
  const baseData = await notificationRecordData(order, bundle, recipientEmails, ccEmails, sendMode, "pending");

  if (!recipientEmails.length) {
    const message = "清关资料接收邮箱未配置，未发送。";
    const row = manual
      ? await prisma.shippingDocumentNotification.create({ data: { ...baseData, sendStatus: "failed", errorMessage: message } })
      : await upsertAutoShippingNotification(order, { ...baseData, sendStatus: "failed", errorMessage: message });
    await runNonCriticalTask("清关资料通知失败日志写入", () => writeAudit(request, actor, "清关资料通知发送失败", "shipping_document_notifications", row.id, null, { orderNo: order.orderNo, errorMessage: message }));
    return serializeOrder(await loadOrder());
  }

  if (missingLabels.length) {
    const message = `资料不完整，未发送：缺少${missingLabels.join("、")}。`;
    const row = manual
      ? await prisma.shippingDocumentNotification.create({ data: { ...baseData, sendStatus: "failed", errorMessage: message } })
      : await upsertAutoShippingNotification(order, { ...baseData, sendStatus: "pending", errorMessage: message });
    await runNonCriticalTask("清关资料通知未发送日志写入", () => writeAudit(request, actor, "清关资料通知未发送", "shipping_document_notifications", row.id, null, { orderNo: order.orderNo, errorMessage: message }));
    return serializeOrder(await loadOrder());
  }

  const row = manual
    ? await prisma.shippingDocumentNotification.create({ data: baseData })
    : await upsertAutoShippingNotification(order, baseData);
  try {
    const attachments = await Promise.all(bundle.items.map(async (item) => {
      if (!hasShippingDocument(item)) throw codedError("清关资料附件不存在或未上传成功。", 400, "SHIPPING_ATTACHMENT_MISSING");
      return {
        filename: standardFilenameForDocument(item.document, order),
        content: await readR2Object(item.document.storageKey),
        contentType: item.document.mimeType || "application/pdf",
      };
    }));
    const template = await renderShippingDocumentEmail(order, bundle, customer.clearanceEmailLanguage || "EN");
    const delivery = await sendNotificationEmail({
      type: template.type,
      recipientEmails,
      ccEmails,
      attachments,
      variables: template.variables,
      subjectOverride: template.subject,
      bodyOverride: template.body,
      idempotencyKey: row.id,
      relatedEntityType: "shipping_document_notifications",
      relatedEntityId: row.id || "",
      relatedOrderId: order.id || "",
      context: { sendMode, documentTypes: bundle.documentTypes, language: template.language },
    });
    if (delivery.skipped || delivery.sent !== true) {
      throw codedError(delivery.error || "清关资料通知模板已停用，未发送。", 409, "NOTIFICATION_TEMPLATE_DISABLED");
    }
    const sent = await prisma.shippingDocumentNotification.update({
      where: { id: row.id },
      data: { sendStatus: "sent", emailLanguage: template.language, emailSubject: template.subject, emailBody: template.body, errorMessage: null, sentAt: new Date() },
    });
    await runNonCriticalTask("清关资料通知发送日志写入", () => writeAudit(request, actor, manual ? "手动重发清关资料" : "自动发送清关资料", "shipping_document_notifications", sent.id, row, sent));
  } catch (error: unknown) {
    const message = publicShippingError(error);
    const failed = await prisma.shippingDocumentNotification.update({
      where: { id: row.id },
      data: { sendStatus: "failed", errorMessage: message, sentAt: null },
    });
    await runNonCriticalTask("清关资料通知失败日志写入", () => writeAudit(request, actor, "清关资料通知发送失败", "shipping_document_notifications", failed.id, row, {
      ...failed,
      technicalError: errorMessage(error),
    }));
  }
  return serializeOrder(await loadOrder());
}

export async function tryAutoShippingDocumentsNotification(request: AuditRequestLike, actor: ActorLike, orderId: string) {
  try {
    return await attemptShippingDocumentsNotification(request, actor, orderId, "auto");
  } catch (error: unknown) {
    logServerError("清关资料自动通知异常", error, { orderId });
    return null;
  }
}

export async function resendShippingDocumentsNotification(request: AuditRequestLike, actor: ActorLike, orderId: string) {
  assertWrite(actor, "customerCommunication");
  return attemptShippingDocumentsNotification(request, actor, orderId, "manual");
}

export async function prepareManualShippingDocumentsNotification(actor: ActorLike, orderId: string) {
  const order = await loadOrderForManualShippingNotification(orderId, actor);
  if (!order.customerId || !order.customer) throw codedError("订单未关联客户，不能发送清关资料。", 400, "SHIPPING_CUSTOMER_REQUIRED");
  return shippingDocumentDraft(order);
}

export async function sendManualShippingDocumentsNotification(request: AuditRequestLike, actor: ActorLike, orderId: string, input: ManualShippingEmailInput = {}) {
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const order = await loadOrderForManualShippingNotification(orderId, actor);
  if (!order.customerId || !order.customer) throw codedError("订单未关联客户，不能发送清关资料。", 400, "SHIPPING_CUSTOMER_REQUIRED");
  const bundle = shippingDocumentManualBundle(order);
  const missingLabels = bundle.missing.map((item) => item.label);
  if (!bundle.documents.length) {
    throw codedError("商业发票、装箱单、报关单均未上传，不能发送。", 400, "SHIPPING_ATTACHMENTS_REQUIRED");
  }
  if (missingLabels.length) {
    throw codedError(`当前资料不完整，缺少${missingLabels.join("、")}。`, 409, "SHIPPING_DOCUMENTS_INCOMPLETE");
  }
  const emailInput = await normalizeManualShippingEmailInput(input, order, bundle);
  if (!emailInput.recipientEmails.length) {
    throw codedError("收件邮箱不能为空。", 400, "SHIPPING_RECIPIENT_REQUIRED");
  }
  const baseData = await notificationRecordData(
    order,
    bundle,
    emailInput.recipientEmails,
    emailInput.ccEmails,
    "manual",
    "pending",
    "",
    {
      sentById: actorId,
      emailLanguage: emailInput.language,
      emailSubject: emailInput.subject,
      emailBody: emailInput.body,
      documentTypes: bundle.items.filter((item) => item.document).map((item) => item.typeKey),
    },
  );
  const row = await prisma.shippingDocumentNotification.create({ data: baseData });
  try {
    const attachments = await Promise.all(bundle.items.filter(hasShippingDocument).map(async (item) => ({
      filename: standardFilenameForDocument(item.document, order),
      content: await readR2Object(item.document.storageKey),
      contentType: item.document.mimeType || "application/pdf",
    })));
    const delivery = await sendNotificationEmail({
      type: emailInput.type,
      recipientEmails: emailInput.recipientEmails,
      ccEmails: emailInput.ccEmails,
      attachments,
      variables: emailInput.variables,
      subjectOverride: emailInput.subject,
      bodyOverride: emailInput.body,
      idempotencyKey: row.id,
      relatedEntityType: "shipping_document_notifications",
      relatedEntityId: row.id || "",
      relatedOrderId: order.id || "",
      context: { sendMode: "manual", documentTypes: bundle.documentTypes, language: emailInput.language },
    });
    if (delivery.skipped || delivery.sent !== true) {
      throw codedError(delivery.error || "清关资料通知模板已停用，未发送。", 409, "NOTIFICATION_TEMPLATE_DISABLED");
    }
    const sent = await prisma.shippingDocumentNotification.update({
      where: { id: row.id },
      data: { sendStatus: "SUCCESS", errorMessage: null, sentAt: new Date() },
      include: { sentBy: true },
    });
    await runNonCriticalTask("手动发送清关资料日志写入", () => writeAudit(request, actor, "手动发送清关资料", "shipping_document_notifications", sent.id, row, {
      ...sent,
      missingLabels,
    }));
  } catch (error: unknown) {
    const message = publicShippingError(error);
    const failed = await prisma.shippingDocumentNotification.update({
      where: { id: row.id },
      data: { sendStatus: "FAILED", errorMessage: message, sentAt: null },
      include: { sentBy: true },
    });
    await runNonCriticalTask("手动发送清关资料失败日志写入", () => writeAudit(request, actor, "手动发送清关资料失败", "shipping_document_notifications", failed.id, row, {
      ...failed,
      technicalError: errorMessage(error),
    }));
    throw codedError("清关资料发送失败，请稍后重试或联系管理员。", 502, "SHIPPING_EMAIL_SEND_FAILED");
  }
  return serializeOrder(await loadOrderForManualShippingNotification(orderId, actor));
}

export async function getShippingDocumentDraftForOrder(actor: ActorLike, orderId: string) {
  assertRead(actor, "customerCommunication");
  const order = await prisma.receivableOrder.findFirst({
    where: customerCommunicationEnabledOrderWhere({ id: orderId, deletedAt: null, ...customerCommunicationOrderAccessWhere(actor) }),
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("订单不存在或无权查看客户沟通资料", 404);
  return shippingDocumentDraft(order);
}

export function canSendCustomerCommunication(actor: ActorLike) {
  return canWrite(actor, "customerCommunication");
}
