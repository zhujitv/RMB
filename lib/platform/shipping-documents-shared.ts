import * as customsDeclarationParser from "../customs-declaration-parser";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { orderAccessWhere } from "./order-access";
import {
  DEFAULT_SHIPPING_DOCUMENT_TYPES,
  SHIPPING_DOCUMENT_TYPE_CONFIG,
  SHIPPING_EMAIL_LANGUAGE_LABELS,
  assertWrite,
  codedError,
  customerFullName,
  customerShortName,
  dateToInput,
  includeOrderRelations,
  nonEmpty,
  normalizeClearanceEmailLanguage,
  normalizeShippingDocumentTypes,
  parseEmailList,
  permissionError,
  requireValidEmailList,
  standardFilenameForDocument,
  writeAudit,
} from "./shared";
import {
  notificationTemplateTypeForShippingLanguage,
  renderNotificationTemplate,
} from "./notification-engine";

export type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type ShippingCustomerLike = {
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
export type ShippingDocumentLike = {
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
export type ShippingNotificationLike = {
  id?: string;
  sendMode?: string | null;
  sendStatus?: string | null;
  createdAt?: Date | string | null;
};
export type ShippingOrderLike = {
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
export type ShippingBundleItem = {
  typeKey: string;
  label: string;
  emailLabel: string;
  documentType: string;
  document: ShippingDocumentLike | null;
};
export type ShippingBundle = {
  documentTypes: string[];
  items: ShippingBundleItem[];
  documents: ShippingDocumentLike[];
  missing: ShippingBundleItem[];
};
export type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};
export type SendShippingDocumentsEmailInput = {
  recipientEmails: string[];
  ccEmails: string[];
  attachments: EmailAttachment[];
  subject: string;
  body: string;
  notificationId?: string | null;
};
export type ManualShippingEmailInput = Record<string, unknown>;
export type RenderedShippingEmail = {
  language: string;
  type: string;
  subject: string;
  body: string;
  variables: Record<string, unknown>;
};
export type NotificationRecordOptions = {
  sentById?: string;
  documentTypes?: string[];
  emailLanguage?: string;
  emailSubject?: string;
  emailBody?: string;
};
export type ShippingBundleItemWithDocument = ShippingBundleItem & {
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

export function customerCommunicationEnabledOrderWhere(where: Prisma.ReceivableOrderWhereInput): Prisma.ReceivableOrderWhereInput {
  return { AND: [where, CUSTOMER_COMMUNICATION_ENABLED_ORDER_WHERE] };
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

export function hasShippingDocument(item: ShippingBundleItem): item is ShippingBundleItemWithDocument {
  return Boolean(item.document?.storageKey);
}

export function selectedShippingDocumentTypes(customer: ShippingCustomerLike = {}) {
  return normalizeShippingDocumentTypes(customer.autoSendDocumentTypes);
}

export function shippingRecipientEmails(customer: ShippingCustomerLike = {}) {
  const configured = parseEmailList(customer.shippingDocsEmails || []);
  return configured.length ? configured : parseEmailList(customer.contactEmail || "");
}

export function latestSuccessfulDocumentByType(order: ShippingOrderLike = {}, documentType = "") {
  return (order.documents || [])
    .filter((document) => (
      document.documentType === documentType
      && document.uploadStatus === "SUCCESS"
      && !document.deletedAt
      && String(document.mimeType || "").toLowerCase() === "application/pdf"
    ))
    .sort((a, b) => new Date(b.uploadedAt || b.createdAt || 0).getTime() - new Date(a.uploadedAt || a.createdAt || 0).getTime())[0] || null;
}

export function shippingDocumentBundle(order: ShippingOrderLike = {}, options: { documentTypes?: unknown } = {}): ShippingBundle {
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

export function shippingDocumentManualBundle(order: ShippingOrderLike = {}) {
  return shippingDocumentBundle(order, { documentTypes: DEFAULT_SHIPPING_DOCUMENT_TYPES });
}

export function latestShippingNotification(order: ShippingOrderLike = {}) {
  return (order.shippingDocumentNotifications || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null;
}

export function hasSentAutoShippingNotification(order: ShippingOrderLike = {}) {
  return (order.shippingDocumentNotifications || []).some((item) => item.sendMode === "auto" && item.sendStatus === "sent");
}

export function customsDocumentsConfirmed(order: ShippingOrderLike = {}) {
  return order.customsDeclarationParseSource === customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL
    || order.customsParseStatus === "MANUAL";
}

export async function loadOrderForShippingNotification(orderId: string, actor: ActorLike = null) {
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

export async function loadOrderForManualShippingNotification(orderId: string, actor: ActorLike = null) {
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

export function customerCommunicationOrderAccessWhere(actor: ActorLike = null) {
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

export function shippingDocumentEmailTemplate(order: ShippingOrderLike = {}, bundle: ShippingBundle = shippingDocumentBundle(order), language = "EN") {
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

export function shippingDocumentTemplateVariables(order: ShippingOrderLike = {}, bundle: ShippingBundle = shippingDocumentBundle(order), language = "EN") {
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

export async function renderShippingDocumentEmail(order: ShippingOrderLike = {}, bundle: ShippingBundle = shippingDocumentBundle(order), language = "EN"): Promise<RenderedShippingEmail> {
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

export async function shippingDocumentDraft(order: ShippingOrderLike = {}) {
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

export function normalizeShippingEmailLanguage(value = "", order: ShippingOrderLike = {}) {
  return normalizeClearanceEmailLanguage(String(value || ""), order.customer?.country || order.country || "");
}

export async function normalizeManualShippingEmailInput(input: ManualShippingEmailInput = {}, order: ShippingOrderLike = {}, bundle: ShippingBundle = shippingDocumentBundle(order)) {
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
