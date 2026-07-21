import type { OrderRow } from "./model";

type OrderLookupResponse = {
  order?: OrderRow;
  data?: OrderRow;
};

type OrderLookup = (path: string) => Promise<OrderLookupResponse>;

const REFRESHABLE_ORDER_CONFLICT_CODES = new Set([
  "ORDER_UPDATE_CONFLICT",
  "ORDER_CURRENCY_LOCKED_BY_PAYMENTS",
]);

function errorDetails(error: unknown) {
  if (!error || typeof error !== "object") return { status: 0, code: "", message: "" };
  const row = error as { status?: unknown; code?: unknown; message?: unknown };
  return {
    status: Number(row.status || 0),
    code: String(row.code || ""),
    message: String(row.message || ""),
  };
}

export function isRefreshableOrderConflict(error: unknown) {
  const { status, code, message } = errorDetails(error);
  if (status !== 409) return false;
  if (REFRESHABLE_ORDER_CONFLICT_CODES.has(code)) return true;
  return [
    "订单刚刚被其他操作更新",
    "订单已被其他人或收款操作更新",
    "订单已有待确认或已到账收款，不能修改币种",
  ].some((text) => message.includes(text));
}

export async function loadLatestOrderAfterConflict(
  error: unknown,
  orderId: string,
  lookup: OrderLookup,
) {
  if (!orderId || !isRefreshableOrderConflict(error)) return null;
  const result = await lookup(`/api/orders/${encodeURIComponent(orderId)}`);
  const order = result.order || result.data || null;
  if (!order?.id) throw new Error("服务器未返回最新订单数据");
  return order;
}
