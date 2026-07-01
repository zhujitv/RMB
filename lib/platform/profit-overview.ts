import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  assertRead,
  canRead,
  confirmedCost,
  customerFullName,
  customerShortName,
  getCommissionFormulaSettings,
  includeOrderRelations,
  isPlainRecord,
  nonEmpty,
  normalizedCostType,
  pageParams,
  pageResult,
  requireAdminGlobal,
  summarizeOrder,
  type CostDto,
} from "./shared";
import { listCosts } from "./cost-records";
import { listOrders, type OrderListRow } from "./orders-module";
import { listPayments, type PaymentListRow } from "./payments-module";
import { logisticsCostTypeLabel } from "./logistics-cost-types";
import { orderAccessWhere, scopeOrderForActor } from "./order-access";
export { getAuditLogs } from "./audit-logs";

type AmountGroup = {
  label: string;
  amount: number;
  count: number;
};

type ActorLike = ({
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} & Record<string, unknown>) | null | undefined;
type QueryLike = URLSearchParams;
type CommissionFormulaSettings = Awaited<ReturnType<typeof getCommissionFormulaSettings>>;
type ProfitOrder = Prisma.ReceivableOrderGetPayload<{ include: ReturnType<typeof includeOrderRelations> }>;
type ProfitCost = ProfitOrder["costs"][number];
type CostListRow = CostDto;
type ProfitListFilters = {
  keyword: string;
  month: string;
  currency: string;
  orderStatus: string;
};

type OverviewMetric = ReturnType<typeof overviewOrderMetrics>;
const PROFIT_ANALYSIS_UNPAGINATED_SCAN_LIMIT = 1000;

type OverviewGroup = {
  label: string;
  count: number;
  receivable: number;
  paid: number;
  unpaid: number;
  expectedProfit: number;
  commissionMonth: number;
  commissionYear: number;
  commissionPending: number;
  commissionSettled: number;
};

function numericField(row: unknown, field: string) {
  const value = isPlainRecord(row) ? row[field] : 0;
  return Number(value || 0);
}

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
      include: includeOrderRelations(),
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

function serializeProfitAnalysisOrder(order: ProfitOrder, actor: ActorLike, commissionFormulaSettings: CommissionFormulaSettings) {
  const scoped = scopeOrderForActor(order, actor);
  const summary = summarizeOrder(scoped, commissionFormulaSettings);
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
    currency: scoped.currency,
    status: scoped.status,
    salespersonName: scoped.salesperson?.name || "",
    commissionStatus: summary.commissionStatus,
    commissionSettledByName: scoped.commissionSettledBy?.name || "",
    commissionSettledAt: scoped.commissionSettledAt || null,
    summary: {
      receivableCny: summary.receivableCny,
      arrivedPaymentsCny: summary.arrivedPaymentsCny,
      confirmedTotalCostCny: summary.confirmedTotalCostCny,
      totalCostCny: summary.totalCostCny,
      logisticsCostCny: summary.logisticsCostCny,
      commissionBaseCny: summary.commissionBaseCny,
      commissionFormulaMode: summary.commissionFormulaMode,
      commissionFormulaLabel: summary.commissionFormulaLabel,
      commissionFormulaDescription: summary.commissionFormulaDescription,
      taxLogisticsCostsComplete: summary.taxLogisticsCostsComplete,
      taxLogisticsMissingLabels: summary.taxLogisticsMissingLabels,
      expectedGrossProfit: summary.expectedGrossProfit,
      expectedGrossMargin: summary.expectedGrossMargin,
      realizedGrossProfit: summary.realizedGrossProfit,
      realizedGrossMargin: summary.realizedGrossMargin,
      netCashFlowCny: summary.netCashFlowCny,
      commissionAmountCny: summary.commissionAmountCny,
      estimatedCommissionCny: summary.estimatedCommissionCny,
      commissionRate: summary.commissionRate,
      commissionCanSettle: summary.commissionCanSettle,
      commissionStatus: summary.commissionStatus,
      costGroups,
    },
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
      include: includeOrderRelations(),
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    getCommissionFormulaSettings(),
  ]);
  const rows = orders.map((order) => serializeProfitAnalysisOrder(order, actor, commissionFormulaSettings));
  return pageResult(rows, total, page, pageSize);
}

