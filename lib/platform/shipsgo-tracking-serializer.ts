import { nonEmpty } from "./shared-base-utils";
import { uniqueStrings } from "./shipsgo-tracking-utils";
import { extractShipmentPayload } from "./shipsgo-tracking-mapping-helpers";
import { mapShipsgoShipmentPayload } from "./shipsgo-tracking-mapper";
import { extractShipsgoTimeline } from "./shipsgo-tracking-timeline";

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
