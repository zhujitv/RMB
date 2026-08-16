import { prisma } from "../prisma";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { ACTIVE_PURCHASE_ORDER_STATUSES } from "./factory-purchase-order-dispatch-notification-helpers";
import { factoryDispatchSmsIdempotencyKey } from "./factory-purchase-order-dispatch-sms-keys";

export const FACTORY_DISPATCH_SMS_MAX_ATTEMPTS = 6;
export const FACTORY_DISPATCH_SMS_LEASE_MS = 5 * 60 * 1000;

function storedPhones(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((phone) => String(phone || "").trim()).filter(Boolean))]
    : [];
}

type SmsStatusRow = {
  status: string;
  sentAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
  attempts: number;
};

export function deriveFactoryDispatchSmsState(rows: SmsStatusRow[], expectedCount: number) {
  const allSubmitted = rows.length === expectedCount
    && rows.every((row) => row.status === "sent");
  const outcomeUnknown = rows.find((row) => row.status === "unknown");
  const sending = rows.some((row) => ["pending", "sending"].includes(row.status));
  const queued = rows.some((row) => row.status === "queued");
  const retrying = rows.find((row) => (
    row.status === "failed" && row.attempts < FACTORY_DISPATCH_SMS_MAX_ATTEMPTS
  ));
  const failed = rows.find((row) => (
    row.status === "terminal_failed"
    || (row.status === "failed" && row.attempts >= FACTORY_DISPATCH_SMS_MAX_ATTEMPTS)
  ));
  const cancelled = rows.find((row) => row.status === "cancelled");
  const status = allSubmitted
    ? "SUBMITTED"
    : outcomeUnknown
      ? "UNKNOWN"
      : sending
        ? "SENDING"
        : queued
          ? "NOT_SENT"
          : retrying
            ? "RETRYING"
            : failed
              ? "FAILED"
              : cancelled
                ? "CANCELLED"
                : "NOT_SENT";
  const submittedAt = allSubmitted
    ? rows.reduce<Date | null>((latest, row) => (
      row.sentAt && (!latest || row.sentAt > latest) ? row.sentAt : latest
    ), null)
    : null;
  return {
    status,
    submittedAt,
    error: (outcomeUnknown?.lastError
      || retrying?.lastError
      || failed?.lastError
      || cancelled?.lastError)?.slice(0, 1000) || null,
  };
}

async function refreshPurchaseOrderSmsStatus(
  purchaseOrderId: string,
  dispatchVersionNumber: number,
) {
  const order = await prisma.factoryPurchaseOrder.findFirst({
    where: { id: purchaseOrderId, dispatchVersionNumber },
    select: { dispatchRecipientPhones: true },
  });
  const phones = storedPhones(order?.dispatchRecipientPhones);
  const keys = phones.map((phone) => (
    factoryDispatchSmsIdempotencyKey(purchaseOrderId, dispatchVersionNumber, phone)
  ));
  if (!keys.length) return;
  const rows = await prisma.notificationOutbox.findMany({
    where: {
      type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH_SMS,
      channel: "SMS",
      relatedEntityType: "factory_purchase_order",
      relatedEntityId: purchaseOrderId,
      idempotencyKey: { in: keys },
    },
    select: { status: true, sentAt: true, lastError: true, updatedAt: true, attempts: true },
    orderBy: [{ updatedAt: "desc" }],
  });
  const state = deriveFactoryDispatchSmsState(rows, keys.length);
  await prisma.factoryPurchaseOrder.updateMany({
    where: {
      id: purchaseOrderId,
      dispatchVersionNumber,
      status: { in: [...ACTIVE_PURCHASE_ORDER_STATUSES] },
    },
    data: {
      dispatchSmsStatus: state.status,
      dispatchSmsSentAt: state.submittedAt,
      dispatchSmsError: state.error,
    },
  });
}

export async function reconcilePurchaseOrderSmsStatuses(purchaseOrderIds: string[]) {
  const orders = await prisma.factoryPurchaseOrder.findMany({
    where: {
      status: { in: [...ACTIVE_PURCHASE_ORDER_STATUSES] },
      dispatchVersionNumber: { not: null },
      dispatchSmsStatus: { notIn: ["SUBMITTED", "DISABLED", "NO_RECIPIENT", "CONFIG_ERROR"] },
      ...(purchaseOrderIds.length ? { id: { in: purchaseOrderIds } } : {}),
    },
    select: { id: true, dispatchVersionNumber: true },
    orderBy: [{ dispatchedAt: "asc" }],
    take: purchaseOrderIds.length ? Math.min(200, purchaseOrderIds.length) : 50,
  });
  for (const order of orders) {
    if (order.dispatchVersionNumber) {
      await refreshPurchaseOrderSmsStatus(order.id, order.dispatchVersionNumber);
    }
  }
}

export function factoryDispatchSmsRetryableStatusWhere(staleBefore: Date) {
  return [
    {
      status: { in: ["queued", "failed"] },
      attempts: { lt: FACTORY_DISPATCH_SMS_MAX_ATTEMPTS },
    },
    {
      status: "pending",
      attempts: { lt: FACTORY_DISPATCH_SMS_MAX_ATTEMPTS },
      updatedAt: { lte: staleBefore },
    },
  ];
}

export function factoryDispatchSmsStaleSendingWhere(staleBefore: Date) {
  return { status: "sending", updatedAt: { lte: staleBefore } };
}

export function factoryDispatchSmsRemainingStatusWhere() {
  return [
    {
      status: { in: ["queued", "failed"] },
      attempts: { lt: FACTORY_DISPATCH_SMS_MAX_ATTEMPTS },
    },
    { status: "pending", attempts: { lt: FACTORY_DISPATCH_SMS_MAX_ATTEMPTS } },
    { status: "sending" },
  ];
}

export function factoryDispatchSmsRetryAt(attempt: number) {
  const delays = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 8 * 60 * 60_000];
  return new Date(Date.now() + (delays[Math.max(0, attempt - 1)] || 24 * 60 * 60_000));
}
