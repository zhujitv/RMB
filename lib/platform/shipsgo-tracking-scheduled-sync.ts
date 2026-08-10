import { prisma } from "../prisma";
import { assertWrite } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { getShipsgoIntegrationSettings } from "./freightower-integration";
import {
  createFreightowerPayloadFromTracking,
  freightowerApiRequest,
  mapFreightowerShipmentPayload,
  trackingUpdateFromFreightowerMappedShipment,
} from "./freightower-tracking";
import {
  FREIGHTOWER_PROVIDER,
  OCEAN_MODE,
  actorId,
  assertActiveOceanTrackingEnabled,
  type ShipsgoActor,
} from "./shipsgo-tracking-utils";
import { replaceShipsgoTrackingContainers, type AuditRequestLike } from "./shipsgo-tracking-service-shared";
import {
  hasFreightowerTrackingNotificationChange,
} from "./shipsgo-tracking-notifications";
import { syncFreightowerCustomsTracking } from "./freightower-customs-tracking";
import { syncFreightowerPortTracking } from "./freightower-port-tracking";
import {
  claimFreightowerTrackingSyncLease,
  releaseFreightowerTrackingSyncLease,
} from "./shipsgo-tracking-sync-lease";
import {
  FREIGHTOWER_NOTIFICATION_COMPREHENSIVE,
  markFreightowerNotificationPending,
  reconcileFreightowerTrackingNotification,
} from "./freightower-notification-pending";

