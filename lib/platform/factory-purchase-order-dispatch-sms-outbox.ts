import { Prisma } from "../generated/prisma/client.js";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import {
  getSmsIntegrationSettings,
} from "./sms-integration-settings";
import { normalizeChinaMobilePhone } from "./sms-integration-config";
import { ACTIVE_PURCHASE_ORDER_STATUSES } from "./factory-purchase-order-dispatch-notification-helpers";
import { factoryDispatchSmsIdempotencyKey } from "./factory-purchase-order-dispatch-sms-keys";

export {
  factoryDispatchSmsIdempotencyKey,
  factoryDispatchSmsRecipientKey,
} from "./factory-purchase-order-dispatch-sms-keys";

export const FACTORY_DISPATCH_SMS_CHANNEL = "SMS";

type QueueFactoryDispatchSmsOptions = {
  purchaseOrderIds?: string[];
};

function settingsUsable(settings: Awaited<ReturnType<typeof getSmsIntegrationSettings>>) {
  return Boolean(
    settings.enabled
    && settings.tencentSdkAppId
    && settings.signName
    && settings.templateId
    && settings.credentialsComplete,
  );
}

export async function queueFactoryPurchaseOrderDispatchSmsOutbox(
  tx: Prisma.TransactionClient,
  executionId: string,
  dispatchVersionNumber: number,
  options: QueueFactoryDispatchSmsOptions = {},
) {
  const orders = await tx.factoryPurchaseOrder.findMany({
    where: {
      executionId,
      dispatchVersionNumber,
      status: { in: [...ACTIVE_PURCHASE_ORDER_STATUSES] },
      ...(options.purchaseOrderIds?.length ? { id: { in: options.purchaseOrderIds } } : {}),
    },
    include: {
      supplier: {
        select: {
          deletedAt: true,
          status: true,
          dispatchSmsEnabled: true,
          dispatchSmsPhone: true,
        },
      },
    },
  });
  const purchaseOrderIds = orders.map((order) => order.id);
  let settings: Awaited<ReturnType<typeof getSmsIntegrationSettings>> | null = null;
  let settingsReadFailed = false;
  try {
    settings = await getSmsIntegrationSettings(tx);
  } catch {
    settingsReadFailed = true;
  }

  const globallyEnabled = Boolean(settings?.enabled);
  const configurationReady = Boolean(settings && settingsUsable(settings));
  const outboxRows: Prisma.NotificationOutboxCreateManyInput[] = [];
  let missingRecipient = 0;
  let disabled = 0;
  let configurationError = 0;

  for (const order of orders) {
    if (["SUBMITTED", "SENDING", "UNKNOWN"].includes(order.dispatchSmsStatus || "")) continue;
    if (!order.supplier.dispatchSmsEnabled) {
      disabled += 1;
      await tx.factoryPurchaseOrder.updateMany({
        where: { id: order.id, dispatchSmsStatus: { not: "SUBMITTED" } },
        data: {
          dispatchSmsStatus: "DISABLED",
          dispatchRecipientPhones: [],
          dispatchSmsError: null,
        },
      });
      continue;
    }
    if (!settingsReadFailed && !globallyEnabled) {
      disabled += 1;
      await tx.factoryPurchaseOrder.updateMany({
        where: { id: order.id, dispatchSmsStatus: { not: "SUBMITTED" } },
        data: {
          dispatchSmsStatus: "DISABLED",
          dispatchRecipientPhones: [],
          dispatchSmsError: null,
        },
      });
      continue;
    }
    const phone = order.supplier.deletedAt || order.supplier.status !== "启用"
      ? ""
      : normalizeChinaMobilePhone(order.supplier.dispatchSmsPhone);
    if (!phone) {
      missingRecipient += 1;
      await tx.factoryPurchaseOrder.updateMany({
        where: { id: order.id, dispatchSmsStatus: { not: "SUBMITTED" } },
        data: {
          dispatchSmsStatus: "NO_RECIPIENT",
          dispatchRecipientPhones: [],
          dispatchSmsError: "供应商未配置有效的中国大陆短信接收手机号",
        },
      });
      continue;
    }

    const configurationProblem = settingsReadFailed || !configurationReady;
    const configurationMessage = settingsReadFailed
      ? "短信设置读取失败，系统稍后自动重试"
      : "短信设置不完整，系统将在配置修正后自动重试";
    if (configurationProblem) configurationError += 1;
    await tx.factoryPurchaseOrder.updateMany({
      where: { id: order.id, dispatchSmsStatus: { not: "SUBMITTED" } },
      data: {
        dispatchSmsStatus: configurationProblem ? "CONFIG_ERROR" : "NOT_SENT",
        dispatchRecipientPhones: [phone],
        dispatchSmsError: configurationProblem ? configurationMessage : null,
      },
    });
    outboxRows.push({
      type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH_SMS,
      channel: FACTORY_DISPATCH_SMS_CHANNEL,
      idempotencyKey: factoryDispatchSmsIdempotencyKey(
        order.id,
        dispatchVersionNumber,
        phone,
      ),
      status: configurationProblem ? "failed" : "queued",
      recipientEmails: [],
      recipientPhones: [phone],
      ccEmails: [],
      subject: "工厂采购单短信通知",
      body: "采购订单下发通知",
      context: {
        poNo: order.poNo,
        dispatchVersionNumber,
      },
      relatedEntityType: "factory_purchase_order",
      relatedEntityId: order.id,
      ...(configurationProblem ? {
        scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
        lastError: configurationMessage,
      } : {}),
    });
  }

  const created = outboxRows.length
    ? await tx.notificationOutbox.createMany({ data: outboxRows, skipDuplicates: true })
    : { count: 0 };
  return {
    total: orders.length,
    queued: created.count,
    missingRecipient,
    disabled,
    configurationError,
    purchaseOrderIds,
  };
}
