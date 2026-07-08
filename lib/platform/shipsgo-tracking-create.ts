import { prisma } from "../prisma";
import { assertJsonObject, codedError } from "./shared-base-utils";
import { assertWrite } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { getShipsgoIntegrationSettings } from "./shipsgo-integration";
import { createFreightowerPayloadFromInput, freightowerApiRequest, mapFreightowerShipmentPayload, trackingDataFromFreightowerMappedShipment } from "./freightower-tracking";
import { extractShipmentPayload, mapShipsgoShipmentPayload, serializeShipsgoTracking, trackingDataFromMappedShipment } from "./shipsgo-tracking-mapping";
import {
  FREIGHTOWER_PROVIDER,
  OCEAN_MODE,
  SHIPSGO_PROVIDER,
  actorId,
  assertActiveOceanTrackingEnabled,
  assertShipsgoOceanEnabled,
  assertShipsgoTrackingWriteAccess,
  cleanCarrierScac,
  cleanInputText,
  shipsgoApiRequest,
  type ShipsgoActor,
  type ShipsgoTrackingInput,
} from "./shipsgo-tracking-utils";
import {
  createPayloadFromInput,
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
  if (!orderId) throw codedError("请选择需要创建大掌櫃跟踪的订单。", 400, "ORDER_REQUIRED");
  const settings = await getShipsgoIntegrationSettings();
  const provider = assertActiveOceanTrackingEnabled(settings);
  const order = await getShipsgoTrackingOrder(orderId, actor);
  assertShipsgoTrackingWriteAccess(actor, order);

  const existing = await prisma.shipsgoTracking.findFirst({
    where: {
      orderId,
      provider,
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
    return { tracking: serializeShipsgoTracking(existing), alreadyExists: true, message: "该订单已创建当前接口跟踪。" };
  }

  if (provider === FREIGHTOWER_PROVIDER) {
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
        lastSyncedAt: now,
        lastSyncTime: now,
        createdById: currentActorId || null,
        updatedById: currentActorId || null,
      },
    });
    await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
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

  assertShipsgoOceanEnabled(settings);
  const payload = createPayloadFromInput(body, order);
  const response = await shipsgoApiRequest<unknown>(
    settings,
    "/ocean/shipments",
    { method: "POST", body: JSON.stringify(payload) },
    true,
  );
  const shipment = extractShipmentPayload(response.data);
  const mapped = mapShipsgoShipmentPayload(shipment);
  const trackingData = trackingDataFromMappedShipment(mapped);
  const now = new Date();
  const savedBase = await prisma.shipsgoTracking.create({
    data: {
      orderId,
      provider: SHIPSGO_PROVIDER,
      mode: OCEAN_MODE,
      ...trackingData,
      masterBlNo: mapped.masterBlNo || payload.booking_number,
      reference: mapped.reference || payload.reference,
      carrierScac: mapped.carrierScac || cleanCarrierScac(payload.carrier),
      bookingNumber: mapped.bookingNumber || payload.booking_number,
      containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || null,
      syncMessage: response.status === 409 ? "大掌櫃已存在该跟踪，已同步本地记录。" : "",
      eta: mapped.eta,
      currentStatus: mapped.currentStatus,
      lastCheckedAt: now,
      lastSyncedAt: now,
      lastSyncTime: now,
      createdById: currentActorId || null,
      updatedById: currentActorId || null,
    },
  });
  await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
  const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
  if (!saved) throw codedError("大掌櫃跟踪本地保存失败。", 500, "SHIPSGO_TRACKING_SAVE_FAILED");

  await runNonCriticalTask("大掌櫃跟踪创建日志写入", () => writeAudit(
    request,
    actor,
    "创建大掌櫃海运跟踪",
    "shipsgo_trackings",
    saved.id,
    null,
    {
      orderId,
      shipsgoShipmentId: saved.shipsgoShipmentId,
      masterBlNo: saved.masterBlNo || saved.bookingNumber,
      containerNumbers: (saved.containers || []).map((container) => container.containerNo),
      creditsCost: response.headers.get("X-Shipsgo-Credits-Cost") || "",
      creditsRemaining: response.headers.get("X-Shipsgo-Credits-Remaining") || "",
    },
  ));

  return { tracking: serializeShipsgoTracking(saved), alreadyExists: response.status === 409, message: "大掌櫃跟踪已创建。" };
}
