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
import { assertRead, assertWrite, timingSafeEqualText } from "./shared-auth";
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
type ShipsgoQueryLike = {
  get(key: string): string | null;
} | null | undefined;

const SHIPSGO_PROVIDER = "SHIPSGO";
const OCEAN_MODE = "OCEAN";
const CONTAINER_PATTERN = /^[A-Z]{4}[0-9]{7}$/;
const CARRIER_PATTERN = /^(SG_)?[A-Z0-9]{4}$/;

function actorId(actor: ShipsgoActor) {
  return nonEmpty(actor?.id);
}

function actorRole(actor: ShipsgoActor) {
  return nonEmpty(actor?.role);
}

function assertShipsgoTrackingWriteAccess(
  actor: ShipsgoActor,
  order: { customer?: { salespersonUserId?: string | null } | null } | null | undefined,
) {
  const role = actorRole(actor);
  if (role === "管理员") return;
  if (role === "业务员" && order?.customer?.salespersonUserId === actorId(actor)) return;
  throw codedError("当前角色不允许创建、同步或删除大掌櫃跟踪。", 403, "SHIPSGO_TRACKING_WRITE_FORBIDDEN");
}

function assertShipsgoTrackingDeleteAccess(actor: ShipsgoActor) {
  if (actorRole(actor) === "管理员") return;
  throw codedError("只有管理员可以删除大掌櫃跟踪。", 403, "SHIPSGO_TRACKING_DELETE_ADMIN_ONLY");
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
    throw codedError("船公司代码应为大掌櫃支持的 SCAC 代码，例如 MAEU / CMDU。", 400, "SHIPSGO_INVALID_CARRIER");
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
  if (!settings.enabled) throw codedError("大掌櫃集成未启用。", 400, "SHIPSGO_DISABLED");
  if (!settings.apiKey) throw codedError("大掌櫃 API Key 未配置。", 400, "SHIPSGO_API_KEY_REQUIRED");
  if (!settings.oceanTrackingEnabled) throw codedError("大掌櫃海运跟踪功能未启用。", 400, "SHIPSGO_OCEAN_DISABLED");
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
  if (status === 401 || status === 403) return "大掌櫃 API Key 无效或权限不足。";
  if (status === 402) return "大掌櫃 Credit 不足，请先充值或调整跟踪数量。";
  if (status === 429) return "大掌櫃请求频率过高，请稍后再试。";
  if (status >= 500) return "大掌櫃服务暂时不可用，请稍后再试。";
  return detail || "大掌櫃请求失败。";
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

function hasRecordEntries(value: unknown) {
  return isPlainRecord(value) && Object.keys(value).length > 0;
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
    const nestedLocation = recordAt(record, "location");
    const nestedPort = recordAt(record, "port");
    const value = textAt(record, "name")
      || textAt(record, "port_name")
      || textAt(record, "portName")
      || (hasRecordEntries(nestedLocation) ? portName(nestedLocation) : "")
      || (hasRecordEntries(nestedPort) ? portName(nestedPort) : "")
      || textAt(record, "location")
      || textAt(record, "port")
      || textAt(record, "city")
      || textAt(record, "unlocode")
      || textAt(record, "unLocode")
      || textAt(record, "UNLocode")
      || textAt(record, "code");
    if (value) return value;
  }
  return "";
}

function portCode(...records: unknown[]) {
  for (const record of records) {
    const nestedLocation = recordAt(record, "location");
    const nestedPort = recordAt(record, "port");
    const value = textAt(record, "unlocode")
      || textAt(record, "unLocode")
      || textAt(record, "UNLocode")
      || textAt(record, "code")
      || (hasRecordEntries(nestedLocation) ? portCode(nestedLocation) : "")
      || (hasRecordEntries(nestedPort) ? portCode(nestedPort) : "");
    if (value) return value;
  }
  return "";
}

function recordByNormalizedKey(source: unknown, keys: string[]) {
  if (!isPlainRecord(source)) return {};
  const normalizedKeys = keys.map(normalizeKey);
  for (const [key, value] of Object.entries(source)) {
    if (normalizedKeys.includes(normalizeKey(key)) && isPlainRecord(value)) return value;
  }
  return {};
}

