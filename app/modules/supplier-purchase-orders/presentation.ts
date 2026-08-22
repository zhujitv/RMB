import type {
  SupplierPurchaseOrderDto,
  SupplierPurchaseOrderResponseAction,
  SupplierPurchaseOrderStatus,
} from "./types";

const STATUS_LABELS: Record<SupplierPurchaseOrderStatus, string> = {
  DISPATCHED: "待回复",
  ACCEPTED: "已接受",
  DELIVERY_PROPOSED: "已提出新交期",
  REJECTED: "已拒绝",
};

export function statusLabel(status: SupplierPurchaseOrderStatus) {
  return STATUS_LABELS[status] || status;
}

export function productionStatusLabel(status: string) {
  switch (status) {
    case "WAITING_PREPAYMENT": return "等待预付款";
    case "READY": return "可以开始生产";
    case "IN_PRODUCTION": return "生产中";
    case "COMPLETED": return "生产完成";
    default: return "等待订单确认";
  }
}

const RESPONSE_ACTION_LABELS: Record<SupplierPurchaseOrderResponseAction, string> = {
  ACCEPTED: "接受并确认交期",
  DELIVERY_PROPOSED: "提出新交期",
  REJECTED: "拒绝采购单",
};

const SUPPLIER_UNIT_PRICE_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;

export function responseActionLabel(action: string) {
  return RESPONSE_ACTION_LABELS[action as SupplierPurchaseOrderResponseAction] || action;
}

export function isValidSupplierUnitPrice(value: string | null | undefined) {
  const text = value?.trim() || "";
  return SUPPLIER_UNIT_PRICE_PATTERN.test(text) && Number.isFinite(Number(text));
}

export function formatPrice(value: string | null | undefined, currency: string, fractionDigits = 2) {
  if (!value) return "-";
  const numeric = Number(value);
  const text = Number.isFinite(numeric)
    ? new Intl.NumberFormat("zh-CN", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(numeric)
    : value;
  return currency ? `${currency} ${text}` : text;
}

export function dateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

export function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(date);
}

export function responseSummary(order: SupplierPurchaseOrderDto) {
  if (order.status === "ACCEPTED") {
    return `已确认交期：${formatDate(order.confirmedSupplierDeliveryDate || order.supplierDeliveryDate)}`;
  }
  if (order.status === "DELIVERY_PROPOSED") {
    return `建议新交期：${formatDate(order.responseHistory.at(-1)?.deliveryDate)}`;
  }
  if (order.status === "REJECTED") return "已拒绝该采购单";
  return "等待回复";
}
