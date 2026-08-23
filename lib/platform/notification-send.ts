import { prisma } from "../prisma";
import { codedError, nonEmpty } from "./shared-base-utils";
import { type SendNotificationEmailInput } from "./notification-definitions";
import {
  applyTemplate,
  attachmentMetadata,
  bodyPreview,
  cleanTemplateText,
  enabledAdminEmails,
  ensureNotificationTemplate,
  jsonOrNull,
  persistedNotificationBody,
  persistedNotificationContext,
  publicSendError,
  sendResendEmail,
  uniqueEmails,
} from "./notification-helpers";
import { TEXT_LIMITS } from "./notification-definitions";
import { freightowerTrackingEmailHtml } from "./freightower-tracking-email";
import { NOTIFICATION_TYPES } from "./notification-definition-types";
import { validateNotificationAttachments } from "./notification-email-transport";

const FREIGHTOWER_EMAIL_TYPES = new Set<string>([
  NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
  NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_CUSTOMER_UPDATE,
  NOTIFICATION_TYPES.FREIGHTOWER_PORT_ROLLOVER_ALERT,
  NOTIFICATION_TYPES.FREIGHTOWER_PORT_OPERATION_ALERT,
  NOTIFICATION_TYPES.FREIGHTOWER_CUSTOMS_ALERT,
]);

export async function sendNotificationEmail(input: SendNotificationEmailInput) {
  const template = await ensureNotificationTemplate(input.type);
  if (template.enabled === false && input.ignoreTemplateEnabled !== true) {
    return { sent: false, skipped: true, outboxId: "", error: "通知模板已停用" };
  }
  const recipientEmails = uniqueEmails([input.recipientEmails]);
  if (!recipientEmails.length) {
    throw codedError("邮件收件人不能为空或格式错误。", 400, "NOTIFICATION_RECIPIENT_REQUIRED");
  }
  const templateCc = input.ignoreTemplateCc || template.securitySensitive
    ? []
    : uniqueEmails([template.ccEmails || []]);
  const directCc = template.securitySensitive ? [] : uniqueEmails([input.ccEmails || []]);
  const adminCc = !input.ignoreTemplateCc && !template.securitySensitive && template.ccAdminEmails
    ? await enabledAdminEmails()
    : [];
  const recipientSet = new Set(recipientEmails);
  const ccEmails = uniqueEmails([...directCc, ...templateCc, ...adminCc])
    .filter((email) => !recipientSet.has(email));
  const variables = input.variables || {};
  const subject = cleanTemplateText(input.subjectOverride, applyTemplate(template.subjectTemplate, variables), TEXT_LIMITS.subject);
  const body = cleanTemplateText(input.bodyOverride, applyTemplate(template.bodyTemplate, variables), TEXT_LIMITS.body);
  const html = input.htmlOverride || (
    FREIGHTOWER_EMAIL_TYPES.has(template.type) ? freightowerTrackingEmailHtml(template.type, variables) : ""
  );
  const storedBody = persistedNotificationBody(template, body);
  const storedContext = persistedNotificationContext(template, input.context || {}, variables);
  const idempotencyKey = nonEmpty(input.idempotencyKey);
  const existing = idempotencyKey
    ? await prisma.notificationOutbox.findUnique({ where: { idempotencyKey } })
    : null;
  const claimedOutboxId = nonEmpty(input.claimedOutboxId);
  const claimedOutboxAttempt = Number(input.claimedOutboxAttempt);
  const preclaimed = Boolean(
    claimedOutboxId
    && existing?.id === claimedOutboxId
    && existing.status === "sending"
    && Number.isSafeInteger(claimedOutboxAttempt)
    && existing.attempts === claimedOutboxAttempt
  );
  if (claimedOutboxId && !preclaimed) {
    return {
      sent: existing?.status === "sent",
      skipped: true,
      outboxId: existing?.id || claimedOutboxId,
      error: existing?.status === "sent" ? "" : "通知任务租约已失效",
    };
  }
  if (existing?.status === "sent") {
    return { sent: true, skipped: true, outboxId: existing.id, error: "" };
  }
  if (!preclaimed
    && existing
    && ["pending", "sending"].includes(existing.status)
    && Date.now() - existing.updatedAt.getTime() < 5 * 60 * 1000
  ) {
    return { sent: false, skipped: true, outboxId: existing.id, error: "相同通知正在发送中" };
  }
  if (input.attachments?.length && !template.supportsAttachments) {
    throw codedError("该通知类型不允许发送附件。", 400, "NOTIFICATION_ATTACHMENTS_NOT_SUPPORTED");
  }
  const attachments = validateNotificationAttachments(input.attachments || []);
  const outbox = preclaimed && existing
    ? existing
    : existing
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
  if (preclaimed) {
    const prepared = await prisma.notificationOutbox.updateMany({
      where: { id: outbox.id, status: "sending", attempts: claimedOutboxAttempt },
      data: {
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
      },
    });
    if (prepared.count !== 1) {
      return { sent: false, skipped: true, outboxId: outbox.id, error: "通知任务租约已失效" };
    }
  }
  let providerDelivered = false;
  try {
    if (!preclaimed) {
      await prisma.notificationOutbox.update({
        where: { id: outbox.id },
        data: { status: "sending", attempts: { increment: 1 }, lastError: null },
      });
    }
    await sendResendEmail({
      recipientEmails,
      ccEmails,
      subject,
      body,
      html,
      attachments,
      idempotencyKey: idempotencyKey || outbox.id,
    });
    providerDelivered = true;
    const sentAt = new Date();
    const tracked = await prisma.$transaction(async (tx) => {
      if (preclaimed) {
        const changed = await tx.notificationOutbox.updateMany({
          where: { id: outbox.id, status: "sending", attempts: claimedOutboxAttempt },
          data: { status: "sent", sentAt, failedAt: null, lastError: null },
        });
        if (changed.count !== 1) return false;
      } else {
        await tx.notificationOutbox.update({
          where: { id: outbox.id },
          data: { status: "sent", sentAt, failedAt: null, lastError: null },
        });
      }
      await tx.notificationDeliveryLog.create({
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
      });
      return true;
    });
    if (!tracked) {
      throw codedError("通知任务租约已失效", 409, "NOTIFICATION_OUTBOX_LEASE_LOST");
    }
    return { sent: true, skipped: false, outboxId: outbox.id, error: "" };
  } catch (error: unknown) {
    const message = publicSendError(error);
    if (providerDelivered) {
      console.error("notification-delivery-tracking-failed", {
        outboxId: outbox.id,
        type: template.type,
        message,
      });
      return { sent: true, skipped: false, outboxId: outbox.id, error: "", trackingError: message };
    }
    await prisma.$transaction(async (tx) => {
      if (preclaimed) {
        const changed = await tx.notificationOutbox.updateMany({
          where: { id: outbox.id, status: "sending", attempts: claimedOutboxAttempt },
          data: { status: "failed", failedAt: new Date(), lastError: message },
        });
        if (changed.count !== 1) return;
      } else {
        await tx.notificationOutbox.update({
          where: { id: outbox.id },
          data: { status: "failed", failedAt: new Date(), lastError: message },
        });
      }
      await tx.notificationDeliveryLog.create({
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
      });
    });
    throw error;
  }
}
