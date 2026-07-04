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
