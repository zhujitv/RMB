import type { Prisma } from "../generated/prisma/client.js";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { codedError } from "./shared-base-errors";
import { retireFactoryPurchaseOrderDispatchSms } from "./factory-purchase-order-dispatch-sms-retirement";

const DISPATCH_LEASE_MS = 5 * 60 * 1000;

export async function retireRejectedPurchaseOrderNotifications(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  now: Date,
) {
  const staleBefore = new Date(now.getTime() - DISPATCH_LEASE_MS);
  const sending = await tx.notificationOutbox.findFirst({
    where: {
      type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
      channel: "EMAIL",
      relatedEntityType: "factory_purchase_order",
      relatedEntityId: purchaseOrderId,
      status: "sending",
      updatedAt: { gt: staleBefore },
    },
    select: { id: true },
  });
  if (sending) {
    throw codedError(
      "原采购单通知正在发送，请稍后再重新选厂",
      409,
      "FACTORY_PURCHASE_ORDER_REASSIGN_NOTIFICATION_SENDING",
    );
  }
  await tx.notificationOutbox.updateMany({
    where: {
      type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
      channel: "EMAIL",
      relatedEntityType: "factory_purchase_order",
      relatedEntityId: purchaseOrderId,
      OR: [
        { status: { in: ["queued", "failed", "pending"] } },
        { status: "sending", updatedAt: { lte: staleBefore } },
      ],
    },
    data: { status: "cancelled", lastError: "采购单已拒绝并重新选厂，原通知已取消" },
  });
  return retireFactoryPurchaseOrderDispatchSms(tx, {
    purchaseOrderIds: [purchaseOrderId],
    now,
    reason: "采购单已拒绝并重新选厂，原短信通知已取消",
    freshSendingMessage: "原采购单短信正在发送，请稍后再重新选厂",
    freshSendingCode: "FACTORY_PURCHASE_ORDER_REASSIGN_SMS_SENDING",
  });
}
