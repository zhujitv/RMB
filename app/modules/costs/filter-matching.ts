import type { CostFilters, CostRow } from "./model";

function normalizedSearchText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function costDateMatchesSubmittedRange(cost: CostRow, filters: CostFilters) {
  if (!filters.dateFrom && !filters.dateTo) return true;
  const dates = [cost.createdAt, cost.updatedAt, cost.paymentDate]
    .map((value) => String(value || "").slice(0, 10))
    .filter(Boolean);
  if (!dates.length) return false;
  return dates.some((date) => {
    if (filters.dateFrom && date < filters.dateFrom) return false;
    if (filters.dateTo && date > filters.dateTo) return false;
    return true;
  });
}

function equivalentSubmittedCostTypes(costType = "") {
  if (costType === "拖车费") return ["拖车费", "国内物流费", "国内拖车费"];
  if (costType === "港杂费") return ["港杂费", "文件费", "订舱费"];
  return [costType];
}

export function costMatchesFilters(cost: CostRow, filters: CostFilters) {
  const keywordValue = normalizedSearchText(filters.keyword);
  if (keywordValue) {
    const haystack = [
      cost.orderNo,
      cost.blNo,
      cost.billOfLadingNo,
      cost.customerName,
      cost.customerFullName,
      cost.customerShortName,
      cost.supplierName,
      cost.supplierNameSnapshot,
      cost.vendorName,
      cost.supplierType,
      cost.costType,
      cost.remark,
    ].map(normalizedSearchText).join(" ");
    if (!haystack.includes(keywordValue)) return false;
  }
  if (filters.costType && !equivalentSubmittedCostTypes(filters.costType).includes(cost.costType || "")) return false;
  if (filters.paymentStatus && cost.paymentStatus !== filters.paymentStatus) return false;
  if (filters.invoiceStatus && cost.invoiceStatus !== filters.invoiceStatus) return false;
  if (filters.costConfirmed) {
    const confirmed = cost.costConfirmed === true ? "true" : "false";
    if (confirmed !== filters.costConfirmed) return false;
  }
  return costDateMatchesSubmittedRange(cost, filters);
}
