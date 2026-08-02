import { prisma } from "../prisma";
import { logServerError, nonEmpty } from "./shared-base-utils";
import { getWechatOfficialSettings } from "./wechat-official-config";
import {
  isWechatDeliveryOutcomeUnknown,
  isWechatProviderRetryable,
  sendWechatOneTimeMessage,
} from "./wechat-official-provider";

const MAX_ATTEMPTS = 6;

export type EnqueueWechatNotificationInput = {
  userIds: string[];
  idempotencyKey: string;
  title: string;
  content: string;
  url?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  relatedOrderId?: string;
};

function uniqueIds(values: unknown[]) {
  return values.map(nonEmpty).filter((value, index, rows) => Boolean(value) && rows.indexOf(value) === index);
}

function boundedText(value: unknown, limit: number) {
  return nonEmpty(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, limit).trim();
}

export async function enqueueWechatOfficialNotifications(input: EnqueueWechatNotificationInput) {
  const settings = await getWechatOfficialSettings();
  if (!settings.enabled || !settings.accountCertified || !settings.appId || !settings.appSecret || !settings.templateId) {
    return { queued: 0, skipped: uniqueIds(input.userIds).length };
  }
  const userIds = uniqueIds(input.userIds);
  let queued = 0;
  for (const userId of userIds) {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.wechatOfficialDelivery.findUnique({
        where: { idempotencyKey: `wechat:${input.idempotencyKey}:${userId}` },
        select: { id: true },
      });
      if (existing) return false;
      const user = await tx.user.findFirst({
        where: {
          id: userId,
          isActive: true,
          approvalStatus: "APPROVED",
          wechatOfficialBinding: { enabled: true },
        },
        select: { wechatOfficialBinding: { select: { openId: true } } },
      });
      const openId = user?.wechatOfficialBinding?.openId;
      if (!openId) return false;
      const subscription = await tx.wechatOfficialSubscription.findFirst({
        where: {
          userId,
          openId,
          templateId: settings.templateId,
          status: "CONFIRMED",
        },
        orderBy: [{ confirmedAt: "asc" }, { createdAt: "asc" }],
      });
      if (!subscription) return false;
      const reserved = await tx.wechatOfficialSubscription.updateMany({
        where: { id: subscription.id, status: "CONFIRMED" },
        data: { status: "RESERVED" },
      });
      if (reserved.count !== 1) return false;
      await tx.wechatOfficialDelivery.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          idempotencyKey: `wechat:${input.idempotencyKey}:${userId}`,
          status: "pending",
          title: boundedText(input.title, 15),
          content: boundedText(input.content, 200),
          url: nonEmpty(input.url).slice(0, 500) || null,
          relatedEntityType: nonEmpty(input.relatedEntityType) || null,
          relatedEntityId: nonEmpty(input.relatedEntityId) || null,
          relatedOrderId: nonEmpty(input.relatedOrderId) || null,
        },
      });
      return true;
    });
    if (created) queued += 1;
  }
  return { queued, skipped: userIds.length - queued };
}

function publicWechatError(error: unknown) {
  const message = error instanceof Error ? error.message : "微信订阅消息发送失败";
  return message.replace(/[\r\n]+/g, " ").slice(0, 300);
}

export type WechatDeliveryFailureDisposition = "retry" | "permanent_failure" | "outcome_unknown";

export function wechatDeliveryFailureDisposition(
  error: unknown,
  attempts: number,
): WechatDeliveryFailureDisposition {
  if (isWechatDeliveryOutcomeUnknown(error)) return "outcome_unknown";
  if (isWechatProviderRetryable(error) && attempts < MAX_ATTEMPTS) return "retry";
  return "permanent_failure";
}

async function reconcileInterruptedWechatDeliveries(staleAt: Date) {
  const rows = await prisma.wechatOfficialDelivery.findMany({
    where: {
      status: { in: ["sending", "dispatching"] },
      updatedAt: { lte: staleAt },
    },
    select: { id: true, subscriptionId: true },
    take: 50,
  });
  if (!rows.length) return 0;
  const reconciledAt = new Date();
  const deliveryIds = rows.map((row) => row.id);
  const subscriptionIds = rows.map((row) => row.subscriptionId);
  await prisma.$transaction([
    prisma.wechatOfficialDelivery.updateMany({
      where: { id: { in: deliveryIds }, status: { in: ["sending", "dispatching"] } },
      data: {
        status: "outcome_unknown",
        outcomeUnknownAt: reconciledAt,
        failedAt: reconciledAt,
        lastError: "发送进程中断，无法确认微信是否已接收；为避免重复通知，系统不会自动重发",
      },
    }),
    prisma.wechatOfficialSubscription.updateMany({
      where: { id: { in: subscriptionIds }, status: "RESERVED" },
      data: { status: "CONSUMED_UNKNOWN", consumedAt: reconciledAt },
    }),
  ]);
  return rows.length;
}

