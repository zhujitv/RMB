import {
  formatShipsgoCarrierForLocale,
  formatShipsgoPortForLocale,
  formatShipsgoStatusForLocale,
} from "../../lib/shipsgo-display";

export type ShipsgoTimelineEvent = {
  time?: string;
  location?: string;
  description?: string;
  vesselName?: string;
  voyage?: string;
  source?: string;
};

export type ShipsgoTracking = {
  id: string;
  provider?: string;
  shipsgoShipmentId?: string;
  masterBlNo?: string;
  bookingNumber?: string;
  carrierScac?: string;
  carrierName?: string;
  originName?: string;
  originPortName?: string;
  originPortCode?: string;
  destinationName?: string;
  destinationPortName?: string;
  destinationPortCode?: string;
  currentStatus?: string;
  status?: string;
  statusLabel?: string;
  eta?: string;
  vesselName?: string;
  voyage?: string;
  mapUrl?: string;
  lastEvent?: string;
  lastEventAt?: string;
  lastSyncedAt?: string;
  lastSyncTime?: string;
  containerNumber?: string;
  containerNumbers?: string[];
  timeline?: ShipsgoTimelineEvent[];
};

export type TrackingMapResponse = { success?: boolean; message?: string; tracking?: ShipsgoTracking };
export type TrackingMapClientProps = { initialTrackingId?: string; initialBillOfLading?: string };

export function clean(value: unknown) {
  return String(value || "").trim();
}

function fallback(value: unknown, emptyText = "接口未返回") {
  return clean(value) || emptyText;
}

export function providerLabel(_tracking?: Pick<ShipsgoTracking, "provider"> | null) {
  return "飞驼可视";
}

export function formatDateTime(value: unknown) {
  const text = clean(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shipsgoCarrierText(tracking: ShipsgoTracking) {
  return formatShipsgoCarrierForLocale(tracking.carrierName || tracking.carrierScac, tracking.carrierScac, "zh-CN")
    || fallback(tracking.carrierName || tracking.carrierScac);
}

export function shipsgoPortText(name: unknown, code: unknown) {
  return formatShipsgoPortForLocale(name, code, "zh-CN") || "接口未返回";
}

export function shipsgoStatusText(tracking: ShipsgoTracking) {
  return formatShipsgoStatusForLocale(tracking.currentStatus || tracking.status || tracking.statusLabel, "zh-CN")
    || fallback(tracking.currentStatus || tracking.status || tracking.statusLabel, "待更新");
}

export function vesselVoyageText(tracking: ShipsgoTracking) {
  const vessel = clean(tracking.vesselName);
  const voyage = clean(tracking.voyage);
  if (vessel && voyage) return `${vessel} / ${voyage}`;
  return vessel || voyage || "暂无船名航次";
}

export function containers(tracking: ShipsgoTracking) {
  return Array.from(new Set([
    ...(tracking.containerNumbers || []),
    tracking.containerNumber || "",
  ].map(clean).filter(Boolean)));
}

export async function fetchTracking(trackingId: string) {
  const response = await fetch(`/api/freightower/ocean-trackings/${encodeURIComponent(trackingId)}`, {
    credentials: "include",
    cache: "no-store",
  });
  const data: TrackingMapResponse = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false || !data.tracking) {
    throw new Error(data.message || "当前运输跟踪数据加载失败，请重新同步后再试。");
  }
  return data;
}
