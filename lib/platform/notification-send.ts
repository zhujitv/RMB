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

const FREIGHTOWER_NOTIFICATION_RETRY_MAX_ATTEMPTS = 6;
const FREIGHTOWER_EMAIL_TYPES = new Set<string>([
  NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
  NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_CUSTOMER_UPDATE,
  NOTIFICATION_TYPES.FREIGHTOWER_PORT_ROLLOVER_ALERT,
  NOTIFICATION_TYPES.FREIGHTOWER_PORT_OPERATION_ALERT,
  NOTIFICATION_TYPES.FREIGHTOWER_CUSTOMS_ALERT,
]);

function notificationVariablesFromContext(context: unknown) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};
  const variables = (context as Record<string, unknown>).variables;
  return variables && typeof variables === "object" && !Array.isArray(variables)
    ? variables as Record<string, unknown>
    : {};
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
  if (existing?.status === "sent") {
    return { sent: true, skipped: true, outboxId: existing.id, error: "" };
  }
  if (
    existing
    && ["pending", "sending"].includes(existing.status)
    && Date.now() - existing.updatedAt.getTime() < 5 * 60 * 1000
  ) {
    return { sent: false, skipped: true, outboxId: existing.id, error: "相同通知正在发送中" };
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
  let providerDelivered = false;
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
      html,
      attachments,
      idempotencyKey: idempotencyKey || outbox.id,
    });
    providerDelivered = true;
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
    if (providerDelivered) {
      console.error("notification-delivery-tracking-failed", {
        outboxId: outbox.id,
        type: template.type,
        message,
      });
      return { sent: true, skipped: false, outboxId: outbox.id, error: "", trackingError: message };
    }
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

export async function processFailedFreightowerNotificationOutbox(options: { limit?: number } = {}) {
  const requestedLimit = Number(options.limit || 8);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(20, Math.max(1, Math.trunc(requestedLimit)))
    : 8;
  const staleAt = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await prisma.notificationOutbox.findMany({
    where: {
      type: {
        in: [
          NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
          NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_CUSTOMER_UPDATE,
          NOTIFICATION_TYPES.FREIGHTOWER_PORT_ROLLOVER_ALERT,
          NOTIFICATION_TYPES.FREIGHTOWER_PORT_OPERATION_ALERT,
          NOTIFICATION_TYPES.FREIGHTOWER_CUSTOMS_ALERT,
        ],
      },
      attempts: { lt: FREIGHTOWER_NOTIFICATION_RETRY_MAX_ATTEMPTS },
      scheduledAt: { lte: new Date() },
      OR: [
        { status: "failed" },
        { status: "pending", updatedAt: { lte: staleAt } },
        { status: "sending", updatedAt: { lte: staleAt } },
      ],
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  const results: Array<{
    outboxId: string;
    sent: boolean;
    skipped: boolean;
    queued: boolean;
    error: string;
  }> = [];
  for (const row of rows) {
    const context = row.context && typeof row.context === "object" && !Array.isArray(row.context)
      ? row.context as Record<string, unknown>
      : {};
    try {
      const delivery = await sendNotificationEmail({
        type: row.type,
        recipientEmails: Array.isArray(row.recipientEmails) ? row.recipientEmails : [],
        ccEmails: Array.isArray(row.ccEmails) ? row.ccEmails : [],
        variables: notificationVariablesFromContext(context),
        relatedEntityType: row.relatedEntityType || undefined,
        relatedEntityId: row.relatedEntityId || undefined,
        relatedOrderId: row.relatedOrderId || undefined,
        idempotencyKey: row.idempotencyKey || undefined,
        context,
      });
      results.push({
        outboxId: row.id,
        sent: delivery.sent,
        skipped: delivery.skipped,
        queued: false,
        error: delivery.error,
      });
    } catch (error: unknown) {
      const message = publicSendError(error);
      results.push({
        outboxId: row.id,
        sent: false,
        skipped: false,
        queued: row.attempts + 1 < FREIGHTOWER_NOTIFICATION_RETRY_MAX_ATTEMPTS,
        error: message,
      });
    }
  }
  return {
    scanned: rows.length,
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => !result.sent && !result.skipped).length,
    skipped: results.filter((result) => result.skipped).length,
    queued: results.filter((result) => result.queued).length,
    results,
  };
}