export async function getReminders(query: QueryLike, actor: ActorLike) {
  const orders = await listOrders(query, actor);
  return orders
    .filter((order) => !order.taxArchived && order.taxRefundStatus !== "SUBMITTED")
    .filter((order) => ["即将到期", "已逾期"].includes(order.summary.reminderStatus))
    .sort((a, b) => {
      if (b.summary.overdueDays !== a.summary.overdueDays) return b.summary.overdueDays - a.summary.overdueDays;
      return String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31"));
    });
}

export async function getOverview(query: QueryLike, actor: ActorLike) {
  requireAdminGlobal(actor, "无权限访问经营总览");
  const trendQuery = new URLSearchParams(query);
  trendQuery.delete("month");
  const [orders, trendOrders, payments, costs] = await Promise.all([
    canRead(actor, "orders") ? listOrders(query, actor) : [],
    canRead(actor, "orders") ? listOrders(trendQuery, actor) : [],
    canRead(actor, "payments") ? listPayments(query, actor) : [],
    canRead(actor, "costs") ? listCosts(query, actor) : [],
  ]) as [OrderListRow[], OrderListRow[], PaymentListRow[], CostListRow[]];
  const total = orders.reduce((acc, order) => {
    acc.receivable += order.summary.receivableCny;
    acc.confirmed += order.summary.confirmedPaymentsCny;
    acc.pending += order.summary.pendingPaymentsCny;
    acc.outstanding += order.summary.outstandingCny;
    acc.requiredDepositAmount += order.summary.requiredDepositAmount;
    acc.receivedDeposit += order.summary.receivedDepositCny;
    acc.depositGap += order.summary.depositGapCny;
    acc.cost += order.summary.totalCostCny;
    acc.confirmedCost += order.summary.confirmedTotalCostCny;
    acc.paidConfirmedCost += order.summary.paidConfirmedCostCny;
    acc.expectedProfit += order.summary.expectedGrossProfit;
    acc.netCashFlow += order.summary.netCashFlowCny;
    if (order.summary.realizedGrossProfit != null) {
      acc.realizedProfit += order.summary.realizedGrossProfit;
      acc.realizedReceivable += order.summary.receivableCny;
    }
    acc.commissionAmount += Number(order.summary?.commissionAmountCny ?? order.summary?.estimatedCommissionCny ?? 0);
    if (order.summary.reminderStatus === "已逾期") acc.overdueOrders += 1;
    if (order.summary.reminderStatus === "即将到期") acc.dueSoonOrders += 1;
    return acc;
  }, {
    receivable: 0,
    confirmed: 0,
    pending: 0,
    outstanding: 0,
    requiredDepositAmount: 0,
    receivedDeposit: 0,
    depositGap: 0,
    cost: 0,
    confirmedCost: 0,
    paidConfirmedCost: 0,
    expectedProfit: 0,
    realizedProfit: 0,
    realizedReceivable: 0,
    netCashFlow: 0,
    commissionAmount: 0,
    overdueOrders: 0,
    dueSoonOrders: 0,
    expectedGrossMargin: null as number | null,
    realizedGrossMargin: null as number | null,
    grossMargin: null as number | null,
  });
  total.expectedGrossMargin = total.receivable > 0 ? total.expectedProfit / total.receivable : null;
  total.realizedGrossMargin = total.realizedReceivable > 0 ? total.realizedProfit / total.realizedReceivable : null;
  total.grossMargin = total.expectedGrossMargin;
  const activeOrders = orders.filter((order) => !order.taxArchived && order.taxRefundStatus !== "SUBMITTED");
  const overviewRows = orders.map((order) => overviewOrderMetrics(order, query));
  const activeOverviewRows = activeOrders.map((order) => overviewOrderMetrics(order, query));
  const monthlyTrend = buildOverviewMonthlyTrend(trendOrders.map((order) => overviewOrderMetrics(order, query)));
  const overdueTop = activeOverviewRows
    .filter((row) => row.unpaid > 0 && row.remainingDays != null && row.remainingDays < 0)
    .sort((a, b) => Math.abs(Number(b.remainingDays)) - Math.abs(Number(a.remainingDays)) || b.unpaid - a.unpaid)
    .slice(0, 10);
  const dueSoonTop = activeOverviewRows
    .filter((row) => row.unpaid > 0 && row.remainingDays != null && row.remainingDays >= 0 && row.remainingDays <= 7)
    .sort((a, b) => Number(a.remainingDays) - Number(b.remainingDays) || b.unpaid - a.unpaid)
    .slice(0, 10);
  const lowMarginOrders = activeOverviewRows
    .filter((row) => row.receivable > 0 || row.cost > 0)
    .sort((a, b) => {
      const marginA = a.expectedGrossMargin == null ? Number.POSITIVE_INFINITY : a.expectedGrossMargin;
      const marginB = b.expectedGrossMargin == null ? Number.POSITIVE_INFINITY : b.expectedGrossMargin;
      return marginA - marginB || a.expectedGrossProfit - b.expectedGrossProfit;
    })
    .slice(0, 10);
  const groupBy = <T>(items: T[], labelFn: (item: T) => string | null | undefined, valueFn: (item: T) => number): AmountGroup[] => Object.values(items.reduce((acc, item) => {
    const label = labelFn(item) || "未填写";
    acc[label] ||= { label, amount: 0, count: 0 };
    acc[label].amount += valueFn(item);
    acc[label].count += 1;
    return acc;
  }, {} as Record<string, AmountGroup>)).sort((a, b) => b.amount - a.amount);
  const salespersonGroups = groupOverviewRows(overviewRows, (row) => row.salespersonName || "未分配");
  const salespersonCollections = salespersonGroups
    .map((group) => ({ ...group, collectionRate: group.receivable > 0 ? group.paid / group.receivable : null }))
    .sort((a, b) => b.paid - a.paid || b.receivable - a.receivable)
    .slice(0, 10);
  const commissionRank = salespersonGroups
    .filter((group) => group.commissionMonth || group.commissionYear || group.commissionPending || group.commissionSettled)
    .sort((a, b) => b.commissionMonth - a.commissionMonth || b.commissionPending - a.commissionPending || b.commissionYear - a.commissionYear)
    .slice(0, 10);
  const salespersonProfitRank = salespersonGroups
    .map((group) => ({ ...group, expectedGrossMargin: group.receivable > 0 ? group.expectedProfit / group.receivable : null }))
    .filter((group) => group.receivable || group.expectedProfit)
    .sort((a, b) => b.expectedProfit - a.expectedProfit || b.receivable - a.receivable)
    .slice(0, 10);

  return {
    totals: { ...total, orderCount: orders.length, paymentCount: payments.length, costCount: costs.length },
    orderProfits: activeOrders,
    costStructure: groupBy(costs, (cost) => logisticsCostTypeLabel(normalizedCostType(cost.costType || "")), (cost) => numericField(cost, "amountCny")),
    reminders: await getReminders(query, actor),
    bySalesperson: groupBy(orders, (order) => order.salespersonName, (order) => order.summary.receivableCny),
    byCustomer: groupBy(orders, (order) => order.customerName, (order) => order.summary.receivableCny),
    byMonth: groupBy(orders, (order) => String(order.createdAt).slice(0, 7), (order) => order.summary.receivableCny),
    monthlyTrend,
    overdueTop,
    dueSoonTop,
    lowMarginOrders,
    salespersonCollections,
    commissionRank,
    salespersonProfitRank,
  };
}

