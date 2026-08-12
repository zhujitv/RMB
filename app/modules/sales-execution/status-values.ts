import type { FactoryPurchaseOrder } from "./types";

export type SalesExecutionStatusTone = "muted" | "warning" | "success" | "danger";

export function salesExecutionStatusLabel(status: unknown, shippingStarted = false, linkedOrderStatus?: unknown) {
  if (shippingStarted && String(linkedOrderStatus || "") === "已取消") return "关联订单已取消";
  if (shippingStarted) return "已进入发货";
  switch (String(status || "DRAFT")) {
    case "DISPATCHED": return "已下发";
    case "VOIDED": return "已作废";
    default: return "草稿";
  }
}

export function factoryPurchaseOrderStatusLabel(status: unknown) {
  switch (String(status || "DRAFT")) {
    case "DISPATCHED": return "待工厂确认";
    case "ACCEPTED": return "已接受";
    case "DELIVERY_PROPOSED": return "建议新交期";
    case "REJECTED": return "已拒绝";
    case "VOIDED": return "已作废";
    default: return "草稿";
  }
}

export function factoryProductionStatusLabel(status: unknown) {
  switch (String(status || "WAITING_SUPPLIER")) {
    case "WAITING_PREPAYMENT": return "待预付款";
    case "READY": return "可开始生产";
    case "IN_PRODUCTION": return "生产中";
    case "COMPLETED": return "生产完成";
    default: return "待工厂确认";
  }
}

export function statusTone(status: unknown, shippingStarted = false, linkedOrderStatus?: unknown): SalesExecutionStatusTone {
  if (shippingStarted && String(linkedOrderStatus || "") === "已取消") return "danger";
  if (shippingStarted) return "success";
  switch (String(status || "DRAFT")) {
    case "ACCEPTED": return "success";
    case "DISPATCHED":
    case "DELIVERY_PROPOSED": return "warning";
    case "REJECTED": return "danger";
    default: return "muted";
  }
}

export function supplierResponseSummary(orders: FactoryPurchaseOrder[]) {
  const active = orders.filter((order) => String(order.status) !== "VOIDED");
  const accepted = active.filter((order) => order.status === "ACCEPTED").length;
  const deliveryProposed = active.filter((order) => order.status === "DELIVERY_PROPOSED").length;
  const rejected = active.filter((order) => order.status === "REJECTED").length;
  const pending = active.filter((order) => order.status === "DISPATCHED").length;
  if (!active.length) return "尚未生成";
  if (active.every((order) => order.status === "DRAFT")) return "尚未下发";
  return `已接受 ${accepted} · 待确认 ${pending} · 新交期 ${deliveryProposed} · 拒绝 ${rejected}`;
}
