import { Prisma } from "../generated/prisma/client.js";
import { businessEntityFieldsFromOrder } from "./business-entities";
import { normalizeCurrencyCode, summarizeCurrencyTotals } from "./currency-totals";
import {
  FACTORY_SUPPLIER_COST_TYPES,
  LOGISTICS_COST_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES,
  customerFullName,
  customerShortName,
  isLogisticsCostType,
  isOrderCostExcludedByTradeTerm,
  isTaxRefundFactoryCost,
  isTaxRefundLogisticsInvoiceCost,
  normalizedCostType,
  safeSerializeCost,
  successDocument,
  supplierTypeForCost,
  validCost,
} from "./shared";

export { createCostIdempotently, duplicateCostFingerprint, includeCostRelations } from "./cost-records-idempotency";

type CostDocumentLike = {
  documentType?: string | null;
  uploadStatus?: string | null;
  deletedAt?: Date | string | null;
};
type NumericLike = number | string | { toString(): string };
type SupplierLike = {
  supplierName?: string | null;
  supplierType?: string | null;
};
type CostLike = {
  orderId?: string | null;
  supplierId?: string | null;
  supplier?: SupplierLike | null;
  supplierNameSnapshot?: string | null;
  costType?: string | null;
  currency?: string | null;
  amount?: NumericLike | null;
  amountCny?: NumericLike | null;
  paymentStatus?: string | null;
  costConfirmed?: boolean | null;
  status?: string | null;
  documents?: CostDocumentLike[] | null;
  createdById?: string | null;
  deletedAt?: Date | string | null;
};
type CostSummaryOrderLike = {
  id: string;
  orderNo: string;
  blNo?: string | null;
  customerId: string;
  customer?: unknown;
  customerNameSnapshot?: string | null;
  businessEntityId?: string | null;
  businessEntityNameSnapshot?: string | null;
  businessEntity?: unknown;
  receivableAmountCny?: NumericLike | null;
  finalReceivableAmountCny?: NumericLike | null;
  tradeTerm?: string | null;
  costs?: CostLike[] | null;
};
type CostQuery = {
  get(key: string): string | null;
};
type CostBreakdownKey = "factory" | "logistics" | "other";

const FACTORY_SUMMARY_COST_TYPES = [...FACTORY_SUPPLIER_COST_TYPES, "样品费"];
const LOGISTICS_SUMMARY_COST_TYPES = [
  ...LOGISTICS_COST_TYPES,
  ...TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES,
  "国内物流费",
  "国内拖车费",
].filter((item, index, rows) => rows.indexOf(item) === index);

export function costPageParams(query: CostQuery) {
  const page = Math.max(1, Number.parseInt(query.get("page") || "1", 10) || 1);
  const requestedPageSize = Number.parseInt(query.get("pageSize") || "20", 10) || 20;
  const allowedPageSizes = [20, 50, 100];
  const pageSize = allowedPageSizes.includes(requestedPageSize) ? requestedPageSize : 20;
  return { page, pageSize };
}

export function archiveScope(query: CostQuery | null | undefined) {
  const scope = query ? String(query.get("archiveScope") || query.get("businessScope") || query.get("taxArchiveScope") || "").trim() : "";
  return ["current", "archive", "all"].includes(scope) ? scope : "current";
}

export function orderArchiveWhereForScope(scope = "current"): Prisma.ReceivableOrderWhereInput {
  if (scope === "archive") return { OR: [{ taxArchived: true }, { taxRefundStatus: "SUBMITTED" }] };
  if (scope === "all") return {};
  return { taxArchived: false };
}

export function costSummaryCategory(costType = ""): CostBreakdownKey {
  const normalized = normalizedCostType(costType);
  if (FACTORY_SUMMARY_COST_TYPES.includes(normalized)) return "factory";
  if (LOGISTICS_SUMMARY_COST_TYPES.includes(normalized) || isLogisticsCostType(normalized)) return "logistics";
  return "other";
}

function isFactorySummaryCostType(costType = "") {
  return FACTORY_SUMMARY_COST_TYPES.includes(normalizedCostType(costType));
}

function hasInvalidFactoryCurrency(cost: CostLike) {
  return isFactorySummaryCostType(String(cost.costType || "")) && normalizeCurrencyCode(cost.currency) !== "CNY";
}

function warnInvalidFactoryCurrency(cost: CostLike) {
  console.warn("cost-summary-invalid-factory-currency", {
    orderId: cost.orderId || undefined,
    supplierId: cost.supplierId || undefined,
    costType: normalizedCostType(String(cost.costType || "")),
    currency: normalizeCurrencyCode(cost.currency),
  });
}

