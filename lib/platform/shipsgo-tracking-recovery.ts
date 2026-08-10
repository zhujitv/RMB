import { prisma } from "../prisma";
import { assertWrite } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { assertJsonObject, codedError } from "./shared-base-utils";
import { getShipsgoIntegrationSettings } from "./freightower-integration";
import {
  assertFreightowerOceanEnabled,
  createFreightowerPayloadFromInput,
  freightowerApiRequest,
  latestFreightowerDumpingAlert,
  mapFreightowerShipmentPayload,
  trackingDataFromFreightowerMappedShipment,
} from "./freightower-tracking";
import { serializeShipsgoTracking } from "./shipsgo-tracking-mapping";
import {
  FREIGHTOWER_PROVIDER,
  OCEAN_MODE,
  actorId,
  assertShipsgoTrackingWriteAccess,
  cleanInputText,
  type ShipsgoActor,
  type ShipsgoTrackingInput,
} from "./shipsgo-tracking-utils";
import {
  getShipsgoTrackingOrder,
  lockShipsgoTrackingCreation,
  loadShipsgoTrackingWithContainers,
  replaceShipsgoTrackingContainers,
  type AuditRequestLike,
} from "./shipsgo-tracking-service-shared";
import { syncLoadedShipsgoOceanTracking } from "./shipsgo-tracking-sync-operation";
import { syncFreightowerCustomsTracking } from "./freightower-customs-tracking";
import { syncFreightowerPortTracking } from "./freightower-port-tracking";
import {
  FREIGHTOWER_NOTIFICATION_COMPREHENSIVE,
  reconcileFreightowerTrackingNotification,
} from "./freightower-notification-pending";
import {
  createFreightowerTrackingSyncLease,
  releaseFreightowerTrackingSyncLease,
} from "./shipsgo-tracking-sync-lease";

export async function recoverShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, input: unknown = {}) {
  assertWrite(actor, "domesticLogistics");
  const body = assertJsonObject(input) as ShipsgoTrackingInput;
  const orderId = cleanInputText(body.orderId, 80);
  if (!orderId) throw codedError("请选择需要同步的飞驼可视跟踪订单。", 400, "ORDER_REQUIRED");

  const settings = await getShipsgoIntegrationSettings();
  assertFreightowerOceanEnabled(settings);
  const order = await getShipsgoTrackingOrder(orderId, actor);
  assertShipsgoTrackingWriteAccess(actor, order);

  const existing = await prisma.shipsgoTracking.findFirst({
    where: {
      orderId,
      provider: FREIGHTOWER_PROVIDER,
      mode: OCEAN_MODE,
      deletedAt: null,
    },
    include: {
      containers: {
        select: { containerNo: true },
        orderBy: [{ containerNo: "asc" }],
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  if (existing) return syncLoadedShipsgoOceanTracking(request, actor, existing, settings);

  const payload = createFreightowerPayloadFromInput(body, order, settings);
  const response = await freightowerApiRequest<unknown>(settings, "/application/v1/query", payload);
  const mapped = mapFreightowerShipmentPayload(response, settings);
  const trackingData = trackingDataFromFreightowerMappedShipment(mapped);
  const now = new Date();
  const initialComprehensiveDumping = latestFreightowerDumpingAlert(
    trackingData.rawResponse ?? trackingData.rawPayload,
  );
  const initialLease = createFreightowerTrackingSyncLease(now);
  const currentActorId = actorId(actor);
  const created = await prisma.$transaction(async (tx) => {
    await lockShipsgoTrackingCreation(tx, orderId, FREIGHTOWER_PROVIDER, OCEAN_MODE);
    const active = await tx.shipsgoTracking.findFirst({
      where: { orderId, provider: FREIGHTOWER_PROVIDER, mode: OCEAN_MODE, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }],
    });
    if (active) return { row: active, wasCreated: false as const };
    const row = await tx.shipsgoTracking.create({
      data: {
        orderId,
        provider: FREIGHTOWER_PROVIDER,
        mode: OCEAN_MODE,
        ...trackingData,
        masterBlNo: mapped.masterBlNo || payload.billNo,
        reference: mapped.reference || payload.businessNo,
        carrierScac: mapped.carrierScac || payload.carrierCode,
        bookingNumber: mapped.bookingNumber || payload.billNo,
        containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || payload.containerNo || null,
        eta: mapped.eta,
        currentStatus: mapped.currentStatus,
        syncStatus: mapped.syncStatus === "SUBSCRIBED" ? mapped.syncStatus : "RECOVERED",
        syncMessage: mapped.syncStatus === "SUBSCRIBED" ? mapped.syncMessage : "已从飞驼可视同步已有跟踪。",
        lastCheckedAt: now,
        lastSyncedAt: mapped.syncStatus === "SUBSCRIBED" ? null : now,
        lastSyncTime: now,
        syncLeaseToken: initialLease.token,
        syncLeaseExpiresAt: initialLease.expiresAt,
        trackingNotificationPendingAt: initialComprehensiveDumping ? now : null,
        trackingNotificationPendingMask: initialComprehensiveDumping
          ? FREIGHTOWER_NOTIFICATION_COMPREHENSIVE
          : 0,
        createdById: currentActorId || null,
        updatedById: currentActorId || null,
      },
    });
    return { row, wasCreated: true as const };
  });
  if (!created.wasCreated) return syncLoadedShipsgoOceanTracking(request, actor, created.row, settings);
  const savedBase = created.row;
  try {
    await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
    await Promise.all([
      runNonCriticalTask(
        "飞驼可视中国港区恢复同步",
        () => syncFreightowerPortTracking(savedBase.id, settings, { force: true }),
        { context: { provider: FREIGHTOWER_PROVIDER, trackingId: savedBase.id, orderId } },
      ),
      runNonCriticalTask(
        "飞驼可视中国海关恢复同步",
        () => syncFreightowerCustomsTracking(savedBase.id, settings, { force: true }),
        { context: { provider: FREIGHTOWER_PROVIDER, trackingId: savedBase.id, orderId } },
      ),
    ]);
    const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
    if (!saved) throw codedError("飞驼可视已有跟踪同步保存失败。", 500, "FREIGHTOWER_TRACKING_SAVE_FAILED");
    await runNonCriticalTask(
      "飞驼可视恢复时首次物流异常通知入队",
      () => reconcileFreightowerTrackingNotification(saved.id, { leaseToken: initialLease.token }),
      { context: { provider: FREIGHTOWER_PROVIDER, trackingId: saved.id, orderId } },
    );
    await runNonCriticalTask("飞驼可视已有跟踪同步日志写入", () => writeAudit(
      request,
      actor,
      "同步飞驼可视已有跟踪",
      "shipsgo_trackings",
      saved.id,
      null,
      {
        orderId,
        masterBlNo: saved.masterBlNo || saved.bookingNumber,
        containerNumbers: (saved.containers || []).map((container) => container.containerNo),
      },
    ));
    return {
      tracking: serializeShipsgoTracking(saved),
      recovered: true,
      message: mapped.syncStatus === "SUBSCRIBED" ? mapped.syncMessage : "已从飞驼可视同步已有跟踪。",
    };
  } finally {
    await releaseFreightowerTrackingSyncLease(savedBase.id, initialLease.token).catch((error: unknown) => {
      console.error("freightower-recovery-sync-lease-release-failed", {
        trackingId: savedBase.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  }
}
