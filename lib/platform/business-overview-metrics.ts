import { nonEmpty } from "./shared";
import type { OrderListRow } from "./orders-module";

export type OverviewGroup = {
  label: string; count: number; receivable: number; paid: number; collectionBasisPaid: number;
  unpaid: number; expectedProfit: number; commissionMonth: number; commissionYear: number;
  commissionPending: number; commissionSettled: number;
};
type OverviewCollectionSummary = Partial<Pick<OrderListRow["summary"],
  "receivableCny" | "arrivedPaymentsCny" | "confirmedPaymentsCny" | "arrivedBalanceCny"
  | "arrivedOutstandingCny" | "outstandingCny" | "exchangeDifferenceCny">>;
export type OverviewMetric = ReturnType<typeof overviewOrderMetrics>;

function overviewDayNumber(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const [year, month, day] = date.split("-").map(Number);
  return year && month && day ? Math.floor(Date.UTC(year, month - 1, day) / 86400000) : null;
}

export function overviewCollectionMetrics(summary: OverviewCollectionSummary) {
  const receivable = Number(summary.receivableCny || 0);
  const paid = Number(summary.arrivedPaymentsCny ?? summary.confirmedPaymentsCny ?? 0);
  const unpaid = Number(summary.arrivedOutstandingCny ?? summary.outstandingCny ?? Math.max(receivable - paid, 0));
  const collectionBasisPaid = summary.arrivedBalanceCny == null ? paid : Math.max(receivable - Number(summary.arrivedBalanceCny), 0);
  return { receivable, paid, unpaid, collectionBasisPaid, exchangeDifference: Number(summary.exchangeDifferenceCny || 0) };
}

export function overviewOrderMetrics(order: OrderListRow, query: URLSearchParams | null = null) {
  const summary = order.summary || {};
  const collection = overviewCollectionMetrics(summary);
  const cost = Number(summary.confirmedTotalCostCny ?? summary.totalCostCny ?? 0);
  const expectedGrossProfit = Number(summary.expectedGrossProfit ?? (collection.receivable - cost));
  const expectedGrossMargin = summary.expectedGrossMargin == null
    ? (collection.receivable > 0 ? expectedGrossProfit / collection.receivable : null)
    : Number(summary.expectedGrossMargin);
  const todayNo = overviewDayNumber(new Date());
  const dueNo = overviewDayNumber(order.dueDate);
  const month = nonEmpty(query?.get("month")) || new Date().toISOString().slice(0, 7);
  const createdMonth = String(order.createdAt || "").slice(0, 7);
  const estimatedCommission = Number(summary.estimatedCommissionCny || 0);
  const settleableCommission = Number(summary.settleableCommissionCny ?? summary.commissionAmountCny ?? 0);
  const commissionSnapshotMissing = Boolean(summary.commissionSnapshotMissing);
  const commissionSettled = commissionSnapshotMissing
    || ["已结算", "SETTLED"].includes(String(summary.commissionStatus || ""))
    || ["已结算", "SETTLED"].includes(String(order.commissionStatus || ""));
  const settledCommission = commissionSettled && !commissionSnapshotMissing ? settleableCommission : 0;
  return {
    id: order.id, orderNo: order.orderNo, blNo: order.blNo || "", customerName: order.customerName || "",
    customerFullName: order.customerFullName || order.customerName || "", customerShortName: order.customerShortName || "",
    salespersonName: order.salespersonName || "未分配", createdAt: order.createdAt || null, dueDate: order.dueDate || null,
    status: order.status || "", ...collection, cost, expectedGrossProfit, expectedGrossMargin,
    realizedGrossProfit: summary.realizedGrossProfit == null ? null : Number(summary.realizedGrossProfit),
    netCashFlowCny: Number(summary.netCashFlowCny || 0), remainingDays: dueNo == null || todayNo == null ? null : dueNo - todayNo,
    commissionMonth: createdMonth === month ? (commissionSettled ? settledCommission : estimatedCommission) : 0,
    commissionYear: createdMonth.slice(0, 4) === month.slice(0, 4) ? (commissionSettled ? settledCommission : estimatedCommission) : 0,
    commissionPending: commissionSettled ? 0 : estimatedCommission, commissionSettled: settledCommission, commissionSnapshotMissing,
  };
}

export function buildOverviewMonthlyTrend(rows: OverviewMetric[]) {
  const now = new Date();
  const labels = Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1)).toISOString().slice(0, 7));
  const monthlyTrend = labels.map((label) => ({ label, receivable: 0, paid: 0, unpaid: 0 }));
  const byMonth = Object.fromEntries(monthlyTrend.map((item) => [item.label, item]));
  rows.forEach((row) => {
    const target = byMonth[String(row.createdAt || row.dueDate || "").slice(0, 7)];
    if (target) { target.receivable += row.receivable; target.paid += row.paid; target.unpaid += row.unpaid; }
  });
  return monthlyTrend;
}

export function groupOverviewRows(rows: OverviewMetric[], labelFn: (row: OverviewMetric) => string): OverviewGroup[] {
  return Object.values(rows.reduce((acc, row) => {
    const label = labelFn(row) || "未填写";
    acc[label] ||= { label, count: 0, receivable: 0, paid: 0, collectionBasisPaid: 0, unpaid: 0,
      expectedProfit: 0, commissionMonth: 0, commissionYear: 0, commissionPending: 0, commissionSettled: 0 };
    const group = acc[label];
    group.count += 1; group.receivable += row.receivable; group.paid += row.paid;
    group.collectionBasisPaid += row.collectionBasisPaid; group.unpaid += row.unpaid;
    group.expectedProfit += row.expectedGrossProfit; group.commissionMonth += row.commissionMonth;
    group.commissionYear += row.commissionYear; group.commissionPending += row.commissionPending;
    group.commissionSettled += row.commissionSettled;
    return acc;
  }, {} as Record<string, OverviewGroup>));
}
