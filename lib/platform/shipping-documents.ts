// @ts-nocheck
import * as customsDeclarationParser from "../customs-declaration-parser";
import { prisma } from "../prisma";
import { readR2Object } from "../r2";
import {
  DEFAULT_SHIPPING_DOCUMENT_TYPES,
  SHIPPING_DOCUMENT_TYPE_CONFIG,
  SHIPPING_EMAIL_LANGUAGE_LABELS,
  codedError,
  customerFullName,
  customerShortName,
  dateToInput,
  includeOrderRelations,
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

function selectedShippingDocumentTypes(customer = {}) {
  return normalizeShippingDocumentTypes(customer.autoSendDocumentTypes);
}

function shippingRecipientEmails(customer = {}) {
  const configured = parseEmailList(customer.shippingDocsEmails || []);
  return configured.length ? configured : parseEmailList(customer.contactEmail || "");
}

function latestSuccessfulDocumentByType(order = {}, documentType = "") {
  return (order.documents || [])
    .filter((document) => (
      document.documentType === documentType
      && document.uploadStatus === "SUCCESS"
      && !document.deletedAt
      && String(document.mimeType || "").toLowerCase() === "application/pdf"
    ))
    .sort((a, b) => new Date(b.uploadedAt || b.createdAt || 0) - new Date(a.uploadedAt || a.createdAt || 0))[0] || null;
}

function shippingDocumentBundle(order = {}, options = {}) {
  const customer = order.customer || {};
  const documentTypes = normalizeShippingDocumentTypes(options.documentTypes || selectedShippingDocumentTypes(customer));
  const items = documentTypes.map((typeKey) => {
    const config = SHIPPING_DOCUMENT_TYPE_CONFIG[typeKey];
    const document = latestSuccessfulDocumentByType(order, config.documentType);
    return { typeKey, ...config, document };
  });
  return {
    documentTypes,
    items,
    documents: items.map((item) => item.document).filter(Boolean),
    missing: items.filter((item) => !item.document),
  };
}

function shippingDocumentManualBundle(order = {}) {
  return shippingDocumentBundle(order, { documentTypes: DEFAULT_SHIPPING_DOCUMENT_TYPES });
}

function latestShippingNotification(order = {}) {
  return (order.shippingDocumentNotifications || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
}

function hasSentAutoShippingNotification(order = {}) {
  return (order.shippingDocumentNotifications || []).some((item) => item.sendMode === "auto" && item.sendStatus === "sent");
}

function customsDocumentsConfirmed(order = {}) {
  return order.customsDeclarationParseSource === customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL
    || order.customsParseStatus === "MANUAL";
}

async function loadOrderForShippingNotification(orderId, actor = null) {
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

async function loadOrderForManualShippingNotification(orderId, actor = null) {
  if (!["管理员", "业务员"].includes(actor?.role)) throw permissionError("没有权限手动发送清关资料", 403);
  const order = await prisma.receivableOrder.findFirst({
    where: {
      id: orderId,
      deletedAt: null,
      ...(actor.role === "业务员" ? orderAccessWhere(actor) : {}),
    },
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("订单不存在或无权发送清关资料", 404);
  return order;
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

function resendAttachmentPayload(attachments = []) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    content: Buffer.isBuffer(attachment.content)
      ? attachment.content.toString("base64")
      : Buffer.from(String(attachment.content || "")).toString("base64"),
  }));
}

function shippingDocumentEmailTemplate(order = {}, bundle = {}, language = "EN") {
  const normalizedLanguage = normalizeClearanceEmailLanguage(language, order.customer?.country || order.country || "");
  const billOfLadingNo = order.blNo || order.billOfLadingNo || "-";
  const customsDeclarationDate = dateToInput(order.customsDeclarationDate) || "-";
  const labels = (bundle.items || []).filter((item) => item.document).map((item) => item.emailLabel);
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

function shippingDocumentDraft(order = {}) {
  const customer = order.customer || {};
  const bundle = shippingDocumentManualBundle(order);
  const template = shippingDocumentEmailTemplate(order, bundle, customer.clearanceEmailLanguage || "EN");
  const recipientEmails = parseEmailList(customer.shippingDocsEmails || []);
  const ccEmails = parseEmailList(customer.shippingDocsCcEmails || []);
  return {
    customerShortName: customerShortName(customer) || customerFullName(customer, order.customerNameSnapshot),
    orderNo: order.orderNo || "",
    billOfLadingNo: order.blNo || order.billOfLadingNo || "-",
    blNo: order.blNo || order.billOfLadingNo || "-",
    customsDeclarationDate: dateToInput(order.customsDeclarationDate) || "-",
    recipientEmails,
    ccEmails,
    language: template.language,
    languageLabel: SHIPPING_EMAIL_LANGUAGE_LABELS[template.language],
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
    canSendWithIncomplete: bundle.documents.length > 0 && bundle.missing.length > 0,
    incompleteMessage: bundle.missing.length ? `当前资料不完整，缺少${bundle.missing.map((item) => item.label).join("、")}。` : "",
  };
}

function normalizeShippingEmailLanguage(value = "", order = {}) {
  return normalizeClearanceEmailLanguage(value, order.customer?.country || order.country || "");
}

function normalizeManualShippingEmailInput(input = {}, order = {}, bundle = {}) {
  const language = normalizeShippingEmailLanguage(input.emailLanguage || input.language || order.customer?.clearanceEmailLanguage || "EN", order);
  const template = shippingDocumentEmailTemplate(order, bundle, language);
  const recipientEmails = requireValidEmailList(input.recipientEmails, "收件邮箱");
  const ccEmails = requireValidEmailList(input.ccEmails, "抄送邮箱");
  const subject = nonEmpty(input.emailSubject || input.subject || template.subject);
  const body = nonEmpty(input.emailBody || input.body || template.body);
  if (!subject) throw codedError("邮件标题不能为空", 400, "SHIPPING_EMAIL_SUBJECT_REQUIRED");
  if (!body) throw codedError("邮件正文不能为空", 400, "SHIPPING_EMAIL_BODY_REQUIRED");
  return { language, recipientEmails, ccEmails, subject, body };
}

export async function sendShippingDocumentsEmail({ recipientEmails, ccEmails, attachments, subject, body, notificationId }) {
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
    const data = await response.json().catch(() => ({}));
    const reason = data?.message || data?.error?.message || data?.error || `HTTP ${response.status}`;
    throw codedError(`Resend 邮件发送失败：${reason}`, response.status, "RESEND_SEND_FAILED");
  }
}

async function notificationRecordData(order, bundle, recipientEmails, ccEmails, sendMode, sendStatus, errorMessage = "", options = {}) {
  const commercialInvoice = bundle.items.find((item) => item.typeKey === "commercialInvoice")?.document || null;
  return {
    orderId: order.id,
    customerId: order.customerId,
    invoiceId: commercialInvoice?.id || null,
    sentById: options.sentById || null,
    recipientEmails,
    ccEmails,
    documentTypes: options.documentTypes || bundle.documentTypes,
    attachmentFileIds: bundle.documents.map((document) => document.id),
    sendStatus,
    sendMode,
    emailLanguage: options.emailLanguage || null,
    emailSubject: options.emailSubject || null,
    emailBody: options.emailBody || null,
    errorMessage: errorMessage || null,
    sentAt: ["sent", "SUCCESS"].includes(sendStatus) ? new Date() : null,
  };
}

async function upsertAutoShippingNotification(order, data) {
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

function publicShippingError(error) {
  const message = String(error?.message || "");
  if (error?.code === "MAIL_SERVICE_NOT_CONFIGURED") return "Resend 邮件服务未配置，未发送。";
  if (/Resend|mail|email|邮件|ECONN|ETIMEDOUT|EAUTH|ENOTFOUND|fetch/i.test(message)) return `邮件发送失败：${message.slice(0, 120)}`;
  return message || "邮件发送失败。";
}

async function attemptShippingDocumentsNotification(request, actor, orderId, sendMode = "auto") {
  const manual = sendMode === "manual";
  const accessActor = manual ? actor : null;
  const order = await loadOrderForShippingNotification(orderId, accessActor);
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
    return serializeOrder(await loadOrderForShippingNotification(orderId, accessActor));
  }

  if (missingLabels.length) {
    const message = `资料不完整，未发送：缺少${missingLabels.join("、")}。`;
    const row = manual
      ? await prisma.shippingDocumentNotification.create({ data: { ...baseData, sendStatus: "failed", errorMessage: message } })
      : await upsertAutoShippingNotification(order, { ...baseData, sendStatus: "pending", errorMessage: message });
    await runNonCriticalTask("清关资料通知未发送日志写入", () => writeAudit(request, actor, "清关资料通知未发送", "shipping_document_notifications", row.id, null, { orderNo: order.orderNo, errorMessage: message }));
    return serializeOrder(await loadOrderForShippingNotification(orderId, accessActor));
  }

  const row = manual
    ? await prisma.shippingDocumentNotification.create({ data: baseData })
    : await upsertAutoShippingNotification(order, baseData);
  try {
    const attachments = await Promise.all(bundle.items.map(async (item) => ({
      filename: standardFilenameForDocument(item.document, order),
      content: await readR2Object(item.document.storageKey),
      contentType: item.document.mimeType || "application/pdf",
    })));
    const template = shippingDocumentEmailTemplate(order, bundle, customer.clearanceEmailLanguage || "EN");
    await sendShippingDocumentsEmail({
      recipientEmails,
      ccEmails,
      attachments,
      subject: template.subject,
      body: template.body,
      notificationId: row.id,
    });
    const sent = await prisma.shippingDocumentNotification.update({
      where: { id: row.id },
      data: { sendStatus: "sent", emailLanguage: template.language, emailSubject: template.subject, emailBody: template.body, errorMessage: null, sentAt: new Date() },
    });
    await runNonCriticalTask("清关资料通知发送日志写入", () => writeAudit(request, actor, manual ? "手动重发清关资料" : "自动发送清关资料", "shipping_document_notifications", sent.id, row, sent));
  } catch (error) {
    const message = publicShippingError(error);
    const failed = await prisma.shippingDocumentNotification.update({
      where: { id: row.id },
      data: { sendStatus: "failed", errorMessage: message, sentAt: null },
    });
    await runNonCriticalTask("清关资料通知失败日志写入", () => writeAudit(request, actor, "清关资料通知发送失败", "shipping_document_notifications", failed.id, row, {
      ...failed,
      technicalError: error?.message || "",
    }));
  }
  return serializeOrder(await loadOrderForShippingNotification(orderId, accessActor));
}

export async function tryAutoShippingDocumentsNotification(request, actor, orderId) {
  try {
    return await attemptShippingDocumentsNotification(request, actor, orderId, "auto");
  } catch (error) {
    logServerError("清关资料自动通知异常", error, { orderId });
    return null;
  }
}

export async function resendShippingDocumentsNotification(request, actor, orderId) {
  if (!["管理员", "业务员"].includes(actor?.role)) throw permissionError("没有权限手动发送清关资料", 403);
  return attemptShippingDocumentsNotification(request, actor, orderId, "manual");
}

export async function prepareManualShippingDocumentsNotification(actor, orderId) {
  const order = await loadOrderForManualShippingNotification(orderId, actor);
  if (!order.customerId || !order.customer) throw codedError("订单未关联客户，不能发送清关资料。", 400, "SHIPPING_CUSTOMER_REQUIRED");
  return shippingDocumentDraft(order);
}

export async function sendManualShippingDocumentsNotification(request, actor, orderId, input = {}) {
  const order = await loadOrderForManualShippingNotification(orderId, actor);
  if (!order.customerId || !order.customer) throw codedError("订单未关联客户，不能发送清关资料。", 400, "SHIPPING_CUSTOMER_REQUIRED");
  const bundle = shippingDocumentManualBundle(order);
  const missingLabels = bundle.missing.map((item) => item.label);
  if (!parseEmailList(order.customer.shippingDocsEmails || []).length) {
    throw codedError("客户未配置清关资料接收邮箱，不能发送。", 400, "SHIPPING_RECIPIENT_REQUIRED");
  }
  if (!bundle.documents.length) {
    throw codedError("商业发票、装箱单、报关单均未上传，不能发送。", 400, "SHIPPING_ATTACHMENTS_REQUIRED");
  }
  if (missingLabels.length && input.confirmIncomplete !== true) {
    throw codedError(`当前资料不完整，缺少${missingLabels.join("、")}。`, 409, "SHIPPING_DOCUMENTS_INCOMPLETE");
  }
  const emailInput = normalizeManualShippingEmailInput(input, order, bundle);
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
      sentById: actor.id,
      emailLanguage: emailInput.language,
      emailSubject: emailInput.subject,
      emailBody: emailInput.body,
      documentTypes: bundle.items.filter((item) => item.document).map((item) => item.typeKey),
    },
  );
  const row = await prisma.shippingDocumentNotification.create({ data: baseData });
  try {
    const attachments = await Promise.all(bundle.items.filter((item) => item.document).map(async (item) => ({
      filename: standardFilenameForDocument(item.document, order),
      content: await readR2Object(item.document.storageKey),
      contentType: item.document.mimeType || "application/pdf",
    })));
    await sendShippingDocumentsEmail({
      recipientEmails: emailInput.recipientEmails,
      ccEmails: emailInput.ccEmails,
      attachments,
      subject: emailInput.subject,
      body: emailInput.body,
      notificationId: row.id,
    });
    const sent = await prisma.shippingDocumentNotification.update({
      where: { id: row.id },
      data: { sendStatus: "SUCCESS", errorMessage: null, sentAt: new Date() },
      include: { sentBy: true },
    });
    await runNonCriticalTask("手动发送清关资料日志写入", () => writeAudit(request, actor, "手动发送清关资料", "shipping_document_notifications", sent.id, row, {
      ...sent,
      missingLabels,
    }));
  } catch (error) {
    const message = publicShippingError(error);
    const failed = await prisma.shippingDocumentNotification.update({
      where: { id: row.id },
      data: { sendStatus: "FAILED", errorMessage: message, sentAt: null },
      include: { sentBy: true },
    });
    await runNonCriticalTask("手动发送清关资料失败日志写入", () => writeAudit(request, actor, "手动发送清关资料失败", "shipping_document_notifications", failed.id, row, {
      ...failed,
      technicalError: error?.message || "",
    }));
    throw codedError("清关资料发送失败，请稍后重试或联系管理员。", 502, "SHIPPING_EMAIL_SEND_FAILED");
  }
  return serializeOrder(await loadOrderForManualShippingNotification(orderId, actor));
}
