import { prisma } from "../prisma";
import { assertJsonObject, codedError } from "./shared-base-utils";
import { assertWrite } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { getShipsgoIntegrationSettings } from "./freightower-integration";
import { createFreightowerPayloadFromInput, freightowerApiRequest, latestFreightowerDumpingAlert, mapFreightowerShipmentPayload, trackingDataFromFreightowerMappedShipment } from "./freightower-tracking";
import { serializeShipsgoTracking } from "./shipsgo-tracking-mapping";
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
import {
  FREIGHTOWER_PROVIDER,
  OCEAN_MODE,
  actorId,
  assertActiveOceanTrackingEnabled,
  assertShipsgoTrackingWriteAccess,
  cleanInputText,
  type ShipsgoActor,
  type ShipsgoTrackingInput,
} from "./shipsgo-tracking-utils";
import {
  getShipsgoTrackingOrder,
  lockShipsgoTrackingCreation,
  loadShipsgoTrackingWithContainers,
  orderContainerNumbers,
  replaceShipsgoTrackingContainers,
  type AuditRequestLike,
} from "./shipsgo-tracking-service-shared";

export async function createShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, input: unknown = {}) {
  assertWrite(actor, "domesticLogistics");
  const currentActorId = actorId(actor);
  const body = assertJsonObject(input) as ShipsgoTrackingInput;
  const orderId = cleanInputText(body.orderId, 80);
  if (!orderId) throw codedError("请选择需要创建飞驼可视跟踪的订单。", 400, "ORDER_REQUIRED");
  const settings = await getShipsgoIntegrationSettings();
  assertActiveOceanTrackingEnabled(settings);
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
  if (existing) {
    return { tracking: serializeShipsgoTracking(existing), alreadyExists: true, message: "该订单已创建飞驼可视跟踪。" };
  }

  const payload = createFreightowerPayloadFromInput(body, order, settings);
  let mapped: ReturnType<typeof mapFreightowerShipmentPayload> | null = null;
  let comprehensiveError: unknown = null;
  try {
    const response = await freightowerApiRequest<unknown>(settings, "/application/v1/query", payload);
    mapped = mapFreightowerShipmentPayload(response, settings);
  } catch (error) {
    comprehensiveError = error;
  }
  const comprehensiveErrorMessage = comprehensiveError instanceof Error
    ? comprehensiveError.message
    : "当前船公司暂不支持海运综合跟踪。";
  const trackingData = mapped
    ? trackingDataFromFreightowerMappedShipment(mapped)
    : {
        status: "SUPPLEMENTAL_ONLY",
        currentStatus: "港区及海关跟踪中",
        syncStatus: "SYNC_FAILED",
        syncMessage: `海运综合跟踪暂不可用：${comprehensiveErrorMessage}；已继续查询中国港区和海关。`.slice(0, 500),
      };
  const containerNumbers = mapped?.containerNumbers.length
    ? mapped.containerNumbers
    : orderContainerNumbers(order);
  const now = new Date();
  const initialComprehensiveDumping = latestFreightowerDumpingAlert(
    "rawResponse" in trackingData ? trackingData.rawResponse ?? trackingData.rawPayload : null,
  );
  const initialLease = createFreightowerTrackingSyncLease(now);
  const created = await prisma.$transaction(async (tx) => {
    await lockShipsgoTrackingCreation(tx, orderId, FREIGHTOWER_PROVIDER, OCEAN_MODE);
    const active = await tx.shipsgoTracking.findFirst({
      where: { orderId, provider: FREIGHTOWER_PROVIDER, mode: OCEAN_MODE, deletedAt: null },
      include: {
        containers: {
          select: { containerNo: true },
          orderBy: [{ containerNo: "asc" }],
        },
      },
      orderBy: [{ updatedAt: "desc" }],
    });
    if (active) return { row: active, wasCreated: false as const };
    const row = await tx.shipsgoTracking.create({
      data: {
        orderId,
        provider: FREIGHTOWER_PROVIDER,
        mode: OCEAN_MODE,
        ...trackingData,
        masterBlNo: mapped?.masterBlNo || payload.billNo,
        reference: mapped?.reference || payload.businessNo,
        carrierScac: mapped?.carrierScac || payload.carrierCode,
        bookingNumber: mapped?.bookingNumber || payload.billNo,
        containerNumber: mapped?.containerNumber || containerNumbers[0] || payload.containerNo || null,
        eta: mapped?.eta,
        currentStatus: mapped?.currentStatus || trackingData.currentStatus,
        portCode: payload.portCode || null,
        portDirection: "E",
        customsDirection: "E",
        lastCheckedAt: now,
        lastSyncedAt: mapped && mapped.syncStatus !== "SUBSCRIBED" ? now : null,
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
  if (!created.wasCreated) {
    return { tracking: serializeShipsgoTracking(created.row), alreadyExists: true, message: "该订单已创建飞驼可视跟踪。" };
  }
  const savedBase = created.row;
  try {
    await replaceShipsgoTrackingContainers(savedBase.id, containerNumbers);
    await Promise.all([
      runNonCriticalTask(
        "飞驼可视中国港区订阅与同步",
        () => syncFreightowerPortTracking(savedBase.id, settings),
        { context: { provider: FREIGHTOWER_PROVIDER, trackingId: savedBase.id, orderId } },
      ),
      runNonCriticalTask(
        "飞驼可视中国海关提单号查询",
        () => syncFreightowerCustomsTracking(savedBase.id, settings),
        { context: { provider: FREIGHTOWER_PROVIDER, trackingId: savedBase.id, orderId } },
      ),
    ]);
    const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
    if (!saved) throw codedError("飞驼可视跟踪本地保存失败。", 500, "FREIGHTOWER_TRACKING_SAVE_FAILED");
    await runNonCriticalTask(
      "飞驼可视首次物流异常通知入队",
      () => reconcileFreightowerTrackingNotification(saved.id, { leaseToken: initialLease.token }),
      { context: { provider: FREIGHTOWER_PROVIDER, trackingId: saved.id, orderId } },
    );

    await runNonCriticalTask("飞驼可视跟踪创建日志写入", () => writeAudit(
      request,
      actor,
      "创建飞驼可视海运跟踪",
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
      alreadyExists: false,
      message: comprehensiveError
        ? "海运综合跟踪暂不可用，已启动中国港区和海关跟踪。"
        : "飞驼可视跟踪已创建。",
    };
  } finally {
    await releaseFreightowerTrackingSyncLease(savedBase.id, initialLease.token).catch((error: unknown) => {
      console.error("freightower-create-sync-lease-release-failed", {
        trackingId: savedBase.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  }
}
