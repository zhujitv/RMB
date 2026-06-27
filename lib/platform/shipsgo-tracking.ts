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
  masterBlNo?: unknown;
  carrierScac?: unknown;
  bookingNumber?: unknown;
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
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

function firstArrayRecord(value: unknown): ShipsgoShipmentPayload | null {
  if (!Array.isArray(value)) return null;
  return value.find((item) => isPlainRecord(item)) as ShipsgoShipmentPayload | undefined || null;
}

function extractShipmentPayload(data: unknown): ShipsgoShipmentPayload {
  if (Array.isArray(data)) return firstArrayRecord(data) || {};
  if (!isPlainRecord(data)) return {};
  return firstRecord(
    data.shipment,
    data.Shipment,
    data.data,
    firstArrayRecord(data.data),
    firstArrayRecord(data.shipments),
    firstArrayRecord(data.Shipments),
    firstArrayRecord(data.results),
    firstArrayRecord(data.items),
    isPlainRecord(data.data) ? data.data.shipment : null,
    isPlainRecord(data.data) ? firstArrayRecord(data.data.shipments) : null,
    isPlainRecord(data.result) ? data.result.shipment : null,
    data,
  ) || {};
}

function textAt(source: unknown, key: string) {
  if (!isPlainRecord(source)) return "";
  const value = source[key];
  if (isPlainRecord(value) || Array.isArray(value)) return "";
  return nonEmpty(value);
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function textByKeys(source: unknown, keys: string[], depth = 0): string {
  if (depth > 6 || source == null) return "";
  if (isPlainRecord(source)) {
    const normalizedKeys = keys.map(normalizeKey);
    for (const [key, value] of Object.entries(source)) {
      if (normalizedKeys.includes(normalizeKey(key))) {
        if (isPlainRecord(value) || Array.isArray(value)) {
          const nested = textByKeys(value, keys, depth + 1);
          if (nested) return nested;
          continue;
        }
        const text = nonEmpty(value);
        if (text) return text;
      }
    }
    for (const value of Object.values(source)) {
      const found = textByKeys(value, keys, depth + 1);
      if (found) return found;
    }
  }
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = textByKeys(item, keys, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function arrayByKeys(source: unknown, keys: string[], depth = 0): unknown[] {
  if (depth > 5 || source == null) return [];
  if (isPlainRecord(source)) {
    const normalizedKeys = keys.map(normalizeKey);
    for (const [key, value] of Object.entries(source)) {
      if (normalizedKeys.includes(normalizeKey(key)) && Array.isArray(value)) return value;
    }
    for (const value of Object.values(source)) {
      const found = arrayByKeys(value, keys, depth + 1);
      if (found.length) return found;
    }
  }
  return [];
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

function dateByKeys(source: unknown, keys: string[]) {
  const text = textByKeys(source, keys);
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

function containerNumberFromRecord(container: unknown) {
  return safeContainerNumber(
    textAt(container, "container_number")
    || textAt(container, "containerNo")
    || textAt(container, "container_no")
    || textAt(container, "container")
    || textAt(container, "cntrNo")
    || textAt(container, "number")
    || textAt(container, "id"),
  );
}

function extractContainerNumbersFromPayload(payload: ShipsgoShipmentPayload) {
  const containers = arrayAt(payload, "containers")
    .concat(arrayByKeys(payload, ["containerList", "container_list", "containers"]))
    .map((container) => containerNumberFromRecord(container))
    .filter(Boolean);
  const directContainer = safeContainerNumber(
    textAt(payload, "container_number")
    || textAt(payload, "containerNo")
    || textAt(payload, "container_no")
    || textAt(payload, "containerNumber")
    || textByKeys(payload, ["container_number", "containerNo", "container_no", "containerNumber"]),
  );
  return uniqueStrings([directContainer, ...containers]);
}

function portName(...records: unknown[]) {
  for (const record of records) {
    const value = textAt(record, "location")
      || textAt(record, "name")
      || textAt(record, "port_name")
      || textAt(record, "portName")
      || textAt(record, "port")
      || textAt(record, "unlocode")
      || textAt(record, "code");
    if (value) return value;
  }
  return "";
}

function mapShipsgoShipmentPayload(payload: ShipsgoShipmentPayload) {
  const carrier = recordAt(payload, "carrier");
  const shippingLine = recordAt(payload, "shippingLine");
  const shippingLineSnake = recordAt(payload, "shipping_line");
  const route = recordAt(payload, "route");
  const pol = recordAt(route, "port_of_loading");
  const pod = recordAt(route, "port_of_discharge");
  const originPort = recordAt(payload, "originPort");
  const destinationPort = recordAt(payload, "destinationPort");
  const departurePort = recordAt(payload, "departurePort");
  const arrivalPort = recordAt(payload, "arrivalPort");
  const polRecord = recordAt(payload, "pol");
  const podRecord = recordAt(payload, "pod");
  const tokens = recordAt(payload, "tokens");
  const containers = arrayAt(payload, "containers").concat(arrayByKeys(payload, ["containerList", "container_list"]));
  const events = arrayByKeys(payload, ["events", "eventTimeline", "event_timeline", "trackingEvents", "tracking_events"]);
  const lastMovement = lastOceanMovement(containers);
  const vessel = lastMovement ? recordAt(lastMovement.movement, "vessel") : {};
  const latestEvent = events.length ? events[events.length - 1] : null;
  const latestEventVessel = latestEvent ? recordAt(latestEvent, "vessel") : {};
  const shipmentId = textAt(payload, "id")
    || textAt(payload, "shipment_id")
    || textAt(payload, "shipmentId")
    || recursiveShipmentId(payload);
  const token = textAt(tokens, "map") || textAt(payload, "mapToken") || textAt(payload, "map_token");
  const status = textAt(payload, "status")
    || textAt(payload, "current_status")
    || textAt(payload, "currentStatus")
    || textAt(payload, "latestStatus")
    || textAt(payload, "latest_status")
    || textAt(latestEvent, "status")
    || textAt(latestEvent, "event")
    || "UNKNOWN";
  const eta = dateAt(route, "date_of_discharge_predicted")
    || dateAt(route, "date_of_discharge")
    || dateByKeys(payload, ["eta", "ETA", "estimatedArrival", "estimated_arrival", "estimatedTimeOfArrival", "predictedDischargeDate", "dateOfDischargePredicted"]);
  const containerNumbers = extractContainerNumbersFromPayload(payload);
  const masterBlNo = textAt(payload, "master_bl_no")
    || textAt(payload, "master_bill_of_lading")
    || textAt(payload, "mbl_number")
    || textAt(payload, "masterBlNo")
    || textAt(payload, "bl_no")
    || textAt(payload, "blNo")
    || textAt(payload, "booking_number")
    || textAt(payload, "bookingNumber");
  const carrierScac = textAt(carrier, "scac")
    || textAt(shippingLine, "scac")
    || textAt(shippingLineSnake, "scac")
    || textAt(payload, "carrier_scac")
    || textAt(payload, "carrierScac")
    || textAt(payload, "scac")
    || textByKeys(payload, ["carrier_scac", "carrierScac", "scac"]);
  const carrierName = textAt(carrier, "name")
    || textAt(shippingLine, "name")
    || textAt(shippingLineSnake, "name")
    || textAt(payload, "shippingLine")
    || textAt(payload, "shipping_line")
    || textAt(payload, "carrier_name")
    || textAt(payload, "carrierName")
    || textByKeys(payload, ["carrier_name", "carrierName", "shippingLineName"]);
  const vesselName = textAt(vessel, "name")
    || textAt(latestEventVessel, "name")
    || textAt(payload, "vesselName")
    || textAt(payload, "vessel_name")
    || textByKeys(payload, ["vesselName", "vessel_name", "vessel"]);
  const voyage = textAt(lastMovement?.movement, "voyage")
    || textAt(latestEvent, "voyage")
    || textAt(payload, "voyage")
    || textAt(payload, "voyageNo")
    || textAt(payload, "voyage_no")
    || textAt(payload, "voyageNumber")
    || textByKeys(payload, ["voyageNo", "voyage_no", "voyageNumber", "voyage"]);
  return {
    shipsgoShipmentId: shipmentId,
    masterBlNo,
    reference: textAt(payload, "reference"),
    carrierScac,
    carrierName,
    bookingNumber: textAt(payload, "booking_number") || textAt(payload, "bookingNumber") || masterBlNo,
    containerNumber: containerNumbers[0] || textAt(payload, "container_number"),
    status,
    currentStatus: status,
    syncStatus: "SYNCED",
    syncMessage: "",
    originName: portName(pol, originPort, departurePort, polRecord) || textByKeys(payload, ["originPort", "departurePort", "pol", "portOfLoading"]),
    destinationName: portName(pod, destinationPort, arrivalPort, podRecord) || textByKeys(payload, ["destinationPort", "arrivalPort", "pod", "portOfDischarge"]),
    dateOfLoading: dateAt(route, "date_of_loading") || dateByKeys(payload, ["dateOfLoading", "date_of_loading", "etd", "departureDate"]),
    dateOfDischarge: dateAt(route, "date_of_discharge") || dateByKeys(payload, ["dateOfDischarge", "date_of_discharge", "ata", "arrivalDate"]),
    predictedDischargeDate: dateAt(route, "date_of_discharge_predicted") || eta,
    eta,
    vesselName,
    voyage,
    mapToken: token,
    mapUrl: mapUrl(shipmentId, token),
    lastEvent: textAt(lastMovement?.movement, "event")
      || textAt(latestEvent, "event")
      || textAt(latestEvent, "status")
      || textAt(payload, "latestStatus")
      || textAt(payload, "lastLocation")
      || textAt(payload, "last_location"),
    lastEventAt: lastMovement?.timestamp || dateByKeys(latestEvent, ["timestamp", "date", "eventDate", "event_date"]) || null,
    containerNumbers,
    rawPayload: payload as Prisma.InputJsonValue,
    rawResponse: payload as Prisma.InputJsonValue,
  };
}

function trackingDataFromMappedShipment(mapped: ReturnType<typeof mapShipsgoShipmentPayload>) {
  const { containerNumbers: _containerNumbers, ...trackingData } = mapped;
  return trackingData;
}

function serializeShipsgoTracking(row: {
  id: string;
  orderId: string;
  provider: string;
  mode: string;
  shipsgoShipmentId?: string | null;
  masterBlNo?: string | null;
  reference?: string | null;
  carrierScac?: string | null;
  carrierName?: string | null;
  bookingNumber?: string | null;
  containerNumber?: string | null;
  status?: string | null;
  currentStatus?: string | null;
  syncStatus?: string | null;
  syncMessage?: string | null;
  originName?: string | null;
  destinationName?: string | null;
  dateOfLoading?: Date | string | null;
  dateOfDischarge?: Date | string | null;
  predictedDischargeDate?: Date | string | null;
  eta?: Date | string | null;
  vesselName?: string | null;
  voyage?: string | null;
  mapUrl?: string | null;
  lastEvent?: string | null;
  lastEventAt?: Date | string | null;
  lastCheckedAt?: Date | string | null;
  lastSyncedAt?: Date | string | null;
  lastSyncTime?: Date | string | null;
  updatedAt?: Date | string | null;
  containers?: { containerNo?: string | null }[] | null;
  rawPayload?: unknown;
  rawResponse?: unknown;
}) {
  const rawFallback = isPlainRecord(row.rawResponse)
    ? mapShipsgoShipmentPayload(row.rawResponse)
    : isPlainRecord(row.rawPayload)
      ? mapShipsgoShipmentPayload(row.rawPayload)
      : null;
  const containerNumbers = uniqueStrings([
    row.containerNumber || "",
    ...((row.containers || []).map((container) => container.containerNo || "")),
    ...(rawFallback?.containerNumbers || []),
  ]);
  const status = row.currentStatus || row.status || rawFallback?.currentStatus || rawFallback?.status || "UNKNOWN";
  const masterBlNo = row.masterBlNo || row.bookingNumber || rawFallback?.masterBlNo || rawFallback?.bookingNumber || "";
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    mode: row.mode,
    shipsgoShipmentId: row.shipsgoShipmentId || rawFallback?.shipsgoShipmentId || "",
    masterBlNo,
    reference: row.reference || "",
    carrierScac: row.carrierScac || rawFallback?.carrierScac || "",
    carrierName: row.carrierName || rawFallback?.carrierName || "",
    bookingNumber: row.bookingNumber || masterBlNo,
    containerNumber: containerNumbers[0] || "",
    containerNumbers,
    status,
    currentStatus: status,
    statusLabel: shipsgoStatusLabel(status),
    syncStatus: row.syncStatus || "NOT_SYNCED",
    syncMessage: row.syncMessage || "",
    originName: row.originName || rawFallback?.originName || "",
    destinationName: row.destinationName || rawFallback?.destinationName || "",
    dateOfLoading: dateText(row.dateOfLoading || rawFallback?.dateOfLoading),
    dateOfDischarge: dateText(row.dateOfDischarge || rawFallback?.dateOfDischarge),
    predictedDischargeDate: dateText(row.predictedDischargeDate || rawFallback?.predictedDischargeDate),
    eta: dateText(row.eta || row.predictedDischargeDate || row.dateOfDischarge || rawFallback?.eta),
    vesselName: row.vesselName || rawFallback?.vesselName || "",
    voyage: row.voyage || rawFallback?.voyage || "",
    mapUrl: row.mapUrl || rawFallback?.mapUrl || "",
    lastEvent: row.lastEvent || rawFallback?.lastEvent || "",
    lastEventAt: dateTimeText(row.lastEventAt || rawFallback?.lastEventAt),
    lastCheckedAt: dateTimeText(row.lastCheckedAt),
    lastSyncedAt: dateTimeText(row.lastSyncTime || row.lastSyncedAt),
    lastSyncTime: dateTimeText(row.lastSyncTime || row.lastSyncedAt),
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
      lastMessage = error instanceof Error ? error.message : "查询 ShipsGo 已有跟踪失败";
    }
  }
  throw codedError(
    lastMessage || "未在 ShipsGo 查询到已有 Tracking，请确认提单号或柜号已在 ShipsGo 后台存在。",
    404,
    "SHIPSGO_EXISTING_TRACKING_NOT_FOUND",
  );
}

function createPayloadFromInput(input: ShipsgoTrackingInput, order: ShipsgoTrackingOrder) {
  const carrierScac = cleanCarrierScac(input.carrierScac);
  const masterBlNo = cleanBookingNumber(input.masterBlNo) || cleanBookingNumber(input.bookingNumber) || cleanBookingNumber(order.blNo);
  if (!masterBlNo) {
    throw codedError("请先填写 Master B/L（提单号）后再开始 ShipsGo 跟踪。", 400, "SHIPSGO_MASTER_BL_REQUIRED");
  }
  const reference = cleanInputText(input.reference, 128)
    || cleanInputText(`${order.orderNo || order.id}-${masterBlNo}`, 128);
  if (reference && reference.length < 5) {
    throw codedError("ShipsGo Reference 至少需要 5 个字符。", 400, "SHIPSGO_REFERENCE_TOO_SHORT");
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
      syncMessage: response.status === 409 ? "ShipsGo 已存在该跟踪，已同步本地记录。" : "",
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
  if (!saved) throw codedError("ShipsGo 跟踪本地保存失败。", 500, "SHIPSGO_TRACKING_SAVE_FAILED");

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
      masterBlNo: saved.masterBlNo || saved.bookingNumber,
      containerNumbers: (saved.containers || []).map((container) => container.containerNo),
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
  if (!saved) throw codedError("ShipsGo 跟踪本地同步保存失败。", 500, "SHIPSGO_TRACKING_SAVE_FAILED");
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

export async function recoverShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, input: unknown = {}) {
  assertWrite(actor, "domesticLogistics");
  const body = assertJsonObject(input) as ShipsgoTrackingInput;
  const orderId = cleanInputText(body.orderId, 80);
  if (!orderId) throw codedError("请选择需要补同步 ShipsGo 跟踪的订单。", 400, "ORDER_REQUIRED");
  const settings = await getShipsgoIntegrationSettings();
  assertShipsgoOceanEnabled(settings);
  const order = await getShipsgoTrackingOrder(orderId, actor);
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
    throw codedError("本地缺少提单号和柜号，无法从 ShipsGo 找回已有 Tracking。", 400, "SHIPSGO_RECOVER_TARGET_REQUIRED");
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
        syncMessage: `已从 ShipsGo 已有 Tracking 补同步。`,
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
        syncMessage: "已从 ShipsGo 已有 Tracking 补同步。",
        lastCheckedAt: now,
        lastSyncedAt: now,
        lastSyncTime: now,
        createdById: currentActorId || null,
        updatedById: currentActorId || null,
      },
    });
  await replaceShipsgoTrackingContainers(savedBase.id, uniqueStrings([...mapped.containerNumbers, ...localContainers]));
  const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
  if (!saved) throw codedError("ShipsGo 已有 Tracking 补同步保存失败。", 500, "SHIPSGO_TRACKING_SAVE_FAILED");
  await runNonCriticalTask("ShipsGo 已有跟踪补同步日志写入", () => writeAudit(
    request,
    actor,
    "补同步 ShipsGo 已有跟踪",
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
  return { tracking: serializeShipsgoTracking(saved), recovered: true, message: "已从 ShipsGo 同步已有跟踪。" };
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
    throw codedError("本地未找到该柜号对应的 ShipsGo Tracking，请管理员先同步已有提单跟踪。", 404, "SHIPSGO_CONTAINER_NOT_FOUND");
  }
  if (!canAccessDomesticLogisticsOrder(actor, row.tracking.order)) {
    throw codedError("无权限访问该柜号对应的 ShipsGo Tracking。", 403, "PERMISSION_DENIED");
  }
  return { tracking: serializeShipsgoTracking(row.tracking), message: "已从本地柜号关联返回 ShipsGo Tracking。" };
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
  await runNonCriticalTask("ShipsGo 定时同步日志写入", () => writeAudit(
    request,
    actor,
    "定时同步 ShipsGo 海运跟踪",
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
  if (!saved) throw codedError("ShipsGo Webhook 同步保存失败。", 500, "SHIPSGO_TRACKING_SAVE_FAILED");
  return { success: true, tracking: serializeShipsgoTracking(saved) };
}

export function shipsgoRateLimitSummary(headers: Headers) {
  return {
    limit: num(headers.get("X-RateLimit-Limit"), 0),
    remaining: num(headers.get("X-RateLimit-Remaining"), 0),
    reset: nonEmpty(headers.get("X-RateLimit-Reset")),
  };
}