function overviewDayNumber(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function lastOverviewMonthKeys(count = 12) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count + 1 + index, 1));
    return date.toISOString().slice(0, 7);
  });
}

function overviewOrderMetrics(order: OrderListRow, query: URLSearchParams | null = null) {
  const summary = order.summary || {};
  const receivable = Number(summary.receivableCny || 0);
  const paid = Number(summary.arrivedPaymentsCny ?? summary.confirmedPaymentsCny ?? 0);
  const unpaid = Math.max(receivable - paid, 0);
  const cost = Number(summary.confirmedTotalCostCny ?? summary.totalCostCny ?? 0);
  const expectedGrossProfit = Number(summary.expectedGrossProfit ?? (receivable - cost));
  const expectedGrossMargin = summary.expectedGrossMargin == null
    ? (receivable > 0 ? expectedGrossProfit / receivable : null)
    : Number(summary.expectedGrossMargin);
  const realizedGrossProfit = summary.realizedGrossProfit == null ? null : Number(summary.realizedGrossProfit);
  const todayNo = overviewDayNumber(new Date());
  const dueNo = overviewDayNumber(order.dueDate);
  const remainingDays = dueNo == null || todayNo == null ? null : dueNo - todayNo;
  const month = nonEmpty(query?.get("month")) || new Date().toISOString().slice(0, 7);
  const year = month.slice(0, 4);
  const createdMonth = String(order.createdAt || "").slice(0, 7);
  const createdYear = createdMonth.slice(0, 4);
  const estimatedCommission = Number(summary.estimatedCommissionCny || 0);
  const settleableCommission = Number(summary.settleableCommissionCny ?? summary.commissionAmountCny ?? 0);
  const settledCommission = order.commissionStatus === "已结算" ? settleableCommission : 0;
  const pendingCommission = order.commissionStatus === "已结算" ? 0 : estimatedCommission;
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    customerName: order.customerName || "",
    customerFullName: order.customerFullName || order.customerName || "",
    customerShortName: order.customerShortName || "",
    salespersonName: order.salespersonName || "未分配",
    createdAt: order.createdAt || null,
    dueDate: order.dueDate || null,
    status: order.status || "",
    receivable,
    paid,
    unpaid,
    cost,
    expectedGrossProfit,
    expectedGrossMargin,
    realizedGrossProfit,
    netCashFlowCny: Number(summary.netCashFlowCny || 0),
    remainingDays,
    commissionMonth: createdMonth === month ? (order.commissionStatus === "已结算" ? settledCommission : estimatedCommission) : 0,
    commissionYear: createdYear === year ? (order.commissionStatus === "已结算" ? settledCommission : estimatedCommission) : 0,
    commissionPending: pendingCommission,
    commissionSettled: settledCommission,
  };
}

