import { prisma } from "../prisma";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { factoryDispatchIdempotencyKey } from "./factory-purchase-order-dispatch-outbox";
import { ACTIVE_PURCHASE_ORDER_STATUSES } from "./factory-purchase-order-dispatch-notification-helpers";

export const MAX_ATTEMPTS = 6;
export const LEASE_MS = 5 * 60 * 1000;

async function refreshPurchaseOrderEmailStatus(
  purchaseOrderId: string,
  dispatchVersionNumber: number,
) {
  const order = await prisma.factoryPurchaseOrder.findFirst({
    where: { id: purchaseOrderId, dispatchVersionNumber },
    select: { dispatchRecipientEmails: true },
  });
  const recipients = Array.isArray(order?.dispatchRecipientEmails)
    ? order.dispatchRecipientEmails.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const currentKeys = recipients.map((email) => (
    factoryDispatchIdempotencyKey(purchaseOrderId, dispatchVersionNumber, email)
  ));
  if (!currentKeys.length) return;
  const rows = await prisma.notificationOutbox.findMany({
    where: {
      type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
      relatedEntityType: "factory_purchase_order",
      relatedEntityId: purchaseOrderId,
      idempotencyKey: { in: currentKeys },
    },
    select: { status: true, sentAt: true, lastError: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }],
  });
  const allSent = rows.length === currentKeys.length && rows.every((row) => row.status === "sent");
  const sending = rows.some((row) => ["pending", "sending"].includes(row.status));
  const failed = rows.find((row) => row.status === "failed");
  const cancelled = rows.find((row) => row.status === "cancelled");
  const status = allSent ? "SENT" : sending ? "SENDING" : failed || cancelled ? "FAILED" : "NOT_SENT";
  const sentAt = allSent
    ? rows.reduce<Date | null>((latest, row) => (
      row.sentAt && (!latest || row.sentAt > latest) ? row.sentAt : latest
    ), null)
    : null;
  await prisma.factoryPurchaseOrder.updateMany({
    where: {
      id: purchaseOrderId,
      dispatchVersionNumber,
      status: { in: [...ACTIVE_PURCHASE_ORDER_STATUSES] },
    },
    data: {
      dispatchEmailStatus: status,
      dispatchEmailSentAt: sentAt,
      dispatchEmailError: (failed?.lastError || cancelled?.lastError)?.slice(0, 1000) || null,
    },
  });
}

export async function reconcilePurchaseOrderEmailStatuses(purchaseOrderIds: string[]) {
  const orders = await prisma.factoryPurchaseOrder.findMany({
    where: {
      status: { in: [...ACTIVE_PURCHASE_ORDER_STATUSES] },
      dispatchVersionNumber: { not: null },
      dispatchEmailStatus: { not: "SENT" },
      ...(purchaseOrderIds.length ? { id: { in: purchaseOrderIds } } : {}),
    },
    select: { id: true, dispatchVersionNumber: true },
    orderBy: [{ dispatchedAt: "asc" }],
    take: purchaseOrderIds.length ? Math.min(200, purchaseOrderIds.length) : 50,
  });
  for (const order of orders) {
    if (order.dispatchVersionNumber) {
      await refreshPurchaseOrderEmailStatus(order.id, order.dispatchVersionNumber);
    }
  }
}

export function retryableStatusWhere(staleBefore: Date) {
  return [
    { status: { in: ["queued", "failed"] }, attempts: { lt: MAX_ATTEMPTS } },
    { status: "pending", attempts: { lt: MAX_ATTEMPTS }, updatedAt: { lte: staleBefore } },
    { status: "sending", attempts: { lt: MAX_ATTEMPTS }, updatedAt: { lte: staleBefore } },
  ];
}

export function finalAttemptStaleSendingWhere(staleBefore: Date) {
  return { status: "sending", attempts: MAX_ATTEMPTS, updatedAt: { lte: staleBefore } };
}

export function remainingStatusWhere() {
  return [
    { status: { in: ["queued", "failed"] }, attempts: { lt: MAX_ATTEMPTS } },
    { status: "pending", attempts: { lt: MAX_ATTEMPTS } },
    { status: "sending", attempts: { lte: MAX_ATTEMPTS } },
  ];
}

export function rowStillQueued(status: string | undefined, attempts: number | undefined) {
  const count = Number(attempts || 0);
  if (status === "sending") return count <= MAX_ATTEMPTS;
  return ["queued", "failed", "pending"].includes(status || "") && count < MAX_ATTEMPTS;
}
