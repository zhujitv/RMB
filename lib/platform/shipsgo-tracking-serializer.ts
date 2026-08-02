import { nonEmpty } from "./shared-base-utils";
import { extractFreightowerAlerts, freightowerAlertText } from "./freightower-alerts";
import { extractFreightowerPortTimeline } from "./freightower-port-events";
import { mapFreightowerShipmentPayload } from "./freightower-mapping";
import { uniqueStrings } from "./shipsgo-tracking-utils";
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
  portTrackingStatus?: string | null;
  portTrackingMessage?: string | null;
  portCode?: string | null;
  portDirection?: string | null;
  portLastCheckedAt?: Date | string | null;
  portLastSyncedAt?: Date | string | null;
  portRawResponse?: unknown;
}) {
  const rawSource = row.rawResponse ?? row.rawPayload ?? null;
  const mappedContext = rawSource ? mapFreightowerShipmentPayload(rawSource) : null;
  const providerLabel = "飞驼可视";
  const portTimeline = row.portRawResponse ? extractFreightowerPortTimeline(row.portRawResponse) : [];
  const portAlerts = portTimeline.filter((event) => event.isWarning).map((event) => ({
    code: event.eventCode,
    category: event.eventCategory,
    title: event.isDumpingWarning ? "甩柜预警" : "港区异常预警",
    description: event.description,
    time: event.time,
    location: event.location,
    containerNo: "",
    severity: event.isDumpingWarning ? "critical" as const : "warning" as const,
    isDumping: event.isDumpingWarning,
    active: true,
    source: "status" as const,
  }));
  const alerts = [...(rawSource ? extractFreightowerAlerts(rawSource) : []), ...portAlerts];
  const activeAlerts = alerts.filter((alert) => alert.active !== false);
  const dumpingAlerts = activeAlerts.filter((alert) => alert.isDumping);
  const latestDumpingAlert = dumpingAlerts[0] || null;
  const comprehensiveTimeline = rawSource ? extractShipsgoTimeline(rawSource).map((event) => ({
    ...event,
    vesselName: event.vesselName || row.vesselName || "",
    voyage: event.voyage || row.voyage || "",
  })) : [];
  const timeline = mergeTimeline(comprehensiveTimeline, portTimeline.map((event) => ({
    ...event,
    vesselName: event.vesselName || row.vesselName || "",
    voyage: event.voyage || row.voyage || "",
  })));
  const isAwaitingProviderData = String(row.syncStatus || "").toUpperCase() === "SUBSCRIBED";
  const fallbackTimeline = !timeline.length && !isAwaitingProviderData && row.lastEvent ? [{
    time: dateTimeText(row.lastEventAt),
    location: row.originName || row.destinationName || "",
    description: row.lastEvent,
    vesselName: row.vesselName || "",
    voyage: row.voyage || "",
    source: providerLabel,
  }] : [];
  const containerNumbers = uniqueStrings([
    row.containerNumber || "",
    ...((row.containers || []).map((container) => container.containerNo || "")),
  ]);
  const status = row.currentStatus || row.status || "UNKNOWN";
  const masterBlNo = row.masterBlNo || row.bookingNumber || "";
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    mode: row.mode,
    shipsgoShipmentId: row.shipsgoShipmentId || "",
    masterBlNo,
    reference: row.reference || "",
    carrierScac: row.carrierScac || "",
    carrierName: row.carrierName || "",
    bookingNumber: row.bookingNumber || masterBlNo,
    containerNumber: containerNumbers[0] || "",
    containerNumbers,
    status,
    currentStatus: status,
    statusLabel: shipsgoStatusLabel(status),
    syncStatus: row.syncStatus || "NOT_SYNCED",
    syncMessage: row.syncMessage || "",
    originName: row.originName || "",
    originPortName: row.originName || "",
    originPortCode: mappedContext?.originPortCode || (row.portDirection !== "I" ? row.portCode || "" : ""),
    destinationName: row.destinationName || "",
    destinationPortName: row.destinationName || "",
    destinationPortCode: mappedContext?.destinationPortCode || (row.portDirection === "I" ? row.portCode || "" : ""),
    dateOfLoading: dateText(row.dateOfLoading),
    dateOfDischarge: dateText(row.dateOfDischarge),
    predictedDischargeDate: dateText(row.predictedDischargeDate),
    eta: dateText(row.eta || row.predictedDischargeDate || row.dateOfDischarge),
    vesselName: row.vesselName || "",
    voyage: row.voyage || "",
    mapUrl: row.mapUrl || "",
    lastEvent: row.lastEvent || "",
    lastEventAt: dateTimeText(row.lastEventAt),
    lastCheckedAt: dateTimeText(row.lastCheckedAt),
    lastSyncedAt: dateTimeText(row.lastSyncTime || row.lastSyncedAt),
    lastSyncTime: dateTimeText(row.lastSyncTime || row.lastSyncedAt),
    updatedAt: dateTimeText(row.updatedAt),
    portTrackingStatus: row.portTrackingStatus || "NOT_SUBSCRIBED",
    portTrackingMessage: row.portTrackingMessage || "",
    portCode: row.portCode || "",
    portDirection: row.portDirection || "",
    portLastCheckedAt: dateTimeText(row.portLastCheckedAt),
    portLastSyncedAt: dateTimeText(row.portLastSyncedAt),
    portEventCount: portTimeline.length,
    alerts,
    alertCount: activeAlerts.length,
    hasDumpingWarning: dumpingAlerts.length > 0,
    dumpingWarning: freightowerAlertText(latestDumpingAlert),
    dumpingWarningAt: latestDumpingAlert?.time || "",
    timeline: timeline.length ? timeline : fallbackTimeline,
  };
}

function mergeTimeline<T extends { time?: string; location?: string; description?: string; vesselName?: string; voyage?: string }>(...groups: T[][]) {
  const seen = new Set<string>();
  return groups.flat().filter((event) => {
    const key = `${event.time || ""}|${event.location || ""}|${event.description || ""}|${event.vesselName || ""}|${event.voyage || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => {
    if (!left.time && !right.time) return 0;
    if (!left.time) return 1;
    if (!right.time) return -1;
    return new Date(left.time).getTime() - new Date(right.time).getTime();
  });
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
