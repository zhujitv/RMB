import crypto from "node:crypto";
import { prisma } from "../prisma";
import { assertJsonObject, codedError, nonEmpty } from "./shared-base-utils";
import { assertRead, assertWrite, timingSafeEqualText } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { canAccessDomesticLogisticsOrder } from "./masters-access";
import { getShipsgoIntegrationSettings } from "./shipsgo-integration";
import {
  extractShipmentPayload,
  mapShipsgoShipmentPayload,
  recursiveShipmentId,
  serializeShipsgoTracking,
  textAt,
  trackingDataFromMappedShipment,
} from "./shipsgo-tracking-mapping";
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
  safeJsonParse,
  shipsgoApiRequest,
  uniqueStrings,
  type ShipsgoActor,
  type ShipsgoSettings,
  type ShipsgoShipmentPayload,
  type ShipsgoTrackingInput,
} from "./shipsgo-tracking-utils";

type AuditRequestLike = Parameters<typeof writeAudit>[0];
type ShipsgoTrackingOrder = Awaited<ReturnType<typeof getShipsgoTrackingOrder>>;

async function getShipsgoTrackingOrder(orderId: string, actor: ShipsgoActor) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      customerNameSnapshot: true,
      customer: { select: { salespersonUserId: true, shortName: true, name: true } },
      logisticsSuppliers: { select: { supplierId: true } },
      domesticLogisticsInfos: {
        where: { deletedAt: null },
        select: {
          id: true,
          transportItems: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { containerNo: true, containerType: true },
          },
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
      },
    },
  });
  if (!order) throw codedError("订单不存在或已删除。", 404, "ORDER_NOT_FOUND");
  if (!canAccessDomesticLogisticsOrder(actor, order)) {
    throw codedError("无权限访问该订单物流信息。", 403, "PERMISSION_DENIED");
  }
  return order;
}

function orderContainerNumbers(order: ShipsgoTrackingOrder) {
  return uniqueStrings((order.domesticLogisticsInfos || []).flatMap((info) => (
    info.transportItems || []
  ).map((item) => safeContainerNumber(item.containerNo))));
}

