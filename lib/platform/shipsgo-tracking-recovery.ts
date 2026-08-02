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
  loadShipsgoTrackingWithContainers,
  replaceShipsgoTrackingContainers,
  type AuditRequestLike,
} from "./shipsgo-tracking-service-shared";
import { syncLoadedShipsgoOceanTracking } from "./shipsgo-tracking-sync-operation";
import { syncFreightowerPortTracking } from "./freightower-port-tracking";

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
  const currentActorId = actorId(actor);
  const savedBase = await prisma.shipsgoTracking.create({
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
      createdById: currentActorId || null,
      updatedById: currentActorId || null,
    },
  });
  await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
  await runNonCriticalTask(
    "飞驼可视中国港区恢复同步",
    () => syncFreightowerPortTracking(savedBase.id, settings),
    { context: { provider: FREIGHTOWER_PROVIDER, trackingId: savedBase.id, orderId } },
  );
  const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
  if (!saved) throw codedError("飞驼可视已有跟踪同步保存失败。", 500, "FREIGHTOWER_TRACKING_SAVE_FAILED");
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
}
