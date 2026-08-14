import type { FactoryPurchaseOrder, PurchaseOrderItem } from "./types";

export type OfflineFactoryConfirmationChannel = "WECHAT" | "PHONE" | "EMAIL" | "PAPER" | "OTHER";
export type OfflineFactoryResponseAction = "ACCEPTED" | "DELIVERY_PROPOSED" | "REJECTED";

export const OFFLINE_FACTORY_CHANNELS: Array<{ value: OfflineFactoryConfirmationChannel; label: string }> = [
  { value: "WECHAT", label: "微信" },
  { value: "PHONE", label: "电话" },
  { value: "EMAIL", label: "邮件" },
  { value: "PAPER", label: "纸质回执" },
  { value: "OTHER", label: "其他" },
];

const UNIT_PRICE_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;

function shanghaiParts(value: Date) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).map((part) => [part.type, part.value]));
}

export function shanghaiDateTimeInputValue(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = shanghaiParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function shanghaiDateInputValue(value: Date | string = new Date()) {
  return shanghaiDateTimeInputValue(value).slice(0, 10);
}

export function shanghaiDateTimeIso(value: string) {
  const minuteOnly = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
  if (!minuteOnly && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return "";
  const date = new Date(`${minuteOnly ? `${value}:00` : value}+08:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function validOfflineUnitPrice(value: string) {
  const text = value.trim();
  return UNIT_PRICE_PATTERN.test(text) && Number.isFinite(Number(text));
}

export function purchaseOrderItemPrice(item: PurchaseOrderItem) {
  const value = item.supplierConfirmedUnitPrice ?? item.purchaseUnitPrice ?? item.unitPrice;
  return value == null ? "" : String(value);
}

export function initialOfflineItemPrices(order: FactoryPurchaseOrder) {
  return Object.fromEntries((order.items || [])
    .filter((item) => Boolean(item.id))
    .map((item) => [String(item.id), purchaseOrderItemPrice(item)]));
}

export function currentFactoryDeliveryDate(order: FactoryPurchaseOrder) {
  const value = order.confirmedSupplierDeliveryDate || order.supplierDeliveryDate || order.requestedDeliveryDate;
  return value ? shanghaiDateInputValue(value) : "";
}

export function factoryConfirmationChannelLabel(value: unknown) {
  if (String(value || "") === "PORTAL") return "供应商门户";
  return OFFLINE_FACTORY_CHANNELS.find((item) => item.value === value)?.label || "未标记渠道";
}

export function factoryConfirmationSourceLabel(value: unknown) {
  if (String(value || "") === "INTERNAL_OFFLINE") return "内部线下代录";
  if (String(value || "") === "SUPPLIER_PORTAL") return "供应商门户";
  return "历史记录";
}

export function factoryResponseActionLabel(value: unknown) {
  if (String(value || "") === "ACCEPTED") return "接受订单";
  if (String(value || "") === "DELIVERY_PROPOSED") return "提出新交期";
  if (String(value || "") === "REJECTED") return "拒绝订单";
  return "供应商回复";
}
