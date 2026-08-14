import { dateFromInput, dateToInput, todayInputInChina } from "./shared-base-input";
import { codedError } from "./shared-base-errors";

const DOMESTIC_SHIPMENT_TRANSPORT_TYPES = new Set(["TRUCK", "MULTIMODAL"]);

type ShipmentDateItem = { departureDate?: unknown };

function normalizedDate(value: unknown) {
  return dateFromInput(value);
}

export function domesticShipmentDateFromItems(transportType: unknown, items: ShipmentDateItem[] = []) {
  if (!DOMESTIC_SHIPMENT_TRANSPORT_TYPES.has(String(transportType || ""))) return null;
  const dates = items
    .map((item) => normalizedDate(item.departureDate))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.getTime() - right.getTime());
  return dates[0] || null;
}

export function sameDomesticShipmentDate(left: unknown, right: unknown) {
  const leftDate = dateToInput(left);
  const rightDate = dateToInput(right);
  return Boolean(leftDate && rightDate && leftDate === rightDate);
}

export function shouldSyncDomesticShipmentDate(currentOrderDate: unknown, previousAutomaticDate: unknown) {
  if (!normalizedDate(currentOrderDate)) return true;
  return sameDomesticShipmentDate(currentOrderDate, previousAutomaticDate);
}

export function assertDomesticShipmentDateNotFuture(value: unknown, today = todayInputInChina()) {
  const date = dateToInput(value);
  if (date && date > today) {
    throw codedError("国内物流起运日期不能晚于今天。", 400, "DOMESTIC_DEPARTURE_DATE_FUTURE");
  }
}
