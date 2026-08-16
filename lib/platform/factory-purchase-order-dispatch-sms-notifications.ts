import { prisma } from "../prisma";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { redactSensitiveText } from "./shared-base-utils";
import { sendTencentCloudSms } from "./sms-integration";
import { ACTIVE_PURCHASE_ORDER_STATUSES } from "./factory-purchase-order-dispatch-notification-helpers";
import { FACTORY_DISPATCH_SMS_CHANNEL } from "./factory-purchase-order-dispatch-sms-outbox";
import {
  FACTORY_DISPATCH_SMS_LEASE_MS,
  FACTORY_DISPATCH_SMS_MAX_ATTEMPTS,
  factoryDispatchSmsRemainingStatusWhere,
  factoryDispatchSmsRetryAt,
  factoryDispatchSmsRetryableStatusWhere,
  factoryDispatchSmsStaleSendingWhere,
  reconcilePurchaseOrderSmsStatuses,
} from "./factory-purchase-order-dispatch-sms-status";
import {
  claimFactoryDispatchSmsOutboxRow,
  smsOutboxContext,
} from "./factory-purchase-order-dispatch-sms-claim";

function safeProviderMessage(value: unknown, fallback: string) {
  return redactSensitiveText(String(value || "").trim(), 1000) || fallback;
}

async function markSmsOutcome(
  row: {
    id: string;
    attempts: number;
    relatedEntityId: string | null;
    recipientPhones: unknown;
    subject: string;
    body: string;
    type: string;
    templateId: string | null;
  },
  outcome: {
    outboxStatus: "sent" | "failed" | "terminal_failed" | "unknown";
    purchaseOrderStatus: "SUBMITTED" | "FAILED" | "RETRYING" | "UNKNOWN";
    message?: string;
    retryAt?: Date;
    providerPreview?: string;
  },
) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.notificationOutbox.updateMany({
      where: { id: row.id, status: "sending", attempts: row.attempts },
      data: {
        status: outcome.outboxStatus,
        sentAt: outcome.outboxStatus === "sent" ? now : null,
        failedAt: outcome.outboxStatus === "sent" ? null : now,
        scheduledAt: outcome.retryAt || now,
        lastError: outcome.message || null,
      },
    });
    if (updated.count !== 1) return false;
    await tx.notificationDeliveryLog.create({
      data: {
        outboxId: row.id,
        templateId: row.templateId,
        type: row.type,
        channel: FACTORY_DISPATCH_SMS_CHANNEL,
        status: outcome.purchaseOrderStatus,
        recipientEmails: [],
        recipientPhones: Array.isArray(row.recipientPhones) ? row.recipientPhones : [],
        ccEmails: [],
        subject: row.subject,
        bodyPreview: outcome.providerPreview || row.body,
        relatedEntityType: "factory_purchase_order",
        relatedEntityId: row.relatedEntityId,
        errorMessage: outcome.message || null,
        provider: "Tencent Cloud SMS",
        sentAt: outcome.outboxStatus === "sent" ? now : null,
      },
    });
    if (row.relatedEntityId) {
      await tx.factoryPurchaseOrder.updateMany({
        where: { id: row.relatedEntityId, status: { in: [...ACTIVE_PURCHASE_ORDER_STATUSES] } },
        data: {
          dispatchSmsStatus: outcome.purchaseOrderStatus,
          dispatchSmsSentAt: outcome.outboxStatus === "sent" ? now : null,
          dispatchSmsError: outcome.message || null,
        },
      });
    }
    return true;
  });
}

