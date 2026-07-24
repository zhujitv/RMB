import { prisma } from "../prisma";
import { assertWrite } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { assertJsonObject, codedError } from "./shared-base-utils";
import { getShipsgoIntegrationSettings } from "./shipsgo-integration";
import {
  assertFreightowerOceanEnabled,
  createFreightowerPayloadFromInput,
  freightowerApiRequest,
  mapFreightowerShipmentPayload,
  trackingDataFromFreightowerMappedShipment,
} from "./freightower-tracking";
import {
  mapShipsgoShipmentPayload,
  serializeShipsgoTracking,
  trackingDataFromMappedShipment,
} from "./shipsgo-tracking-mapping";
import {
  FREIGHTOWER_PROVIDER,
  OCEAN_MODE,
  SHIPSGO_PROVIDER,
  actorId,
  assertShipsgoOceanEnabled,
  assertShipsgoTrackingWriteAccess,
  cleanBookingNumber,
  cleanCarrierScac,
  cleanInputText,
  uniqueStrings,
  type ShipsgoActor,
  type ShipsgoTrackingInput,
} from "./shipsgo-tracking-utils";
import {
  findExistingShipsgoShipment,
  getShipsgoTrackingOrder,
  loadShipsgoTrackingWithContainers,
  orderContainerNumbers,
  replaceShipsgoTrackingContainers,
  type AuditRequestLike,
} from "./shipsgo-tracking-service-shared";
import { syncLoadedShipsgoOceanTracking } from "./shipsgo-tracking-sync-operation";

export async function recoverShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, input: unknown = {}) {
  assertWrite(actor, "domesticLogistics");
  const body = assertJsonObject(input) as ShipsgoTrackingInput;
  const orderId = cleanInputText(body.orderId, 80);
  if (!orderId) throw codedError("请选择需要补同步大掌櫃跟踪的订单。", 400, "ORDER_REQUIRED");
  const settings = await getShipsgoIntegrationSettings();
  const order = await getShipsgoTrackingOrder(orderId, actor);
  assertShipsgoTrackingWriteAccess(actor, order);
  if (settings.activeProvider === FREIGHTOWER_PROVIDER) {
    assertFreightowerOceanEnabled(settings);
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
        syncStatus: "RECOVERED",
        syncMessage: "已从飞驼可视同步已有跟踪。",
        lastCheckedAt: now,
        lastSyncedAt: now,
        lastSyncTime: now,
        createdById: currentActorId || null,
        updatedById: currentActorId || null,
      },
    });
    await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
    const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
    if (!saved) throw codedError("飞驼可视已有跟踪补同步保存失败。", 500, "FREIGHTOWER_TRACKING_SAVE_FAILED");
    await runNonCriticalTask("飞驼可视已有跟踪补同步日志写入", () => writeAudit(
      request,
      actor,
      "补同步飞驼可视已有跟踪",
      "shipsgo_trackings",
      saved.id,
      null,
      {
        orderId,
        masterBlNo: saved.masterBlNo || saved.bookingNumber,
        containerNumbers: (saved.containers || []).map((container) => container.containerNo),
      },
    ));
    return { tracking: serializeShipsgoTracking(saved), recovered: true, message: "已从飞驼可视同步已有跟踪。" };
  }

  assertShipsgoOceanEnabled(settings);
  const masterBlNo = cleanBookingNumber(body.masterBlNo) || cleanBookingNumber(body.bookingNumber) || cleanBookingNumber(order.blNo);
  const carrierScac = cleanCarrierScac(body.carrierScac);
  const existing = await prisma.shipsgoTracking.findFirst({
    where: {
      orderId,
      provider: SHIPSGO_PROVIDER,
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
  if (existing?.shipsgoShipmentId) {
    return syncLoadedShipsgoOceanTracking(request, actor, existing, settings);
  }

  const localContainers = uniqueStrings([
    ...orderContainerNumbers(order),
    ...((existing?.containers || []).map((container) => container.containerNo || "")),
    existing?.containerNumber || "",
  ]);
  if (!masterBlNo && !localContainers.length) {
    throw codedError("本地缺少提单号和柜号，无法从大掌櫃找回已有跟踪。", 400, "SHIPSGO_RECOVER_TARGET_REQUIRED");
  }

  const found = await findExistingShipsgoShipment(settings, { masterBlNo, carrierScac, containerNumbers: localContainers });
  const mapped = mapShipsgoShipmentPayload(found.shipment);
  const trackingData = trackingDataFromMappedShipment(mapped);
  const now = new Date();
  const currentActorId = actorId(actor);
  const savedBase = existing
    ? await prisma.shipsgoTracking.update({
      where: { id: existing.id },
      data: {
        ...trackingData,
        masterBlNo: mapped.masterBlNo || existing.masterBlNo || existing.bookingNumber || masterBlNo,
        reference: mapped.reference || existing.reference || masterBlNo,
        carrierScac: mapped.carrierScac || carrierScac || existing.carrierScac,
        bookingNumber: mapped.bookingNumber || existing.bookingNumber || masterBlNo,
        containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || existing.containerNumber,
        eta: mapped.eta,
        currentStatus: mapped.currentStatus,
        syncStatus: "RECOVERED",
        syncMessage: "已从大掌櫃已有跟踪补同步。",
        lastCheckedAt: now,
        lastSyncedAt: now,
        lastSyncTime: now,
        updatedById: currentActorId || null,
      },
    })
    : await prisma.shipsgoTracking.create({
      data: {
        orderId,
        provider: SHIPSGO_PROVIDER,
        mode: OCEAN_MODE,
        ...trackingData,
        masterBlNo: mapped.masterBlNo || mapped.bookingNumber || masterBlNo,
        reference: mapped.reference || masterBlNo || cleanInputText(`${order.orderNo || order.id}-shipsgo`, 128),
        carrierScac: mapped.carrierScac || carrierScac || null,
        bookingNumber: mapped.bookingNumber || masterBlNo || null,
        containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || localContainers[0] || null,
        eta: mapped.eta,
        currentStatus: mapped.currentStatus,
        syncStatus: "RECOVERED",
        syncMessage: "已从大掌櫃已有跟踪补同步。",
        lastCheckedAt: now,
        lastSyncedAt: now,
        lastSyncTime: now,
        createdById: currentActorId || null,
        updatedById: currentActorId || null,
      },
    });
  await replaceShipsgoTrackingContainers(savedBase.id, uniqueStrings([...mapped.containerNumbers, ...localContainers]));
  const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
  if (!saved) throw codedError("大掌櫃已有跟踪补同步保存失败。", 500, "SHIPSGO_TRACKING_SAVE_FAILED");
  await runNonCriticalTask("大掌櫃已有跟踪补同步日志写入", () => writeAudit(
    request,
    actor,
    "补同步大掌櫃已有跟踪",
    "shipsgo_trackings",
    saved.id,
    existing ? { shipsgoShipmentId: existing.shipsgoShipmentId, syncStatus: existing.syncStatus } : null,
    {
      orderId,
      shipsgoShipmentId: saved.shipsgoShipmentId,
      masterBlNo: saved.masterBlNo || saved.bookingNumber,
      containerNumbers: (saved.containers || []).map((container) => container.containerNo),
      queryPath: found.path,
    },
  ));
  return { tracking: serializeShipsgoTracking(saved), recovered: true, message: "已从大掌櫃同步已有跟踪。" };
}
