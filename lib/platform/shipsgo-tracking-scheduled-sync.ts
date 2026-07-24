import { prisma } from "../prisma";
import { assertWrite } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { getShipsgoIntegrationSettings } from "./shipsgo-integration";
import {
  createFreightowerPayloadFromTracking,
  freightowerApiRequest,
  mapFreightowerShipmentPayload,
  trackingDataFromFreightowerMappedShipment,
} from "./freightower-tracking";
import {
  extractShipmentPayload,
  mapShipsgoShipmentPayload,
  trackingDataFromMappedShipment,
} from "./shipsgo-tracking-mapping";
import {
  FREIGHTOWER_PROVIDER,
  OCEAN_MODE,
  SHIPSGO_PROVIDER,
  actorId,
  assertActiveOceanTrackingEnabled,
  shipsgoApiRequest,
  type ShipsgoActor,
} from "./shipsgo-tracking-utils";
import { replaceShipsgoTrackingContainers, type AuditRequestLike } from "./shipsgo-tracking-service-shared";

export async function syncDueShipsgoOceanTrackings(request: AuditRequestLike, actor: ShipsgoActor, options: { limit?: number; now?: Date } = {}) {
  assertWrite(actor, "domesticLogistics");
  const settings = await getShipsgoIntegrationSettings();
  const provider = assertActiveOceanTrackingEnabled(settings);
  const now = options.now || new Date();
  const cutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit || 50)));
  const rows = await prisma.shipsgoTracking.findMany({
    where: {
      provider,
      mode: OCEAN_MODE,
      deletedAt: null,
      ...(provider === SHIPSGO_PROVIDER ? { shipsgoShipmentId: { not: null } } : {}),
      OR: [
        { lastSyncTime: null },
        { lastSyncTime: { lt: cutoff } },
        { lastSyncedAt: null },
        { lastSyncedAt: { lt: cutoff } },
      ],
    },
    orderBy: [{ lastSyncTime: "asc" }, { lastSyncedAt: "asc" }, { updatedAt: "asc" }],
    take: limit,
  });
  const results: Array<{ id: string; ok: boolean; message: string }> = [];
  for (const row of rows) {
    try {
      const mapped = provider === FREIGHTOWER_PROVIDER
        ? mapFreightowerShipmentPayload(
          await freightowerApiRequest<unknown>(settings, "/application/v1/query", createFreightowerPayloadFromTracking(row, settings)),
          settings,
        )
        : mapShipsgoShipmentPayload(extractShipmentPayload(
          (await shipsgoApiRequest<unknown>(settings, `/ocean/shipments/${encodeURIComponent(row.shipsgoShipmentId || "")}`)).data,
        ));
      const trackingData = provider === FREIGHTOWER_PROVIDER
        ? trackingDataFromFreightowerMappedShipment(mapped as ReturnType<typeof mapFreightowerShipmentPayload>)
        : trackingDataFromMappedShipment(mapped as ReturnType<typeof mapShipsgoShipmentPayload>);
      const savedBase = await prisma.shipsgoTracking.update({
        where: { id: row.id },
        data: {
          ...trackingData,
          masterBlNo: mapped.masterBlNo || row.masterBlNo || row.bookingNumber,
          containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || row.containerNumber,
          eta: mapped.eta,
          currentStatus: mapped.currentStatus,
          syncStatus: "SYNCED",
          syncMessage: "",
          lastCheckedAt: now,
          lastSyncedAt: now,
          lastSyncTime: now,
          updatedById: actorId(actor) || null,
        },
      });
      await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
      results.push({ id: row.id, ok: true, message: "同步成功" });
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
  await runNonCriticalTask("大掌櫃定时同步日志写入", () => writeAudit(
    request,
    actor,
    "定时同步大掌櫃海运跟踪",
    "shipsgo_trackings",
    "cron",
    null,
    { provider, total: rows.length, success: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length },
  ));
  return {
    success: true,
    total: rows.length,
    successCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    results,
  };
}
