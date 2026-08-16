import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { isPlainRecord } from "./shared-base-utils";
import { getSmsIntegrationSettings, normalizeChinaMobilePhone } from "./sms-integration";
import { ACTIVE_PURCHASE_ORDER_STATUSES } from "./factory-purchase-order-dispatch-notification-helpers";
import { FACTORY_DISPATCH_SMS_CHANNEL } from "./factory-purchase-order-dispatch-sms-outbox";
import { factoryDispatchSmsRetryableStatusWhere } from "./factory-purchase-order-dispatch-sms-status";

export type SmsOutboxContext = {
  poNo: string;
  dispatchVersionNumber: number;
};

export function smsOutboxContext(value: unknown): SmsOutboxContext {
  const context = isPlainRecord(value) ? value : {};
  return {
    poNo: String(context.poNo || "").trim(),
    dispatchVersionNumber: Number(context.dispatchVersionNumber || 0),
  };
}

function frozenPhone(value: unknown) {
  if (!Array.isArray(value) || value.length !== 1) return "";
  return normalizeChinaMobilePhone(value[0]) || "";
}

function smsSettingsReady(settings: Awaited<ReturnType<typeof getSmsIntegrationSettings>>) {
  return Boolean(
    settings.enabled
    && settings.credentialsComplete
    && settings.tencentSdkAppId
    && settings.signName
    && settings.templateId,
  );
}

export async function claimFactoryDispatchSmsOutboxRow(
  outboxId: string,
  purchaseOrderId: string,
  seedContext: SmsOutboxContext,
  staleBefore: Date,
) {
  return prisma.$transaction(async (tx) => {
    const orders = purchaseOrderId
      ? await tx.$queryRaw<Array<{
          id: string;
          status: string;
          poNo: string;
          dispatchVersionNumber: number | null;
          dispatchSmsEnabled: boolean;
          dispatchSmsPhone: string | null;
          supplierStatus: string;
          supplierDeletedAt: Date | null;
        }>>(
          Prisma.sql`
            SELECT po."id", po."status", po."po_no" AS "poNo",
                   po."dispatch_version_number" AS "dispatchVersionNumber",
                   supplier."dispatch_sms_enabled" AS "dispatchSmsEnabled",
                   supplier."dispatch_sms_phone" AS "dispatchSmsPhone",
                   supplier."status" AS "supplierStatus",
                   supplier."deleted_at" AS "supplierDeletedAt"
            FROM "factory_purchase_orders" po
            JOIN "suppliers" supplier ON supplier."id" = po."supplier_id"
            WHERE po."id" = ${purchaseOrderId}
            FOR UPDATE OF po
          `,
        )
      : [];
    const order = orders[0];
    const row = await tx.notificationOutbox.findUnique({ where: { id: outboxId } });
    const context = smsOutboxContext(row?.context);
    const phone = frozenPhone(row?.recipientPhones);
    const currentPhone = order?.dispatchSmsEnabled
      && order.supplierStatus === "启用"
      && !order.supplierDeletedAt
      ? normalizeChinaMobilePhone(order.dispatchSmsPhone)
      : null;
    const workflowEligible = Boolean(
      row
      && row.type === NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH_SMS
      && row.channel === FACTORY_DISPATCH_SMS_CHANNEL
      && order
      && order.dispatchVersionNumber === context.dispatchVersionNumber
      && context.dispatchVersionNumber === seedContext.dispatchVersionNumber
      && context.poNo === order.poNo
      && ACTIVE_PURCHASE_ORDER_STATUSES.includes(order.status as (typeof ACTIVE_PURCHASE_ORDER_STATUSES)[number])
    );
    if (!workflowEligible || !phone || currentPhone !== phone) {
      const reason = !workflowEligible
        ? "采购单已作废、被拒绝或下发版本已失效"
        : "供应商短信通知已关闭或接收手机号已变更";
      await tx.notificationOutbox.updateMany({
        where: { id: outboxId, status: { in: ["queued", "failed", "pending", "sending"] } },
        data: { status: "cancelled", failedAt: new Date(), lastError: reason },
      });
      if (workflowEligible) {
        await tx.factoryPurchaseOrder.updateMany({
          where: { id: purchaseOrderId },
          data: { dispatchSmsStatus: "CANCELLED", dispatchSmsError: reason },
        });
      }
      return null;
    }

    if (row?.status === "sending" && row.updatedAt <= staleBefore) {
      const reason = "短信发送进程中断，腾讯云是否已受理无法确认；为避免重复发送，已停止自动重试";
      await tx.notificationOutbox.updateMany({
        where: { id: outboxId, status: "sending", updatedAt: { lte: staleBefore } },
        data: { status: "unknown", failedAt: new Date(), lastError: reason },
      });
      await tx.factoryPurchaseOrder.updateMany({
        where: { id: purchaseOrderId },
        data: { dispatchSmsStatus: "UNKNOWN", dispatchSmsError: reason },
      });
      return { terminalUnknown: true as const, row, phone, context };
    }

    let settings: Awaited<ReturnType<typeof getSmsIntegrationSettings>> | null = null;
    let settingsReadFailed = false;
    try {
      settings = await getSmsIntegrationSettings(tx);
    } catch {
      settingsReadFailed = true;
    }
    if (settingsReadFailed || (settings?.enabled && !smsSettingsReady(settings))) {
      const reason = settingsReadFailed
        ? "短信设置暂时读取失败，系统稍后自动重试"
        : "短信设置不完整，系统将在配置修正后自动重试";
      await tx.notificationOutbox.updateMany({
        where: { id: outboxId, status: { in: ["queued", "failed", "pending"] } },
        data: { status: "failed", scheduledAt: new Date(Date.now() + 30 * 60 * 1000), lastError: reason },
      });
      await tx.factoryPurchaseOrder.updateMany({
        where: { id: purchaseOrderId },
        data: { dispatchSmsStatus: "CONFIG_ERROR", dispatchSmsError: reason },
      });
      return { configurationDeferred: true as const, row, phone, context };
    }
    if (!settings?.enabled) {
      const reason = "短信通知已在系统设置中关闭";
      await tx.notificationOutbox.updateMany({
        where: { id: outboxId, status: { in: ["queued", "failed", "pending"] } },
        data: { status: "cancelled", failedAt: new Date(), lastError: reason },
      });
      await tx.factoryPurchaseOrder.updateMany({
        where: { id: purchaseOrderId },
        data: { dispatchSmsStatus: "CANCELLED", dispatchSmsError: reason },
      });
      return null;
    }

    const claimed = await tx.notificationOutbox.updateMany({
      where: {
        id: outboxId,
        type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH_SMS,
        channel: FACTORY_DISPATCH_SMS_CHANNEL,
        OR: factoryDispatchSmsRetryableStatusWhere(staleBefore),
      },
      data: { status: "sending", attempts: { increment: 1 }, lastError: null, failedAt: null, updatedAt: new Date() },
    });
    if (claimed.count !== 1) return undefined;
    await tx.factoryPurchaseOrder.updateMany({
      where: { id: purchaseOrderId },
      data: { dispatchSmsStatus: "SENDING", dispatchSmsError: null },
    });
    const claimedRow = await tx.notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } });
    return { terminalUnknown: false as const, row: claimedRow, phone, context };
  });
}