async function finalizeExhaustedWechatDeliveries() {
  const rows = await prisma.wechatOfficialDelivery.findMany({
    where: { status: "failed", attempts: { gte: MAX_ATTEMPTS } },
    select: { id: true, subscriptionId: true },
    take: 50,
  });
  if (!rows.length) return 0;
  const failedAt = new Date();
  await prisma.$transaction([
    prisma.wechatOfficialDelivery.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, status: "failed" },
      data: { status: "permanent_failed", failedAt },
    }),
    prisma.wechatOfficialSubscription.updateMany({
      where: { id: { in: rows.map((row) => row.subscriptionId) }, status: "RESERVED" },
      data: { status: "FAILED" },
    }),
  ]);
  return rows.length;
}

async function markDeliveryOutcomeUnknown(row: { id: string; subscriptionId: string }, error: unknown, providerAcceptedAt?: Date) {
  const failedAt = new Date();
  await prisma.$transaction([
    prisma.wechatOfficialDelivery.updateMany({
      where: { id: row.id, status: "dispatching" },
      data: {
        status: "outcome_unknown",
        providerAcceptedAt: providerAcceptedAt || null,
        outcomeUnknownAt: failedAt,
        failedAt,
        lastError: publicWechatError(error),
      },
    }),
    prisma.wechatOfficialSubscription.updateMany({
      where: { id: row.subscriptionId, status: "RESERVED" },
      data: { status: "CONSUMED_UNKNOWN", consumedAt: failedAt },
    }),
  ]);
}

export async function processWechatOfficialNotificationOutbox(options: { limit?: number } = {}) {
  const settings = await getWechatOfficialSettings();
  if (!settings.enabled || !settings.accountCertified || !settings.appId || !settings.appSecret || !settings.templateId) {
    return { scanned: 0, sent: 0, failed: 0, queued: 0, skipped: "disabled" };
  }
  const limit = Math.min(20, Math.max(1, Math.trunc(Number(options.limit || 8)) || 8));
  const staleSendingAt = new Date(Date.now() - 5 * 60_000);
  const [reconciled, exhausted] = await Promise.all([
    reconcileInterruptedWechatDeliveries(staleSendingAt),
    finalizeExhaustedWechatDeliveries(),
  ]);
  const rows = await prisma.wechatOfficialDelivery.findMany({
    where: {
      attempts: { lt: MAX_ATTEMPTS },
      scheduledAt: { lte: new Date() },
      status: { in: ["pending", "failed"] },
    },
    include: { subscription: true },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  let sent = 0;
  let failed = 0;
  let queued = 0;
  let outcomeUnknown = reconciled;
  for (const row of rows) {
    const claimed = await prisma.wechatOfficialDelivery.updateMany({
      where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
      data: { status: "dispatching", attempts: { increment: 1 }, lastError: null },
    });
    if (claimed.count !== 1) continue;
    const attempts = row.attempts + 1;
    try {
      if (!row.subscription.openId || row.subscription.status !== "RESERVED") {
        throw new Error("微信一次性订阅授权已失效");
      }
      await sendWechatOneTimeMessage({
        openId: row.subscription.openId,
        templateId: row.subscription.templateId,
        scene: row.subscription.scene,
        title: row.title,
        content: row.content,
        url: row.url || undefined,
      });
      const sentAt = new Date();
      try {
        await prisma.$transaction([
          prisma.wechatOfficialDelivery.update({
            where: { id: row.id },
            data: {
              status: "sent",
              providerAcceptedAt: sentAt,
              sentAt,
              failedAt: null,
              outcomeUnknownAt: null,
              lastError: null,
            },
          }),
          prisma.wechatOfficialSubscription.update({
            where: { id: row.subscriptionId },
            data: { status: "CONSUMED", consumedAt: sentAt },
          }),
        ]);
      } catch (persistenceError: unknown) {
        // 微信已经明确接收；即使本地落库失败也绝不能再次调用发送接口。
        logServerError("Persist accepted WeChat delivery failed", persistenceError, { deliveryId: row.id });
        try {
          await markDeliveryOutcomeUnknown(
            row,
            new Error("微信已接收消息，但本地状态保存失败；系统不会自动重复发送"),
            sentAt,
          );
        } catch (recoveryError: unknown) {
          logServerError("Mark accepted WeChat delivery uncertain failed", recoveryError, { deliveryId: row.id });
        }
      }
      sent += 1;
    } catch (error: unknown) {
      const disposition = wechatDeliveryFailureDisposition(error, attempts);
      if (disposition === "outcome_unknown") {
        await markDeliveryOutcomeUnknown(row, error);
        outcomeUnknown += 1;
      } else if (disposition === "retry") {
        await prisma.wechatOfficialDelivery.updateMany({
          where: { id: row.id, status: "dispatching" },
          data: {
            status: "failed",
            failedAt: new Date(),
            lastError: publicWechatError(error),
            scheduledAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
          },
        });
        queued += 1;
      } else {
        const failedAt = new Date();
        await prisma.$transaction([
          prisma.wechatOfficialDelivery.updateMany({
            where: { id: row.id, status: "dispatching" },
            data: { status: "permanent_failed", failedAt, lastError: publicWechatError(error) },
          }),
          prisma.wechatOfficialSubscription.updateMany({
            where: { id: row.subscriptionId, status: "RESERVED" },
            data: { status: "FAILED" },
          }),
        ]);
      }
      failed += 1;
    }
  }
  return { scanned: rows.length, sent, failed, queued, outcomeUnknown, reconciled, exhausted };
}
