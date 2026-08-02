import { prisma } from "../prisma";
import { logServerError, nonEmpty } from "./shared-base-utils";
import { getWechatMiniSettings } from "./wechat-mini-config";
import {
  isWechatMiniDeliveryOutcomeUnknown,
  isWechatMiniProviderRetryable,
  sendWechatMiniSubscriptionMessage,
} from "./wechat-mini-provider";

const MAX_ATTEMPTS = 6;

export type EnqueueWechatMiniNotificationInput = {
  userIds: string[];
  idempotencyKey: string;
  orderNo: string;
  statusText: string;
  eventTimeText: string;
  eventText: string;
  page?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  relatedOrderId?: string;
};

function uniqueIds(values: unknown[]) {
  return values.map(nonEmpty).filter((value, index, rows) => Boolean(value) && rows.indexOf(value) === index);
}

function bounded(value: unknown, limit: number) {
  return nonEmpty(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, limit).trim();
}

export async function enqueueWechatMiniNotifications(input: EnqueueWechatMiniNotificationInput) {
  const settings = await getWechatMiniSettings();
  const userIds = uniqueIds(input.userIds);
  if (!settings.enabled || !settings.appId || !settings.appSecret || !settings.trackingTemplateId) {
    return { queued: 0, skipped: userIds.length };
  }
  let queued = 0;
  for (const userId of userIds) {
    const created = await prisma.$transaction(async (tx) => {
      const idempotencyKey = `wechat-mini:${input.idempotencyKey}:${userId}`;
      if (await tx.wechatMiniDelivery.findUnique({ where: { idempotencyKey }, select: { id: true } })) return false;
      const binding = await tx.wechatMiniBinding.findFirst({
        where: { userId, enabled: true, user: { isActive: true, approvalStatus: "APPROVED", deletedAt: null } },
        select: { id: true, openId: true },
      });
      if (!binding) return false;
      const grant = await tx.wechatMiniSubscriptionGrant.findFirst({
        where: {
          userId,
          bindingId: binding.id,
          openId: binding.openId,
          templateId: settings.trackingTemplateId,
          status: "AVAILABLE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: [{ grantedAt: "asc" }, { createdAt: "asc" }],
      });
      if (!grant) return false;
      const reserved = await tx.wechatMiniSubscriptionGrant.updateMany({
        where: { id: grant.id, status: "AVAILABLE" },
        data: { status: "RESERVED", reservedAt: new Date() },
      });
      if (reserved.count !== 1) return false;
      await tx.wechatMiniDelivery.create({
        data: {
          userId,
          grantId: grant.id,
          idempotencyKey,
          page: bounded(input.page, 256) || null,
          orderNo: bounded(input.orderNo, 20) || "-",
          statusText: bounded(input.statusText, 20) || "物流更新",
          eventTimeText: bounded(input.eventTimeText, 32) || "-",
          eventText: bounded(input.eventText, 20) || "查看物流详情",
          relatedEntityType: bounded(input.relatedEntityType, 64) || null,
          relatedEntityId: bounded(input.relatedEntityId, 100) || null,
          relatedOrderId: bounded(input.relatedOrderId, 100) || null,
        },
      });
      return true;
    });
    if (created) queued += 1;
  }
  return { queued, skipped: userIds.length - queued };
}

function publicError(error: unknown) {
  return (error instanceof Error ? error.message : "小程序订阅消息发送失败").replace(/[\r\n]+/g, " ").slice(0, 300);
}

function failureDisposition(error: unknown, attempts: number) {
  if (isWechatMiniDeliveryOutcomeUnknown(error)) return "outcome_unknown" as const;
  if (isWechatMiniProviderRetryable(error) && attempts < MAX_ATTEMPTS) return "retry" as const;
  return "permanent_failure" as const;
}

async function reconcileInterrupted(staleAt: Date) {
  const rows = await prisma.wechatMiniDelivery.findMany({
    where: { status: "dispatching", updatedAt: { lte: staleAt } },
    select: { id: true, grantId: true },
    take: 50,
  });
  if (!rows.length) return 0;
  const at = new Date();
  await prisma.$transaction([
    prisma.wechatMiniDelivery.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, status: "dispatching" },
      data: { status: "outcome_unknown", outcomeUnknownAt: at, failedAt: at, lastError: "发送进程中断，结果未知；为避免重复通知不会自动重发" },
    }),
    prisma.wechatMiniSubscriptionGrant.updateMany({
      where: { id: { in: rows.map((row) => row.grantId) }, status: "RESERVED" },
      data: { status: "CONSUMED_UNKNOWN", consumedAt: at },
    }),
  ]);
  return rows.length;
}

