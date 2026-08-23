import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { publicSendError, uniqueEmails } from "./notification-helpers";
import { sendNotificationEmail } from "./notification-send";
import { ACTIVE_PURCHASE_ORDER_STATUSES, factoryDispatchContextRecord, factoryDispatchVariables } from "./factory-purchase-order-dispatch-notification-helpers";
import { resolveFactoryPurchaseOrderDispatchRecipients } from "./factory-purchase-order-dispatch-recipients";
import { readFrozenFactoryPurchaseOrderDispatchAttachment } from "./factory-purchase-order-dispatch-attachment-snapshot";
import {
  LEASE_MS,
  MAX_ATTEMPTS,
  finalAttemptStaleSendingWhere,
  reconcilePurchaseOrderEmailStatuses,
  remainingStatusWhere,
  retryableStatusWhere,
  rowStillQueued,
} from "./factory-purchase-order-dispatch-notification-status";

async function processOutboxRow(outboxId: string, staleBefore: Date) {
  const seed = await prisma.notificationOutbox.findUnique({ where: { id: outboxId } });
  const seedContext = factoryDispatchContextRecord(seed?.context);
  const purchaseOrderId = String(seed?.relatedEntityId || "");
  const dispatchVersionNumber = Number(seedContext.dispatchVersionNumber || 0);
  const claim = await prisma.$transaction(async (tx) => {
    const orders = purchaseOrderId
      ? await tx.$queryRaw<Array<{
          id: string;
          status: string;
          supplierId: string;
          dispatchVersionNumber: number | null;
        }>>(
          Prisma.sql`
            SELECT "id", "status", "supplier_id" AS "supplierId",
                   "dispatch_version_number" AS "dispatchVersionNumber"
            FROM "factory_purchase_orders"
            WHERE "id" = ${purchaseOrderId}
            FOR UPDATE
          `,
        )
      : [];
    const order = orders[0];
    const workflowEligible = order
      && order.dispatchVersionNumber === dispatchVersionNumber
      && ACTIVE_PURCHASE_ORDER_STATUSES.includes(order.status as (typeof ACTIVE_PURCHASE_ORDER_STATUSES)[number]);
    const currentOutbox = workflowEligible
      ? await tx.notificationOutbox.findUnique({
          where: { id: outboxId },
          select: { recipientEmails: true },
        })
      : null;
    const recipientResolution = workflowEligible
      ? await resolveFactoryPurchaseOrderDispatchRecipients(tx, order.supplierId)
      : { recipientEmails: [] as string[], blockedReason: "" };
    const frozenRecipients = uniqueEmails(
      Array.isArray(currentOutbox?.recipientEmails) ? currentOutbox.recipientEmails : [],
    );
    const recipientEligible = Boolean(
      frozenRecipients.length
      && frozenRecipients.every((email) => recipientResolution.recipientEmails.includes(email)),
    );
    const eligible = workflowEligible && recipientEligible;
    if (!eligible) {
      const ineligibleReason = workflowEligible
        ? recipientResolution.blockedReason || "采购单通知收件人已变更，请人工重试"
        : "采购单已作废或下发版本已失效";
      await tx.notificationOutbox.updateMany({
        where: {
          id: outboxId,
          status: { in: ["queued", "failed", "pending", "sending"] },
        },
        data: { status: "cancelled", lastError: ineligibleReason },
      });
      if (workflowEligible) {
        await tx.factoryPurchaseOrder.updateMany({
          where: {
            id: purchaseOrderId,
            dispatchVersionNumber,
            status: { in: [...ACTIVE_PURCHASE_ORDER_STATUSES] },
          },
          data: {
            dispatchEmailStatus: recipientResolution.recipientEmails.length ? "FAILED" : "NO_RECIPIENT",
            dispatchEmailError: ineligibleReason,
          },
        });
      }
      return null;
    }
    const claimedAt = new Date();
    let terminalizedFinalAttempt = false;
    let claimed = await tx.notificationOutbox.updateMany({
      where: {
        id: outboxId,
        type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
        channel: "EMAIL",
        OR: retryableStatusWhere(staleBefore),
      },
      data: {
        status: "sending",
        attempts: { increment: 1 },
        lastError: null,
        updatedAt: claimedAt,
      },
    });
    if (claimed.count !== 1) {
      claimed = await tx.notificationOutbox.updateMany({
        where: {
          id: outboxId,
          type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
          channel: "EMAIL",
          ...finalAttemptStaleSendingWhere(staleBefore),
        },
        data: {
          status: "failed",
          failedAt: claimedAt,
          lastError: "邮件发送租约超时，已停止自动重试，请人工确认后重试",
          updatedAt: claimedAt,
        },
      });
      terminalizedFinalAttempt = claimed.count === 1;
    }
    if (claimed.count !== 1) return undefined;
    await tx.factoryPurchaseOrder.update({
      where: { id: purchaseOrderId },
      data: terminalizedFinalAttempt
        ? {
            dispatchEmailStatus: "FAILED",
            dispatchEmailError: "邮件发送租约超时，已停止自动重试，请人工确认后重试",
          }
        : { dispatchEmailStatus: "SENDING", dispatchEmailError: null },
    });
    return tx.notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } });
  });

  if (claim === null) {
    return {
      outboxId,
      purchaseOrderId,
      sent: false,
      skipped: true,
      queued: false,
      error: "采购单已失效、供应商门户已关闭或通知收件人已撤销",
    };
  }
  if (claim === undefined) {
    const current = await prisma.notificationOutbox.findUnique({ where: { id: outboxId } });
    return {
      outboxId,
      purchaseOrderId: String(current?.relatedEntityId || ""),
      sent: current?.status === "sent",
      skipped: true,
      queued: rowStillQueued(current?.status, current?.attempts),
      error: current?.lastError || "通知任务已由其他进程处理",
    };
  }
  if (claim.status === "failed" && claim.attempts >= MAX_ATTEMPTS) {
    return {
      outboxId: claim.id,
      purchaseOrderId,
      sent: false,
      skipped: false,
      queued: false,
      error: claim.lastError || "邮件发送租约超时，已停止自动重试",
    };
  }

  const row = claim;
  const context = factoryDispatchContextRecord(row.context);
  try {
    const attachments = await readFrozenFactoryPurchaseOrderDispatchAttachment(
      purchaseOrderId,
      context.dispatchAttachment,
    );
    const delivery = await sendNotificationEmail({
      type: row.type,
      recipientEmails: Array.isArray(row.recipientEmails) ? row.recipientEmails : [],
      ccEmails: [],
      variables: factoryDispatchVariables(context),
      relatedEntityType: row.relatedEntityType || undefined,
      relatedEntityId: purchaseOrderId,
      idempotencyKey: row.idempotencyKey || undefined,
      context,
      attachments,
      subjectOverride: row.subject,
      bodyOverride: row.body,
      ignoreTemplateCc: true,
      claimedOutboxId: row.id,
      claimedOutboxAttempt: row.attempts,
    });
    if (!delivery.sent) {
      await prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: "sending", attempts: row.attempts },
        data: { status: "failed", failedAt: new Date(), lastError: delivery.error || "邮件发送未完成" },
      });
    }
    return {
      outboxId: row.id,
      purchaseOrderId,
      sent: delivery.sent,
      skipped: delivery.skipped,
      queued: !delivery.sent && row.attempts < MAX_ATTEMPTS,
      error: delivery.error,
    };
  } catch (error: unknown) {
    const message = publicSendError(error);
    await prisma.notificationOutbox.updateMany({
      where: { id: row.id, status: "sending", attempts: row.attempts },
      data: { status: "failed", failedAt: new Date(), lastError: message },
    }).catch(() => undefined);
    return {
      outboxId: row.id,
      purchaseOrderId,
      sent: false,
      skipped: false,
      queued: row.attempts < MAX_ATTEMPTS,
      error: message,
    };
  }
}

