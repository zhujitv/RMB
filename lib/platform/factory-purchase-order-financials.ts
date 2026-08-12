import { Prisma } from "../generated/prisma/client.js";

export const FACTORY_DELAY_GRACE_DAYS = 10;
export const FACTORY_DELAY_RATE_PER_DAY = new Prisma.Decimal("0.00003");

type DecimalInput = Prisma.Decimal | string | number | null | undefined;
type DateInput = Date | string | null | undefined;

function decimal(value: DecimalInput, fallback = "0") {
  if (value === null || value === undefined || String(value).trim() === "") {
    return new Prisma.Decimal(fallback);
  }
  return Prisma.Decimal.isDecimal(value) ? value : new Prisma.Decimal(value);
}

function shanghaiDateKey(value: DateInput) {
  if (!value) return "";
  if (typeof value === "string") {
    const dateOnly = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function calendarDayNumber(value: DateInput) {
  const key = shanghaiDateKey(value);
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function factoryPrepaymentRequiredAmount(subtotal: DecimalInput, ratio: DecimalInput) {
  const normalizedSubtotal = Prisma.Decimal.max(decimal(subtotal), 0);
  const normalizedRatio = Prisma.Decimal.min(Prisma.Decimal.max(decimal(ratio), 0), 1);
  return normalizedSubtotal.mul(normalizedRatio).toDecimalPlaces(2);
}

export function calculateFactoryDelayPenalty({
  initialDeliveryDate,
  actualDeliveryDate,
  penaltyBaseAmount,
  graceDays = FACTORY_DELAY_GRACE_DAYS,
  ratePerDay = FACTORY_DELAY_RATE_PER_DAY,
  capRatio = null,
}: {
  initialDeliveryDate: DateInput;
  actualDeliveryDate: DateInput;
  penaltyBaseAmount: DecimalInput;
  graceDays?: number;
  ratePerDay?: DecimalInput;
  capRatio?: DecimalInput;
}) {
  const initialDay = calendarDayNumber(initialDeliveryDate);
  const actualDay = calendarDayNumber(actualDeliveryDate);
  const lateCalendarDays = initialDay === null || actualDay === null
    ? 0
    : Math.max(0, actualDay - initialDay);
  const normalizedGraceDays = Number.isSafeInteger(graceDays) ? Math.max(0, graceDays) : FACTORY_DELAY_GRACE_DAYS;
  const delayDays = Math.max(0, lateCalendarDays - normalizedGraceDays);
  const base = Prisma.Decimal.max(decimal(penaltyBaseAmount), 0);
  const rate = Prisma.Decimal.max(decimal(ratePerDay), 0);
  let amount = base.mul(rate).mul(delayDays).toDecimalPlaces(2);
  if (capRatio !== null && capRatio !== undefined && String(capRatio).trim() !== "") {
    const cap = base.mul(Prisma.Decimal.max(decimal(capRatio), 0)).toDecimalPlaces(2);
    amount = Prisma.Decimal.min(amount, cap);
  }
  return { lateCalendarDays, delayDays, amount };
}

export function effectiveFactoryPurchaseOrderAmount(items: Array<{
  amount?: DecimalInput;
  supplierPrice?: { amount?: DecimalInput } | null;
}>) {
  if (!items.length) return null;
  let total = new Prisma.Decimal(0);
  for (const item of items) {
    const value = item.supplierPrice?.amount ?? item.amount;
    if (value === null || value === undefined || String(value).trim() === "") return null;
    total = total.add(decimal(value));
  }
  return total.toDecimalPlaces(2);
}
