import crypto from "node:crypto";
import type { ShipsgoTracking } from "../generated/prisma/client.js";
import { latestFreightowerDumpingAlert } from "./freightower-alerts";
import {
  extractFreightowerCustomsTimeline,
  latestFreightowerCustomsEvent,
} from "./freightower-customs-events";
import { extractFreightowerPortTimeline, latestFreightowerPortEvent } from "./freightower-port-events";
import {
  freightowerCustomsEventHasActiveAlert,
  freightowerPortEventHasActiveAlert,
} from "./freightower-supplemental-alerts";

function dumpingAlertEventKey(alert: NonNullable<ReturnType<typeof latestFreightowerDumpingAlert>>) {
  return crypto.createHash("sha256").update([
    alert.code,
    alert.category,
    alert.time,
    alert.containerNo,
    alert.description,
  ].join("\0")).digest("hex");
}

function timelineEventKey(events: Array<Record<string, unknown>>) {
  return crypto.createHash("sha256").update(JSON.stringify(events)).digest("hex");
}

export type FreightowerNotificationChangeSource = "comprehensive" | "port" | "customs";
export type FreightowerNotificationEvent = {
  time: string;
  location: string;
  description: string;
  vesselName: string;
  voyage: string;
  eventCode: string;
  eventCategory: string;
  isWarning: boolean;
  isDumpingWarning: boolean;
};

export function freightowerComprehensiveTrackingNotificationEventKey(tracking: ShipsgoTracking) {
  const dumpingAlert = latestFreightowerDumpingAlert(tracking.rawResponse ?? tracking.rawPayload);
  return dumpingAlert
    ? `${tracking.id}:dumping:${dumpingAlertEventKey(dumpingAlert)}`
    : [
        tracking.id,
        tracking.lastEventAt?.toISOString() || "",
        tracking.currentStatus || tracking.status || tracking.syncStatus,
        tracking.lastEvent || "",
        tracking.eta?.toISOString() || "",
        tracking.vesselName || "",
        tracking.voyage || "",
      ].join(":");
}

export function freightowerTrackingNotificationEventKey(tracking: ShipsgoTracking) {
  return [
    freightowerComprehensiveTrackingNotificationEventKey(tracking),
    freightowerPortTrackingNotificationEventKey(tracking),
    freightowerCustomsTrackingNotificationEventKey(tracking),
  ].join(":");
}

export function hasFreightowerTrackingNotificationChange(before: ShipsgoTracking, after: ShipsgoTracking) {
  return freightowerComprehensiveTrackingNotificationEventKey(before)
    !== freightowerComprehensiveTrackingNotificationEventKey(after);
}

export function freightowerPortTrackingNotificationEventKey(tracking: ShipsgoTracking) {
  const events = extractFreightowerPortTimeline(tracking.portRawResponse);
  return events.length
    ? `${tracking.id}:port:${timelineEventKey(events)}`
    : `${tracking.id}:port:none`;
}

export function hasFreightowerPortTrackingNotificationChange(before: ShipsgoTracking, after: ShipsgoTracking) {
  return freightowerPortTrackingNotificationEventKey(before) !== freightowerPortTrackingNotificationEventKey(after);
}

export function freightowerCustomsTrackingNotificationEventKey(tracking: ShipsgoTracking) {
  const events = extractFreightowerCustomsTimeline(tracking.customsRawResponse);
  return events.length
    ? `${tracking.id}:customs:${timelineEventKey(events)}`
    : `${tracking.id}:customs:none`;
}

export function hasFreightowerCustomsTrackingNotificationChange(before: ShipsgoTracking, after: ShipsgoTracking) {
  // The first production backfill is silent for ordinary history. Never silence
  // an unresolved first-seen warning, including an existing in-transit order that
  // is already under inspection when customs tracking is enabled.
  if (before.customsRawResponse == null) {
    const events = extractFreightowerCustomsTimeline(after.customsRawResponse);
    return events.some((event) => (
      event.isWarning && freightowerCustomsEventHasActiveAlert(events, event)
    ));
  }
  return freightowerCustomsTrackingNotificationEventKey(before) !== freightowerCustomsTrackingNotificationEventKey(after);
}

export function freightowerNotificationSourceEvent(
  tracking: ShipsgoTracking,
  changeSource: FreightowerNotificationChangeSource,
) {
  if (changeSource === "port") return latestFreightowerPortEvent(tracking.portRawResponse);
  if (changeSource === "customs") return latestFreightowerCustomsEvent(tracking.customsRawResponse);
  return null;
}

function notificationEventKey(event: FreightowerNotificationEvent) {
  return JSON.stringify([
    event.time,
    event.location,
    event.description,
    event.vesselName,
    event.voyage,
    event.eventCode,
    event.eventCategory,
  ]);
}

export function freightowerChangedNotificationSourceEvent(
  before: ShipsgoTracking,
  after: ShipsgoTracking,
  changeSource: Exclude<FreightowerNotificationChangeSource, "comprehensive">,
) {
  if (changeSource === "customs" && before.customsRawResponse == null) {
    if (before.customsNotificationBaselineAt) return null;
    const customsEvents = extractFreightowerCustomsTimeline(after.customsRawResponse);
    return [...customsEvents].reverse().find((event) => (
      event.isWarning && freightowerCustomsEventHasActiveAlert(customsEvents, event)
    )) || null;
  }
  if (changeSource === "port") {
    const beforeEvents = extractFreightowerPortTimeline(before.portRawResponse);
    const afterEvents = extractFreightowerPortTimeline(after.portRawResponse);
    const previousKeys = new Set(beforeEvents.map(notificationEventKey));
    const newlyAdded = afterEvents.filter((event) => !previousKeys.has(notificationEventKey(event)));
    return [...newlyAdded].reverse().find((event) => (
      event.isWarning && freightowerPortEventHasActiveAlert(afterEvents, event)
    )) || [...newlyAdded].reverse()[0] || afterEvents[afterEvents.length - 1] || null;
  }
  const beforeEvents = extractFreightowerCustomsTimeline(before.customsRawResponse);
  const afterEvents = extractFreightowerCustomsTimeline(after.customsRawResponse);
  const previousKeys = new Set(beforeEvents.map(notificationEventKey));
  const newlyAdded = afterEvents.filter((event) => !previousKeys.has(notificationEventKey(event)));
  return [...newlyAdded].reverse().find((event) => (
    event.isWarning && freightowerCustomsEventHasActiveAlert(afterEvents, event)
  )) || [...newlyAdded].reverse()[0] || afterEvents[afterEvents.length - 1] || null;
}

export function freightowerSupplementalNotificationChange(before: ShipsgoTracking, after: ShipsgoTracking) {
  return freightowerSupplementalNotificationChanges(before, after)[0] || null;
}

export function freightowerSupplementalNotificationChanges(before: ShipsgoTracking, after: ShipsgoTracking) {
  const changes = (["port", "customs"] as const).filter((source) => (
    source === "port"
      ? hasFreightowerPortTrackingNotificationChange(before, after)
      : hasFreightowerCustomsTrackingNotificationChange(before, after)
  )).map((source) => ({
    source,
    event: freightowerChangedNotificationSourceEvent(before, after, source),
  }));
  return changes.sort((left, right) => {
    if (Boolean(left.event?.isWarning) !== Boolean(right.event?.isWarning)) {
      return left.event?.isWarning ? -1 : 1;
    }
    const leftTime = left.event?.time ? new Date(left.event.time).getTime() : 0;
    const rightTime = right.event?.time ? new Date(right.event.time).getTime() : 0;
    return rightTime - leftTime;
  });
}
