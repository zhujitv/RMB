import type { Prisma } from "../generated/prisma/client.js";
import {
  arrayAt,
  arrayByKeys,
  dateAt,
  dateByKeys,
  extractContainerNumbersFromPayload,
  extractShipsgoPort,
  lastOceanMovement,
  mapUrl,
  recordAt,
  recursiveShipmentId,
  textAt,
  textByKeys,
} from "./shipsgo-tracking-mapping-helpers";
import type { ShipsgoShipmentPayload } from "./shipsgo-tracking-utils";

export function mapShipsgoShipmentPayload(payload: ShipsgoShipmentPayload) {
  const carrier = recordAt(payload, "carrier");
  const shippingLine = recordAt(payload, "shippingLine");
  const shippingLineSnake = recordAt(payload, "shipping_line");
  const route = recordAt(payload, "route");
  const originPort = extractShipsgoPort(payload, "origin");
  const destinationPort = extractShipsgoPort(payload, "destination");
  const tokens = recordAt(payload, "tokens");
  const containers = arrayAt(payload, "containers").concat(arrayByKeys(payload, ["containerList", "container_list"]));
  const events = arrayByKeys(payload, ["events", "eventTimeline", "event_timeline", "trackingEvents", "tracking_events"]);
  const lastMovement = lastOceanMovement(containers);
  const vessel = lastMovement ? recordAt(lastMovement.movement, "vessel") : {};
  const latestEvent = events.length ? events[events.length - 1] : null;
  const latestEventVessel = latestEvent ? recordAt(latestEvent, "vessel") : {};
  const shipmentId = textAt(payload, "id")
    || textAt(payload, "shipment_id")
    || textAt(payload, "shipmentId")
    || recursiveShipmentId(payload);
  const token = textAt(tokens, "map") || textAt(payload, "mapToken") || textAt(payload, "map_token");
  const status = textAt(payload, "status")
    || textAt(payload, "current_status")
    || textAt(payload, "currentStatus")
    || textAt(payload, "latestStatus")
    || textAt(payload, "latest_status")
    || textAt(latestEvent, "status")
    || textAt(latestEvent, "event")
    || "UNKNOWN";
  const eta = dateAt(route, "date_of_discharge_predicted")
    || dateAt(route, "date_of_discharge")
    || dateByKeys(payload, ["eta", "ETA", "estimatedArrival", "estimated_arrival", "estimatedTimeOfArrival", "predictedDischargeDate", "dateOfDischargePredicted"]);
  const containerNumbers = extractContainerNumbersFromPayload(payload);
  const masterBlNo = textAt(payload, "master_bl_no")
    || textAt(payload, "master_bill_of_lading")
    || textAt(payload, "mbl_number")
    || textAt(payload, "masterBlNo")
    || textAt(payload, "bl_no")
    || textAt(payload, "blNo")
    || textAt(payload, "booking_number")
    || textAt(payload, "bookingNumber");
  const carrierScac = textAt(carrier, "scac")
    || textAt(shippingLine, "scac")
    || textAt(shippingLineSnake, "scac")
    || textAt(payload, "carrier_scac")
    || textAt(payload, "carrierScac")
    || textAt(payload, "scac")
    || textByKeys(payload, ["carrier_scac", "carrierScac", "scac"]);
  const carrierName = textAt(carrier, "name")
    || textAt(shippingLine, "name")
    || textAt(shippingLineSnake, "name")
    || textAt(payload, "shippingLine")
    || textAt(payload, "shipping_line")
    || textAt(payload, "carrier_name")
    || textAt(payload, "carrierName")
    || textByKeys(payload, ["carrier_name", "carrierName", "shippingLineName"]);
  const vesselName = textAt(vessel, "name")
    || textAt(latestEventVessel, "name")
    || textAt(payload, "vesselName")
    || textAt(payload, "vessel_name")
    || textByKeys(payload, ["vesselName", "vessel_name", "vessel"]);
  const voyage = textAt(lastMovement?.movement, "voyage")
    || textAt(latestEvent, "voyage")
    || textAt(payload, "voyage")
    || textAt(payload, "voyageNo")
    || textAt(payload, "voyage_no")
    || textAt(payload, "voyageNumber")
    || textByKeys(payload, ["voyageNo", "voyage_no", "voyageNumber", "voyage"]);
  return {
    shipsgoShipmentId: shipmentId,
    masterBlNo,
    reference: textAt(payload, "reference"),
    carrierScac,
    carrierName,
    bookingNumber: textAt(payload, "booking_number") || textAt(payload, "bookingNumber") || masterBlNo,
    containerNumber: containerNumbers[0] || textAt(payload, "container_number"),
    status,
    currentStatus: status,
    syncStatus: "SYNCED",
    syncMessage: "",
    originName: originPort.name,
    destinationName: destinationPort.name,
    originPortCode: originPort.code,
    destinationPortCode: destinationPort.code,
    dateOfLoading: dateAt(route, "date_of_loading") || dateByKeys(payload, ["dateOfLoading", "date_of_loading", "etd", "departureDate"]),
    dateOfDischarge: dateAt(route, "date_of_discharge") || dateByKeys(payload, ["dateOfDischarge", "date_of_discharge", "ata", "arrivalDate"]),
    predictedDischargeDate: dateAt(route, "date_of_discharge_predicted") || eta,
    eta,
    vesselName,
    voyage,
    mapToken: token,
    mapUrl: mapUrl(shipmentId, token),
    lastEvent: textAt(lastMovement?.movement, "event")
      || textAt(latestEvent, "event")
      || textAt(latestEvent, "status")
      || textAt(payload, "latestStatus")
      || textAt(payload, "lastLocation")
      || textAt(payload, "last_location"),
    lastEventAt: lastMovement?.timestamp || dateByKeys(latestEvent, ["timestamp", "date", "eventDate", "event_date"]) || null,
    containerNumbers,
    rawPayload: payload as Prisma.InputJsonValue,
    rawResponse: payload as Prisma.InputJsonValue,
  };
}

export function trackingDataFromMappedShipment(mapped: ReturnType<typeof mapShipsgoShipmentPayload>) {
  const {
    containerNumbers: _containerNumbers,
    originPortCode: _originPortCode,
    destinationPortCode: _destinationPortCode,
    ...trackingData
  } = mapped;
  return trackingData;
}
