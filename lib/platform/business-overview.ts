import { listCosts } from "./cost-records";
import { logisticsCostTypeLabel } from "./logistics-cost-types";
import { listOrders, type OrderListRow } from "./orders-module";
import { listPayments, type PaymentListRow } from "./payments-module";
import { canRead, getCommissionFormulaSettings, isPlainRecord, normalizedCostType, requireAdminGlobal, type CostDto } from "./shared";
import {
  buildOverviewMonthlyTrend,
  groupOverviewRows,
  overviewMonthKey,
  overviewOrderMetrics,
  previousOverviewMonth,
  type OverviewMetric,
} from "./business-overview-metrics";

type ActorLike = ({ id?: string | null; role?: string | null; supplierId?: string | null; customPermissions?: unknown } & Record<string, unknown>) | null | undefined;
type AmountGroup = { label: string; amount: number; count: number; share?: number };
type PeriodActivity = ReturnType<typeof overviewPeriodActivity>;

function numericField(row: unknown, field: string) {
  return Number(isPlainRecord(row) ? row[field] || 0 : 0);
}

function sumBy<T>(rows: T[], value: (row: T) => number) {
  return rows.reduce((sum, row) => sum + value(row), 0);
}

function inOverviewMonth(value: unknown, month: string) {
  return !month || overviewMonthKey(value) === month;
}

function activeReceivableRow(row: OverviewMetric) {
  return !["已关闭", "已取消"].includes(row.status) && row.unpaid > 0;
}

function confirmedPeriodCost(cost: CostDto, month: string) {
  return cost.costConfirmed
    && cost.status !== "VOID"
    && inOverviewMonth((cost as Record<string, unknown>).costConfirmedAt || cost.createdAt, month);
}

function paidPeriodCost(cost: CostDto, month: string) {
  return cost.paymentStatus === "已支付"
    && inOverviewMonth(cost.paymentDate || cost.paidAt || cost.createdAt, month);
}

function arrivedPeriodPayment(payment: PaymentListRow, month: string) {
  return payment.status === "已到账"
    && inOverviewMonth(payment.paymentDate || payment.createdAt, month);
}

export function overviewPeriodActivity(
  month: string,
  rows: OverviewMetric[],
  payments: PaymentListRow[],
  costs: CostDto[],
) {
  const orders = rows.filter((row) => inOverviewMonth(row.createdAt, month));
  const arrivedPayments = payments.filter((payment) => arrivedPeriodPayment(payment, month));
  const confirmedCosts = costs.filter((cost) => confirmedPeriodCost(cost, month));
  const paidCosts = costs.filter((cost) => paidPeriodCost(cost, month));
  const marginEligibleOrders = orders.filter((row) => row.profitMarginEligible);
  const receivable = sumBy(orders, (row) => row.receivable);
  const collections = sumBy(arrivedPayments, (payment) => Number(payment.amountCny || 0));
  const confirmedCost = sumBy(confirmedCosts, (cost) => Number(cost.amountCny || 0));
  const costPayments = sumBy(paidCosts, (cost) => Number(cost.amountCny || 0));
  const expectedProfit = sumBy(orders, (row) => row.expectedGrossProfit);
  const marginEligibleReceivable = sumBy(marginEligibleOrders, (row) => row.receivable);
  const marginEligibleProfit = sumBy(marginEligibleOrders, (row) => row.expectedGrossProfit);
  return {
    month,
    orders,
    arrivedPayments,
    confirmedCosts,
    paidCosts,
    receivable,
    collections,
    confirmedCost,
    costPayments,
    netCashFlow: collections - costPayments,
    expectedProfit,
    expectedGrossMargin: marginEligibleReceivable > 0 ? marginEligibleProfit / marginEligibleReceivable : null,
    profitMarginEligibleOrders: marginEligibleOrders.length,
    orderCount: orders.length,
    customerCount: new Set(orders.map((row) => row.customerName || row.customerFullName).filter(Boolean)).size,
  };
}

function comparisonMetric(key: string, label: string, current: number, previous: number, format: "money" | "number" = "money") {
  return {
    key,
    label,
    current,
    previous,
    format,
    change: previous === 0 ? null : (current - previous) / Math.abs(previous),
    difference: current - previous,
  };
}

function buildPeriodComparison(current: PeriodActivity, previous: PeriodActivity) {
  return [
    comparisonMetric("receivable", "新增订单额", current.receivable, previous.receivable),
    comparisonMetric("collections", "实际回款", current.collections, previous.collections),
    comparisonMetric("costPayments", "实际付款", current.costPayments, previous.costPayments),
    comparisonMetric("netCashFlow", "净现金流", current.netCashFlow, previous.netCashFlow),
    comparisonMetric("expectedProfit", "预计毛利", current.expectedProfit, previous.expectedProfit),
    comparisonMetric("orderCount", "新增订单", current.orderCount, previous.orderCount, "number"),
  ];
}

