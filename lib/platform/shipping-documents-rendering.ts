import {
  SHIPPING_EMAIL_LANGUAGE_LABELS,
  codedError,
  customerFullName,
  customerShortName,
  dateToInput,
  nonEmpty,
  normalizeClearanceEmailLanguage,
  parseEmailList,
  requireValidEmailList,
  standardFilenameForDocument,
} from "./shared";
import {
  notificationTemplateTypeForShippingLanguage,
  renderNotificationTemplate,
} from "./notification-engine";
import {
  shippingDocumentBundle,
  shippingDocumentManualBundle,
  shippingRecipientEmails,
  type ManualShippingEmailInput,
  type RenderedShippingEmail,
  type ShippingBundle,
  type ShippingOrderLike,
} from "./shipping-documents-core";

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
