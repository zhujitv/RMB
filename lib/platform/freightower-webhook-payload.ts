import { isPlainRecord, nonEmpty } from "./shared-base-utils";
import { safeContainerNumber, uniqueStrings } from "./shipsgo-tracking-utils";

type JsonRecord = Record<string, unknown>;

export type FreightowerWebhookEnvelope = {
  kind: "UPDATE_NOTICE" | "INCREMENTAL_WARNING";
  references: string[];
  billNumbers: string[];
  containerNumbers: string[];
  hasIncrementalResult: boolean;
};

function record(value: unknown): JsonRecord {
  return isPlainRecord(value) ? value : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isPlainRecord) : [];
}

function cleanIdentifier(value: unknown, limit = 160) {
  return nonEmpty(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, limit).trim();
}

function valuesByKeys(source: JsonRecord, keys: string[]) {
  return keys.map((key) => cleanIdentifier(source[key])).filter(Boolean);
}

export function parseFreightowerWebhookEnvelope(payload: unknown): FreightowerWebhookEnvelope {
  const root = record(payload);
  const rootParam = record(root.param);
  const notificationParams = records(root.params);
  const allParams = [rootParam, ...notificationParams];
  const result = record(root.result);
  const hasIncrementalResult = Object.keys(result).length > 0;
  const references = uniqueStrings([
    ...valuesByKeys(root, ["referenceno", "referenceNo", "REFERENCE_NO", "businessNo", "BUSINESSNO"]),
    ...allParams.flatMap((item) => valuesByKeys(item, ["businessNo", "BUSINESSNO", "referenceNo", "REFERENCE_NO"])),
  ]);
  const billNumbers = uniqueStrings([
    // Update notices use REFERENCE_NO for the original subscribed bill/booking
    // number (for example billNo 228980179 -> REFERENCE_NO 228980179).
    ...valuesByKeys(root, ["billNo", "BILLNO", "billno", "referenceno", "referenceNo", "REFERENCE_NO"]),
    ...valuesByKeys(result, ["billNo", "BILLNO", "billno"]),
    ...allParams.flatMap((item) => valuesByKeys(item, ["billNo", "BILLNO", "billno", "referenceNo", "REFERENCE_NO"])),
  ]);
  const containerNumbers = uniqueStrings([
    ...valuesByKeys(root, ["containerNo", "CTNRNO", "ctnrNo"]),
    ...valuesByKeys(result, ["containerNo", "CTNRNO", "ctnrNo"]),
    ...allParams.flatMap((item) => valuesByKeys(item, ["containerNo", "CTNRNO", "ctnrNo"])),
    ...records(result.containers).map((item) => cleanIdentifier(item.containerNo)),
  ].map((value) => safeContainerNumber(value)).filter(Boolean));
  return {
    kind: hasIncrementalResult ? "INCREMENTAL_WARNING" : "UPDATE_NOTICE",
    references,
    billNumbers,
    containerNumbers,
    hasIncrementalResult,
  };
}

function meaningful(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function mergeRecord(baseValue: unknown, incomingValue: unknown): JsonRecord {
  const base = record(baseValue);
  const incoming = record(incomingValue);
  const merged: JsonRecord = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (!meaningful(value)) continue;
    if (isPlainRecord(value) && isPlainRecord(base[key])) merged[key] = mergeRecord(base[key], value);
    else merged[key] = value;
  }
  return merged;
}

function stableKey(value: JsonRecord, keys: string[]) {
  const selected = keys.map((key) => cleanIdentifier(value[key], 300)).filter(Boolean).join("|");
  return selected || JSON.stringify(value);
}

function mergeRecordArrays(baseValue: unknown, incomingValue: unknown, keys: string[]) {
  const merged = new Map<string, JsonRecord>();
  for (const item of [...records(baseValue), ...records(incomingValue)]) {
    const key = stableKey(item, keys);
    merged.set(key, merged.has(key) ? mergeRecord(merged.get(key), item) : item);
  }
  return Array.from(merged.values());
}

function mergeContainers(baseValue: unknown, incomingValue: unknown) {
  const merged = new Map<string, JsonRecord>();
  for (const item of [...records(baseValue), ...records(incomingValue)]) {
    const key = cleanIdentifier(item.containerNo) || stableKey(item, ["equipmentCode"]);
    const previous = merged.get(key);
    const next = previous ? mergeRecord(previous, item) : { ...item };
    next.status = mergeRecordArrays(previous?.status, item.status, ["eventCode", "eventTime", "eventPlace", "vslName", "voy"]);
    next.warnings = mergeRecordArrays(previous?.warnings, item.warnings, ["eventCode", "eventTime", "equipmentCode", "description"]);
    merged.set(key, next);
  }
  return Array.from(merged.values());
}

function payloadResult(payload: unknown) {
  const root = record(payload);
  const data = record(root.data);
  return Object.keys(record(data.result)).length ? record(data.result) : record(root.result);
}

export function mergeFreightowerWebhookPayload(fullPayload: unknown, incrementalPayload: unknown): unknown {
  const fullRoot = record(fullPayload);
  const fullData = record(fullRoot.data);
  const fullResult = payloadResult(fullPayload);
  const incrementalResult = payloadResult(incrementalPayload);
  if (!Object.keys(incrementalResult).length) return fullPayload;

  const mergedResult = mergeRecord(fullResult, incrementalResult);
  mergedResult.places = mergeRecordArrays(fullResult.places, incrementalResult.places, ["code", "type"]);
  mergedResult.routes = mergeRecordArrays(fullResult.routes, incrementalResult.routes, ["eventCode", "eventTime", "placeCode", "vslName", "voy"]);
  mergedResult.containers = mergeContainers(fullResult.containers, incrementalResult.containers);
  return {
    ...fullRoot,
    data: {
      ...fullData,
      result: mergedResult,
    },
  };
}