function groupAmounts<T>(items: T[], label: (item: T) => string | null | undefined, value: (item: T) => number): AmountGroup[] {
  const groups = Object.values(items.reduce((acc, item) => {
    const key = label(item) || "未填写";
    acc[key] ||= { label: key, amount: 0, count: 0 };
    acc[key].amount += value(item);
    acc[key].count += 1;
    return acc;
  }, {} as Record<string, AmountGroup>)).sort((a, b) => b.amount - a.amount);
  const total = sumBy(groups, (group) => group.amount);
  return groups.map((group) => ({ ...group, share: total > 0 ? group.amount / total : 0 }));
}

function buildAgingBuckets(rows: OverviewMetric[]) {
  const definitions = [
    { label: "未到期", matches: (days: number | null) => days != null && days >= 0 },
    { label: "逾期 1-30 天", matches: (days: number | null) => days != null && days < 0 && days >= -30 },
    { label: "逾期 31-60 天", matches: (days: number | null) => days != null && days < -30 && days >= -60 },
    { label: "逾期 61-90 天", matches: (days: number | null) => days != null && days < -60 && days >= -90 },
    { label: "逾期 90 天以上", matches: (days: number | null) => days != null && days < -90 },
    { label: "未设置到期日", matches: (days: number | null) => days == null },
  ];
  return definitions.map((definition) => {
    const matches = rows.filter((row) => definition.matches(row.remainingDays));
    return { label: definition.label, count: matches.length, amount: sumBy(matches, (row) => row.unpaid) };
  });
}

function buildSalespersonCollections(period: PeriodActivity) {
  const orderGroups = groupOverviewRows(period.orders, (row) => row.salespersonName || "未分配");
  const byName = new Map(orderGroups.map((group) => [group.label, { ...group, paid: 0 }]));
  period.arrivedPayments.forEach((payment) => {
    const label = payment.salespersonName || "未分配";
    const group = byName.get(label) || {
      label,
      count: 0,
      receivable: 0,
      paid: 0,
      collectionBasisPaid: 0,
      unpaid: 0,
      expectedProfit: 0,
      marginEligibleCount: 0,
      marginEligibleReceivable: 0,
      marginEligibleProfit: 0,
      commissionMonth: 0,
      commissionYear: 0,
      commissionPending: 0,
      commissionSettled: 0,
    };
    group.paid += Number(payment.amountCny || 0);
    byName.set(label, group);
  });
  return [...byName.values()].sort((a, b) => b.paid - a.paid || b.receivable - a.receivable).slice(0, 10);
}

