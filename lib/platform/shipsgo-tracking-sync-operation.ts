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
  assertShipsgoTrackingWriteAccess,
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

async function syncLoadedShipsgoOceanTrackingUnlocked(request: AuditRequestLike, actor: ShipsgoActor, before: ShipsgoTracking, settings: ShipsgoSettings) {
  assertFreightowerOceanEnabled(settings);
  const now = new Date();
  let savedBase = before;
  let hasFreshTrackingData = false;
  let syncMessage = "";
  let comprehensiveError: unknown = null;
  try {
    const payload = createFreightowerPayloadFromTracking(before, settings);
    const response = await freightowerApiRequest<unknown>(settings, "/application/v1/query", payload);
    const mapped = mapFreightowerShipmentPayload(response, settings);
    hasFreshTrackingData = mapped.syncStatus !== "SUBSCRIBED";
    syncMessage = hasFreshTrackingData ? "飞驼可视状态已同步。" : mapped.syncMessage;
    const trackingData = trackingUpdateFromFreightowerMappedShipment(
      mapped,
      before.rawResponse ?? before.rawPayload,
    );
    savedBase = await prisma.$transaction(async (tx) => {
      const saved = await tx.shipsgoTracking.update({
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
      if (hasFreshTrackingData && hasFreightowerTrackingNotificationChange(before, saved)) {
        await markFreightowerNotificationPending(
          tx,
          before.id,
          FREIGHTOWER_NOTIFICATION_COMPREHENSIVE,
        );
      }
      return saved;
    });
    if (hasFreshTrackingData) {
      await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
    }
  } catch (error) {
    comprehensiveError = error;
    syncMessage = error instanceof Error ? error.message : "飞驼可视综合跟踪同步失败。";
    savedBase = await prisma.shipsgoTracking.update({
      where: { id: before.id },
      data: {
        syncStatus: "SYNC_FAILED",
        syncMessage: syncMessage.slice(0, 500),
        lastCheckedAt: now,
        lastSyncTime: now,
        updatedById: actorId(actor) || null,
      },
    });
  }
  await Promise.all([
    runNonCriticalTask(
      "飞驼可视中国港区同步",
      () => syncFreightowerPortTracking(savedBase.id, settings, { force: true }),
      { context: { provider: "FREIGHTOWER", trackingId: savedBase.id, orderId: savedBase.orderId } },
    ),
    runNonCriticalTask(
      "飞驼可视中国海关同步",
      () => syncFreightowerCustomsTracking(savedBase.id, settings, { force: true }),
      { context: { provider: "FREIGHTOWER", trackingId: savedBase.id, orderId: savedBase.orderId } },
    ),
  ]);
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
  return {
    tracking: serializeShipsgoTracking(saved),
    message: comprehensiveError
      ? "海运综合跟踪暂不可用，中国港区和海关已继续同步。"
      : syncMessage,
  };
}

export async function syncLoadedShipsgoOceanTracking(
  request: AuditRequestLike,
  actor: ShipsgoActor,
  before: ShipsgoTracking,
  settings: ShipsgoSettings,
) {
  const leaseToken = await claimFreightowerTrackingSyncLease(before.id);
  if (!leaseToken) {
    throw codedError("这票物流正在同步，请稍后再试。", 409, "FREIGHTOWER_TRACKING_SYNC_IN_PROGRESS");
  }
  try {
    const current = await prisma.shipsgoTracking.findUnique({
      where: { id: before.id },
      include: {
        order: {
          select: {
            salespersonUserId: true,
            customer: { select: { salespersonUserId: true } },
          },
        },
      },
    });
    if (!current || current.deletedAt) {
      throw codedError("飞驼可视跟踪记录不存在。", 404, "FREIGHTOWER_TRACKING_NOT_FOUND");
    }
    assertShipsgoTrackingWriteAccess(actor, current.order);
    await reconcileFreightowerTrackingNotification(current.id, { leaseToken });
    let result: Awaited<ReturnType<typeof syncLoadedShipsgoOceanTrackingUnlocked>> | null = null;
    let operationError: unknown = null;
    try {
      result = await syncLoadedShipsgoOceanTrackingUnlocked(request, actor, current, settings);
    } catch (error) {
      operationError = error;
    }
    await reconcileFreightowerTrackingNotification(current.id, { leaseToken });
    if (operationError) throw operationError;
    return result!;
  } finally {
    await releaseFreightowerTrackingSyncLease(before.id, leaseToken).catch((error: unknown) => {
      console.error("freightower-sync-lease-release-failed", {
        trackingId: before.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  }
}
