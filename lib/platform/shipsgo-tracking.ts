import crypto from "node:crypto";
import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  assertJsonObject,
  codedError,
  isPlainRecord,
  nonEmpty,
  num,
} from "./shared-base-utils";
import { assertWrite, timingSafeEqualText } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { canAccessDomesticLogisticsOrder } from "./masters-access";
import { getShipsgoIntegrationSettings } from "./shipsgo-integration";

type ShipsgoActor = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];

type ShipsgoTrackingInput = Record<string, unknown> & {
  orderId?: unknown;
  carrierScac?: unknown;
  bookingNumber?: unknown;
  containerNumber?: unknown;
  reference?: unknown;
};

type ShipsgoSettings = Awaited<ReturnType<typeof getShipsgoIntegrationSettings>>;

type ShipsgoApiResponse<T> = {
  status: number;
  data: T;
  headers: Headers;
};

type ShipsgoShipmentPayload = Record<string, unknown>;

type ShipsgoTrackingOrder = Awaited<ReturnType<typeof getShipsgoTrackingOrder>>;

const SHIPSGO_PROVIDER = "SHIPSGO";
const OCEAN_MODE = "OCEAN";
const CONTAINER_PATTERN = /^[A-Z]{4}[0-9]{7}$/;
const CARRIER_PATTERN = /^(SG_)?[A-Z0-9]{4}$/;

function actorId(actor: ShipsgoActor) {
  return nonEmpty(actor?.id);
}

