import { isPlainRecord } from "./shared-base-utils";
import { parseFreightowerDate } from "./freightower-dates";
import { arrayAt, recordAt, textAt } from "./shipsgo-tracking-mapping-helpers";

const CUSTOMS_WARNING_CODES = new Set(["ASB", "CPI", "DEL", "BCB", "TRB"]);
const CUSTOMS_WARNING_PATTERN = /查验|扣留|退单|退回|删单|异常|风险|转人工|人工审核|未通过|拒绝/;

function customsResult(payload: unknown) {
  const root = isPlainRecord(payload) ? payload : {};
  const outerData = recordAt(root, "data");
  const innerData = recordAt(outerData, "data");
  return Object.keys(innerData).length ? innerData : outerData;
}

function customsRawEventKey(event: unknown) {
  return [
    textAt(event, "noticedate"),
    textAt(event, "statuscd"),
    textAt(event, "channelname"),
    textAt(event, "entryid"),
    textAt(event, "note"),
  ].join("\0");
}

export function mergeFreightowerCustomsResponses(previous: unknown, current: unknown) {
  const previousEvents = arrayAt(customsResult(previous), "status");
  const currentEvents = arrayAt(customsResult(current), "status");
  if (!previousEvents.length) return current;
  const mergedEvents = new Map<string, unknown>();
  for (const event of [...previousEvents, ...currentEvents]) {
    mergedEvents.set(customsRawEventKey(event), event);
  }
  const previousRoot = isPlainRecord(previous) ? previous : {};
  const currentRoot = isPlainRecord(current) ? current : {};
  const currentOuter = recordAt(currentRoot, "data");
  const currentInner = recordAt(currentOuter, "data");
  const previousOuter = recordAt(previousRoot, "data");
  const previousInner = recordAt(previousOuter, "data");
  const usesInnerData = Object.keys(currentInner).length > 0 || Object.keys(previousInner).length > 0;
  const status = [...mergedEvents.values()];
  return usesInnerData
    ? {
        ...previousRoot,
        ...currentRoot,
        data: {
          ...previousOuter,
          ...currentOuter,
          data: { ...previousInner, ...currentInner, status },
        },
      }
    : { ...previousRoot, ...currentRoot, data: { ...previousOuter, ...currentOuter, status } };
}

export function freightowerCustomsResponseState(payload: unknown) {
  const root = isPlainRecord(payload) ? payload : {};
  const data = recordAt(root, "data");
  const statusCode = String(root.statusCode || "");
  const success = data.success;
  const explicitlySucceeded = success === true || String(success).toLowerCase() === "true";
  const explicitlyFailed = success === false || String(success).toLowerCase() === "false";
  const statusText = textAt(data, "status");
  const status = statusText === "" ? null : Number(statusText);
  const validNestedResult = isPlainRecord(root.data) && isPlainRecord(data.data);
  const accepted = statusCode === "20001" || (
    statusCode === "20000"
    && validNestedResult
    && explicitlySucceeded
    && !explicitlyFailed
    && status === 0
  );
  return {
    accepted,
    message: textAt(data, "message") || textAt(root, "message") || textAt(root, "alertMessage"),
    eventCount: extractFreightowerCustomsTimeline(payload).length,
  };
}

export function extractFreightowerCustomsTimeline(payload: unknown) {
  const result = customsResult(payload);
  const seen = new Set<string>();
  return arrayAt(result, "status").filter(isPlainRecord).map((event) => {
    const note = textAt(event, "note");
    const channelName = textAt(event, "channelname");
    const statusCode = textAt(event, "statuscd").toUpperCase();
    const entryId = textAt(event, "entryid");
    const parsedTime = parseFreightowerDate(textAt(event, "noticedate"));
    const description = [channelName, note].filter(Boolean).join("：") || "中国海关节点";
    return {
      time: parsedTime?.toISOString() || "",
      location: "中国海关",
      description,
      vesselName: "",
      voyage: "",
      eventCode: statusCode,
      eventCategory: channelName,
      entryId,
      isWarning: CUSTOMS_WARNING_CODES.has(statusCode) || CUSTOMS_WARNING_PATTERN.test(description),
      isDumpingWarning: false,
      source: "飞驼可视·中国海关",
    };
  }).filter((event) => {
    const key = `${event.time}|${event.eventCode}|${event.entryId}|${event.description}`;
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

export function latestFreightowerCustomsEvent(payload: unknown) {
  const events = extractFreightowerCustomsTimeline(payload);
  return [...events].reverse().find((event) => event.time) || events[events.length - 1] || null;
}
