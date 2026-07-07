import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { attachBusinessDocumentsToCost } from "./business-documents";
import { businessEntityFieldsFromOrder } from "./business-entities";
import { logisticsCostSourceSelect } from "./cost-records-logistics-source";
import { normalizeCurrencyCode, summarizeCurrencyTotals } from "./currency-totals";
import {
  COST_DUPLICATE_GUARD_LOOKBACK_MS,
  COST_IDEMPOTENCY_WINDOW_MS,
  FACTORY_SUPPLIER_COST_TYPES,
  LOGISTICS_COST_TYPES,
  ORDER_COST_STATUS_VOID,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES,
  customerFullName,
  customerShortName,
  isPlainRecord,
  isLogisticsCostType,
  isTaxRefundFactoryCost,
  isTaxRefundLogisticsInvoiceCost,
  normalizedCostType,
  safeSerializeCost,
  successDocument,
  supplierTypeForCost,
  validCost,
} from "./shared";

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
  costs?: CostLike[] | null;
};
type DuplicateCostOptions = {
  sameCreator?: boolean;
};
type CostQuery = {
  get(key: string): string | null;
};
type CostCreateData = Prisma.OrderCostUncheckedCreateInput;
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
  const buckets = costAmountBuckets(summaryCosts);
  const currencyTotals = summarizeCurrencyTotals(summaryCosts);
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
    costConfirmProgress: costConfirmedProgress(summaryCosts),
    documentProgress: costDocumentProgress(summaryCosts),
    costCount: summaryCosts.length,
    currencyTotals,
    costs: summaryCosts.map(safeSerializeCost),
    ...buckets,
  };
}

export function includeCostRelations() {
  return Prisma.validator<Prisma.OrderCostInclude>()({
    order: {
      include: {
        customer: true,
        businessEntity: true,
        salesperson: true,
        commissionSettlementRecords: { select: { id: true }, take: 1 },
      },
    },
    supplier: true,
    createdBy: true,
    updatedBy: true,
    generatedLogisticsExpense: { select: logisticsCostSourceSelect() },
    supplierDocumentRequests: {
      where: { deletedAt: null },
      select: { id: true, deletedAt: true },
      take: 1,
    },
    documents: {
      where: { deletedAt: null },
      include: { uploadedBy: true, supplier: true },
      orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    },
  });
}

type CostWithRelations = Prisma.OrderCostGetPayload<{ include: ReturnType<typeof includeCostRelations> }>;
type CostRecordClient = {
  orderCost: Pick<typeof prisma.orderCost, "create" | "findFirst">;
};
type CreateCostIdempotentlyOptions = {
  attachDocuments?: boolean;
  createdBefore?: Date;
};

function duplicateDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function duplicateNumber(value: unknown) {
  return Number(value || 0);
}

function duplicateText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function duplicateCreatedAtWindow(windowMs: number, createdBefore?: Date): Prisma.DateTimeFilter<"OrderCost"> {
  return {
    gte: new Date(Date.now() - windowMs),
    ...(createdBefore ? { lt: createdBefore } : {}),
  };
}

function duplicateCostWhere(data: CostCreateData, windowMs: number, { sameCreator = false }: DuplicateCostOptions = {}, createdBefore?: Date): Prisma.OrderCostWhereInput {
  return {
    deletedAt: null,
    status: { not: ORDER_COST_STATUS_VOID },
    orderId: data.orderId,
    supplierId: data.supplierId || null,
    costType: data.costType,
    amount: data.amount,
    currency: duplicateText(data.currency, "CNY") || "CNY",
    exchangeRate: data.exchangeRate,
    paymentDate: duplicateDate(data.paymentDate),
    sourceType: duplicateText(data.sourceType, "MANUAL") || "MANUAL",
    sourceId: data.sourceId || null,
    remark: data.remark || null,
    createdAt: duplicateCreatedAtWindow(windowMs, createdBefore),
    ...(sameCreator ? { createdById: data.createdById || null } : {}),
  };
}

export function duplicateCostFingerprint(data: Pick<CostCreateData, "orderId" | "supplierId" | "costType" | "amount" | "currency" | "exchangeRate" | "paymentDate" | "sourceType" | "sourceId" | "remark">) {
  return [
    data.orderId || "",
    data.supplierId || "",
    data.costType || "",
    duplicateText(data.currency, "CNY") || "CNY",
    duplicateNumber(data.amount).toFixed(2),
    duplicateNumber(data.exchangeRate).toFixed(6),
    duplicateDate(data.paymentDate)?.toISOString().slice(0, 10) || "",
    duplicateText(data.sourceType, "MANUAL") || "MANUAL",
    data.sourceId || "",
    data.remark || "",
  ].join("|");
}

async function findDuplicateCost(client: CostRecordClient, data: CostCreateData, windowMs: number, options: DuplicateCostOptions = {}, createdBefore?: Date) {
  return client.orderCost.findFirst({
    where: duplicateCostWhere(data, windowMs, options, createdBefore),
    include: includeCostRelations(),
    orderBy: [{ createdAt: "desc" }],
  });
}

function isUniqueConstraintError(error: unknown) {
  return isPlainRecord(error) && error.code === "P2002";
}

async function maybeAttachBusinessDocuments(cost: CostWithRelations, attachDocuments: boolean) {
  return attachDocuments ? await attachBusinessDocumentsToCost(cost) as CostWithRelations : cost;
}

export async function createCostIdempotently(data: CostCreateData, client: CostRecordClient = prisma, options: CreateCostIdempotentlyOptions = {}): Promise<{ cost: CostWithRelations; reused: boolean }> {
  const attachDocuments = options.attachDocuments !== false;
  const recentDuplicate = await findDuplicateCost(client, data, COST_IDEMPOTENCY_WINDOW_MS, {}, options.createdBefore);
  if (recentDuplicate) return { cost: await maybeAttachBusinessDocuments(recentDuplicate, attachDocuments), reused: true };
  try {
    const cost = await client.orderCost.create({ data, include: includeCostRelations() });
    return { cost: await maybeAttachBusinessDocuments(cost, attachDocuments), reused: false };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const guardedDuplicate = await findDuplicateCost(client, data, COST_DUPLICATE_GUARD_LOOKBACK_MS, { sameCreator: true }, options.createdBefore)
      || await findDuplicateCost(client, data, COST_DUPLICATE_GUARD_LOOKBACK_MS, {}, options.createdBefore);
    if (guardedDuplicate) return { cost: await maybeAttachBusinessDocuments(guardedDuplicate, attachDocuments), reused: true };
    throw error;
  }
}

export function serializeCosts(rows: unknown[] = []) {
  return rows.map(safeSerializeCost);
}
