import type { Prisma } from "../generated/prisma/client.js";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { codedError } from "./shared-base-errors";

const SMS_LEASE_MS = 5 * 60 * 1000;

export async function retireFactoryPurchaseOrderDispatchSms(
  tx: Prisma.TransactionClient,
  input: {
    purchaseOrderIds: string[];
    now: Date;
    reason: string;
    freshSendingMessage: string;
    freshSendingCode: string;
  },
) {
  const purchaseOrderIds = [...new Set(input.purchaseOrderIds.filter(Boolean))];
  if (!purchaseOrderIds.length) return { unknownPurchaseOrderIds: [] as string[] };
  const staleBefore = new Date(input.now.getTime() - SMS_LEASE_MS);
  const baseWhere = {
    type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH_SMS,
    channel: "SMS",
    relatedEntityType: "factory_purchase_order",
    relatedEntityId: { in: purchaseOrderIds },
  } as const;
  const freshSending = await tx.notificationOutbox.findFirst({
    where: { ...baseWhere, status: "sending", updatedAt: { gt: staleBefore } },
    select: { id: true },
  });
  if (freshSending) {
    throw codedError(input.freshSendingMessage, 409, input.freshSendingCode);
  }
  const [staleRows, existingUnknownOrders] = await Promise.all([
    tx.notificationOutbox.findMany({
      where: { ...baseWhere, status: "sending", updatedAt: { lte: staleBefore } },
      select: { id: true, relatedEntityId: true },
    }),
    tx.factoryPurchaseOrder.findMany({
      where: { id: { in: purchaseOrderIds }, dispatchSmsStatus: "UNKNOWN" },
      select: { id: true },
    }),
  ]);
  const unknownPurchaseOrderIds = [...new Set(
    [
      ...staleRows.map((row) => String(row.relatedEntityId || "")),
      ...existingUnknownOrders.map((order) => order.id),
    ].filter(Boolean),
  )];
  const unknownReason = "短信发送进程中断，腾讯云是否已受理无法确认；为避免重复发送，已停止自动重试";
  if (staleRows.length) {
    await tx.notificationOutbox.updateMany({
      where: { id: { in: staleRows.map((row) => row.id) }, status: "sending" },
      data: { status: "unknown", failedAt: input.now, lastError: unknownReason },
    });
    await tx.factoryPurchaseOrder.updateMany({
      where: { id: { in: unknownPurchaseOrderIds }, dispatchSmsStatus: { not: "SUBMITTED" } },
      data: { dispatchSmsStatus: "UNKNOWN", dispatchSmsError: unknownReason },
    });
  }
  await tx.notificationOutbox.updateMany({
    where: { ...baseWhere, status: { in: ["queued", "failed", "pending"] } },
    data: { status: "cancelled", failedAt: input.now, lastError: input.reason },
  });
  const cancellablePurchaseOrderIds = purchaseOrderIds.filter(
    (id) => !unknownPurchaseOrderIds.includes(id),
  );
  if (cancellablePurchaseOrderIds.length) {
    await tx.factoryPurchaseOrder.updateMany({
      where: {
        id: { in: cancellablePurchaseOrderIds },
        dispatchSmsStatus: { not: "SUBMITTED" },
      },
      data: { dispatchSmsStatus: "CANCELLED", dispatchSmsError: input.reason },
    });
  }
  return { unknownPurchaseOrderIds };
}
