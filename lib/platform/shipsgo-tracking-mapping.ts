import type { Prisma } from "../generated/prisma/client.js";
import { isPlainRecord, nonEmpty } from "./shared-base-utils";
import { safeContainerNumber, uniqueStrings, type ShipsgoShipmentPayload } from "./shipsgo-tracking-utils";

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

export function extractShipmentPayload(data: unknown): ShipsgoShipmentPayload {
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

export function textAt(source: unknown, key: string) {
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

export function mapShipsgoShipmentPayload(payload: ShipsgoShipmentPayload) {
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

export function trackingDataFromMappedShipment(mapped: ReturnType<typeof mapShipsgoShipmentPayload>) {
  const {
    containerNumbers: _containerNumbers,
    originPortCode: _originPortCode,
    destinationPortCode: _destinationPortCode,
    ...trackingData
  } = mapped;
  return trackingData;
}

export function serializeShipsgoTracking(row: {
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

export function recursiveShipmentId(value: unknown, depth = 0): string {
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
