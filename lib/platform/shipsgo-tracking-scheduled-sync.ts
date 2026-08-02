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
  hasFreightowerPortTrackingNotificationChange,
  notifyFreightowerTrackingUpdate,
} from "./shipsgo-tracking-notifications";
import { syncFreightowerPortTracking } from "./freightower-port-tracking";

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
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit || 50)));
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
    try {
      const mapped = mapFreightowerShipmentPayload(
        await freightowerApiRequest<unknown>(settings, "/application/v1/query", createFreightowerPayloadFromTracking(row, settings)),
        settings,
      );
      const hasFreshTrackingData = mapped.syncStatus !== "SUBSCRIBED";
      const trackingData = trackingUpdateFromFreightowerMappedShipment(
        mapped,
        row.rawResponse ?? row.rawPayload,
      );
      const savedBase = await prisma.shipsgoTracking.update({
        where: { id: row.id },
        data: {
          ...trackingData,
          masterBlNo: mapped.masterBlNo || row.masterBlNo || row.bookingNumber,
          containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || row.containerNumber,
          lastCheckedAt: now,
          ...(hasFreshTrackingData ? { lastSyncedAt: now } : {}),
          lastSyncTime: now,
          updatedById: actorId(actor) || null,
        },
      });
      if (hasFreshTrackingData) {
        await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
      }
      const portSaved = await runNonCriticalTask(
        "飞驼可视中国港区定时同步",
        () => syncFreightowerPortTracking(savedBase.id, settings),
        { context: { provider: FREIGHTOWER_PROVIDER, trackingId: savedBase.id, orderId: savedBase.orderId } },
      );
      if (
        (hasFreshTrackingData && hasFreightowerTrackingNotificationChange(row, savedBase))
        || Boolean(portSaved && hasFreightowerPortTrackingNotificationChange(row, portSaved))
      ) {
        await runNonCriticalTask(
          "飞驼可视定时同步邮件通知",
          () => notifyFreightowerTrackingUpdate(savedBase.id),
          { context: { provider: FREIGHTOWER_PROVIDER, trackingId: savedBase.id, orderId: savedBase.orderId } },
        );
      }
      results.push({
        id: row.id,
        ok: true,
        message: hasFreshTrackingData ? "同步成功" : mapped.syncMessage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";
      await prisma.shipsgoTracking.update({
        where: { id: row.id },
        data: {
          syncStatus: "SYNC_FAILED",
          syncMessage: message.slice(0, 500),
          lastCheckedAt: now,
          lastSyncTime: now,
          updatedById: actorId(actor) || null,
        },
      }).catch(() => null);
      results.push({ id: row.id, ok: false, message });
    }
  }
  await runNonCriticalTask("飞驼可视定时同步日志写入", () => writeAudit(
    request,
    actor,
    "定时同步飞驼可视海运跟踪",
    "shipsgo_trackings",
    "cron",
    null,
    { provider: FREIGHTOWER_PROVIDER, total: rows.length, success: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length },
  ));
  return {
    success: true,
    total: rows.length,
    successCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    results,
  };
}
