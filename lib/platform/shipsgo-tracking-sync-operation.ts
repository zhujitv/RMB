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
  trackingDataFromFreightowerMappedShipment,
} from "./freightower-tracking";
import {
  extractShipmentPayload,
  mapShipsgoShipmentPayload,
  serializeShipsgoTracking,
  trackingDataFromMappedShipment,
} from "./shipsgo-tracking-mapping";
import {
  FREIGHTOWER_PROVIDER,
  actorId,
  assertShipsgoOceanEnabled,
  shipsgoApiRequest,
  type ShipsgoActor,
  type ShipsgoSettings,
} from "./shipsgo-tracking-utils";
import {
  loadShipsgoTrackingWithContainers,
  replaceShipsgoTrackingContainers,
  type AuditRequestLike,
} from "./shipsgo-tracking-service-shared";

export async function syncLoadedShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, before: ShipsgoTracking, settings: ShipsgoSettings) {
  if (before.provider === FREIGHTOWER_PROVIDER) {
    assertFreightowerOceanEnabled(settings);
    const payload = createFreightowerPayloadFromTracking(before, settings);
    const response = await freightowerApiRequest<unknown>(settings, "/application/v1/query", payload);
    const mapped = mapFreightowerShipmentPayload(response, settings);
    const trackingData = trackingDataFromFreightowerMappedShipment(mapped);
    const now = new Date();
    const savedBase = await prisma.shipsgoTracking.update({
      where: { id: before.id },
      data: {
        ...trackingData,
        masterBlNo: mapped.masterBlNo || before.masterBlNo || before.bookingNumber,
        containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || before.containerNumber,
        eta: mapped.eta,
        currentStatus: mapped.currentStatus,
        lastCheckedAt: now,
        lastSyncedAt: now,
        lastSyncTime: now,
        updatedById: actorId(actor) || null,
      },
    });
    await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
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
    return { tracking: serializeShipsgoTracking(saved), message: "飞驼可视状态已同步。" };
  }

  assertShipsgoOceanEnabled(settings);

  const response = await shipsgoApiRequest<unknown>(settings, `/ocean/shipments/${encodeURIComponent(before.shipsgoShipmentId || "")}`);
  const shipment = extractShipmentPayload(response.data);
  const mapped = mapShipsgoShipmentPayload(shipment);
  const trackingData = trackingDataFromMappedShipment(mapped);
  const now = new Date();
  const savedBase = await prisma.shipsgoTracking.update({
    where: { id: before.id },
    data: {
      ...trackingData,
      masterBlNo: mapped.masterBlNo || before.masterBlNo || before.bookingNumber,
      containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || before.containerNumber,
      eta: mapped.eta,
      currentStatus: mapped.currentStatus,
      lastCheckedAt: now,
      lastSyncedAt: now,
      lastSyncTime: now,
      updatedById: actorId(actor) || null,
    },
  });
  await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
  const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
  if (!saved) throw codedError("大掌櫃跟踪本地同步保存失败。", 500, "SHIPSGO_TRACKING_SAVE_FAILED");
  await runNonCriticalTask("大掌櫃跟踪同步日志写入", () => writeAudit(
    request,
    actor,
    "同步大掌櫃海运跟踪",
    "shipsgo_trackings",
    saved.id,
    { status: before.status, syncStatus: before.syncStatus },
    { status: saved.status, syncStatus: saved.syncStatus, lastSyncedAt: saved.lastSyncedAt },
  ));
  return { tracking: serializeShipsgoTracking(saved), message: "大掌櫃状态已同步。" };
}