function summaryDisplayCosts(costs: CostLike[] = []) {
  const rows = costs.filter(validCost);
  rows.filter(hasInvalidFactoryCurrency).forEach(warnInvalidFactoryCurrency);
  return rows.filter((cost) => !hasInvalidFactoryCurrency(cost));
}

function costAmountBuckets(costs: CostLike[] = []) {
  const rows = costs.filter(validCost);
  const categorized = rows.reduce<Record<CostBreakdownKey, CostLike[]>>((acc, cost) => {
    acc[costSummaryCategory(String(cost.costType || ""))].push(cost);
    return acc;
  }, { factory: [], logistics: [], other: [] });
  const factoryTotals = summarizeCurrencyTotals(categorized.factory);
  const logisticsTotals = summarizeCurrencyTotals(categorized.logistics);
  const otherTotals = summarizeCurrencyTotals(categorized.other);
  const totalCostCny = Number((factoryTotals.totalCny + logisticsTotals.totalCny + otherTotals.totalCny).toFixed(2));
  const portCostCny = rows
    .filter((cost) => normalizedCostType(String(cost.costType || "")) === "港杂费" || supplierTypeForCost(cost) === "港杂费用供应商")
    .reduce((sum, cost) => sum + Number(cost.amountCny || 0), 0);
  return {
    totalCostCny,
    factoryCostCny: factoryTotals.totalCny,
    logisticsCostCny: logisticsTotals.totalCny,
    portCostCny,
    otherCostCny: otherTotals.totalCny,
    costBreakdown: {
      factory: factoryTotals,
      logistics: logisticsTotals,
      other: otherTotals,
    },
  };
}

function costDocumentProgress(costs: CostLike[] = []) {
  const progress = costs.filter(validCost).reduce((acc, cost) => {
    const successDocs = (cost.documents || []).filter(successDocument);
    if (isTaxRefundFactoryCost(cost)) {
      SUPPLIER_DOCUMENT_TYPES.forEach((type) => {
        acc.total += 1;
        if (successDocs.some((doc) => doc.documentType === type)) acc.completed += 1;
      });
    } else if (isTaxRefundLogisticsInvoiceCost(cost)) {
      acc.total += 1;
      if (successDocs.some((doc) => doc.documentType === "SUPPLIER_INVOICE")) acc.completed += 1;
    }
    return acc;
  }, { completed: 0, total: 0 });
  return {
    ...progress,
    text: progress.total ? `${progress.completed}/${progress.total}` : "无需资料",
  };
}

function costConfirmedProgress(costs: CostLike[] = []) {
  const rows = costs.filter(validCost);
  const completed = rows.filter((cost) => cost.costConfirmed).length;
  return {
    completed,
    total: rows.length,
    text: rows.length ? `${completed}/${rows.length}` : "无成本",
  };
}

export function serializeCostOrderSummary(order: CostSummaryOrderLike) {
  const costs = order.costs || [];
  const summaryCosts = summaryDisplayCosts(costs);
  const participatingCosts = summaryCosts.filter((cost) => !isOrderCostExcludedByTradeTerm(order.tradeTerm, cost.costType));
  const excludedFobSeaFreightCostCny = summaryCosts
    .filter((cost) => isOrderCostExcludedByTradeTerm(order.tradeTerm, cost.costType))
    .reduce((sum, cost) => sum + Number(cost.amountCny || 0), 0);
  const buckets = costAmountBuckets(participatingCosts);
  const currencyTotals = summarizeCurrencyTotals(participatingCosts);
  const fullCustomerName = customerFullName(order.customer, order.customerNameSnapshot || "");
  const shortCustomerName = customerShortName(order.customer);
  return {
    id: order.id,
    orderId: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerId: order.customerId,
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    customerShortName: shortCustomerName,
    ...businessEntityFieldsFromOrder(order),
    receivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny ?? 0),
    tradeTerm: order.tradeTerm || "",
    excludedFobSeaFreightCostCny,
    costConfirmProgress: costConfirmedProgress(participatingCosts),
    documentProgress: costDocumentProgress(summaryCosts),
    costCount: summaryCosts.length,
    currencyTotals,
    costs: summaryCosts.map((cost) => ({
      ...safeSerializeCost(cost),
      excludedFromOrderCost: isOrderCostExcludedByTradeTerm(order.tradeTerm, cost.costType),
    })),
    ...buckets,
  };
}

export function serializeCosts(rows: unknown[] = []) {
  return rows.map(safeSerializeCost);
}
