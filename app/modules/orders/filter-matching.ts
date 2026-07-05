import type { OrderRow } from "./model";

function normalizedSearchText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function orderMatchesFilters(
  order: OrderRow,
  filters: {
    keyword: string;
    orderStatus: string;
    businessEntityId: string;
  },
) {
  const keywordValue = normalizedSearchText(filters.keyword);
  if (keywordValue) {
    const haystack = [
      order.orderNo,
      order.blNo,
      order.billOfLadingNo,
      order.customerName,
      order.customerFullName,
      order.customerShortName,
      order.salespersonName,
      order.remark,
    ].map(normalizedSearchText).join(" ");
    if (!haystack.includes(keywordValue)) return false;
  }
  if (filters.orderStatus && order.status !== filters.orderStatus) return false;
  if (filters.businessEntityId && order.businessEntityId !== filters.businessEntityId) return false;
  return true;
}