async function markOutcomeUnknown(row: { id: string; grantId: string }, error: unknown, providerAcceptedAt?: Date) {
  const at = new Date();
  await prisma.$transaction([
    prisma.wechatMiniDelivery.updateMany({
      where: { id: row.id, status: "dispatching" },
      data: { status: "outcome_unknown", providerAcceptedAt: providerAcceptedAt || null, outcomeUnknownAt: at, failedAt: at, lastError: publicError(error) },
    }),
    prisma.wechatMiniSubscriptionGrant.updateMany({
      where: { id: row.grantId, status: "RESERVED" },
      data: { status: "CONSUMED_UNKNOWN", consumedAt: at },
    }),
  ]);
}

export async function processWechatMiniNotificationOutbox(options: { limit?: number } = {}) {
  const settings = await getWechatMiniSettings();
  if (!settings.enabled || !settings.appId || !settings.appSecret || !settings.trackingTemplateId) {
    return { scanned: 0, sent: 0, failed: 0, queued: 0, skipped: "disabled" };
  }
  const limit = Math.min(20, Math.max(1, Math.trunc(Number(options.limit || 8)) || 8));
  let outcomeUnknown = await reconcileInterrupted(new Date(Date.now() - 5 * 60_000));
  const rows = await prisma.wechatMiniDelivery.findMany({
    where: { attempts: { lt: MAX_ATTEMPTS }, scheduledAt: { lte: new Date() }, status: { in: ["pending", "failed"] } },
    include: { grant: true },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  let sent = 0;
  let failed = 0;
  let queued = 0;
  for (const row of rows) {
    const claimed = await prisma.wechatMiniDelivery.updateMany({
      where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
      data: { status: "dispatching", attempts: { increment: 1 }, lastError: null },
    });
    if (claimed.count !== 1) continue;
    const attempts = row.attempts + 1;
    try {
      if (!row.grant.openId || row.grant.status !== "RESERVED") throw new Error("小程序订阅授权已失效");
      await sendWechatMiniSubscriptionMessage({
        openId: row.grant.openId,
        templateId: row.grant.templateId,
        page: row.page || undefined,
        orderNo: row.orderNo,
        statusText: row.statusText,
        eventTimeText: row.eventTimeText,
        eventText: row.eventText,
      });
      const at = new Date();
      try {
        await prisma.$transaction([
          prisma.wechatMiniDelivery.update({ where: { id: row.id }, data: { status: "sent", providerAcceptedAt: at, sentAt: at, failedAt: null, lastError: null } }),
          prisma.wechatMiniSubscriptionGrant.update({ where: { id: row.grantId }, data: { status: "CONSUMED", consumedAt: at } }),
        ]);
      } catch (persistenceError) {
        logServerError("Persist accepted mini program delivery failed", persistenceError, { deliveryId: row.id });
        try {
          await markOutcomeUnknown(row, new Error("微信已接收消息，但本地状态保存失败；系统不会自动重复发送"), at);
        } catch (recoveryError) {
          logServerError("Mark accepted mini program delivery uncertain failed", recoveryError, { deliveryId: row.id });
        }
      }
      sent += 1;
    } catch (error) {
      const disposition = failureDisposition(error, attempts);
      if (disposition === "outcome_unknown") {
        await markOutcomeUnknown(row, error);
        outcomeUnknown += 1;
      } else if (disposition === "retry") {
        await prisma.wechatMiniDelivery.updateMany({
          where: { id: row.id, status: "dispatching" },
          data: { status: "failed", failedAt: new Date(), lastError: publicError(error), scheduledAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000) },
        });
        queued += 1;
      } else {
        const at = new Date();
        await prisma.$transaction([
          prisma.wechatMiniDelivery.updateMany({ where: { id: row.id, status: "dispatching" }, data: { status: "permanent_failed", failedAt: at, lastError: publicError(error) } }),
          prisma.wechatMiniSubscriptionGrant.updateMany({ where: { id: row.grantId, status: "RESERVED" }, data: { status: "FAILED" } }),
        ]);
      }
      failed += 1;
    }
  }
  return { scanned: rows.length, sent, failed, queued, outcomeUnknown };
}
