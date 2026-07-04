import { prisma } from "../prisma";
import { assertRead, assertWrite } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { assertJsonObject, codedError } from "./shared-base-utils";
import { canAccessDomesticLogisticsOrder } from "./masters-access";
import { getShipsgoIntegrationSettings } from "./shipsgo-integration";
import { extractShipmentPayload, mapShipsgoShipmentPayload, serializeShipsgoTracking, trackingDataFromMappedShipment } from "./shipsgo-tracking-mapping";
import {
  OCEAN_MODE,
  SHIPSGO_PROVIDER,
  actorId,
  assertShipsgoOceanEnabled,
  assertShipsgoTrackingDeleteAccess,
  assertShipsgoTrackingWriteAccess,
  cleanBookingNumber,
  cleanCarrierScac,
  cleanInputText,
  safeContainerNumber,
  shipsgoApiRequest,
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

export async function getTrackingForActor(id: string, actor: ShipsgoActor) {
  const tracking = await prisma.shipsgoTracking.findFirst({
    where: { id, deletedAt: null },
    include: {
      order: {
        select: {
          id: true,
          orderNo: true,
          blNo: true,
          customer: { select: { salespersonUserId: true } },
          logisticsSuppliers: { select: { supplierId: true } },
        },
      },
    },
  });
  if (!tracking) throw codedError("大掌櫃跟踪记录不存在。", 404, "SHIPSGO_TRACKING_NOT_FOUND");
  if (!canAccessDomesticLogisticsOrder(actor, tracking.order)) {
    throw codedError("无权限访问该大掌櫃跟踪记录。", 403, "PERMISSION_DENIED");
  }
  return tracking;
}

export async function getShipsgoOceanTracking(actor: ShipsgoActor, trackingId: unknown) {
  assertRead(actor, "domesticLogistics");
  const id = cleanInputText(trackingId, 80);
  if (!id) throw codedError("请选择需要查看的大掌櫃跟踪记录。", 400, "SHIPSGO_TRACKING_REQUIRED");
  const allowedTracking = await getTrackingForActor(id, actor);
  const tracking = await loadShipsgoTrackingWithContainers(allowedTracking.id);
  if (!tracking) throw codedError("大掌櫃跟踪记录不存在。", 404, "SHIPSGO_TRACKING_NOT_FOUND");
  return { tracking: serializeShipsgoTracking(tracking) };
}

export async function syncShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, trackingId: unknown) {
  assertWrite(actor, "domesticLogistics");
  const id = cleanInputText(trackingId, 80);
  if (!id) throw codedError("请选择需要同步的大掌櫃跟踪记录。", 400, "SHIPSGO_TRACKING_REQUIRED");
  const settings = await getShipsgoIntegrationSettings();
  assertShipsgoOceanEnabled(settings);
  const before = await getTrackingForActor(id, actor);
  assertShipsgoTrackingWriteAccess(actor, before.order);
  if (!before.shipsgoShipmentId) {
    return recoverShipsgoOceanTracking(request, actor, {
      orderId: before.orderId,
      masterBlNo: before.masterBlNo || before.bookingNumber,
      carrierScac: before.carrierScac,
    });
  }

  const response = await shipsgoApiRequest<unknown>(settings, `/ocean/shipments/${encodeURIComponent(before.shipsgoShipmentId)}`);
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

export async function deleteShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, trackingId: unknown) {
  assertWrite(actor, "domesticLogistics");
  assertShipsgoTrackingDeleteAccess(actor);
  const id = cleanInputText(trackingId, 80);
  if (!id) throw codedError("请选择需要删除的大掌櫃跟踪记录。", 400, "SHIPSGO_TRACKING_REQUIRED");
  const before = await getTrackingForActor(id, actor);
  const now = new Date();
  const saved = await prisma.shipsgoTracking.update({
    where: { id: before.id },
    data: {
      deletedAt: now,
      updatedById: actorId(actor) || null,
    },
  });
  await runNonCriticalTask("大掌櫃跟踪删除日志写入", () => writeAudit(
    request,
    actor,
    "删除大掌櫃海运跟踪",
    "shipsgo_trackings",
    saved.id,
    {
      status: before.status,
      syncStatus: before.syncStatus,
      shipsgoShipmentId: before.shipsgoShipmentId,
      masterBlNo: before.masterBlNo || before.bookingNumber,
    },
    { deletedAt: saved.deletedAt },
  ));
  return { id: saved.id, message: "大掌櫃跟踪已删除。" };
}

export async function recoverShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, input: unknown = {}) {
  assertWrite(actor, "domesticLogistics");
  const body = assertJsonObject(input) as ShipsgoTrackingInput;
  const orderId = cleanInputText(body.orderId, 80);
  if (!orderId) throw codedError("请选择需要补同步大掌櫃跟踪的订单。", 400, "ORDER_REQUIRED");
  const settings = await getShipsgoIntegrationSettings();
  assertShipsgoOceanEnabled(settings);
  const order = await getShipsgoTrackingOrder(orderId, actor);
  assertShipsgoTrackingWriteAccess(actor, order);
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
    return syncShipsgoOceanTracking(request, actor, existing.id);
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

export async function findShipsgoOceanTrackingByContainerNo(actor: ShipsgoActor, containerNoInput: unknown) {
  const containerNo = safeContainerNumber(containerNoInput);
  if (!containerNo) throw codedError("请输入正确的柜号，例如 MSKU1234567。", 400, "SHIPSGO_INVALID_CONTAINER");
  const row = await prisma.shipsgoTrackingContainer.findFirst({
    where: {
      containerNo,
      tracking: {
        provider: SHIPSGO_PROVIDER,
        mode: OCEAN_MODE,
        deletedAt: null,
      },
    },
    include: {
      tracking: {
        include: {
          containers: {
            select: { containerNo: true },
            orderBy: [{ containerNo: "asc" }],
          },
          order: {
            select: {
              id: true,
              orderNo: true,
              blNo: true,
              customer: { select: { salespersonUserId: true } },
              logisticsSuppliers: { select: { supplierId: true } },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });
  if (!row) {
    throw codedError("本地未找到该柜号对应的大掌櫃跟踪，请管理员先同步已有提单跟踪。", 404, "SHIPSGO_CONTAINER_NOT_FOUND");
  }
  if (!canAccessDomesticLogisticsOrder(actor, row.tracking.order)) {
    throw codedError("无权限访问该柜号对应的大掌櫃跟踪。", 403, "PERMISSION_DENIED");
  }
  return { tracking: serializeShipsgoTracking(row.tracking), message: "已从本地柜号关联返回大掌櫃跟踪。" };
}