export async function processFactoryPurchaseOrderDispatchOutbox(options: {
  limit?: number;
  purchaseOrderIds?: string[];
} = {}) {
  const requestedLimit = Number(options.limit || 20);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(50, Math.max(1, Math.trunc(requestedLimit)))
    : 20;
  const purchaseOrderIds = [...new Set((options.purchaseOrderIds || []).filter(Boolean))];
  const staleBefore = new Date(Date.now() - LEASE_MS);
  const candidates = await prisma.notificationOutbox.findMany({
    where: {
      type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
      channel: "EMAIL",
      scheduledAt: { lte: new Date() },
      OR: [...retryableStatusWhere(staleBefore), finalAttemptStaleSendingWhere(staleBefore)],
      ...(purchaseOrderIds.length ? { relatedEntityId: { in: purchaseOrderIds } } : {}),
    },
    select: { id: true },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  const results: Awaited<ReturnType<typeof processOutboxRow>>[] = [];
  for (const candidate of candidates) {
    results.push(await processOutboxRow(candidate.id, staleBefore));
  }
  await reconcilePurchaseOrderEmailStatuses(purchaseOrderIds).catch(() => undefined);
  const remaining = await prisma.notificationOutbox.count({
    where: {
      type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
      channel: "EMAIL",
      OR: remainingStatusWhere(),
      ...(purchaseOrderIds.length ? { relatedEntityId: { in: purchaseOrderIds } } : {}),
    },
  });
  return {
    scanned: candidates.length,
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => !result.sent && !result.skipped).length,
    skipped: results.filter((result) => result.skipped).length,
    queued: remaining,
    results,
  };
}
