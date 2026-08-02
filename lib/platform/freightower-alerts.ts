import { isPlainRecord, nonEmpty } from "./shared-base-utils";
import {
  arrayAt,
  extractShipmentPayload,
  textByKeys,
} from "./shipsgo-tracking-mapping-helpers";
import { parseFreightowerDate } from "./freightower-dates";

export type FreightowerTrackingAlert = {
  code: string;
  category: string;
  title: string;
  description: string;
  time: string;
  location: string;
  containerNo: string;
  severity: "critical" | "warning";
  isDumping: boolean;
  active: boolean;
  source: "warning" | "status";
};

const DUMPING_RESOLUTION_CODES = new Set([
  "LOBD", "DLPT", "TSLB", "TSDP", "BDAR", "POCA", "DSCH", "PCAB", "STCS", "STRP", "RCVE",
  "FDLB", "FDDP", "FDBA", "FDDC",
]);

const WARNING_TITLES: Record<string, string> = {
  WGITM: "起运港进港延误",
  WDLPT: "起运港离港延误",
  WDUMP: "甩柜预警",
  DUMP: "已发生甩柜",
  WTSBA: "中转滞留",
  WPCGI: "目的港码头拥堵",
  WBDAR: "目的港抵达延误",
  WGTOT: "目的港滞留",
  WETA: "交货地抵达延误",
  WSTCS: "滞港超期",
  WRCVE: "用箱超期",
  WCYOP: "开港变更",
  WCYCL: "截港变更",
  WETB: "靠泊变更",
  WETD: "离泊变更",
  WPORT: "港口变更",
};

function cleanCode(value: unknown) {
  return nonEmpty(value).toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
}

export function isFreightowerDumpingEvent(event: unknown) {
  if (!isPlainRecord(event)) return false;
  const code = cleanCode(event.eventCode || event.code);
  const category = cleanCode(event.eventCategory || event.category);
  const description = textByKeys(event, ["description", "descriptionCn", "descriptionEn"]);
  return code === "WDUMP"
    || code === "DUMP"
    || category === "DUMPING"
    || /甩柜|甩箱|dumped|off[ -]?load/i.test(description);
}

function isWarningEvent(event: unknown) {
  if (!isPlainRecord(event)) return false;
  const code = cleanCode(event.eventCode || event.code);
  return code.startsWith("W") || isFreightowerDumpingEvent(event);
}

function alertEventTime(event: unknown) {
  if (!isPlainRecord(event)) return null;
  return parseFreightowerDate(
    textByKeys(event, ["eventTime", "event_time", "time", "timestamp", "date"]),
    textByKeys(event, ["portTimeZone", "port_time_zone", "timezone", "timeZone"]),
  );
}

function dumpingAlertIsResolved(event: unknown, statuses: unknown[]) {
  const alertTime = alertEventTime(event)?.getTime();
  if (alertTime == null) return false;
  return statuses.some((status) => {
    if (!isPlainRecord(status)) return false;
    const code = cleanCode(status.eventCode || status.code);
    const statusTime = alertEventTime(status)?.getTime();
    return DUMPING_RESOLUTION_CODES.has(code) && statusTime != null && statusTime > alertTime;
  });
}

function normalizeAlert(
  event: unknown,
  fallbackContainerNo: string,
  source: FreightowerTrackingAlert["source"],
  statuses: unknown[] = [],
): FreightowerTrackingAlert | null {
  if (!isPlainRecord(event) || !isWarningEvent(event)) return null;
  const code = cleanCode(event.eventCode || event.code);
  const category = cleanCode(event.eventCategory || event.category);
  const isDumping = isFreightowerDumpingEvent(event);
  const title = WARNING_TITLES[code] || (isDumping ? "甩柜预警" : "运输异常预警");
  const eventTime = alertEventTime(event);
  return {
    code,
    category,
    title,
    description: textByKeys(event, ["description", "descriptionCn", "descriptionEn", "message"]) || title,
    time: eventTime ? eventTime.toISOString() : "",
    location: textByKeys(event, ["portPlace", "eventPlace", "location", "portName", "portCode"]),
    containerNo: textByKeys(event, ["equipmentCode", "containerNo", "container_number"]) || fallbackContainerNo,
    severity: isDumping ? "critical" : "warning",
    isDumping,
    active: !isDumping || !dumpingAlertIsResolved(event, statuses),
    source,
  };
}

export function extractFreightowerAlerts(payload: unknown) {
  const shipment = extractShipmentPayload(payload);
  const candidates: Array<{
    event: unknown;
    containerNo: string;
    source: FreightowerTrackingAlert["source"];
    statuses: unknown[];
  }> = [];
  const containers = arrayAt(shipment, "containers");
  const shipmentStatuses = containers.flatMap((container) => arrayAt(container, "status"));
  for (const event of arrayAt(shipment, "warnings")) {
    const equipmentCode = textByKeys(event, ["equipmentCode", "containerNo", "container_number"]);
    const matchingContainer = equipmentCode
      ? containers.find((container) => textByKeys(container, ["containerNo", "container_number"]) === equipmentCode)
      : null;
    candidates.push({
      event,
      containerNo: equipmentCode,
      source: "warning",
      statuses: matchingContainer ? arrayAt(matchingContainer, "status") : shipmentStatuses,
    });
  }
  for (const container of containers) {
    const containerNo = textByKeys(container, ["containerNo", "container_number", "equipmentCode"]);
    const statuses = arrayAt(container, "status");
    for (const event of arrayAt(container, "warnings")) {
      candidates.push({ event, containerNo, source: "warning", statuses });
    }
    for (const event of statuses) {
      if (isFreightowerDumpingEvent(event)) candidates.push({ event, containerNo, source: "status", statuses });
    }
  }
  const seen = new Set<string>();
  return candidates
    .map(({ event, containerNo, source, statuses }) => normalizeAlert(event, containerNo, source, statuses))
    .filter((alert): alert is FreightowerTrackingAlert => Boolean(alert))
    .filter((alert) => {
      const key = `${alert.code}|${alert.time}|${alert.containerNo}|${alert.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    });
}

export function latestFreightowerDumpingAlert(payload: unknown) {
  return extractFreightowerAlerts(payload).find((alert) => alert.isDumping && alert.active) || null;
}

export function freightowerAlertText(alert: FreightowerTrackingAlert | null | undefined) {
  if (!alert) return "";
  return alert.description && alert.description !== alert.title
    ? `${alert.title}：${alert.description}`
    : alert.title;
}
