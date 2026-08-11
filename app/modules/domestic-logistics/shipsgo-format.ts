import { formatDateTime } from "../../formatters";
import {
  formatShipsgoCarrierForLocale,
  formatShipsgoPortForLocale,
  formatShipsgoStatusForLocale,
  formatShipsgoTrackingMethodForLocale,
} from "../../../lib/shipsgo-display";
import type { DomesticLogisticsRow, ShipsgoTrackingRow } from "./model";

export function defaultShipsgoMasterBl(row: DomesticLogisticsRow) {
  return String(row.blNo || row.billOfLadingNo || "").trim();
}

export function shipsgoContainerTags(tracking: ShipsgoTrackingRow) {
  const containers = Array.isArray(tracking.containerNumbers) ? tracking.containerNumbers : [];
  return Array.from(new Set([...(containers || []), tracking.containerNumber || ""].map((item) => item.trim()).filter(Boolean)));
}

export function shipsgoValue(value: unknown, fallback = "未返回") {
  const text = String(value || "").trim();
  return text && text !== "-" ? text : fallback;
}

export function shipsgoVesselVoyage(tracking: ShipsgoTrackingRow) {
  return [tracking.vesselName, tracking.voyage].map((item) => String(item || "").trim()).filter(Boolean).join(" / ") || "暂无船名航次";
}

export function shipsgoCarrierText(tracking: ShipsgoTrackingRow) {
  return formatShipsgoCarrierForLocale(tracking.carrierName || tracking.carrierScac, tracking.carrierScac, "zh-CN") || shipsgoValue(tracking.carrierName || tracking.carrierScac);
}

export function shipsgoPortText(name: unknown, code: unknown = "") {
  return formatShipsgoPortForLocale(name, code, "zh-CN") || "接口未返回";
}

export function shipsgoTrackingMethodText(method = "Master B/L") {
  return formatShipsgoTrackingMethodForLocale(method, "zh-CN") || "主提单跟踪";
}

export function shipsgoSyncTime(tracking: ShipsgoTrackingRow) {
  const value = tracking.lastSyncTime || tracking.lastSyncedAt || "";
  return value ? formatDateTime(value) : "暂无同步记录";
}

export function shipsgoTrackingStatusText(tracking: ShipsgoTrackingRow) {
  const syncStatus = String(tracking.syncStatus || "").toUpperCase();
  if (String(tracking.status || "").toUpperCase() === "SUPPLEMENTAL_ONLY") return "港区/海关跟踪中";
  if (/FAIL|ERROR/.test(syncStatus)) return "同步失败";
  if (!tracking.shipsgoShipmentId && !tracking.lastSyncTime && !tracking.lastSyncedAt) return "已创建，待同步";
  const translated = formatShipsgoStatusForLocale(tracking.currentStatus || tracking.status || tracking.statusLabel, "zh-CN");
  if (translated && !/UNKNOWN|未知/i.test(translated)) return translated;
  if (tracking.statusLabel && !/未知/.test(tracking.statusLabel)) return tracking.statusLabel;
  return "已创建，待同步";
}

export function shouldShowShipsgoRecover(tracking: ShipsgoTrackingRow) {
  const syncStatus = String(tracking.syncStatus || "").toUpperCase();
  return !tracking.shipsgoShipmentId || /FAIL|ERROR|NOT_SYNCED/.test(syncStatus);
}