function queryString(params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

function shipmentHasUsefulIdentity(payload: ShipsgoShipmentPayload) {
  const mapped = mapShipsgoShipmentPayload(payload);
  return Boolean(mapped.shipsgoShipmentId || mapped.masterBlNo || mapped.bookingNumber || mapped.containerNumbers.length);
}

async function findExistingShipsgoShipment(settings: ShipsgoSettings, target: { masterBlNo: string; carrierScac?: string; containerNumbers?: string[] }) {
  const candidates: string[] = [];
  const masterBlNo = target.masterBlNo;
  const carrier = target.carrierScac || "";
  if (masterBlNo) {
    candidates.push(`/ocean/shipments?${queryString({ booking_number: masterBlNo, carrier })}`);
    candidates.push(`/ocean/shipments?${queryString({ master_bl_no: masterBlNo, carrier })}`);
    candidates.push(`/ocean/shipments?${queryString({ mbl_number: masterBlNo, carrier })}`);
    candidates.push(`/ocean/shipments?${queryString({ reference: masterBlNo })}`);
  }
  for (const containerNo of target.containerNumbers || []) {
    candidates.push(`/ocean/shipments?${queryString({ container_number: containerNo })}`);
    candidates.push(`/ocean/shipments?${queryString({ container_no: containerNo })}`);
  }

  let lastMessage = "";
  for (const path of uniqueStrings(candidates)) {
    try {
      const response = await shipsgoApiRequest<unknown>(settings, path, { method: "GET" });
      const shipment = extractShipmentPayload(response.data);
      if (shipmentHasUsefulIdentity(shipment)) return { shipment, path };
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "查询大掌櫃已有跟踪失败";
    }
  }
  throw codedError(
    lastMessage || "未在大掌櫃查询到已有跟踪，请确认提单号或柜号已在大掌櫃后台存在。",
    404,
    "SHIPSGO_EXISTING_TRACKING_NOT_FOUND",
  );
}

function createPayloadFromInput(input: ShipsgoTrackingInput, order: ShipsgoTrackingOrder) {
  const carrierScac = cleanCarrierScac(input.carrierScac);
  const masterBlNo = cleanBookingNumber(order.blNo);
  if (!masterBlNo) {
    throw codedError("请先在物流信息中录入提单号后再开始追踪", 400, "SHIPSGO_MASTER_BL_REQUIRED");
  }
  const reference = cleanInputText(input.reference, 128)
    || cleanInputText(`${order.orderNo || order.id}-${masterBlNo}`, 128);
  if (reference && reference.length < 5) {
    throw codedError("大掌櫃 Reference 至少需要 5 个字符。", 400, "SHIPSGO_REFERENCE_TOO_SHORT");
  }
  return {
    reference,
    carrier: carrierScac || null,
    booking_number: masterBlNo,
    master_bl_no: masterBlNo,
  };
}

async function replaceShipsgoTrackingContainers(trackingId: string, containerNumbers: string[]) {
  const cleanContainers = uniqueStrings(containerNumbers.map((containerNo) => safeContainerNumber(containerNo)));
  await prisma.$transaction([
    prisma.shipsgoTrackingContainer.deleteMany({ where: { trackingId } }),
    ...(cleanContainers.length ? [
      prisma.shipsgoTrackingContainer.createMany({
        data: cleanContainers.map((containerNo) => ({ trackingId, containerNo })),
        skipDuplicates: true,
      }),
    ] : []),
  ]);
}

async function loadShipsgoTrackingWithContainers(id: string) {
  return prisma.shipsgoTracking.findUnique({
    where: { id },
    include: {
      containers: {
        select: { containerNo: true },
        orderBy: [{ containerNo: "asc" }],
      },
    },
  });
}

export async function createShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, input: unknown = {}) {
  assertWrite(actor, "domesticLogistics");
  const currentActorId = actorId(actor);
  const body = assertJsonObject(input) as ShipsgoTrackingInput;
  const orderId = cleanInputText(body.orderId, 80);
  if (!orderId) throw codedError("请选择需要创建大掌櫃跟踪的订单。", 400, "ORDER_REQUIRED");
  const settings = await getShipsgoIntegrationSettings();
  assertShipsgoOceanEnabled(settings);
  const order = await getShipsgoTrackingOrder(orderId, actor);
  assertShipsgoTrackingWriteAccess(actor, order);
  const payload = createPayloadFromInput(body, order);

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
  if (existing) {
    return { tracking: serializeShipsgoTracking(existing), alreadyExists: true, message: "该订单已创建大掌櫃跟踪。" };
  }

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

async function getTrackingForActor(id: string, actor: ShipsgoActor) {
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

export async function syncDueShipsgoOceanTrackings(request: AuditRequestLike, actor: ShipsgoActor, options: { limit?: number; now?: Date } = {}) {
  assertWrite(actor, "domesticLogistics");
  const settings = await getShipsgoIntegrationSettings();
  assertShipsgoOceanEnabled(settings);
  const now = options.now || new Date();
  const cutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit || 50)));
  const rows = await prisma.shipsgoTracking.findMany({
    where: {
      provider: SHIPSGO_PROVIDER,
      mode: OCEAN_MODE,
      deletedAt: null,
      shipsgoShipmentId: { not: null },
      OR: [
        { lastSyncTime: null },
        { lastSyncTime: { lt: cutoff } },
        { lastSyncedAt: null },
        { lastSyncedAt: { lt: cutoff } },
      ],
    },
    orderBy: [{ lastSyncTime: "asc" }, { lastSyncedAt: "asc" }, { updatedAt: "asc" }],
    take: limit,
  });
  const results: Array<{ id: string; ok: boolean; message: string }> = [];
  for (const row of rows) {
    try {
      const response = await shipsgoApiRequest<unknown>(settings, `/ocean/shipments/${encodeURIComponent(row.shipsgoShipmentId || "")}`);
      const shipment = extractShipmentPayload(response.data);
      const mapped = mapShipsgoShipmentPayload(shipment);
      const trackingData = trackingDataFromMappedShipment(mapped);
      const savedBase = await prisma.shipsgoTracking.update({
        where: { id: row.id },
        data: {
          ...trackingData,
          masterBlNo: mapped.masterBlNo || row.masterBlNo || row.bookingNumber,
          containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || row.containerNumber,
          eta: mapped.eta,
          currentStatus: mapped.currentStatus,
          syncStatus: "SYNCED",
          syncMessage: "",
          lastCheckedAt: now,
          lastSyncedAt: now,
          lastSyncTime: now,
          updatedById: actorId(actor) || null,
        },
      });
      await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
      results.push({ id: row.id, ok: true, message: "同步成功" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";
      await prisma.shipsgoTracking.update({
        where: { id: row.id },
        data: {
          syncStatus: "SYNC_FAILED",
          syncMessage: message.slice(0, 500),
          lastCheckedAt: now,
          lastSyncTime: now,
          updatedById: actorId(actor) || null,
        },
      }).catch(() => null);
      results.push({ id: row.id, ok: false, message });
    }
  }
  await runNonCriticalTask("大掌櫃定时同步日志写入", () => writeAudit(
    request,
    actor,
    "定时同步大掌櫃海运跟踪",
    "shipsgo_trackings",
    "cron",
    null,
    { total: rows.length, success: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length },
  ));
  return {
    success: true,
    total: rows.length,
    successCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    results,
  };
}

export async function handleShipsgoWebhook(rawBody: string, signature: unknown) {
  const settings = await getShipsgoIntegrationSettings();
  if (!settings.enabled || !settings.webhookEnabled) {
    throw codedError("大掌櫃 Webhook 未启用。", 400, "SHIPSGO_WEBHOOK_DISABLED");
  }
  if (!settings.webhookSecret) {
    throw codedError("大掌櫃 Webhook Secret 未配置。", 400, "SHIPSGO_WEBHOOK_SECRET_REQUIRED");
  }
  const expected = crypto.createHmac("sha256", settings.webhookSecret).update(rawBody).digest("hex");
  if (!timingSafeEqualText(nonEmpty(signature), expected)) {
    throw codedError("大掌櫃 Webhook 签名校验失败。", 401, "SHIPSGO_WEBHOOK_SIGNATURE_INVALID");
  }
  const payload = safeJsonParse(rawBody);
  const shipmentPayload = extractShipmentPayload(payload);
  const shipmentId = textAt(shipmentPayload, "id") || recursiveShipmentId(payload);
  if (!shipmentId) {
    return { success: true, ignored: true, message: "未找到 Shipment ID，已忽略。" };
  }
  const before = await prisma.shipsgoTracking.findFirst({
    where: { provider: SHIPSGO_PROVIDER, shipsgoShipmentId: shipmentId, deletedAt: null },
    orderBy: [{ updatedAt: "desc" }],
  });
  if (!before) return { success: true, ignored: true, message: "本地未找到对应大掌櫃跟踪，已忽略。" };
  const mapped = mapShipsgoShipmentPayload(shipmentPayload);
  const trackingData = trackingDataFromMappedShipment(mapped);
  const now = new Date();
  const savedBase = await prisma.shipsgoTracking.update({
    where: { id: before.id },
    data: {
      ...trackingData,
      shipsgoShipmentId: mapped.shipsgoShipmentId || shipmentId,
      masterBlNo: mapped.masterBlNo || before.masterBlNo || before.bookingNumber,
      containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || before.containerNumber,
      eta: mapped.eta,
      currentStatus: mapped.currentStatus,
      syncStatus: "WEBHOOK_SYNCED",
      syncMessage: "",
      lastCheckedAt: now,
      lastSyncedAt: now,
      lastSyncTime: now,
    },
  });
  await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
  const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
  if (!saved) throw codedError("大掌櫃 Webhook 同步保存失败。", 500, "SHIPSGO_TRACKING_SAVE_FAILED");
  return { success: true, tracking: serializeShipsgoTracking(saved) };
}