export async function syncDueShipsgoOceanTrackings(request: AuditRequestLike, actor: ShipsgoActor, options: { limit?: number; now?: Date } = {}) {
  assertWrite(actor, "domesticLogistics");
  const settings = await getShipsgoIntegrationSettings();
  assertActiveOceanTrackingEnabled(settings);
  if (!settings.autoSyncEnabled) {
    return {
      success: true,
      skipped: true,
      message: "飞驼可视自动同步尚未启用，本次任务已跳过。",
      total: 0,
      successCount: 0,
      failedCount: 0,
      results: [],
    };
  }
  const now = options.now || new Date();
  const subscribedCutoff = new Date(now.getTime() - 30 * 60 * 1000);
  const regularCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit || 20)));
  const deadlineAt = Date.now() + 3 * 60 * 1000;
  const rows = await prisma.shipsgoTracking.findMany({
    where: {
      provider: FREIGHTOWER_PROVIDER,
      mode: OCEAN_MODE,
      deletedAt: null,
      OR: [
        { lastSyncTime: null },
        { syncStatus: "SUBSCRIBED", lastSyncTime: { lt: subscribedCutoff } },
        { syncStatus: { not: "SUBSCRIBED" }, lastSyncTime: { lt: regularCutoff } },
      ],
    },
    orderBy: [{ lastSyncTime: "asc" }, { lastSyncedAt: "asc" }, { updatedAt: "asc" }],
    take: limit,
  });
  const results: Array<{ id: string; ok: boolean; message: string }> = [];
  for (const row of rows) {
    // Leave time for one complete comprehensive + port + customs cycle.
    if (Date.now() >= deadlineAt) break;
    const leaseToken = await claimFreightowerTrackingSyncLease(row.id);
    if (!leaseToken) {
      results.push({ id: row.id, ok: true, message: "同步任务已在运行，本次已合并。" });
      continue;
    }
    let currentRow = row;
    try {
      const reloaded = await prisma.shipsgoTracking.findUnique({ where: { id: row.id } });
      if (!reloaded || reloaded.deletedAt) {
        results.push({ id: row.id, ok: true, message: "跟踪记录已删除，本次已跳过。" });
        continue;
      }
      currentRow = reloaded;
      try {
        await reconcileFreightowerTrackingNotification(currentRow.id, { leaseToken });
      } catch (error) {
        results.push({
          id: currentRow.id,
          ok: false,
          message: error instanceof Error ? `待发送物流通知处理失败：${error.message}` : "待发送物流通知处理失败。",
        });
        continue;
      }
      const mapped = mapFreightowerShipmentPayload(
        await freightowerApiRequest<unknown>(settings, "/application/v1/query", createFreightowerPayloadFromTracking(currentRow, settings)),
        settings,
      );
      const hasFreshTrackingData = mapped.syncStatus !== "SUBSCRIBED";
      const trackingData = trackingUpdateFromFreightowerMappedShipment(
        mapped,
        currentRow.rawResponse ?? currentRow.rawPayload,
      );
      const savedBase = await prisma.$transaction(async (tx) => {
        const saved = await tx.shipsgoTracking.update({
          where: { id: currentRow.id },
          data: {
            ...trackingData,
            masterBlNo: mapped.masterBlNo || currentRow.masterBlNo || currentRow.bookingNumber,
            containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || currentRow.containerNumber,
            lastCheckedAt: now,
            ...(hasFreshTrackingData ? { lastSyncedAt: now } : {}),
            lastSyncTime: now,
            updatedById: actorId(actor) || null,
          },
        });
        if (hasFreshTrackingData && hasFreightowerTrackingNotificationChange(currentRow, saved)) {
          await markFreightowerNotificationPending(
            tx,
            currentRow.id,
            FREIGHTOWER_NOTIFICATION_COMPREHENSIVE,
          );
        }
        return saved;
      });
      if (hasFreshTrackingData) {
        await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
      }
      await runNonCriticalTask(
        "飞驼可视中国港区定时同步",
        () => syncFreightowerPortTracking(savedBase.id, settings),
        { context: { provider: FREIGHTOWER_PROVIDER, trackingId: savedBase.id, orderId: savedBase.orderId } },
      );
      await runNonCriticalTask(
        "飞驼可视中国海关定时同步",
        () => syncFreightowerCustomsTracking(savedBase.id, settings),
        { context: { provider: FREIGHTOWER_PROVIDER, trackingId: savedBase.id, orderId: savedBase.orderId } },
      );
      await reconcileFreightowerTrackingNotification(savedBase.id, { leaseToken }).catch((error: unknown) => {
        console.error("freightower-cron-notification-reconcile-failed", {
          trackingId: savedBase.id,
          message: error instanceof Error ? error.message : "unknown",
        });
      });
      results.push({
        id: currentRow.id,
        ok: true,
        message: hasFreshTrackingData ? "同步成功" : mapped.syncMessage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";
      await prisma.shipsgoTracking.update({
        where: { id: currentRow.id },
        data: {
          syncStatus: "SYNC_FAILED",
          syncMessage: message.slice(0, 500),
          lastCheckedAt: now,
          lastSyncTime: now,
          updatedById: actorId(actor) || null,
        },
      }).catch(() => currentRow);
      // Port/customs products have independent credentials and availability.
      // Keep them updating even when the comprehensive query is temporarily down.
      await runNonCriticalTask(
        "飞驼可视中国港区失败后定时同步",
        () => syncFreightowerPortTracking(currentRow.id, settings),
        { context: { provider: FREIGHTOWER_PROVIDER, trackingId: currentRow.id, orderId: currentRow.orderId } },
      );
      await runNonCriticalTask(
        "飞驼可视中国海关失败后定时同步",
        () => syncFreightowerCustomsTracking(currentRow.id, settings),
        { context: { provider: FREIGHTOWER_PROVIDER, trackingId: currentRow.id, orderId: currentRow.orderId } },
      );
      await reconcileFreightowerTrackingNotification(currentRow.id, { leaseToken }).catch((reconcileError: unknown) => {
        console.error("freightower-cron-failure-notification-reconcile-failed", {
          trackingId: currentRow.id,
          message: reconcileError instanceof Error ? reconcileError.message : "unknown",
        });
      });
      results.push({ id: currentRow.id, ok: false, message });
    } finally {
      await releaseFreightowerTrackingSyncLease(row.id, leaseToken).catch((error: unknown) => {
        console.error("freightower-cron-sync-lease-release-failed", {
          trackingId: row.id,
          message: error instanceof Error ? error.message : "unknown",
        });
      });
    }
  }
  await runNonCriticalTask("飞驼可视定时同步日志写入", () => writeAudit(
    request,
    actor,
    "定时同步飞驼可视海运跟踪",
    "shipsgo_trackings",
    "cron",
    null,
    { provider: FREIGHTOWER_PROVIDER, total: results.length, deferred: rows.length - results.length, success: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length },
  ));
  return {
    success: true,
    total: results.length,
    deferredCount: rows.length - results.length,
    successCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    results,
  };
}
