import type { Prisma } from "../generated/prisma/client.js";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { retireFactoryPurchaseOrderDispatchSms } from "./factory-purchase-order-dispatch-sms-retirement";
import { codedError } from "./shared-base-errors";

const FACTORY_DISPATCH_EMAIL_LEASE_MS = 5 * 60 * 1000;

export async function retireVoidedSalesExecutionNotifications(
  tx: Prisma.TransactionClient,
  purchaseOrderIds: string[],
  voidedAt: Date,
) {
  if (!purchaseOrderIds.length) return;
  const freshEmail = await tx.notificationOutbox.findFirst({
    where: {
      type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
      channel: "EMAIL",
      relatedEntityType: "factory_purchase_order",
      relatedEntityId: { in: purchaseOrderIds },
      status: "sending",
      updatedAt: {
        gt: new Date(voidedAt.getTime() - FACTORY_DISPATCH_EMAIL_LEASE_MS),
      },
    },
    select: { id: true },
  });
  if (freshEmail) {
    throw codedError(
      "工厂采购单通知正在发送，请稍后再作废",
      409,
      "FACTORY_PURCHASE_ORDER_EMAIL_SENDING",
    );
  }
  await tx.notificationOutbox.updateMany({
    where: {
      type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
      channel: "EMAIL",
      relatedEntityType: "factory_purchase_order",
      relatedEntityId: { in: purchaseOrderIds },
      status: { in: ["queued", "failed", "pending", "sending"] },
    },
    data: { status: "cancelled", lastError: "销售执行单及工厂采购单已作废" },
  });
  await retireFactoryPurchaseOrderDispatchSms(tx, {
    purchaseOrderIds,
    now: voidedAt,
    reason: "销售执行单及工厂采购单已作废",
    freshSendingMessage: "工厂采购单短信正在发送，请稍后再作废",
    freshSendingCode: "FACTORY_PURCHASE_ORDER_SMS_SENDING",
  });
}
