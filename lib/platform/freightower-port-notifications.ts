import crypto from "node:crypto";

export type FreightowerPortOperationEvent = {
  eventCode?: string | null;
  eventCategory?: string | null;
  time?: string | null;
  location?: string | null;
  description?: string | null;
};

const PORT_OPERATION_CODES = new Set(["CYOP", "CYCL", "WCYOP", "WCYCL"]);

function eventCode(event: FreightowerPortOperationEvent | null | undefined) {
  return String(event?.eventCode || "").trim().toUpperCase();
}

export function isFreightowerPortOperationEvent(
  event: FreightowerPortOperationEvent | null | undefined,
) {
  return PORT_OPERATION_CODES.has(eventCode(event));
}

export function freightowerPortOperationEventSegment(
  event: FreightowerPortOperationEvent | null | undefined,
) {
  if (!isFreightowerPortOperationEvent(event)) return "";
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify([
    eventCode(event),
    event?.eventCategory || "",
    event?.time || "",
    event?.location || "",
    event?.description || "",
  ])).digest("hex");
  return `port-operation:${fingerprint}`;
}

export function freightowerPortOperationNotificationTitle(
  event: FreightowerPortOperationEvent | null | undefined,
  portTimeline: FreightowerPortOperationEvent[] = [],
) {
  const code = eventCode(event);
  if (code === "WCYOP") return "开港时间变更";
  if (code === "WCYCL" || code === "CYCL") return "截港时间变更";
  if (code === "CYOP") {
    const openingCount = portTimeline.filter((item) => eventCode(item) === "CYOP").length;
    return openingCount > 1 ? "开港时间变更" : "港区已开放，可以进箱";
  }
  return "港区开截港状态更新";
}

export function freightowerPortOperationNotification(
  changes: Array<{ source: string; event: FreightowerPortOperationEvent | null }>,
  portTimeline: FreightowerPortOperationEvent[] = [],
) {
  const event = changes.find((change) => (
    change.source === "port" && isFreightowerPortOperationEvent(change.event)
  ))?.event || null;
  return {
    changed: Boolean(event),
    title: event ? freightowerPortOperationNotificationTitle(event, portTimeline) : "",
  };
}
