import { prisma } from "../prisma";
import { readR2Object } from "../r2";
import { sendNotificationEmail } from "./notification-engine";
import {
  assertRead,
  assertWrite,
  canWrite,
  codedError,
  includeOrderRelations,
  logServerError,
  nonEmpty,
  parseEmailList,
  permissionError,
  runNonCriticalTask,
  serializeOrder,
  standardFilenameForDocument,
  writeAudit,
} from "./shared";
import {
  customerCommunicationEnabledOrderWhere,
  customerCommunicationOrderAccessWhere,
  customsDocumentsConfirmed,
  errorMessage,
  hasSentShippingNotification,
  hasShippingDocument,
  latestShippingNotification,
  loadOrderForManualShippingNotification,
  loadOrderForShippingNotification,
  normalizeManualShippingEmailInput,
  renderShippingDocumentEmail,
  shippingDocumentBundle,
  shippingDocumentDraft,
  shippingDocumentManualBundle,
  shippingRecipientEmails,
  type ActorLike,
  type AuditRequestLike,
  type ManualShippingEmailInput,
  type ShippingOrderLike,
} from "./shipping-documents-shared";
import {
  claimManualShippingNotification,
  manualSendFingerprint,
  manualSendIdempotencyKey,
} from "./shipping-documents-deduplication";
import { shippingNotificationRecordData } from "./shipping-documents-records";

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
    if (hasSentShippingNotification(order)) return serializeOrder(order);
  }
  const bundle = shippingDocumentBundle(order);
  const recipientEmails = shippingRecipientEmails(customer);
  const ccEmails = parseEmailList(customer.shippingDocsCcEmails || []);
  const missingLabels = bundle.missing.map((item) => item.label);
  const baseData = shippingNotificationRecordData(order, bundle, recipientEmails, ccEmails, sendMode, "pending");

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
      idempotencyKey: `shipping-docs:auto:${order.id}`,
      relatedEntityType: "shipping_document_notifications",
      relatedEntityId: row.id || "",
      relatedOrderId: order.id || "",
      context: { sendMode, documentTypes: bundle.documentTypes, language: template.language },
    });
    if (delivery.sent !== true) {
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
  const baseData = shippingNotificationRecordData(
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
  const fingerprint = manualSendFingerprint({
    recipientEmails: emailInput.recipientEmails,
    ccEmails: emailInput.ccEmails,
    emailSubject: emailInput.subject,
    emailBody: emailInput.body,
    attachmentFileIds: baseData.attachmentFileIds,
  });
  const claimed = await claimManualShippingNotification(order.id || orderId, baseData, fingerprint);
  if (claimed.duplicate) {
    if (["sent", "SUCCESS"].includes(claimed.duplicate.sendStatus)) {
      return serializeOrder(await loadOrderForManualShippingNotification(orderId, actor));
    }
    throw codedError("相同的清关资料邮件正在发送，请勿重复提交。", 409, "SHIPPING_EMAIL_SEND_IN_PROGRESS");
  }
  const row = claimed.row;
  if (!row) throw codedError("清关资料发送任务创建失败。", 500, "SHIPPING_EMAIL_SEND_CLAIM_FAILED");
  const idempotencyKey = manualSendIdempotencyKey(order.id || orderId, input);
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
      idempotencyKey,
      relatedEntityType: "shipping_document_notifications",
      relatedEntityId: row.id || "",
      relatedOrderId: order.id || "",
      context: { sendMode: "manual", documentTypes: bundle.documentTypes, language: emailInput.language },
    });
    if (delivery.sent !== true) {
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