function cleanInputText(value: unknown, limit = 128) {
  return nonEmpty(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

function cleanCarrierScac(value: unknown) {
  const text = cleanInputText(value, 8).toUpperCase();
  if (text && !CARRIER_PATTERN.test(text)) {
    throw codedError("船公司代码应为 ShipsGo 支持的 SCAC 代码，例如 MAEU / CMDU。", 400, "SHIPSGO_INVALID_CARRIER");
  }
  return text;
}

function cleanContainerNumber(value: unknown) {
  const text = cleanInputText(value, 24).toUpperCase();
  if (text && !CONTAINER_PATTERN.test(text)) {
    throw codedError("柜号格式应为 4 位字母 + 7 位数字，例如 MSKU1234567。", 400, "SHIPSGO_INVALID_CONTAINER");
  }
  return text;
}

function safeContainerNumber(value: unknown) {
  const text = cleanInputText(value, 24).toUpperCase();
  return CONTAINER_PATTERN.test(text) ? text : "";
}

function cleanBookingNumber(value: unknown) {
  const text = cleanInputText(value, 64);
  if (text && !/^[a-zA-Z0-9/-]+$/.test(text)) {
    throw codedError("提单号 / Booking No. 仅支持字母、数字、斜杠和横线。", 400, "SHIPSGO_INVALID_BOOKING");
  }
  return text;
}

function shipsgoApiBaseUrl(settings: ShipsgoSettings) {
  const base = String(settings.apiBaseUrl || "https://api.shipsgo.com").replace(/\/+$/, "");
  return base.endsWith("/v2") ? base : `${base}/v2`;
}

function assertShipsgoOceanEnabled(settings: ShipsgoSettings) {
  if (!settings.enabled) throw codedError("ShipsGo 集成未启用。", 400, "SHIPSGO_DISABLED");
  if (!settings.apiKey) throw codedError("ShipsGo API Key 未配置。", 400, "SHIPSGO_API_KEY_REQUIRED");
  if (!settings.oceanTrackingEnabled) throw codedError("ShipsGo 海运跟踪功能未启用。", 400, "SHIPSGO_OCEAN_DISABLED");
}

async function shipsgoApiRequest<T>(
  settings: ShipsgoSettings,
  path: string,
  options: RequestInit = {},
  allowConflict = false,
): Promise<ShipsgoApiResponse<T>> {
  const response = await fetch(`${shipsgoApiBaseUrl(settings)}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Shipsgo-User-Token": settings.apiKey,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  const data = text ? safeJsonParse(text) : {};
  if (!response.ok && !(allowConflict && response.status === 409)) {
    throw codedError(shipsgoApiErrorMessage(response.status, data), shipsgoApiErrorStatus(response.status), "SHIPSGO_API_ERROR");
  }
  return { status: response.status, data: data as T, headers: response.headers };
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function shipsgoResponseMessage(data: unknown) {
  if (!isPlainRecord(data)) return "";
  return nonEmpty(data.message || data.error || data.detail || data.title);
}

function shipsgoApiErrorStatus(status: number) {
  if (status === 401 || status === 403) return 400;
  if (status === 402) return 402;
  if (status === 429) return 429;
  if (status >= 500) return 502;
  return 400;
}

function shipsgoApiErrorMessage(status: number, data: unknown) {
  const detail = shipsgoResponseMessage(data);
  if (status === 401 || status === 403) return "ShipsGo API Key 无效或权限不足。";
  if (status === 402) return "ShipsGo Credit 不足，请先充值或调整跟踪数量。";
  if (status === 429) return "ShipsGo 请求频率过高，请稍后再试。";
  if (status >= 500) return "ShipsGo 服务暂时不可用，请稍后再试。";
  return detail || "ShipsGo 请求失败。";
}

function firstRecord(...values: unknown[]): ShipsgoShipmentPayload | null {
  for (const value of values) {
    if (isPlainRecord(value)) return value;
  }
  return null;
}

function extractShipmentPayload(data: unknown): ShipsgoShipmentPayload {
  if (!isPlainRecord(data)) return {};
  return firstRecord(
    data.shipment,
    data.data,
    isPlainRecord(data.data) ? data.data.shipment : null,
    isPlainRecord(data.result) ? data.result.shipment : null,
    data,
  ) || {};
}

function textAt(source: unknown, key: string) {
  return isPlainRecord(source) ? nonEmpty(source[key]) : "";
}

function recordAt(source: unknown, key: string) {
  const value = isPlainRecord(source) ? source[key] : null;
  return isPlainRecord(value) ? value : {};
}

function arrayAt(source: unknown, key: string) {
  const value = isPlainRecord(source) ? source[key] : null;
  return Array.isArray(value) ? value : [];
}

function dateAt(source: unknown, key: string) {
  const text = textAt(source, key);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function lastOceanMovement(containers: unknown[]) {
  const movements = containers.flatMap((container) => arrayAt(container, "movements"));
  return movements
    .map((movement) => {
      const timestamp = dateAt(movement, "timestamp");
      return { movement, timestamp };
    })
    .filter((item): item is { movement: unknown; timestamp: Date } => Boolean(item.timestamp))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0] || null;
}

function mapUrl(shipmentId: string, mapToken: string) {
  if (!shipmentId || !mapToken) return "";
  return `https://map.shipsgo.com/ocean/shipments/${encodeURIComponent(shipmentId)}?token=${encodeURIComponent(mapToken)}`;
}

function mapShipsgoShipmentPayload(payload: ShipsgoShipmentPayload) {
  const carrier = recordAt(payload, "carrier");
  const route = recordAt(payload, "route");
  const pol = recordAt(route, "port_of_loading");
  const pod = recordAt(route, "port_of_discharge");
  const tokens = recordAt(payload, "tokens");
  const containers = arrayAt(payload, "containers");
  const lastMovement = lastOceanMovement(containers);
  const vessel = lastMovement ? recordAt(lastMovement.movement, "vessel") : {};
  const shipmentId = textAt(payload, "id");
  const token = textAt(tokens, "map");
  return {
    shipsgoShipmentId: shipmentId,
    reference: textAt(payload, "reference"),
    carrierScac: textAt(carrier, "scac"),
    carrierName: textAt(carrier, "name"),
    bookingNumber: textAt(payload, "booking_number"),
    containerNumber: textAt(payload, "container_number"),
    status: textAt(payload, "status") || "UNKNOWN",
    syncStatus: "SYNCED",
    syncMessage: "",
    originName: textAt(pol, "location"),
    destinationName: textAt(pod, "location"),
    dateOfLoading: dateAt(route, "date_of_loading"),
    dateOfDischarge: dateAt(route, "date_of_discharge"),
    predictedDischargeDate: dateAt(route, "date_of_discharge_predicted"),
    vesselName: textAt(vessel, "name"),
    voyage: textAt(lastMovement?.movement, "voyage"),
    mapToken: token,
    mapUrl: mapUrl(shipmentId, token),
    lastEvent: textAt(lastMovement?.movement, "event"),
    lastEventAt: lastMovement?.timestamp || null,
    rawPayload: payload as Prisma.InputJsonValue,
  };
}

function serializeShipsgoTracking(row: {
  id: string;
  orderId: string;
  provider: string;
  mode: string;
  shipsgoShipmentId?: string | null;
  reference?: string | null;
  carrierScac?: string | null;
  carrierName?: string | null;
  bookingNumber?: string | null;
  containerNumber?: string | null;
  status?: string | null;
  syncStatus?: string | null;
  syncMessage?: string | null;
  originName?: string | null;
  destinationName?: string | null;
  dateOfLoading?: Date | string | null;
  dateOfDischarge?: Date | string | null;
  predictedDischargeDate?: Date | string | null;
  vesselName?: string | null;
  voyage?: string | null;
  mapUrl?: string | null;
  lastEvent?: string | null;
  lastEventAt?: Date | string | null;
  lastCheckedAt?: Date | string | null;
  lastSyncedAt?: Date | string | null;
  updatedAt?: Date | string | null;
}) {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    mode: row.mode,
    shipsgoShipmentId: row.shipsgoShipmentId || "",
    reference: row.reference || "",
    carrierScac: row.carrierScac || "",
    carrierName: row.carrierName || "",
    bookingNumber: row.bookingNumber || "",
    containerNumber: row.containerNumber || "",
    status: row.status || "UNKNOWN",
    statusLabel: shipsgoStatusLabel(row.status),
    syncStatus: row.syncStatus || "NOT_SYNCED",
    syncMessage: row.syncMessage || "",
    originName: row.originName || "",
    destinationName: row.destinationName || "",
    dateOfLoading: dateText(row.dateOfLoading),
    dateOfDischarge: dateText(row.dateOfDischarge),
    predictedDischargeDate: dateText(row.predictedDischargeDate),
    vesselName: row.vesselName || "",
    voyage: row.voyage || "",
    mapUrl: row.mapUrl || "",
    lastEvent: row.lastEvent || "",
    lastEventAt: dateTimeText(row.lastEventAt),
    lastCheckedAt: dateTimeText(row.lastCheckedAt),
    lastSyncedAt: dateTimeText(row.lastSyncedAt),
    updatedAt: dateTimeText(row.updatedAt),
  };
}

export type ShipsgoTrackingDto = ReturnType<typeof serializeShipsgoTracking>;

export function serializeShipsgoTrackingSummary(row: Parameters<typeof serializeShipsgoTracking>[0]) {
  return serializeShipsgoTracking(row);
}

function dateText(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function dateTimeText(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function shipsgoStatusLabel(value: unknown) {
  const status = nonEmpty(value).toUpperCase();
  const labels: Record<string, string> = {
    NEW: "新建",
    INPROGRESS: "跟踪中",
    BOOKED: "已订舱",
    LOADED: "已装船",
    SAILING: "航行中",
    ARRIVED: "已到港",
    DISCHARGED: "已卸船",
    UNTRACKED: "无法跟踪",
    LOCAL_PENDING: "待创建",
    UNKNOWN: "未知",
  };
  return labels[status] || status || "未知";
}

function firstContainerNumber(order: ShipsgoTrackingOrder) {
  for (const info of order.domesticLogisticsInfos || []) {
    for (const item of info.transportItems || []) {
      const containerNo = safeContainerNumber(item.containerNo);
      if (containerNo) return containerNo;
    }
  }
  return "";
}

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

function createPayloadFromInput(input: ShipsgoTrackingInput, order: ShipsgoTrackingOrder) {
  const carrierScac = cleanCarrierScac(input.carrierScac);
  const bookingNumber = cleanBookingNumber(input.bookingNumber) || cleanBookingNumber(order.blNo);
  const containerNumber = cleanContainerNumber(input.containerNumber) || firstContainerNumber(order);
  if (!bookingNumber && !containerNumber) {
    throw codedError("请至少填写提单号 / Booking No. 或柜号后再创建 ShipsGo 跟踪。", 400, "SHIPSGO_TRACKING_TARGET_REQUIRED");
  }
  const reference = cleanInputText(input.reference, 128)
    || cleanInputText(`${order.orderNo || order.id}-${bookingNumber || containerNumber}`, 128);
  if (reference && reference.length < 5) {
    throw codedError("ShipsGo Reference 至少需要 5 个字符。", 400, "SHIPSGO_REFERENCE_TOO_SHORT");
  }
  return {
    reference,
    carrier: carrierScac || null,
    booking_number: bookingNumber || null,
    container_number: containerNumber || null,
  };
}

export async function createShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, input: unknown = {}) {
  assertWrite(actor, "domesticLogistics");
  const currentActorId = actorId(actor);
  const body = assertJsonObject(input) as ShipsgoTrackingInput;
  const orderId = cleanInputText(body.orderId, 80);
  if (!orderId) throw codedError("请选择需要创建 ShipsGo 跟踪的订单。", 400, "ORDER_REQUIRED");
  const settings = await getShipsgoIntegrationSettings();
  assertShipsgoOceanEnabled(settings);
  const order = await getShipsgoTrackingOrder(orderId, actor);
  const payload = createPayloadFromInput(body, order);

  const existing = await prisma.shipsgoTracking.findFirst({
    where: {
      orderId,
      provider: SHIPSGO_PROVIDER,
      mode: OCEAN_MODE,
      deletedAt: null,
      OR: [
        payload.booking_number ? { bookingNumber: payload.booking_number } : {},
        payload.container_number ? { containerNumber: payload.container_number } : {},
      ].filter((item) => Object.keys(item).length) as Prisma.ShipsgoTrackingWhereInput[],
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  if (existing?.shipsgoShipmentId) {
    return { tracking: serializeShipsgoTracking(existing), alreadyExists: true, message: "该订单已创建 ShipsGo 跟踪。" };
  }

  const response = await shipsgoApiRequest<unknown>(
    settings,
    "/ocean/shipments",
    { method: "POST", body: JSON.stringify(payload) },
    true,
  );
  const shipment = extractShipmentPayload(response.data);
  const mapped = mapShipsgoShipmentPayload(shipment);
  const now = new Date();
  const saved = existing
    ? await prisma.shipsgoTracking.update({
      where: { id: existing.id },
      data: {
        ...mapped,
        reference: mapped.reference || payload.reference,
        carrierScac: mapped.carrierScac || cleanCarrierScac(payload.carrier),
        bookingNumber: mapped.bookingNumber || payload.booking_number,
        containerNumber: mapped.containerNumber || payload.container_number,
        syncMessage: response.status === 409 ? "ShipsGo 已存在该跟踪，已同步本地记录。" : "",
        lastCheckedAt: now,
        lastSyncedAt: now,
        updatedById: currentActorId || null,
      },
    })
    : await prisma.shipsgoTracking.create({
      data: {
        orderId,
        provider: SHIPSGO_PROVIDER,
        mode: OCEAN_MODE,
        ...mapped,
        reference: mapped.reference || payload.reference,
        carrierScac: mapped.carrierScac || cleanCarrierScac(payload.carrier),
        bookingNumber: mapped.bookingNumber || payload.booking_number,
        containerNumber: mapped.containerNumber || payload.container_number,
        syncMessage: response.status === 409 ? "ShipsGo 已存在该跟踪，已同步本地记录。" : "",
        lastCheckedAt: now,
        lastSyncedAt: now,
        createdById: currentActorId || null,
        updatedById: currentActorId || null,
      },
    });

  await runNonCriticalTask("ShipsGo 跟踪创建日志写入", () => writeAudit(
    request,
    actor,
    "创建 ShipsGo 海运跟踪",
    "shipsgo_trackings",
    saved.id,
    null,
    {
      orderId,
      shipsgoShipmentId: saved.shipsgoShipmentId,
      bookingNumber: saved.bookingNumber,
      containerNumber: saved.containerNumber,
      creditsCost: response.headers.get("X-Shipsgo-Credits-Cost") || "",
      creditsRemaining: response.headers.get("X-Shipsgo-Credits-Remaining") || "",
    },
  ));

  return { tracking: serializeShipsgoTracking(saved), alreadyExists: response.status === 409, message: "ShipsGo 跟踪已创建。" };
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
  if (!tracking) throw codedError("ShipsGo 跟踪记录不存在。", 404, "SHIPSGO_TRACKING_NOT_FOUND");
  if (!canAccessDomesticLogisticsOrder(actor, tracking.order)) {
    throw codedError("无权限访问该 ShipsGo 跟踪记录。", 403, "PERMISSION_DENIED");
  }
  return tracking;
}

export async function syncShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, trackingId: unknown) {
  assertWrite(actor, "domesticLogistics");
  const id = cleanInputText(trackingId, 80);
  if (!id) throw codedError("请选择需要同步的 ShipsGo 跟踪记录。", 400, "SHIPSGO_TRACKING_REQUIRED");
  const settings = await getShipsgoIntegrationSettings();
  assertShipsgoOceanEnabled(settings);
  const before = await getTrackingForActor(id, actor);
  if (!before.shipsgoShipmentId) throw codedError("该记录还没有 ShipsGo Shipment ID，请先创建跟踪。", 400, "SHIPSGO_SHIPMENT_ID_REQUIRED");

  const response = await shipsgoApiRequest<unknown>(settings, `/ocean/shipments/${encodeURIComponent(before.shipsgoShipmentId)}`);
  const shipment = extractShipmentPayload(response.data);
  const mapped = mapShipsgoShipmentPayload(shipment);
  const now = new Date();
  const saved = await prisma.shipsgoTracking.update({
    where: { id: before.id },
    data: {
      ...mapped,
      lastCheckedAt: now,
      lastSyncedAt: now,
      updatedById: actorId(actor) || null,
    },
  });
  await runNonCriticalTask("ShipsGo 跟踪同步日志写入", () => writeAudit(
    request,
    actor,
    "同步 ShipsGo 海运跟踪",
    "shipsgo_trackings",
    saved.id,
    { status: before.status, syncStatus: before.syncStatus },
    { status: saved.status, syncStatus: saved.syncStatus, lastSyncedAt: saved.lastSyncedAt },
  ));
  return { tracking: serializeShipsgoTracking(saved), message: "ShipsGo 状态已同步。" };
}

function recursiveShipmentId(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return "";
  if (isPlainRecord(value)) {
    const direct = nonEmpty(value.shipment_id || value.shipmentId);
    if (direct) return direct;
    const shipment = isPlainRecord(value.shipment) ? nonEmpty(value.shipment.id || value.shipment.shipment_id || value.shipment.shipmentId) : "";
    if (shipment) return shipment;
    for (const item of Object.values(value)) {
      const found = recursiveShipmentId(item, depth + 1);
      if (found) return found;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = recursiveShipmentId(item, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

export async function handleShipsgoWebhook(rawBody: string, signature: unknown) {
  const settings = await getShipsgoIntegrationSettings();
  if (!settings.enabled || !settings.webhookEnabled) {
    throw codedError("ShipsGo Webhook 未启用。", 400, "SHIPSGO_WEBHOOK_DISABLED");
  }
  if (!settings.webhookSecret) {
    throw codedError("ShipsGo Webhook Secret 未配置。", 400, "SHIPSGO_WEBHOOK_SECRET_REQUIRED");
  }
  const expected = crypto.createHmac("sha256", settings.webhookSecret).update(rawBody).digest("hex");
  if (!timingSafeEqualText(nonEmpty(signature), expected)) {
    throw codedError("ShipsGo Webhook 签名校验失败。", 401, "SHIPSGO_WEBHOOK_SIGNATURE_INVALID");
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
  if (!before) return { success: true, ignored: true, message: "本地未找到对应 ShipsGo 跟踪，已忽略。" };
  const mapped = mapShipsgoShipmentPayload(shipmentPayload);
  const saved = await prisma.shipsgoTracking.update({
    where: { id: before.id },
    data: {
      ...mapped,
      shipsgoShipmentId: mapped.shipsgoShipmentId || shipmentId,
      syncStatus: "WEBHOOK_SYNCED",
      syncMessage: "",
      lastCheckedAt: new Date(),
      lastSyncedAt: new Date(),
    },
  });
  return { success: true, tracking: serializeShipsgoTracking(saved) };
}

export function shipsgoRateLimitSummary(headers: Headers) {
  return {
    limit: num(headers.get("X-RateLimit-Limit"), 0),
    remaining: num(headers.get("X-RateLimit-Remaining"), 0),
    reset: nonEmpty(headers.get("X-RateLimit-Reset")),
  };
}
