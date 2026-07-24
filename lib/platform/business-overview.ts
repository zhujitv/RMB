import { listCosts } from "./cost-records";
import { logisticsCostTypeLabel } from "./logistics-cost-types";
import { listOrders, type OrderListRow } from "./orders-module";
import { listPayments, type PaymentListRow } from "./payments-module";
import { canRead, getCommissionFormulaSettings, isPlainRecord, normalizedCostType, requireAdminGlobal, type CostDto } from "./shared";
import { buildOverviewMonthlyTrend, groupOverviewRows, overviewOrderMetrics } from "./business-overview-metrics";

type ActorLike = ({ id?: string | null; role?: string | null; supplierId?: string | null; customPermissions?: unknown } & Record<string, unknown>) | null | undefined;
type AmountGroup = { label: string; amount: number; count: number };

function numericField(row: unknown, field: string) {
  return Number(isPlainRecord(row) ? row[field] || 0 : 0);
}

export async function getReminders(query: URLSearchParams, actor: ActorLike) {
  const orders = await listOrders(query, actor);
  return orders.filter((order) => !order.taxArchived && order.taxRefundStatus !== "SUBMITTED")
    .filter((order) => ["即将到期", "已逾期"].includes(order.summary.reminderStatus))
    .sort((a, b) => b.summary.overdueDays - a.summary.overdueDays
      || String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31")));
}

function overviewTotals(orders: OrderListRow[]) {
  const total = orders.reduce((acc, order) => {
    const summary = order.summary;
    acc.receivable += summary.receivableCny; acc.confirmed += summary.confirmedPaymentsCny;
    acc.pending += summary.pendingPaymentsCny; acc.outstanding += summary.outstandingCny;
    acc.exchangeDifference += summary.exchangeDifferenceCny; acc.requiredDepositAmount += summary.requiredDepositAmount;
    acc.receivedDeposit += summary.receivedDepositCny; acc.depositGap += summary.depositGapCny;
    acc.cost += summary.totalCostCny; acc.confirmedCost += summary.confirmedTotalCostCny;
    acc.paidConfirmedCost += summary.paidConfirmedCostCny; acc.expectedProfit += summary.expectedGrossProfit;
    acc.netCashFlow += summary.netCashFlowCny;
    if (summary.realizedGrossProfit != null) { acc.realizedProfit += summary.realizedGrossProfit; acc.realizedReceivable += summary.receivableCny; }
    if (!summary.commissionSnapshotMissing) acc.commissionAmount += Number(summary.commissionAmountCny ?? summary.estimatedCommissionCny ?? 0);
    else acc.commissionSnapshotMissingOrders += 1;
    if (summary.reminderStatus === "已逾期") acc.overdueOrders += 1;
    if (summary.reminderStatus === "即将到期") acc.dueSoonOrders += 1;
    return acc;
  }, { receivable: 0, confirmed: 0, pending: 0, outstanding: 0, exchangeDifference: 0,
    requiredDepositAmount: 0, receivedDeposit: 0, depositGap: 0, cost: 0, confirmedCost: 0,
    paidConfirmedCost: 0, expectedProfit: 0, realizedProfit: 0, realizedReceivable: 0, netCashFlow: 0,
    commissionAmount: 0, commissionSnapshotMissingOrders: 0, overdueOrders: 0, dueSoonOrders: 0,
    expectedGrossMargin: null as number | null, realizedGrossMargin: null as number | null, grossMargin: null as number | null });
  total.expectedGrossMargin = total.receivable > 0 ? total.expectedProfit / total.receivable : null;
  total.realizedGrossMargin = total.realizedReceivable > 0 ? total.realizedProfit / total.realizedReceivable : null;
  total.grossMargin = total.expectedGrossMargin;
  return total;
}

export async function getOverview(query: URLSearchParams, actor: ActorLike) {
  requireAdminGlobal(actor, "无权限访问经营总览");
  const trendQuery = new URLSearchParams(query); trendQuery.delete("month");
  const canReadOrders = canRead(actor, "orders");
  const commissionFormulaSettings = canReadOrders ? await getCommissionFormulaSettings() : undefined;
  const [orders, trendOrders, payments, costs] = await Promise.all([
    canReadOrders ? listOrders(query, actor, { commissionFormulaSettings }) : [],
    canReadOrders ? listOrders(trendQuery, actor, { commissionFormulaSettings }) : [],
    canRead(actor, "payments") ? listPayments(query, actor) : [],
    canRead(actor, "costs") ? listCosts(query, actor) : [],
  ]) as [OrderListRow[], OrderListRow[], PaymentListRow[], CostDto[]];
  const total = overviewTotals(orders);
  const activeOrders = orders.filter((order) => !order.taxArchived && order.taxRefundStatus !== "SUBMITTED");
  const overviewRows = orders.map((order) => overviewOrderMetrics(order, query));
  const activeRows = activeOrders.map((order) => overviewOrderMetrics(order, query));
  const overdueTop = activeRows.filter((row) => row.unpaid > 0 && row.remainingDays != null && row.remainingDays < 0)
    .sort((a, b) => Math.abs(Number(b.remainingDays)) - Math.abs(Number(a.remainingDays)) || b.unpaid - a.unpaid).slice(0, 10);
  const dueSoonTop = activeRows.filter((row) => row.unpaid > 0 && row.remainingDays != null && row.remainingDays >= 0 && row.remainingDays <= 7)
    .sort((a, b) => Number(a.remainingDays) - Number(b.remainingDays) || b.unpaid - a.unpaid).slice(0, 10);
  const lowMarginOrders = activeRows.filter((row) => row.receivable > 0 || row.cost > 0).sort((a, b) => {
    const marginA = a.expectedGrossMargin == null ? Infinity : a.expectedGrossMargin;
    const marginB = b.expectedGrossMargin == null ? Infinity : b.expectedGrossMargin;
    return marginA - marginB || a.expectedGrossProfit - b.expectedGrossProfit;
  }).slice(0, 10);
  const groupBy = <T>(items: T[], labelFn: (item: T) => string | null | undefined, valueFn: (item: T) => number): AmountGroup[] =>
    Object.values(items.reduce((acc, item) => { const label = labelFn(item) || "未填写";
      acc[label] ||= { label, amount: 0, count: 0 }; acc[label].amount += valueFn(item); acc[label].count += 1; return acc;
    }, {} as Record<string, AmountGroup>)).sort((a, b) => b.amount - a.amount);
  const salespersonGroups = groupOverviewRows(overviewRows, (row) => row.salespersonName || "未分配");
  return {
    totals: { ...total, orderCount: orders.length, paymentCount: payments.length, costCount: costs.length }, orderProfits: activeOrders,
    costStructure: groupBy(costs, (cost) => logisticsCostTypeLabel(normalizedCostType(cost.costType || "")), (cost) => numericField(cost, "amountCny")),
    reminders: await getReminders(query, actor), bySalesperson: groupBy(orders, (order) => order.salespersonName, (order) => order.summary.receivableCny),
    byCustomer: groupBy(orders, (order) => order.customerName, (order) => order.summary.receivableCny),
    byMonth: groupBy(orders, (order) => String(order.createdAt).slice(0, 7), (order) => order.summary.receivableCny),
    monthlyTrend: buildOverviewMonthlyTrend(trendOrders.map((order) => overviewOrderMetrics(order, query))), overdueTop, dueSoonTop, lowMarginOrders,
    salespersonCollections: salespersonGroups.map((group) => ({ ...group, collectionRate: group.receivable > 0 ? group.collectionBasisPaid / group.receivable : null }))
      .sort((a, b) => b.paid - a.paid || b.receivable - a.receivable).slice(0, 10),
    commissionRank: salespersonGroups.filter((group) => group.commissionMonth || group.commissionYear || group.commissionPending || group.commissionSettled)
      .sort((a, b) => b.commissionMonth - a.commissionMonth || b.commissionPending - a.commissionPending || b.commissionYear - a.commissionYear).slice(0, 10),
    salespersonProfitRank: salespersonGroups.map((group) => ({ ...group, expectedGrossMargin: group.receivable > 0 ? group.expectedProfit / group.receivable : null }))
      .filter((group) => group.receivable || group.expectedProfit).sort((a, b) => b.expectedProfit - a.expectedProfit || b.receivable - a.receivable).slice(0, 10),
  };
}
