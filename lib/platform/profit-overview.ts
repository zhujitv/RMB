import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  assertRead,
  confirmedCost,
  customerFullName,
  customerShortName,
  getCommissionFormulaSettings,
  includeOrderRelationsWithCommissionSettlement,
  nonEmpty,
  normalizedCostType,
  pageParams,
  pageResult,
  summarizeOrder,
  summarizeOrderWithCommissionSnapshot,
} from "./shared";
import { businessEntityFieldsFromOrder } from "./business-entities";
import { logisticsCostTypeLabel } from "./logistics-cost-types";
import { orderAccessWhere, scopeOrderForActor } from "./order-access";
export { getAuditLogs } from "./audit-logs";
export { getOverview, getReminders } from "./business-overview";
export { overviewCollectionMetrics, overviewOrderMetrics } from "./business-overview-metrics";

type ActorLike = ({
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} & Record<string, unknown>) | null | undefined;
type QueryLike = URLSearchParams;
type CommissionFormulaSettings = Awaited<ReturnType<typeof getCommissionFormulaSettings>>;
type ProfitOrder = Prisma.ReceivableOrderGetPayload<{ include: ReturnType<typeof includeOrderRelationsWithCommissionSettlement> }>;
type ProfitCost = ProfitOrder["costs"][number];
type ProfitListFilters = {
  keyword: string;
  month: string;
  currency: string;
  orderStatus: string;
};

const PROFIT_ANALYSIS_UNPAGINATED_SCAN_LIMIT = 1000;

function assertProfitAnalysisAccess(actor: ActorLike) {
  assertRead(actor, "orders");
  assertRead(actor, "costs");
  assertRead(actor, "commissions");
}

export async function getProfitAnalysis(query: QueryLike, actor: ActorLike): Promise<ProfitAnalysisRow[]> {
  assertProfitAnalysisAccess(actor);
  const where = profitFilterWhere(profitListFiltersFromQuery(query), actor);
  const [orders, commissionFormulaSettings] = await Promise.all([
    prisma.receivableOrder.findMany({
      where,
      include: includeOrderRelationsWithCommissionSettlement(),
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: PROFIT_ANALYSIS_UNPAGINATED_SCAN_LIMIT,
    }),
    getCommissionFormulaSettings(),
  ]);
  return orders.map((order) => serializeProfitAnalysisOrder(order, actor, commissionFormulaSettings));
}

