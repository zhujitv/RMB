import { prisma } from "../prisma";
import { assertJsonObject, codedError } from "./shared-base-utils";
import { assertWrite } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { getShipsgoIntegrationSettings } from "./freightower-integration";
import { createFreightowerPayloadFromInput, freightowerApiRequest, mapFreightowerShipmentPayload, trackingDataFromFreightowerMappedShipment } from "./freightower-tracking";
import { serializeShipsgoTracking } from "./shipsgo-tracking-mapping";
import { syncFreightowerPortTracking } from "./freightower-port-tracking";
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
  loadShipsgoTrackingWithContainers,
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
  const response = await freightowerApiRequest<unknown>(settings, "/application/v1/query", payload);
  const mapped = mapFreightowerShipmentPayload(response, settings);
  const trackingData = trackingDataFromFreightowerMappedShipment(mapped);
  const now = new Date();
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
      lastCheckedAt: now,
      lastSyncedAt: mapped.syncStatus === "SUBSCRIBED" ? null : now,
      lastSyncTime: now,
      createdById: currentActorId || null,
      updatedById: currentActorId || null,
    },
  });
  await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
  await runNonCriticalTask(
    "飞驼可视中国港区订阅与同步",
    () => syncFreightowerPortTracking(savedBase.id, settings),
    { context: { provider: FREIGHTOWER_PROVIDER, trackingId: savedBase.id, orderId } },
  );
  const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
  if (!saved) throw codedError("飞驼可视跟踪本地保存失败。", 500, "FREIGHTOWER_TRACKING_SAVE_FAILED");

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

  return { tracking: serializeShipsgoTracking(saved), alreadyExists: false, message: "飞驼可视跟踪已创建。" };
}
