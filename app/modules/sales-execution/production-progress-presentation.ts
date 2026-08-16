import type { FactoryPurchaseOrder, PurchaseOrderItem } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function productionItemDescription(item: PurchaseOrderItem, index = 0) {
  return String(
    item.productDescription
      || [item.productNameSnapshot, item.specificationSnapshot].filter(Boolean).join(" ")
      || item.descriptionSnapshot
      || `产品 ${index + 1}`,
  );
}

export function productionItemQuantity(item: PurchaseOrderItem) {
  return String(item.allocatedQuantity ?? item.quantity ?? "0");
}

export function productionItemUnit(item: PurchaseOrderItem) {
  return String(item.unitSnapshot || "");
}

export function formatProductionQuantity(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString("zh-CN", { maximumFractionDigits: 4 })
    : String(value || "0");
}

export function formatProductionPercent(value: unknown) {
  const parsed = Number(value || 0);
  return `${(Number.isFinite(parsed) ? parsed : 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`;
}

function shanghaiDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateKeyMillis(key: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
}

export function daysFromToday(value: string | null | undefined) {
  if (!value) return null;
  const targetKey = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] || shanghaiDateKey(value);
  const todayKey = shanghaiDateKey(new Date());
  const difference = dateKeyMillis(targetKey) - dateKeyMillis(todayKey);
  return Number.isFinite(difference) ? Math.round(difference / DAY_MS) : null;
}

export function confirmedDeliveryDate(order: FactoryPurchaseOrder) {
  return order.confirmedSupplierDeliveryDate || order.supplierDeliveryDate || order.requestedDeliveryDate || null;
}

export function deliveryTimingLabel(order: FactoryPurchaseOrder) {
  const days = daysFromToday(confirmedDeliveryDate(order));
  if (days === null) return "未设置确认交期";
  if (days > 0) return `距确认交期 ${days} 天`;
  if (days === 0) return "今天为确认交期";
  return `已超过确认交期 ${Math.abs(days)} 天`;
}
