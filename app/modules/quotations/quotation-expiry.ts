import { currentQuotationVersion, type QuotationRow } from "./types";

const chinaDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function chinaDateKey(value: Date) {
  const parts = chinaDateFormatter.formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function quotationValidityState(quotation: QuotationRow, now = new Date()) {
  const version = currentQuotationVersion(quotation);
  const validUntil = String(version?.validUntil || "").slice(0, 10);
  const expirable = ["DRAFT", "SENT"].includes(String(quotation.status));
  return {
    validUntil,
    expired: Boolean(expirable && validUntil && validUntil < chinaDateKey(now)),
  };
}
