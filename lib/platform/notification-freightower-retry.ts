import { prisma } from "../prisma";
import { NOTIFICATION_TYPES } from "./notification-definition-types";
import { publicSendError } from "./notification-helpers";
import { sendNotificationEmail } from "./notification-send";

const FREIGHTOWER_NOTIFICATION_RETRY_MAX_ATTEMPTS = 6;

function notificationVariablesFromContext(context: unknown) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};
  const variables = (context as Record<string, unknown>).variables;
  return variables && typeof variables === "object" && !Array.isArray(variables)
    ? variables as Record<string, unknown>
    : {};
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
  const results: Array<{ outboxId: string; sent: boolean; skipped: boolean; queued: boolean; error: string }> = [];
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
