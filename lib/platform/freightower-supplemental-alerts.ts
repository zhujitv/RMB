import type { FreightowerTrackingAlert } from "./freightower-alerts";
import type { extractFreightowerCustomsTimeline } from "./freightower-customs-events";
import type { extractFreightowerPortTimeline } from "./freightower-port-events";

type PortEvent = ReturnType<typeof extractFreightowerPortTimeline>[number];
type CustomsEvent = ReturnType<typeof extractFreightowerCustomsTimeline>[number];

const PORT_DUMPING_RESOLUTION_CODES = new Set(["LOAD", "DEPA", "ARRI", "DISC", "GTOT"]);
const CUSTOMS_RESOLUTION_CODES: Record<string, Set<string>> = {
  ASB: new Set(["AAD", "ASA"]),
  BCB: new Set(["BCA"]),
  TRB: new Set(["TRA"]),
  CPI: new Set(["PAS", "CLR"]),
  DEL: new Set(["EDC", "CDC", "PAS", "CLR"]),
};

function eventTime(value: string) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function hasLaterEvent<T extends { time: string }>(
  events: T[],
  warning: T,
  predicate: (event: T) => boolean,
  allowSameTime = false,
) {
  const warningTime = eventTime(warning.time);
  if (warningTime == null) return false;
  const warningIndex = events.indexOf(warning);
  return events.some((event, index) => {
    const candidateTime = eventTime(event.time);
    const later = candidateTime != null && (
      candidateTime > warningTime
      || (allowSameTime && candidateTime === warningTime && index > warningIndex)
    );
    return later && predicate(event);
  });
}

export function freightowerPortAlerts(events: PortEvent[]): FreightowerTrackingAlert[] {
  return events.filter((event) => event.isWarning).map((event) => {
    const resolved = hasLaterEvent(events, event, (candidate) => (
      event.isDumpingWarning
        ? PORT_DUMPING_RESOLUTION_CODES.has(candidate.eventCode)
        : !candidate.isWarning
    ), event.isDumpingWarning);
    return {
      code: event.eventCode,
      category: event.eventCategory,
      title: event.isDumpingWarning ? "甩柜预警" : "港区异常预警",
      description: event.description,
      time: event.time,
      location: event.location,
      containerNo: "",
      severity: event.isDumpingWarning ? "critical" : "warning",
      isDumping: event.isDumpingWarning,
      active: !resolved,
      source: "status",
    };
  });
}

export function freightowerCustomsAlerts(events: CustomsEvent[]): FreightowerTrackingAlert[] {
  return events.filter((event) => event.isWarning).map((event) => ({
    code: event.eventCode,
    category: "CUSTOMS",
    title: "中国海关异常预警",
    description: event.description,
    time: event.time,
    location: event.location,
    containerNo: "",
    severity: "warning",
    isDumping: false,
    active: !hasLaterEvent(
      events,
      event,
      (candidate) => customsEventResolvesWarning(event, candidate),
      true,
    ),
    source: "status",
  }));
}

function customsEventResolvesWarning(warning: CustomsEvent, candidate: CustomsEvent) {
  const warningEntryId = String(warning.entryId || "").trim();
  const candidateEntryId = String(candidate.entryId || "").trim();
  if (warningEntryId || candidateEntryId) {
    if (!warningEntryId || warningEntryId !== candidateEntryId) return false;
  } else if (warning.eventCategory !== candidate.eventCategory) {
    return false;
  }
  const expectedCodes = CUSTOMS_RESOLUTION_CODES[warning.eventCode];
  if (expectedCodes) return expectedCodes.has(candidate.eventCode);
  // Some Freightower customs warnings (for example a manual-review note) do
  // not carry a documented status code. Treat release/clearance as resolution
  // only when both events belong to the same customs declaration.
  if (warningEntryId && (candidate.eventCode === "PAS" || candidate.eventCode === "CLR")) {
    return true;
  }
  return warning.eventCategory === candidate.eventCategory && !candidate.isWarning;
}

type AlertMatchEvent = { time: string; description: string };

function alertMatchesEvent(alert: FreightowerTrackingAlert, event: AlertMatchEvent) {
  return alert.time === event.time && alert.description === event.description;
}

export function freightowerPortEventHasActiveAlert(events: PortEvent[], event: AlertMatchEvent | null | undefined) {
  return Boolean(event && freightowerPortAlerts(events).some((alert) => (
    alert.active && alertMatchesEvent(alert, event)
  )));
}

export function freightowerCustomsEventHasActiveAlert(events: CustomsEvent[], event: AlertMatchEvent | null | undefined) {
  return Boolean(event && freightowerCustomsAlerts(events).some((alert) => (
    alert.active && alertMatchesEvent(alert, event)
  )));
}