function buildOverviewMonthlyTrend(rows: OverviewMetric[]) {
  const monthlyTrend = lastOverviewMonthKeys(12).map((label) => ({ label, receivable: 0, paid: 0, unpaid: 0 }));
  const byMonth = Object.fromEntries(monthlyTrend.map((item) => [item.label, item]));
  rows.forEach((row) => {
    const key = String(row.createdAt || row.dueDate || "").slice(0, 7);
    const target = byMonth[key];
    if (!target) return;
    target.receivable += row.receivable;
    target.paid += row.paid;
    target.unpaid += row.unpaid;
  });
  return monthlyTrend;
}

function groupOverviewRows(rows: OverviewMetric[], labelFn: (row: OverviewMetric) => string): OverviewGroup[] {
  return Object.values(rows.reduce((acc, row) => {
    const label = labelFn(row) || "未填写";
    acc[label] ||= {
      label,
      count: 0,
      receivable: 0,
      paid: 0,
      unpaid: 0,
      expectedProfit: 0,
      commissionMonth: 0,
      commissionYear: 0,
      commissionPending: 0,
      commissionSettled: 0,
    };
    const group = acc[label];
    group.count += 1;
    group.receivable += row.receivable;
    group.paid += row.paid;
    group.unpaid += row.unpaid;
    group.expectedProfit += row.expectedGrossProfit;
    group.commissionMonth += row.commissionMonth;
    group.commissionYear += row.commissionYear;
    group.commissionPending += row.commissionPending;
    group.commissionSettled += row.commissionSettled;
    return acc;
  }, {} as Record<string, OverviewGroup>));
}
