import { summarizeCurrencyTotals } from "./currency-totals";
import { isLogisticsGeneratedCostSourceType, nonEmpty, type CostDto } from "./shared";
import type { CostInvoiceGroupCostDto, CostWithInvoiceGroupRelations } from "./cost-records-query-shared";

function logisticsBillIdForCost(cost: CostWithInvoiceGroupRelations | null | undefined) {
  return nonEmpty(cost?.generatedLogisticsExpense?.billId || cost?.generatedLogisticsExpense?.bill?.id);
}

export function costInvoiceGroupKey(cost: CostWithInvoiceGroupRelations) {
  const billId = logisticsBillIdForCost(cost);
  if (isLogisticsGeneratedCostSourceType(cost.sourceType) && billId) return `logistics-bill:${billId}`;
  if (isLogisticsGeneratedCostSourceType(cost.sourceType)) {
    return ["logistics-fallback", cost.orderId || "", cost.supplierId || "", cost.order?.blNo || "", cost.currency || "CNY"].join(":");
  }
  return `cost:${cost.id}`;
}

function groupPaymentStatus(costs: CostDto[] = []) {
  const statuses = costs.map((cost) => cost.paymentStatus || "待支付");
  if (statuses.length && statuses.every((status) => status === "已支付")) return "已支付";
  if (statuses.some((status) => status === "已支付" || status === "部分支付")) return "部分支付";
  if (statuses.length && statuses.every((status) => status === "已取消")) return "已取消";
  return statuses[0] || "待支付";
}

function groupInvoiceStatus(costs: CostDto[] = []) {
  const statuses = costs.map((cost) => cost.invoiceStatus || "未收到");
  if (statuses.length && statuses.every((status) => status === "已收到")) return "已收到";
  if (statuses.some((status) => status === "已收到")) return "部分收到";
  return "未收到";
}

function hasOverdueMissingInvoice(costs: CostDto[] = []) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return costs.some((cost) => {
    const row = cost as CostDto & Record<string, unknown>;
    const raw = row.costConfirmedAt || row.paymentDate || row.updatedAt || row.createdAt;
    const time = new Date(String(raw || "")).getTime();
    return Number.isFinite(time) && time > 0 && time < cutoff;
  });
}

function invoiceExceptionType(costs: CostDto[] = [], paymentStatus = "", invoiceStatus = "") {
  if (invoiceStatus !== "未收到") return "";
  if (paymentStatus === "已支付") return "PAID_WITHOUT_INVOICE";
  if (costs.some((cost) => cost.costConfirmed)) return "CONFIRMED_WITHOUT_INVOICE";
  return hasOverdueMissingInvoice(costs) ? "OVERDUE_WITHOUT_INVOICE" : "";
}

function invoiceExceptionLabel(type: string) {
  if (type === "PAID_WITHOUT_INVOICE") return "已付款未收票";
  if (type === "CONFIRMED_WITHOUT_INVOICE") return "已确认未收票";
  if (type === "OVERDUE_WITHOUT_INVOICE") return "超期未收票";
  return "";
}

export function uniqueTextList(values: Array<string | null | undefined>) {
  return values.map(nonEmpty).filter((value, index, rows) => value && rows.indexOf(value) === index);
}

function groupInvoiceFiles(costs: CostDto[] = []) {
  const documents = costs.flatMap((cost) => cost.documents || [])
    .filter((document) => document.documentType === "SUPPLIER_INVOICE" && document.uploadStatus === "SUCCESS");
  const seen = new Set<string>();
  return documents.filter((document) => {
    const key = document.id || document.fileName || "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function serializeCostInvoiceGroup(key: string, costs: CostDto[], rawRows: CostWithInvoiceGroupRelations[] = []) {
  const groupCosts = costs as CostInvoiceGroupCostDto[];
  const first = groupCosts[0] || {};
  const invoiceFiles = groupInvoiceFiles(groupCosts);
  const paymentStatus = groupPaymentStatus(groupCosts);
  const invoiceStatus = groupInvoiceStatus(groupCosts);
  const exceptionType = invoiceExceptionType(groupCosts, paymentStatus, invoiceStatus);
  const groupType = uniqueTextList(groupCosts.map((cost) => cost.sourceType)).some(isLogisticsGeneratedCostSourceType) ? "LOGISTICS_BILL" : "COST";
  const costTypeLabels = uniqueTextList(groupCosts.map((cost) => cost.costType));
  const latestCreatedAt = groupCosts.map((cost) => new Date(cost.createdAt || cost.updatedAt || 0).getTime())
    .filter(Number.isFinite).sort((a, b) => b - a)[0] || 0;
  const latestUpdatedAt = groupCosts.map((cost) => new Date(cost.updatedAt || cost.createdAt || 0).getTime())
    .filter(Number.isFinite).sort((a, b) => b - a)[0] || 0;
  return {
    id: key, groupKey: key, groupType, logisticsBillId: logisticsBillIdForCost(rawRows[0]),
    orderId: first.orderId || "", orderNo: first.orderNo || "", blNo: first.blNo || first.billOfLadingNo || "",
    billOfLadingNo: first.billOfLadingNo || first.blNo || "", customerName: first.customerName || "",
    customerFullName: first.customerFullName || "", customerShortName: first.customerShortName || "",
    businessEntityId: first.businessEntityId || "", businessEntityName: first.businessEntityName || "",
    businessEntityShortName: first.businessEntityShortName || "", businessEntityDisplayName: first.businessEntityDisplayName || "",
    businessEntityNameSnapshot: first.businessEntityNameSnapshot || "", businessEntityIsDefault: first.businessEntityIsDefault !== false,
    businessEntity: first.businessEntity || null, supplierId: first.supplierId || "",
    supplierName: first.supplierName || first.supplierNameSnapshot || first.vendorName || "",
    supplierNameSnapshot: first.supplierNameSnapshot || first.supplierName || first.vendorName || "",
    vendorName: first.vendorName || first.supplierNameSnapshot || first.supplierName || "",
    invoiceNo: uniqueTextList(invoiceFiles.map((document) => document.fileName)).join(" / "), costTypes: costTypeLabels,
    costTypeSummary: costTypeLabels.join(" / "), currencyTotals: summarizeCurrencyTotals(groupCosts), paymentStatus, invoiceStatus,
    invoiceExceptionType: exceptionType, invoiceExceptionLabel: invoiceExceptionLabel(exceptionType), costCount: groupCosts.length,
    costs: groupCosts, documents: invoiceFiles,
    createdAt: latestCreatedAt ? new Date(latestCreatedAt).toISOString() : first.createdAt || first.updatedAt || "",
    updatedAt: latestUpdatedAt ? new Date(latestUpdatedAt).toISOString() : first.updatedAt || first.createdAt || "", sourceType: groupType,
  };
}