export async function getReminders(query: URLSearchParams, actor: ActorLike) {
  const orders = await listOrders(query, actor);
  return orders.filter((order) => !order.taxArchived && order.taxRefundStatus !== "SUBMITTED")
    .filter((order) => ["即将到期", "已逾期"].includes(order.summary.reminderStatus))
    .sort((a, b) => b.summary.overdueDays - a.summary.overdueDays
      || String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31")));
}

export async function getOverview(query: URLSearchParams, actor: ActorLike) {
  requireAdminGlobal(actor, "无权限访问经营总览");
  const selectedMonth = /^\d{4}-\d{2}$/.test(String(query.get("month") || ""))
    ? String(query.get("month"))
    : overviewMonthKey(new Date());
  const previousMonth = previousOverviewMonth(selectedMonth);
  const baseQuery = new URLSearchParams(query);
  baseQuery.delete("month");
  const costQuery = new URLSearchParams(baseQuery);
  costQuery.set("pageSize", "5000");
  const canReadOrders = canRead(actor, "orders");
  const commissionFormulaSettings = canReadOrders ? await getCommissionFormulaSettings() : undefined;
  const [orders, payments, costs] = await Promise.all([
    canReadOrders ? listOrders(baseQuery, actor, { commissionFormulaSettings }) : [],
    canRead(actor, "payments") ? listPayments(baseQuery, actor) : [],
    canRead(actor, "costs") ? listCosts(costQuery, actor) : [],
  ]) as [OrderListRow[], PaymentListRow[], CostDto[]];

  const allRows = orders.map((order) => overviewOrderMetrics(order, query));
  const currentPeriod = overviewPeriodActivity(selectedMonth, allRows, payments, costs);
  const previousPeriod = overviewPeriodActivity(previousMonth, allRows, payments, costs);
  const activeRows = allRows.filter(activeReceivableRow);
  const overdueRows = activeRows.filter((row) => row.remainingDays != null && row.remainingDays < 0);
  const dueSoonRows = activeRows.filter((row) => row.remainingDays != null && row.remainingDays >= 0 && row.remainingDays <= 7);
  const overdueTop = [...overdueRows]
    .sort((a, b) => Math.abs(Number(b.remainingDays)) - Math.abs(Number(a.remainingDays)) || b.unpaid - a.unpaid)
    .slice(0, 10);
  const dueSoonTop = [...dueSoonRows]
    .sort((a, b) => Number(a.remainingDays) - Number(b.remainingDays) || b.unpaid - a.unpaid)
    .slice(0, 10);
  const lowMarginOrders = activeRows
    .filter((row) => row.profitMarginEligible && row.expectedGrossMargin != null && row.expectedGrossMargin < 0.08)
    .sort((a, b) => Number(a.expectedGrossMargin) - Number(b.expectedGrossMargin) || a.expectedGrossProfit - b.expectedGrossProfit)
    .slice(0, 10);
  const commissionGroups = groupOverviewRows(allRows, (row) => row.salespersonName || "未分配");
  const periodProfitGroups = groupOverviewRows(currentPeriod.orders, (row) => row.salespersonName || "未分配");
  const customerRank = groupAmounts(currentPeriod.orders, (row) => row.customerName || row.customerFullName, (row) => row.receivable).slice(0, 10);
  const statusDistribution = groupAmounts(currentPeriod.orders, (row) => row.status, (row) => row.receivable);
  const snapshotOutstanding = sumBy(activeRows, (row) => row.unpaid);
  const overdueAmount = sumBy(overdueRows, (row) => row.unpaid);
  const dueSoonAmount = sumBy(dueSoonRows, (row) => row.unpaid);
  const pendingCostAmount = sumBy(activeRows, (row) => row.costPendingConfirmation);
  const periodExchangeDifference = sumBy(currentPeriod.orders, (row) => row.exchangeDifference);
  const periodRealizedProfit = sumBy(currentPeriod.orders, (row) => Number(row.realizedGrossProfit || 0));
  const commissionAmount = sumBy(commissionGroups, (group) => group.commissionMonth);
  const dataWarnings = [
    ...(orders.length >= 1000 ? ["订单数据达到 1000 条扫描上限，建议缩小筛选范围"] : []),
    ...(payments.length >= 1000 ? ["收款数据达到 1000 条扫描上限，建议缩小筛选范围"] : []),
    ...(costs.length >= 5000 ? ["成本数据达到 5000 条扫描上限，建议缩小筛选范围"] : []),
  ];

  return {
    period: { month: selectedMonth, previousMonth },
    dataWarnings,
    totals: {
      receivable: currentPeriod.receivable,
      confirmed: currentPeriod.collections,
      outstanding: snapshotOutstanding,
      exchangeDifference: periodExchangeDifference,
      expectedProfit: currentPeriod.expectedProfit,
      expectedGrossMargin: currentPeriod.expectedGrossMargin,
      profitMarginEligibleOrders: currentPeriod.profitMarginEligibleOrders,
      realizedProfit: periodRealizedProfit,
      netCashFlow: currentPeriod.netCashFlow,
      commissionAmount,
      orderCount: currentPeriod.orderCount,
      customerCount: currentPeriod.customerCount,
      paymentCount: currentPeriod.arrivedPayments.length,
      costCount: currentPeriod.confirmedCosts.length,
      confirmedCost: currentPeriod.confirmedCost,
      costPayments: currentPeriod.costPayments,
      overdueOrders: overdueRows.length,
      overdueAmount,
      dueSoonOrders: dueSoonRows.length,
      dueSoonAmount,
      activeOrders: activeRows.length,
      pendingCostAmount,
      pendingCostOrders: activeRows.filter((row) => row.costPendingConfirmation > 0).length,
      missingCostOrders: activeRows.filter((row) => row.costMissing).length,
      negativeMarginOrders: activeRows.filter((row) => row.profitMarginEligible && Number(row.expectedGrossMargin) < 0).length,
      lowMarginOrders: activeRows.filter((row) => row.profitMarginEligible && row.expectedGrossMargin != null && row.expectedGrossMargin < 0.08).length,
      commissionSnapshotMissingOrders: currentPeriod.orders.filter((row) => row.commissionSnapshotMissing).length,
    },
    periodComparison: buildPeriodComparison(currentPeriod, previousPeriod),
    monthlyTrend: buildOverviewMonthlyTrend(allRows, payments, costs),
    agingBuckets: buildAgingBuckets(activeRows),
    customerRank,
    statusDistribution,
    costStructure: groupAmounts(
      currentPeriod.confirmedCosts,
      (cost) => logisticsCostTypeLabel(normalizedCostType(String(cost.costType || ""))),
      (cost) => numericField(cost, "amountCny"),
    ),
    overdueTop,
    dueSoonTop,
    lowMarginOrders,
    salespersonCollections: buildSalespersonCollections(currentPeriod),
    commissionRank: commissionGroups
      .filter((group) => group.commissionMonth || group.commissionYear || group.commissionPending || group.commissionSettled)
      .sort((a, b) => b.commissionMonth - a.commissionMonth || b.commissionPending - a.commissionPending || b.commissionYear - a.commissionYear)
      .slice(0, 10),
    salespersonProfitRank: periodProfitGroups
      .map((group) => ({
        ...group,
        expectedGrossMargin: group.marginEligibleReceivable > 0
          ? group.marginEligibleProfit / group.marginEligibleReceivable
          : null,
      }))
      .filter((group) => group.receivable || group.expectedProfit)
      .sort((a, b) => b.expectedProfit - a.expectedProfit || b.receivable - a.receivable)
      .slice(0, 10),
  };
}
