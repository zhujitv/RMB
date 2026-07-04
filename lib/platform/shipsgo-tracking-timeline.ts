import { isPlainRecord } from "./shared-base-utils";
import {
  arrayAt,
  arrayByKeys,
  collectArraysByKeys,
  dateByKeys,
  portName,
  recordAt,
  textAt,
  textByKeys,
  extractShipmentPayload,
} from "./shipsgo-tracking-mapping-helpers";

function shipsgoEventDate(event: unknown) {
  return dateByKeys(event, [
    "timestamp",
    "time",
    "date",
    "datetime",
    "eventDate",
    "event_date",
    "eventTime",
    "event_time",
    "actualDate",
    "actual_date",
    "estimatedDate",
    "estimated_date",
    "plannedDate",
    "planned_date",
  ]);
}

function shipsgoEventLocation(event: unknown) {
  return portName(
    recordAt(event, "location"),
    recordAt(event, "port"),
    recordAt(event, "place"),
    recordAt(event, "terminal"),
  ) || textByKeys(event, [
    "location",
    "portName",
    "port_name",
    "port",
    "facility",
    "terminal",
    "place",
    "city",
    "unlocode",
    "UNLocode",
  ]);
}

function shipsgoEventDescription(event: unknown) {
  return textByKeys(event, [
    "description",
    "statusDescription",
    "status_description",
    "eventDescription",
    "event_description",
    "eventName",
    "event_name",
    "event",
    "status",
    "activity",
    "milestone",
    "message",
    "name",
  ]);
}

function shipsgoEventVessel(event: unknown) {
  const vessel = recordAt(event, "vessel");
  return textAt(vessel, "name")
    || textAt(event, "vesselName")
    || textAt(event, "vessel_name")
    || textByKeys(event, ["vesselName", "vessel_name"]);
}

function shipsgoEventVoyage(event: unknown) {
  return textAt(event, "voyage")
    || textAt(event, "voyageNo")
    || textAt(event, "voyage_no")
    || textAt(event, "voyageNumber")
    || textByKeys(event, ["voyageNo", "voyage_no", "voyageNumber", "voyage"]);
}

export function extractShipsgoTimeline(payload: unknown) {
  const shipment = extractShipmentPayload(payload);
  const eventArrays = collectArraysByKeys(shipment, [
    "events",
    "checkpoints",
    "routing",
    "routes",
    "locations",
    "statusHistory",
    "status_history",
    "eventTimeline",
    "event_timeline",
    "trackingEvents",
    "tracking_events",
    "milestones",
    "movements",
  ]);
  const containers = arrayAt(shipment, "containers").concat(arrayByKeys(shipment, ["containerList", "container_list"]));
  for (const container of containers) {
    const movements = arrayAt(container, "movements");
    if (movements.length) eventArrays.push(movements);
  }
  const seen = new Set<string>();
  return eventArrays
    .flat()
    .filter((event) => isPlainRecord(event))
    .map((event) => {
      const time = shipsgoEventDate(event);
      const location = shipsgoEventLocation(event);
      const description = shipsgoEventDescription(event) || "运输节点";
      const vesselName = shipsgoEventVessel(event);
      const voyage = shipsgoEventVoyage(event);
      return {
        time: time ? time.toISOString() : "",
        location,
        description,
        vesselName,
        voyage,
        source: "大掌櫃",
      };
    })
    .filter((event) => event.time || event.location || event.description !== "运输节点")
    .filter((event) => {
      const key = `${event.time}|${event.location}|${event.description}|${event.vesselName}|${event.voyage}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return new Date(a.time).getTime() - new Date(b.time).getTime();
    });
}
