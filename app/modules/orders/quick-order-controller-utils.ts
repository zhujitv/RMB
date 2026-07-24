import type { QuickOrderForm } from "./model";

export function normalizedOrderTradeTerm(value: string) {
  return String(value || "").trim().toUpperCase();
}

export function isExwTradeTerm(value: string) {
  return normalizedOrderTradeTerm(value).includes("EXW");
}

export function hasHistoricalBusinessDate(form: QuickOrderForm) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    form.actualShipmentDate,
    form.blDate,
    form.expectedArrivalDate,
    form.expectedPaymentDate,
    form.dueDate,
  ].some((value) => Boolean(value && value < today));
}