function locationPortRole(value: unknown) {
  return textByKeys(value, [
    "type",
    "role",
    "portType",
    "port_type",
    "locationType",
    "location_type",
    "milestone",
    "event",
    "eventType",
    "event_type",
  ]).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function findPortInLocationArrays(payload: unknown, direction: "origin" | "destination") {
  const wanted = direction === "origin"
    ? ["POL", "ORIGIN", "DEPARTURE", "LOADING", "PORTOFLOADING", "LOADPORT"]
    : ["POD", "DESTINATION", "ARRIVAL", "DISCHARGE", "PORTOFDISCHARGE", "DISCHARGEPORT"];
  const arrays = collectArraysByKeys(payload, [
    "locations",
    "locationList",
    "location_list",
    "ports",
    "portList",
    "port_list",
    "routing",
    "routes",
  ]);
  for (const item of arrays.flat()) {
    if (!isPlainRecord(item)) continue;
    const role = locationPortRole(item);
    if (wanted.some((token) => role === token || role.includes(token))) return item;
  }
  return {};
}

function extractShipsgoPort(payload: ShipsgoShipmentPayload, direction: "origin" | "destination") {
  const route = recordAt(payload, "route");
  const routing = recordAt(payload, "routing");
  const keys = direction === "origin"
    ? ["pol", "origin", "originPort", "origin_port", "portOfLoading", "port_of_loading", "departurePort", "departure_port", "loadingPort", "loading_port"]
    : ["pod", "destination", "destinationPort", "destination_port", "portOfDischarge", "port_of_discharge", "arrivalPort", "arrival_port", "dischargePort", "discharge_port"];
  const records = [
    recordByNormalizedKey(route, keys),
    recordByNormalizedKey(routing, keys),
    recordByNormalizedKey(payload, keys),
    findPortInLocationArrays(payload, direction),
  ];
  const name = portName(...records) || textByKeys(payload, keys);
  const code = portCode(...records);
  return { name, code };
}

function collectArraysByKeys(source: unknown, keys: string[], depth = 0, found: unknown[][] = []) {
  if (depth > 6 || source == null) return found;
  if (isPlainRecord(source)) {
    const normalizedKeys = keys.map(normalizeKey);
    for (const [key, value] of Object.entries(source)) {
      if (normalizedKeys.includes(normalizeKey(key)) && Array.isArray(value)) found.push(value);
      collectArraysByKeys(value, keys, depth + 1, found);
    }
  } else if (Array.isArray(source)) {
    for (const item of source) collectArraysByKeys(item, keys, depth + 1, found);
  }
  return found;
}

function shipsgoEventDate(event: unknown) {
  return dateByKeys(event, [
    "timestamp",
    "time",
    "date",
    "datetime",
    "eventDate",
    "event_date",
    "eventTime",
    "event_time",
    "actualDate",
    "actual_date",
    "estimatedDate",
    "estimated_date",
    "plannedDate",
    "planned_date",
  ]);
}

function shipsgoEventLocation(event: unknown) {
  return portName(
    recordAt(event, "location"),
    recordAt(event, "port"),
    recordAt(event, "place"),
    recordAt(event, "terminal"),
  ) || textByKeys(event, [
    "location",
    "portName",
    "port_name",
    "port",
    "facility",
    "terminal",
    "place",
    "city",
    "unlocode",
    "UNLocode",
  ]);
}

function shipsgoEventDescription(event: unknown) {
  return textByKeys(event, [
    "description",
    "statusDescription",
    "status_description",
    "eventDescription",
    "event_description",
    "eventName",
    "event_name",
    "event",
    "status",
    "activity",
    "milestone",
    "message",
    "name",
  ]);
}

function shipsgoEventVessel(event: unknown) {
  const vessel = recordAt(event, "vessel");
  return textAt(vessel, "name")
    || textAt(event, "vesselName")
    || textAt(event, "vessel_name")
    || textByKeys(event, ["vesselName", "vessel_name"]);
}

function shipsgoEventVoyage(event: unknown) {
  return textAt(event, "voyage")
    || textAt(event, "voyageNo")
    || textAt(event, "voyage_no")
    || textAt(event, "voyageNumber")
    || textByKeys(event, ["voyageNo", "voyage_no", "voyageNumber", "voyage"]);
}

function extractShipsgoTimeline(payload: unknown) {
  const shipment = extractShipmentPayload(payload);
  const eventArrays = collectArraysByKeys(shipment, [
    "events",
    "checkpoints",
    "routing",
    "routes",
    "locations",
    "statusHistory",
    "status_history",
    "eventTimeline",
    "event_timeline",
    "trackingEvents",
    "tracking_events",
    "milestones",
    "movements",
  ]);
  const containers = arrayAt(shipment, "containers").concat(arrayByKeys(shipment, ["containerList", "container_list"]));
  for (const container of containers) {
    const movements = arrayAt(container, "movements");
    if (movements.length) eventArrays.push(movements);
  }
  const seen = new Set<string>();
  return eventArrays
    .flat()
    .filter((event) => isPlainRecord(event))
    .map((event) => {
      const time = shipsgoEventDate(event);
      const location = shipsgoEventLocation(event);
      const description = shipsgoEventDescription(event) || "运输节点";
      const vesselName = shipsgoEventVessel(event);
      const voyage = shipsgoEventVoyage(event);
      return {
        time: time ? time.toISOString() : "",
        location,
        description,
        vesselName,
        voyage,
        source: "大掌櫃",
      };
    })
    .filter((event) => event.time || event.location || event.description !== "运输节点")
    .filter((event) => {
      const key = `${event.time}|${event.location}|${event.description}|${event.vesselName}|${event.voyage}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return new Date(a.time).getTime() - new Date(b.time).getTime();
    });
}

function mapShipsgoShipmentPayload(payload: ShipsgoShipmentPayload) {
  const carrier = recordAt(payload, "carrier");
  const shippingLine = recordAt(payload, "shippingLine");
  const shippingLineSnake = recordAt(payload, "shipping_line");
  const route = recordAt(payload, "route");
  const originPort = extractShipsgoPort(payload, "origin");
  const destinationPort = extractShipsgoPort(payload, "destination");
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
    originName: originPort.name,
    destinationName: destinationPort.name,
    originPortCode: originPort.code,
    destinationPortCode: destinationPort.code,
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
  const {
    containerNumbers: _containerNumbers,
    originPortCode: _originPortCode,
    destinationPortCode: _destinationPortCode,
    ...trackingData
  } = mapped;
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
  const rawSource = row.rawResponse ?? row.rawPayload ?? null;
  const rawShipment = rawSource ? extractShipmentPayload(rawSource) : {};
  const rawFallback = Object.keys(rawShipment).length ? mapShipsgoShipmentPayload(rawShipment) : null;
  const timeline = rawSource ? extractShipsgoTimeline(rawSource) : [];
  const fallbackTimeline = !timeline.length && row.lastEvent ? [{
    time: dateTimeText(row.lastEventAt),
    location: row.originName || row.destinationName || "",
    description: row.lastEvent,
    vesselName: row.vesselName || "",
    voyage: row.voyage || "",
    source: "大掌櫃",
  }] : [];
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
    originPortName: row.originName || rawFallback?.originName || "",
    originPortCode: rawFallback?.originPortCode || "",
    destinationName: row.destinationName || rawFallback?.destinationName || "",
    destinationPortName: row.destinationName || rawFallback?.destinationName || "",
    destinationPortCode: rawFallback?.destinationPortCode || "",
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
    timeline: timeline.length ? timeline : fallbackTimeline,
  };
}

export type ShipsgoTrackingDto = ReturnType<typeof serializeShipsgoTracking>;

export function serializeShipsgoTrackingSummary(row: Parameters<typeof serializeShipsgoTracking>[0]) {
  return serializeShipsgoTracking(row);
}

function controlTowerQueryValue(query: ShipsgoQueryLike, key: string, limit = 128) {
  return cleanInputText(query?.get(key), limit);
}

function boolQueryValue(query: ShipsgoQueryLike, key: string) {
  const value = controlTowerQueryValue(query, key, 16).toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return null;
}

function lowerIncludes(value: unknown, keyword: string) {
  if (!keyword) return true;
  return String(value || "").toLowerCase().includes(keyword.toLowerCase());
}

function trackingDateMs(value: unknown) {
  const text = nonEmpty(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function startOfTodayMs(now = new Date()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isShipsgoCompletedStatus(value: unknown) {
  return /ARRIVED|DISCHARGED|DELIVERED|COMPLETE|COMPLETED|CLOSED|FINISHED|已到港|已完成/i.test(nonEmpty(value));
}

function latestShipsgoTimelineEvent(timeline: ShipsgoTrackingDto["timeline"] = []) {
  return timeline.reduce<ShipsgoTrackingDto["timeline"][number] | null>((latest, event) => {
    if (!latest) return event;
    const latestTime = trackingDateMs(latest.time);
    const eventTime = trackingDateMs(event.time);
    if (eventTime != null && (latestTime == null || eventTime > latestTime)) return event;
    return latest;
  }, null);
}

function trackingSignalExists(tracking: ShipsgoTrackingDto) {
  return Boolean(
    tracking.eta
    || tracking.predictedDischargeDate
    || tracking.dateOfDischarge
    || tracking.lastEvent
    || tracking.timeline.length
  );
}

function trackingMatchesQuery(row: ShipsgoControlTowerRow, query: ShipsgoQueryLike) {
  const keyword = controlTowerQueryValue(query, "keyword", 100);
  const customer = controlTowerQueryValue(query, "customer", 100);
  const orderNo = controlTowerQueryValue(query, "orderNo", 100);
  const masterBlNo = controlTowerQueryValue(query, "masterBlNo", 100) || controlTowerQueryValue(query, "masterBl", 100);
  const carrier = controlTowerQueryValue(query, "carrier", 100);
  const origin = controlTowerQueryValue(query, "origin", 100);
  const destination = controlTowerQueryValue(query, "destination", 100);
  const status = controlTowerQueryValue(query, "status", 100);
  const etaStart = controlTowerQueryValue(query, "etaStart", 24);
  const etaEnd = controlTowerQueryValue(query, "etaEnd", 24);
  const overdue = boolQueryValue(query, "overdue");
  const syncFailed = boolQueryValue(query, "syncFailed");
  const etaMs = trackingDateMs(row.eta);
  const searchable = [
    row.orderNo,
    row.customerShortName,
    row.customerName,
    row.blNo,
    row.billOfLadingNo,
    row.masterBlNo,
    row.bookingNumber,
    row.carrierName,
    row.carrierScac,
    row.originName,
    row.destinationName,
    row.currentStatus,
    row.statusLabel,
    row.lastEvent,
    ...row.containerNumbers,
  ].join(" ");
  if (keyword && !lowerIncludes(searchable, keyword)) return false;
  if (customer && !lowerIncludes(`${row.customerShortName || ""} ${row.customerName || ""}`, customer)) return false;
  if (orderNo && !lowerIncludes(row.orderNo, orderNo)) return false;
  if (masterBlNo && !lowerIncludes(`${row.blNo || ""} ${row.billOfLadingNo || ""} ${row.masterBlNo || ""} ${row.bookingNumber || ""}`, masterBlNo)) return false;
  if (carrier && !lowerIncludes(`${row.carrierName || ""} ${row.carrierScac || ""}`, carrier)) return false;
  if (origin && !lowerIncludes(`${row.originName || ""} ${row.originPortName || ""} ${row.originPortCode || ""}`, origin)) return false;
  if (destination && !lowerIncludes(`${row.destinationName || ""} ${row.destinationPortName || ""} ${row.destinationPortCode || ""}`, destination)) return false;
  if (status && !lowerIncludes(`${row.currentStatus || ""} ${row.statusLabel || ""} ${row.alertLabels.join(" ")}`, status)) return false;
  if (etaStart) {
    const startMs = trackingDateMs(etaStart);
    if (startMs != null && (etaMs == null || etaMs < startMs)) return false;
  }
  if (etaEnd) {
    const endMs = trackingDateMs(`${etaEnd}T23:59:59`);
    if (endMs != null && (etaMs == null || etaMs > endMs)) return false;
  }
  if (overdue != null && row.isEtaOverdue !== overdue) return false;
  if (syncFailed != null && row.isSyncFailed !== syncFailed) return false;
  return true;
}

type ShipsgoControlTowerRow = ShipsgoTrackingDto & {
  orderNo: string;
  blNo: string;
  billOfLadingNo: string;
  customerName: string;
  customerShortName: string;
  orderIsArchived: boolean;
  isCompleted: boolean;
  isSoonArriving: boolean;
  isEtaOverdue: boolean;
  isSyncStale: boolean;
  isSyncFailed: boolean;
  alertLabels: string[];
  latestNodeTime: string;
  latestNodeLocation: string;
  latestNodeDescription: string;
  containerCount: number;
};

function buildShipsgoControlTowerRow(row: Parameters<typeof serializeShipsgoTracking>[0] & {
  order?: {
    orderNo?: string | null;
    blNo?: string | null;
    customerNameSnapshot?: string | null;
    isArchived?: boolean | null;
    customer?: { shortName?: string | null; name?: string | null } | null;
  } | null;
}, now = new Date()): ShipsgoControlTowerRow {
  const tracking = serializeShipsgoTracking(row);
  const latestEvent = latestShipsgoTimelineEvent(tracking.timeline);
  const etaMs = trackingDateMs(tracking.eta || tracking.predictedDischargeDate || tracking.dateOfDischarge);
  const todayMs = startOfTodayMs(now);
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const lastSyncMs = trackingDateMs(tracking.lastSyncTime || tracking.lastSyncedAt);
  const statusValue = tracking.currentStatus || tracking.status || tracking.statusLabel;
  const isSyncFailed = /FAIL|ERROR/.test(nonEmpty(tracking.syncStatus).toUpperCase());
  const isCompleted = isShipsgoCompletedStatus(statusValue);
  const isEtaOverdue = etaMs != null && etaMs < todayMs && !isCompleted;
  const isSoonArriving = etaMs != null && etaMs >= todayMs && etaMs - todayMs <= sevenDaysMs && !isCompleted;
  const isSyncStale = !isCompleted && (lastSyncMs == null || now.getTime() - lastSyncMs > 24 * 60 * 60 * 1000);
  const alertLabels = [
    isSyncFailed ? "同步失败" : "",
    isEtaOverdue ? "ETA 已过期" : "",
    isSoonArriving ? "即将到港" : "",
    isSyncStale ? "同步超时" : "",
  ].filter(Boolean);
  return {
    ...tracking,
    orderNo: row.order?.orderNo || "",
    blNo: row.order?.blNo || tracking.masterBlNo || tracking.bookingNumber || "",
    billOfLadingNo: row.order?.blNo || tracking.masterBlNo || tracking.bookingNumber || "",
    customerName: row.order?.customer?.name || row.order?.customerNameSnapshot || "",
    customerShortName: row.order?.customer?.shortName || row.order?.customerNameSnapshot || "",
    orderIsArchived: row.order?.isArchived === true,
    isCompleted,
    isSoonArriving,
    isEtaOverdue,
    isSyncStale,
    isSyncFailed,
    alertLabels,
    latestNodeTime: latestEvent?.time || tracking.lastEventAt || "",
    latestNodeLocation: latestEvent?.location || "",
    latestNodeDescription: latestEvent?.description || tracking.lastEvent || "",
    containerCount: tracking.containerNumbers.length,
  };
}

export async function listShipsgoControlTowerTrackings(query: ShipsgoQueryLike, actor: ShipsgoActor) {
  assertRead(actor, "domesticLogistics");
  const includeCompleted = boolQueryValue(query, "includeCompleted") === true;
  const rows = await prisma.shipsgoTracking.findMany({
    where: {
      provider: SHIPSGO_PROVIDER,
      mode: OCEAN_MODE,
      deletedAt: null,
      shipsgoShipmentId: { not: null },
    },
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
          customerNameSnapshot: true,
          isArchived: true,
          customer: { select: { name: true, shortName: true, salespersonUserId: true } },
          logisticsSuppliers: { select: { supplierId: true } },
        },
      },
    },
    orderBy: [{ eta: "asc" }, { lastSyncTime: "desc" }, { updatedAt: "desc" }],
    take: 300,
  });
  const now = new Date();
  const mappedRows = rows
    .filter((row) => canAccessDomesticLogisticsOrder(actor, row.order))
    .map((row) => buildShipsgoControlTowerRow(row, now))
    .filter((row) => trackingSignalExists(row))
    .filter((row) => includeCompleted || !row.isCompleted)
    .filter((row) => trackingMatchesQuery(row, query))
    .sort((a, b) => {
      if (a.isSyncFailed !== b.isSyncFailed) return a.isSyncFailed ? -1 : 1;
      if (a.orderIsArchived !== b.orderIsArchived) return a.orderIsArchived ? 1 : -1;
      const aEta = trackingDateMs(a.eta);
      const bEta = trackingDateMs(b.eta);
      if (aEta == null && bEta == null) return 0;
      if (aEta == null) return 1;
      if (bEta == null) return -1;
      return aEta - bEta;
    });
  const todayStart = startOfTodayMs(now);
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  return {
    rows: mappedRows,
    stats: {
      inTransitCount: mappedRows.filter((row) => !row.isCompleted).length,
      soonArrivingCount: mappedRows.filter((row) => row.isSoonArriving).length,
      etaOverdueCount: mappedRows.filter((row) => row.isEtaOverdue).length,
      syncFailedCount: mappedRows.filter((row) => row.isSyncFailed).length,
      syncedTodayCount: mappedRows.filter((row) => {
        const lastSync = trackingDateMs(row.lastSyncTime || row.lastSyncedAt);
        return lastSync != null && lastSync >= todayStart && lastSync < todayEnd;
      }).length,
    },
    updatedAt: now.toISOString(),
  };
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

export function shipsgoRateLimitSummary(headers: Headers) {
  return {
    limit: num(headers.get("X-RateLimit-Limit"), 0),
    remaining: num(headers.get("X-RateLimit-Remaining"), 0),
    reset: nonEmpty(headers.get("X-RateLimit-Reset")),
  };
}
