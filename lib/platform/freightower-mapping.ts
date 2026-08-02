import type { Prisma } from "../generated/prisma/client.js";
import { freightowerAlertText, latestFreightowerDumpingAlert } from "./freightower-alerts";
import { isPlainRecord, num } from "./shared-base-utils";
import {
  arrayAt,
  recordAt,
  textAt,
  textByKeys,
} from "./shipsgo-tracking-mapping-helpers";
import { parseFreightowerDate } from "./freightower-dates";
import {
  cleanInputText,
  safeContainerNumber,
  uniqueStrings,
  type ShipsgoSettings,
  type ShipsgoShipmentPayload,
} from "./shipsgo-tracking-utils";
import {
  freightowerSubscribedMessage,
  responseMessage,
  responseStatusCode,
} from "./freightower-api";

function resultFromFreightowerPayload(payload: unknown) {
  const root = isPlainRecord(payload) ? payload : {};
  const data = recordAt(root, "data");
  const dataResult = recordAt(data, "result");
  if (Object.keys(dataResult).length) return dataResult;
  const rootResult = recordAt(root, "result");
  if (Object.keys(rootResult).length) return rootResult;
  return root;
}

function paramFromFreightowerPayload(payload: unknown) {
  const root = isPlainRecord(payload) ? payload : {};
  const data = recordAt(root, "data");
  const query = recordAt(data, "query");
  const actualParam = recordAt(query, "actualParam");
  if (Object.keys(actualParam).length) return actualParam;
  const param = recordAt(query, "param");
  if (Object.keys(param).length) return param;
  return recordAt(root, "param");
}

function subscriptionParamFromFreightowerPayload(payload: unknown) {
  const root = isPlainRecord(payload) ? payload : {};
  const data = recordAt(root, "data");
  const queryParam = recordAt(recordAt(data, "query"), "param");
  return Object.keys(queryParam).length ? queryParam : recordAt(root, "param");
}

function freightowerPlaceLabel(place: unknown) {
  return textAt(place, "nameCn") || textAt(place, "name") || textAt(place, "nameOrigin") || textAt(place, "code");
}

function placeByTypes(places: unknown[], types: number[]) {
  return places.find((place) => types.includes(num(textAt(place, "type"), num(isPlainRecord(place) ? place.type : "", 0)))) || {};
}

function newestStatus(statuses: unknown[]) {
  return statuses
    .map((status) => ({ status, time: freightowerDateAt(status, "eventTime") }))
    .filter((item): item is { status: unknown; time: Date } => Boolean(item.time))
    .sort((a, b) => b.time.getTime() - a.time.getTime())[0]?.status || statuses[statuses.length - 1] || {};
}

function freightowerDateAt(source: unknown, key: string) {
  return parseFreightowerDate(textAt(source, key), textByKeys(source, ["portTimeZone", "port_time_zone", "timezone", "timeZone"]));
}

function freightowerDateByKeys(source: unknown, keys: string[]) {
  return parseFreightowerDate(textByKeys(source, keys), textByKeys(source, ["portTimeZone", "port_time_zone", "timezone", "timeZone"]));
}

function firstContainer(result: ShipsgoShipmentPayload) {
  return arrayAt(result, "containers")[0] || {};
}

function freightowerMapUrl(settings: ShipsgoSettings, param: Record<string, unknown>) {
  if (!settings.liveMapEnabled || !settings.freightowerIframeKey || !settings.freightowerClientId) return "";
  const search = new URLSearchParams();
  search.set("key", settings.freightowerIframeKey);
  search.set("clientId", settings.freightowerClientId);
  const params = ["billNo", "containerNo", "carrierCode", "portCode", "isExport", "businessNo", "billCategory", "polCode", "podCode"];
  for (const key of params) {
    const value = cleanInputText(param[key], 128);
    if (value) search.set(key, value);
  }
  search.set("showInfo", "1");
  search.set("lang", settings.freightowerDefaultLang || "zh");
  search.set("hiddenReference", settings.freightowerHiddenReference ? "1" : "0");
  return `https://i.saas.freightower.com/#/ocean/detail?${search.toString()}`;
}

function safeFreightowerIframeUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "i.saas.freightower.com" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function mapFreightowerShipmentPayload(payload: unknown, settings?: ShipsgoSettings) {
  const result = resultFromFreightowerPayload(payload) as ShipsgoShipmentPayload;
  const param = paramFromFreightowerPayload(payload);
  const subscriptionParam = subscriptionParamFromFreightowerPayload(payload);
  const carrier = recordAt(result, "carrier");
  const booking = recordAt(result, "booking");
  const firstVessel = recordAt(result, "firstVessel");
  const current = recordAt(result, "currentStatus");
  const places = arrayAt(result, "places");
  const originPlace = placeByTypes(places, [1, 2]);
  const destinationPlace = placeByTypes(places, [4, 5]) || places[places.length - 1] || {};
  const container = firstContainer(result);
  const containerStatuses = arrayAt(container, "status");
  const hasTrackingEvents = places.length > 0
    || arrayAt(result, "routes").length > 0
    || arrayAt(result, "containers").some((item) => arrayAt(item, "status").length > 0)
    || arrayAt(result, "containers").some((item) => arrayAt(item, "warnings").length > 0)
    || Object.keys(current).length > 0;
  const isSubscribedOnly = responseStatusCode(payload) === "20001" && !hasTrackingEvents;
  const latestContainerStatus = newestStatus(containerStatuses);
  const dumpingAlert = latestFreightowerDumpingAlert(payload);
  const statusDescription = textAt(current, "descriptionCn")
    || textAt(latestContainerStatus, "descriptionCn")
    || textAt(result, "statusDescription")
    || textAt(result, "statusCategory")
    || "UNKNOWN";
  const billNo = textAt(result, "billNo") || textAt(param, "billNo");
  const containerNumbers = uniqueStrings([
    safeContainerNumber(textAt(result, "containerNo")),
    safeContainerNumber(textAt(param, "containerNo")),
    ...arrayAt(result, "containers").map((item) => safeContainerNumber(textAt(item, "containerNo"))),
  ]);
  return {
    shipsgoShipmentId: cleanInputText(`${billNo || containerNumbers[0] || textAt(param, "businessNo") || "freightower"}:${textAt(param, "carrierCode") || textAt(carrier, "code")}`, 160),
    masterBlNo: billNo,
    reference: textAt(param, "businessNo"),
    carrierScac: textAt(carrier, "code") || textAt(param, "carrierCode"),
    carrierName: textAt(carrier, "nameCn") || textAt(carrier, "nameEn") || textAt(carrier, "code") || textAt(param, "carrierCode"),
    bookingNumber: billNo,
    containerNumber: containerNumbers[0] || "",
    status: isSubscribedOnly ? "SUBSCRIBED" : textAt(result, "statusCategory") || "UNKNOWN",
    currentStatus: isSubscribedOnly ? "SUBSCRIBED" : statusDescription,
    syncStatus: isSubscribedOnly ? "SUBSCRIBED" : "SYNCED",
    syncMessage: isSubscribedOnly ? freightowerSubscribedMessage(payload) : responseMessage(payload),
    originName: freightowerPlaceLabel(originPlace),
    destinationName: freightowerPlaceLabel(destinationPlace),
    originPortCode: textAt(originPlace, "code"),
    destinationPortCode: textAt(destinationPlace, "code"),
    dateOfLoading: freightowerDateAt(originPlace, "atd") || freightowerDateAt(originPlace, "load") || freightowerDateAt(originPlace, "etd") || freightowerDateAt(originPlace, "std"),
    dateOfDischarge: freightowerDateAt(destinationPlace, "ata") || freightowerDateAt(destinationPlace, "disc"),
    predictedDischargeDate: freightowerDateAt(destinationPlace, "eta_predicted") || freightowerDateAt(destinationPlace, "eta") || freightowerDateByKeys(result, ["eta_predicted", "podEtaPredicted"]),
    eta: freightowerDateAt(destinationPlace, "eta_predicted") || freightowerDateAt(destinationPlace, "eta") || freightowerDateAt(current, "eventTime"),
    vesselName: textAt(current, "vslName") || textAt(latestContainerStatus, "vslName") || textAt(firstVessel, "vessel") || textAt(originPlace, "vessel") || textAt(destinationPlace, "vessel"),
    voyage: textAt(current, "voy") || textAt(latestContainerStatus, "voy") || textAt(originPlace, "voyage") || textAt(destinationPlace, "voyage"),
    mapToken: "",
    mapUrl: settings
      ? safeFreightowerIframeUrl(result.iframeUrl) || freightowerMapUrl(settings, subscriptionParam)
      : "",
    lastEvent: isSubscribedOnly ? "" : freightowerAlertText(dumpingAlert) || statusDescription,
    lastEventAt: isSubscribedOnly
      ? null
      : dumpingAlert?.time
        ? new Date(dumpingAlert.time)
        : freightowerDateAt(current, "eventTime") || freightowerDateAt(latestContainerStatus, "eventTime") || freightowerDateAt(result, "updateTime"),
    containerNumbers,
    rawPayload: result as Prisma.InputJsonValue,
    rawResponse: payload as Prisma.InputJsonValue,
  };
}

export function trackingDataFromFreightowerMappedShipment(mapped: ReturnType<typeof mapFreightowerShipmentPayload>) {
  const {
    containerNumbers: _containerNumbers,
    originPortCode: _originPortCode,
    destinationPortCode: _destinationPortCode,
    ...trackingData
  } = mapped;
  return trackingData;
}

export function trackingUpdateFromFreightowerMappedShipment(
  mapped: ReturnType<typeof mapFreightowerShipmentPayload>,
  previousPayload?: unknown,
): Partial<ReturnType<typeof trackingDataFromFreightowerMappedShipment>> {
  if (mapped.syncStatus !== "SUBSCRIBED") {
    return trackingDataFromFreightowerMappedShipment(mapped);
  }
  const previous = previousPayload ? mapFreightowerShipmentPayload(previousPayload) : null;
  if (previous?.syncStatus === "SYNCED") {
    return {
      syncStatus: mapped.syncStatus,
      syncMessage: mapped.syncMessage,
    };
  }
  return trackingDataFromFreightowerMappedShipment(mapped);
}
