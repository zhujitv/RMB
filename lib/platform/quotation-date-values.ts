import { codedError } from "./shared-base-utils";

export function quotationDate(value: unknown, label: string, fallback?: Date | null) {
  if (value === undefined) return fallback;
  if (value === null || String(value).trim() === "") return null;
  const text = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw codedError(`${label}格式错误`, 400, "QUOTATION_DATE_INVALID");
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw codedError(`${label}格式错误`, 400, "QUOTATION_DATE_INVALID");
  }
  return date;
}

export function todayInChina() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
}
