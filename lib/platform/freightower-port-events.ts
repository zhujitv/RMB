import { isPlainRecord } from "./shared-base-utils";
import { parseFreightowerDate } from "./freightower-dates";
import { arrayAt, recordAt, textAt } from "./shipsgo-tracking-mapping-helpers";

const EVENT_LABELS: Record<string, string> = {
  "GTOT:EMPTY": "提空箱",
  "GTIN:LADEN": "重箱进场",
  "LOAD:LADEN": "装船",
  "DISC:LADEN": "卸船",
  "GTOT:LADEN": "提货",
  "GTIN:EMPTY": "还空箱",
  "DUMP:LADEN": "甩柜预警",
  "RELS:CUS": "海关放行",
  "RELS:TML": "码头放行",
  "RELS:MDG": "海事放行",
  "RECE:CAR": "运抵港区",
  "RELS:VGM": "VGM 已放行",
  "PRLD:TML": "码头配载",
  "PRER:CAR": "箱预录",
  "PLAN:CAR": "预约提柜",
  "HOLD:SRM": "船公司滞留",
  "HOLD:TML": "码头滞留",
  "HOLD:CUS": "海关滞留",
  "DEPA:BRTH": "船舶离泊",
  "ARRI:BRTH": "船舶靠泊",
  "CYOP:POTE": "出口进箱开始",
  "CYCL:POTE": "出口进箱截止",
  "SICT:POTE": "截单",
  "CUCT:POTE": "截关",
};

function portShipment(payload: unknown) {
  const root = isPlainRecord(payload) ? payload : {};
  const data = recordAt(root, "data");
  const shipment = recordAt(data, "shipment");
  return Object.keys(shipment).length ? shipment : recordAt(root, "shipment");
}

function eventCodes(event: unknown) {
  const call = recordAt(event, "transportCall");
  const candidates = [
    textAt(event, "equipmentEventCategory"),
    textAt(event, "shipmentEventCategory"),
    textAt(event, "transportEventCategory"),
    textAt(event, "eventCategory"),
    textAt(event, "eventClassifier"),
  ].map((value) => value.toUpperCase()).filter(Boolean);
  const qualifiers = [
    textAt(event, "equipmentIndicator"),
    textAt(event, "shipmentDocType"),
    textAt(event, "documentType"),
    textAt(call, "facilityCategory"),
    textAt(event, "eventClassifier"),
    textAt(event, "eventCategory"),
  ].map((value) => value.toUpperCase()).filter(Boolean);
  for (const code of candidates) {
    for (const qualifier of qualifiers) {
      if (EVENT_LABELS[`${code}:${qualifier}`]) return { code, qualifier };
    }
  }
  return { code: candidates[0] || "", qualifier: qualifiers[0] || "" };
}

function eventLocation(event: unknown) {
  const call = recordAt(event, "transportCall");
  const location = recordAt(call, "location");
  const port = textAt(location, "portCn")
    || textAt(location, "locationName")
    || textAt(location, "portEn")
    || textAt(location, "locationCode");
  const facility = textAt(call, "facilityName") || textAt(call, "facilityCode");
  return [port, facility].filter(Boolean).join(" · ");
}

function eventVesselVoyage(event: unknown) {
  const call = recordAt(event, "transportCall");
  const vessel = recordAt(call, "vessel");
  return {
    vesselName: textAt(vessel, "vesselName") || textAt(call, "vesselName"),
    voyage: textAt(call, "voyage") || textAt(call, "exportVoyage") || textAt(call, "importVoyage"),
  };
}

function eventTime(event: unknown) {
  const call = recordAt(event, "transportCall");
  const location = recordAt(call, "location");
  return parseFreightowerDate(
    textAt(event, "eventTime"),
    textAt(location, "portTimeZone") || textAt(event, "portTimeZone"),
  );
}

export function extractFreightowerPortTimeline(payload: unknown) {
  const shipment = portShipment(payload);
  const events = [
    ...arrayAt(shipment, "equipmentEvents"),
    ...arrayAt(shipment, "shipmentEvents"),
    ...arrayAt(shipment, "transportEvents"),
  ];
  const seen = new Set<string>();
  return events.filter(isPlainRecord).map((event) => {
    const { code, qualifier } = eventCodes(event);
    const time = eventTime(event);
    const location = eventLocation(event);
    const vessel = eventVesselVoyage(event);
    const description = EVENT_LABELS[`${code}:${qualifier}`]
      || textAt(event, "details")
      || textAt(event, "status")
      || [code, qualifier].filter(Boolean).join(" / ")
      || "港区节点";
    const isDumpingWarning = code === "DUMP";
    const isWarning = isDumpingWarning || code === "HOLD";
    return {
      time: time?.toISOString() || "",
      location,
      description,
      ...vessel,
      eventCode: code,
      eventCategory: qualifier,
      isWarning,
      isDumpingWarning,
      source: "飞驼可视·中国港区",
    };
  }).filter((event) => {
    const key = `${event.time}|${event.location}|${event.description}|${event.vesselName}|${event.voyage}`;
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

export function latestFreightowerPortEvent(payload: unknown) {
  const events = extractFreightowerPortTimeline(payload);
  return [...events].reverse().find((event) => event.time) || events[events.length - 1] || null;
}
