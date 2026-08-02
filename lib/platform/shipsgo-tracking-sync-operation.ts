import type { ShipsgoTracking } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-utils";
import {
  assertFreightowerOceanEnabled,
  createFreightowerPayloadFromTracking,
  freightowerApiRequest,
  mapFreightowerShipmentPayload,
  trackingUpdateFromFreightowerMappedShipment,
} from "./freightower-tracking";
import { serializeShipsgoTracking } from "./shipsgo-tracking-mapping";
import {
  actorId,
  type ShipsgoActor,
  type ShipsgoSettings,
} from "./shipsgo-tracking-utils";
import {
  loadShipsgoTrackingWithContainers,
  replaceShipsgoTrackingContainers,
  type AuditRequestLike,
} from "./shipsgo-tracking-service-shared";
import {
  hasFreightowerTrackingNotificationChange,
  hasFreightowerPortTrackingNotificationChange,
  notifyFreightowerTrackingUpdate,
} from "./shipsgo-tracking-notifications";
import { syncFreightowerPortTracking } from "./freightower-port-tracking";

export async function syncLoadedShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, before: ShipsgoTracking, settings: ShipsgoSettings) {
  assertFreightowerOceanEnabled(settings);
  const payload = createFreightowerPayloadFromTracking(before, settings);
  const response = await freightowerApiRequest<unknown>(settings, "/application/v1/query", payload);
  const mapped = mapFreightowerShipmentPayload(response, settings);
  const hasFreshTrackingData = mapped.syncStatus !== "SUBSCRIBED";
  const trackingData = trackingUpdateFromFreightowerMappedShipment(
    mapped,
    before.rawResponse ?? before.rawPayload,
  );
  const now = new Date();
  const savedBase = await prisma.shipsgoTracking.update({
    where: { id: before.id },
    data: {
      ...trackingData,
      masterBlNo: mapped.masterBlNo || before.masterBlNo || before.bookingNumber,
      containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || before.containerNumber,
      lastCheckedAt: now,
      ...(hasFreshTrackingData ? { lastSyncedAt: now } : {}),
      lastSyncTime: now,
      updatedById: actorId(actor) || null,
    },
  });
  if (hasFreshTrackingData) {
    await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
  }
  const comprehensiveChanged = hasFreightowerTrackingNotificationChange(before, savedBase);
  await runNonCriticalTask(
    "飞驼可视中国港区同步",
    () => syncFreightowerPortTracking(savedBase.id, settings),
    { context: { provider: "FREIGHTOWER", trackingId: savedBase.id, orderId: savedBase.orderId } },
  );
  const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
  if (!saved) throw codedError("飞驼可视跟踪本地同步保存失败。", 500, "FREIGHTOWER_TRACKING_SAVE_FAILED");
  await runNonCriticalTask("飞驼可视跟踪同步日志写入", () => writeAudit(
    request,
    actor,
    "同步飞驼可视海运跟踪",
    "shipsgo_trackings",
    saved.id,
    { status: before.status, syncStatus: before.syncStatus },
    { status: saved.status, syncStatus: saved.syncStatus, lastSyncedAt: saved.lastSyncedAt },
  ));
  if ((hasFreshTrackingData && comprehensiveChanged) || hasFreightowerPortTrackingNotificationChange(before, saved)) {
    await runNonCriticalTask(
      "飞驼可视跟踪同步邮件通知",
      () => notifyFreightowerTrackingUpdate(saved.id),
      { context: { provider: "FREIGHTOWER", trackingId: saved.id, orderId: saved.orderId } },
    );
  }
  return {
    tracking: serializeShipsgoTracking(saved),
    message: hasFreshTrackingData ? "飞驼可视状态已同步。" : mapped.syncMessage,
  };
}
