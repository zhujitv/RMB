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
    isPlainRecord(data.data) ? data.data.result : null,
    isPlainRecord(data.result) ? data.result : null,
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

export function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function textByKeys(source: unknown, keys: string[], depth = 0): string {
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

export function arrayByKeys(source: unknown, keys: string[], depth = 0): unknown[] {
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

export function recordAt(source: unknown, key: string) {
  const value = isPlainRecord(source) ? source[key] : null;
  return isPlainRecord(value) ? value : {};
}

export function hasRecordEntries(value: unknown) {
  return isPlainRecord(value) && Object.keys(value).length > 0;
}

export function arrayAt(source: unknown, key: string) {
  const value = isPlainRecord(source) ? source[key] : null;
  return Array.isArray(value) ? value : [];
}

export function dateAt(source: unknown, key: string) {
  const text = textAt(source, key);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateByKeys(source: unknown, keys: string[]) {
  const text = textByKeys(source, keys);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function lastOceanMovement(containers: unknown[]) {
  const movements = containers.flatMap((container) => arrayAt(container, "movements"));
  return movements
    .map((movement) => {
      const timestamp = dateAt(movement, "timestamp");
      return { movement, timestamp };
    })
    .filter((item): item is { movement: unknown; timestamp: Date } => Boolean(item.timestamp))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0] || null;
}

export function mapUrl(shipmentId: string, mapToken: string) {
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

export function extractContainerNumbersFromPayload(payload: ShipsgoShipmentPayload) {
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

export function portName(...records: unknown[]) {
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

export function portCode(...records: unknown[]) {
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

export function recordByNormalizedKey(source: unknown, keys: string[]) {
  if (!isPlainRecord(source)) return {};
  const normalizedKeys = keys.map(normalizeKey);
  for (const [key, value] of Object.entries(source)) {
    if (normalizedKeys.includes(normalizeKey(key)) && isPlainRecord(value)) return value;
  }
  return {};
}

export function locationPortRole(value: unknown) {
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

export function findPortInLocationArrays(payload: unknown, direction: "origin" | "destination") {
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

export function extractShipsgoPort(payload: ShipsgoShipmentPayload, direction: "origin" | "destination") {
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

export function collectArraysByKeys(source: unknown, keys: string[], depth = 0, found: unknown[][] = []) {
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