function profitKeywordWhere(keyword: string): Prisma.ReceivableOrderWhereInput {
  if (!keyword) return {};
  return {
    OR: [
      { orderNo: { contains: keyword, mode: "insensitive" } },
      { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
      { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
      { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
      { salesperson: { is: { name: { contains: keyword, mode: "insensitive" } } } },
    ],
  };
}

function profitListFiltersFromQuery(query: QueryLike): ProfitListFilters {
  const keyword = nonEmpty(query.get("keyword"));
  const month = nonEmpty(query.get("month"));
  const currency = nonEmpty(query.get("currency"));
  const orderStatus = nonEmpty(query.get("orderStatus"));
  return { keyword, month, currency, orderStatus };
}

function profitFilterWhere(filters: ProfitListFilters, actor: ActorLike): Prisma.ReceivableOrderWhereInput {
  const monthStart = filters.month && /^\d{4}-\d{2}$/.test(filters.month) ? new Date(`${filters.month}-01T00:00:00.000Z`) : null;
  const monthEnd = monthStart ? new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)) : null;
  const clauses: Prisma.ReceivableOrderWhereInput[] = [
    orderAccessWhere(actor),
    profitKeywordWhere(filters.keyword),
    ...(filters.currency ? [{ currency: filters.currency }] : []),
    ...(filters.orderStatus ? [{ status: filters.orderStatus }] : []),
    ...(monthStart && monthEnd ? [{ createdAt: { gte: monthStart, lt: monthEnd } }] : []),
  ].filter((item) => Object.keys(item).length);
  return {
    deletedAt: null,
    ...(clauses.length ? { AND: clauses } : {}),
  };
}

export function serializeProfitAnalysisSummary(
  summary: ReturnType<typeof summarizeOrder> | ReturnType<typeof summarizeOrderWithCommissionSnapshot>,
  costGroups: Record<string, number> = {},
) {
  return {
    receivableCny: summary.receivableCny,
    arrivedPaymentsCny: summary.arrivedPaymentsCny,
    outstandingCny: summary.outstandingCny,
    confirmedTotalCostCny: summary.confirmedTotalCostCny,
    totalCostCny: summary.totalCostCny,
    logisticsCostCny: summary.logisticsCostCny,
    expectedTaxRefundIncomeCny: summary.expectedTaxRefundIncomeCny,
    commissionBaseCny: summary.commissionBaseCny,
    commissionFormulaMode: summary.commissionFormulaMode,
    commissionFormulaLabel: summary.commissionFormulaLabel,
    commissionFormulaDescription: summary.commissionFormulaDescription,
    commissionFormulaFloorAtZero: summary.commissionFormulaFloorAtZero,
    commissionFormulaVersion: "commissionFormulaVersion" in summary
      ? String(summary.commissionFormulaVersion || "")
      : "",
    commissionSnapshotMissing: "commissionSnapshotMissing" in summary
      ? Boolean(summary.commissionSnapshotMissing)
      : false,
    currentCommissionEstimate: "currentCommissionEstimate" in summary
      ? summary.currentCommissionEstimate
      : undefined,
    taxLogisticsCostsComplete: summary.taxLogisticsCostsComplete,
    taxLogisticsMissingLabels: summary.taxLogisticsMissingLabels,
    expectedGrossProfit: summary.expectedGrossProfit,
    profitMarginEligible: summary.profitMarginEligible,
    expectedGrossMargin: summary.expectedGrossMargin,
    realizedGrossProfit: summary.realizedGrossProfit,
    realizedGrossMargin: summary.realizedGrossMargin,
    netCashFlowCny: summary.netCashFlowCny,
    exchangeDifferenceCny: summary.exchangeDifferenceCny,
    commissionAmountCny: summary.commissionAmountCny,
    estimatedCommissionCny: summary.estimatedCommissionCny,
    commissionRate: summary.commissionRate,
    commissionCanSettle: summary.commissionCanSettle,
    commissionStatus: summary.commissionStatus,
    costGroups,
  };
}

function serializeProfitAnalysisOrder(order: ProfitOrder, actor: ActorLike, commissionFormulaSettings: CommissionFormulaSettings) {
  const scoped = scopeOrderForActor(order, actor);
  const summary = summarizeOrderWithCommissionSnapshot(scoped, commissionFormulaSettings);
  const fullCustomerName = customerFullName(scoped.customer, scoped.customerNameSnapshot);
  const shortCustomerName = customerShortName(scoped.customer);
  const costGroups = (scoped.costs || [])
    .filter(confirmedCost)
    .reduce<Record<string, number>>((acc, cost: ProfitCost) => {
      const label = logisticsCostTypeLabel(normalizedCostType(cost.costType));
      acc[label] = (acc[label] || 0) + Number(cost.amountCny || 0);
      return acc;
    }, {});
  return {
    id: scoped.id,
    orderNo: scoped.orderNo,
    blNo: scoped.blNo || "",
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    customerShortName: shortCustomerName,
    ...businessEntityFieldsFromOrder(scoped),
    currency: scoped.currency,
    status: scoped.status,
    salespersonName: scoped.salesperson?.name || "",
    commissionStatus: summary.commissionStatus,
    commissionSettledByName: scoped.commissionSettledBy?.name || "",
    commissionSettledAt: scoped.commissionSettledAt || null,
    summary: serializeProfitAnalysisSummary(summary, costGroups),
  };
}

export type ProfitAnalysisRow = ReturnType<typeof serializeProfitAnalysisOrder>;

export async function listProfitAnalysisPage(query: QueryLike, actor: ActorLike) {
  assertProfitAnalysisAccess(actor);
  const { page, pageSize } = pageParams(query, 20, 100);
  const where = profitFilterWhere(profitListFiltersFromQuery(query), actor);
  const [total, orders, commissionFormulaSettings] = await Promise.all([
    prisma.receivableOrder.count({ where }),
    prisma.receivableOrder.findMany({
      where,
      include: includeOrderRelationsWithCommissionSettlement(),
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    getCommissionFormulaSettings(),
  ]);
  const rows = orders.map((order) => serializeProfitAnalysisOrder(order, actor, commissionFormulaSettings));
  return pageResult(rows, total, page, pageSize);
}