async function processSmsOutboxRow(outboxId: string, staleBefore: Date) {
  const seed = await prisma.notificationOutbox.findUnique({ where: { id: outboxId } });
  const purchaseOrderId = String(seed?.relatedEntityId || "");
  const claim = await claimFactoryDispatchSmsOutboxRow(
    outboxId,
    purchaseOrderId,
    smsOutboxContext(seed?.context),
    staleBefore,
  );
  if (claim === null) {
    return { outboxId, purchaseOrderId, submitted: false, skipped: true, queued: false, error: "短信任务已取消" };
  }
  if (claim === undefined) {
    const current = await prisma.notificationOutbox.findUnique({ where: { id: outboxId } });
    return {
      outboxId,
      purchaseOrderId,
      submitted: current?.status === "sent",
      skipped: true,
      queued: ["queued", "failed", "pending", "sending"].includes(current?.status || "")
        && Number(current?.attempts || 0) < FACTORY_DISPATCH_SMS_MAX_ATTEMPTS,
      error: current?.lastError || "短信任务已由其他进程处理",
    };
  }
  if ("configurationDeferred" in claim && claim.configurationDeferred) {
    return { outboxId, purchaseOrderId, submitted: false, skipped: true, queued: true, error: "短信配置暂不可用，已延后重试" };
  }
  if ("terminalUnknown" in claim && claim.terminalUnknown) {
    return { outboxId, purchaseOrderId, submitted: false, skipped: false, queued: false, unknown: true, error: "短信发送结果未知，已停止自动重试" };
  }

  const { row, phone, context } = claim;
  try {
    const results = await sendTencentCloudSms({
      phoneNumbers: [phone],
      templateParams: [context.poNo],
      sessionContext: `factory-po:${purchaseOrderId}:v${context.dispatchVersionNumber}`,
    });
    const result = results.find((candidate) => candidate.phoneNumber === phone) || results[0];
    if (!result) {
      const message = "腾讯云未返回短信受理结果；为避免重复发送，已停止自动重试";
      await markSmsOutcome(row, { outboxStatus: "unknown", purchaseOrderStatus: "UNKNOWN", message });
      return { outboxId, purchaseOrderId, submitted: false, skipped: false, queued: false, unknown: true, error: message };
    }
    const providerPreview = [
      result.requestId ? `RequestId ${result.requestId}` : "",
      result.serialNo ? `SerialNo ${result.serialNo}` : "",
      result.code ? `Code ${result.code}` : "",
    ].filter(Boolean).join(" · ");
    if (result.accepted) {
      await markSmsOutcome(row, {
        outboxStatus: "sent",
        purchaseOrderStatus: "SUBMITTED",
        providerPreview: providerPreview || "腾讯云已受理",
      });
      return { outboxId, purchaseOrderId, submitted: true, skipped: false, queued: false, error: "" };
    }

    const message = safeProviderMessage(result.message, `腾讯云短信发送失败（${result.code || "UNKNOWN"}）`);
    if (result.outcomeUnknown) {
      const unknownMessage = `${message}；腾讯云是否已受理无法确认，为避免重复发送，已停止自动重试`;
      await markSmsOutcome(row, {
        outboxStatus: "unknown",
        purchaseOrderStatus: "UNKNOWN",
        message: unknownMessage,
        providerPreview,
      });
      return { outboxId, purchaseOrderId, submitted: false, skipped: false, queued: false, unknown: true, error: unknownMessage };
    }
    const retryable = result.retryable && row.attempts < FACTORY_DISPATCH_SMS_MAX_ATTEMPTS;
    await markSmsOutcome(row, {
      outboxStatus: retryable ? "failed" : "terminal_failed",
      purchaseOrderStatus: retryable ? "RETRYING" : "FAILED",
      message,
      retryAt: retryable ? factoryDispatchSmsRetryAt(row.attempts) : undefined,
      providerPreview,
    });
    return { outboxId, purchaseOrderId, submitted: false, skipped: false, queued: retryable, error: message };
  } catch (error: unknown) {
    const message = `${safeProviderMessage(error instanceof Error ? error.message : error, "短信发送出现未知异常")}；发送结果无法确认，为避免重复发送，已停止自动重试`;
    await markSmsOutcome(row, {
      outboxStatus: "unknown",
      purchaseOrderStatus: "UNKNOWN",
      message,
    }).catch(() => undefined);
    return { outboxId, purchaseOrderId, submitted: false, skipped: false, queued: false, unknown: true, error: message };
  }
}

export async function processFactoryPurchaseOrderDispatchSmsOutbox(options: {
  limit?: number;
  purchaseOrderIds?: string[];
} = {}) {
  const requestedLimit = Number(options.limit || 20);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(50, Math.max(1, Math.trunc(requestedLimit)))
    : 20;
  const purchaseOrderIds = [...new Set((options.purchaseOrderIds || []).filter(Boolean))];
  const staleBefore = new Date(Date.now() - FACTORY_DISPATCH_SMS_LEASE_MS);
  const candidates = await prisma.notificationOutbox.findMany({
    where: {
      type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH_SMS,
      channel: FACTORY_DISPATCH_SMS_CHANNEL,
      scheduledAt: { lte: new Date() },
      OR: [
        ...factoryDispatchSmsRetryableStatusWhere(staleBefore),
        factoryDispatchSmsStaleSendingWhere(staleBefore),
      ],
      ...(purchaseOrderIds.length ? { relatedEntityId: { in: purchaseOrderIds } } : {}),
    },
    select: { id: true },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  const results: Awaited<ReturnType<typeof processSmsOutboxRow>>[] = [];
  for (const candidate of candidates) {
    try {
      results.push(await processSmsOutboxRow(candidate.id, staleBefore));
    } catch (error: unknown) {
      results.push({
        outboxId: candidate.id,
        purchaseOrderId: "",
        submitted: false,
        skipped: false,
        queued: true,
        error: safeProviderMessage(error instanceof Error ? error.message : error, "短信任务处理失败"),
      });
    }
  }
  await reconcilePurchaseOrderSmsStatuses(purchaseOrderIds).catch(() => undefined);
  const remaining = await prisma.notificationOutbox.count({
    where: {
      type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH_SMS,
      channel: FACTORY_DISPATCH_SMS_CHANNEL,
      OR: factoryDispatchSmsRemainingStatusWhere(),
      ...(purchaseOrderIds.length ? { relatedEntityId: { in: purchaseOrderIds } } : {}),
    },
  });
  return {
    scanned: candidates.length,
    submitted: results.filter((result) => result.submitted).length,
    failed: results.filter((result) => !result.submitted && !result.skipped && !result.queued && !("unknown" in result && result.unknown)).length,
    unknown: results.filter((result) => "unknown" in result && result.unknown).length,
    skipped: results.filter((result) => result.skipped).length,
    queued: remaining,
    results,
  };
}
