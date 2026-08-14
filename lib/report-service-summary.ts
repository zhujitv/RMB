import { dateOnly, moneyNumber, text, type ReportRow, type ReportType } from "./report-service-shared";

export type ReportSummaryMetric = {
  key: string;
  label: string;
  value: number | null;
  format: "money" | "number" | "percent" | "days";
  tone: "neutral" | "positive" | "warning" | "danger";
  note?: string;
};

export type ReportSummaryBreakdown = {
  title: string;
  format: "money" | "number";
  items: Array<{ label: string; amount: number; count: number; share: number }>;
};

export type ReportSummary = {
  metrics: ReportSummaryMetric[];
  breakdowns: ReportSummaryBreakdown[];
};

function numberField(row: ReportRow, key: string) {
  return moneyNumber(row[key]);
}

function sum(rows: ReportRow[], key: string) {
  return rows.reduce((total, row) => total + numberField(row, key), 0);
}

function countMetric(key: string, label: string, value: number, tone: ReportSummaryMetric["tone"] = "neutral", note = ""): ReportSummaryMetric {
  return { key, label, value, format: "number", tone, note };
}

function moneyMetric(key: string, label: string, value: number, tone: ReportSummaryMetric["tone"] = "neutral", note = ""): ReportSummaryMetric {
  return { key, label, value, format: "money", tone, note };
}

function percentMetric(key: string, label: string, numerator: number, denominator: number, tone: ReportSummaryMetric["tone"] = "neutral", note = ""): ReportSummaryMetric {
  return { key, label, value: denominator > 0 ? numerator / denominator : 0, format: "percent", tone, note };
}

function nullablePercentMetric(key: string, label: string, numerator: number, denominator: number, tone: ReportSummaryMetric["tone"] = "neutral", note = ""): ReportSummaryMetric {
  return { key, label, value: denominator > 0 ? numerator / denominator : null, format: "percent", tone, note };
}

function daysMetric(key: string, label: string, value: number, tone: ReportSummaryMetric["tone"] = "neutral", note = ""): ReportSummaryMetric {
  return { key, label, value, format: "days", tone, note };
}

function breakdown(
  title: string,
  rows: ReportRow[],
  labelValue: (row: ReportRow) => string,
  amountValue: (row: ReportRow) => number,
  format: ReportSummaryBreakdown["format"] = "money",
): ReportSummaryBreakdown {
  type BreakdownItem = { label: string; amount: number; count: number; share: number };
  const grouped = rows.reduce<Record<string, BreakdownItem>>((acc, row) => {
    const label = labelValue(row).trim() || "未填写";
    acc[label] ||= { label, amount: 0, count: 0, share: 0 };
    acc[label].amount += amountValue(row);
    acc[label].count += 1;
    return acc;
  }, {});
  const groups = Object.values(grouped);
  const total = groups.reduce((value, item) => value + item.amount, 0);
  return {
    title,
    format,
    items: groups
      .map((item) => ({ ...item, share: total > 0 ? item.amount / total : 0 }))
      .sort((a, b) => b.amount - a.amount || b.count - a.count)
      .slice(0, 10),
  };
}

function isOverdue(row: ReportRow) {
  const dueDate = dateOnly(row.dueDate);
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return Boolean(dueDate && dueDate < today && numberField(row, "outstandingCny") > 0);
}

function completenessRatio(value: unknown) {
  const [completed, total] = text(value).split("/").map(Number);
  return Number.isFinite(completed) && Number.isFinite(total) && total > 0 ? completed / total : null;
}

function profitMarginBasis(rows: ReportRow[]) {
  const eligible = rows.filter((row) => row.profitMarginEligible === true);
  return {
    eligible,
    orderCount: eligible.reduce((total, row) => total + (
      row.profitMarginEligibleOrderCount == null ? 1 : numberField(row, "profitMarginEligibleOrderCount")
    ), 0),
    receivable: eligible.reduce((total, row) => total + numberField(
      row,
      row.profitMarginReceivableCny == null ? "receivableCny" : "profitMarginReceivableCny",
    ), 0),
    profit: eligible.reduce((total, row) => total + numberField(
      row,
      row.profitMarginProfitCny == null ? "expectedGrossProfit" : "profitMarginProfitCny",
    ), 0),
  };
}

function receivableSummary(rows: ReportRow[]): ReportSummary {
  const receivable = sum(rows, "finalReceivableAmountCny");
  const received = sum(rows, "receivedAmountCny");
  const outstanding = sum(rows, "outstandingCny");
  const overdueRows = rows.filter(isOverdue);
  return {
    metrics: [
      countMetric("records", "订单数", rows.length),
      moneyMetric("receivable", "应收总额", receivable),
      moneyMetric("received", "已收金额", received, "positive"),
      moneyMetric("outstanding", "未收余额", outstanding, outstanding > 0 ? "warning" : "positive"),
      percentMetric("collectionRate", "回款率", received, receivable, received < receivable ? "warning" : "positive"),
      moneyMetric("overdue", "逾期金额", sum(overdueRows, "outstandingCny"), overdueRows.length ? "danger" : "positive", `${overdueRows.length} 个逾期订单`),
    ],
    breakdowns: [breakdown("未收客户 Top10", rows.filter((row) => numberField(row, "outstandingCny") > 0), (row) => text(row.customerName), (row) => numberField(row, "outstandingCny"))],
  };
}

function paymentSummary(rows: ReportRow[]): ReportSummary {
  const arrived = rows.filter((row) => row.status === "已到账");
  const pending = rows.filter((row) => row.status === "待确认");
  const total = sum(rows, "amountCny");
  return {
    metrics: [
      countMetric("records", "收款笔数", rows.length),
      moneyMetric("total", "收款记录总额", total),
      moneyMetric("arrived", "已到账", sum(arrived, "amountCny"), "positive"),
      moneyMetric("pending", "待确认", sum(pending, "amountCny"), pending.length ? "warning" : "positive", `${pending.length} 笔待确认`),
      percentMetric("arrivedRate", "到账金额占比", sum(arrived, "amountCny"), total, "positive"),
      moneyMetric("average", "平均每笔", rows.length ? total / rows.length : 0),
    ],
    breakdowns: [breakdown("客户回款 Top10", arrived, (row) => text(row.customerName), (row) => numberField(row, "amountCny"))],
  };
}

function costSummary(rows: ReportRow[]): ReportSummary {
  const confirmed = rows.filter((row) => Boolean(row.costConfirmed));
  const paid = rows.filter((row) => row.paymentStatus === "已支付");
  const unpaid = rows.filter((row) => !["已支付", "已取消"].includes(text(row.paymentStatus)));
  const missingInvoice = rows.filter((row) => row.invoiceStatus !== "已收到");
  const total = sum(rows, "amountCny");
  return {
    metrics: [
      moneyMetric("total", "录入成本", total),
      moneyMetric("confirmed", "已确认成本", sum(confirmed, "amountCny"), "positive"),
      moneyMetric("paid", "已支付成本", sum(paid, "amountCny"), "positive"),
      moneyMetric("unpaid", "待支付成本", sum(unpaid, "amountCny"), unpaid.length ? "warning" : "positive", `${unpaid.length} 笔待支付`),
      moneyMetric("missingInvoice", "缺票金额", sum(missingInvoice, "amountCny"), missingInvoice.length ? "danger" : "positive", `${missingInvoice.length} 笔缺票`),
      percentMetric("confirmationRate", "成本确认率", sum(confirmed, "amountCny"), total, confirmed.length === rows.length ? "positive" : "warning"),
    ],
    breakdowns: [breakdown("成本类型结构", rows, (row) => text(row.costType), (row) => numberField(row, "amountCny"))],
  };
}

function profitSummary(rows: ReportRow[]): ReportSummary {
  const receivable = sum(rows, "receivableCny");
  const cost = sum(rows, "totalCostCny");
  const profit = sum(rows, "expectedGrossProfit");
  const marginBasis = profitMarginBasis(rows);
  const negative = marginBasis.eligible.filter((row) => numberField(row, "expectedGrossProfit") < 0);
  const lowMargin = marginBasis.eligible.filter((row) => {
    const base = numberField(row, "receivableCny");
    return base > 0 && numberField(row, "expectedGrossProfit") / base < 0.08;
  });
  return {
    metrics: [
      moneyMetric("receivable", "最终应收", receivable),
      moneyMetric("cost", "总成本", cost),
      moneyMetric("profit", "预计毛利", profit, profit >= 0 ? "positive" : "danger"),
      nullablePercentMetric("margin", "预计毛利率", marginBasis.profit, marginBasis.receivable, marginBasis.orderCount ? (marginBasis.profit >= 0 ? "positive" : "danger") : "neutral", `仅统计 ${marginBasis.orderCount} 个已发货订单`),
      countMetric("negative", "亏损订单", negative.length, negative.length ? "danger" : "positive"),
      countMetric("lowMargin", "低毛利订单", lowMargin.length, lowMargin.length ? "warning" : "positive", "毛利率低于 8%"),
    ],
    breakdowns: [breakdown("业务员毛利贡献", rows, (row) => text(row.salespersonName), (row) => numberField(row, "expectedGrossProfit"))],
  };
}

function commissionSummary(rows: ReportRow[]): ReportSummary {
  const settled = rows.filter((row) => ["已结算", "SETTLED"].includes(text(row.commissionStatus)));
  const pending = rows.filter((row) => !["已结算", "SETTLED"].includes(text(row.commissionStatus)));
  return {
    metrics: [
      countMetric("records", "涉及订单", rows.length),
      moneyMetric("base", "提成基数", sum(rows, "commissionBaseCny")),
      moneyMetric("amount", "提成总额", sum(rows, "commissionAmountCny")),
      moneyMetric("settled", "已结算提成", sum(settled, "commissionAmountCny"), "positive"),
      moneyMetric("pending", "待结算提成", sum(pending, "commissionAmountCny"), pending.length ? "warning" : "positive"),
      countMetric("pendingOrders", "待结算订单", pending.length, pending.length ? "warning" : "positive"),
    ],
    breakdowns: [breakdown("业务员提成结构", rows, (row) => text(row.salespersonName), (row) => numberField(row, "commissionAmountCny"))],
  };
}

function overdueSummary(rows: ReportRow[]): ReportSummary {
  const days = rows.map((row) => Math.max(0, numberField(row, "overdueDays")));
  const aging = rows.map((row) => ({
    ...row,
    aging: numberField(row, "overdueDays") > 90 ? "90 天以上"
      : numberField(row, "overdueDays") > 60 ? "61-90 天"
        : numberField(row, "overdueDays") > 30 ? "31-60 天" : "1-30 天",
  }));
  return {
    metrics: [
      countMetric("records", "逾期订单", rows.length, rows.length ? "danger" : "positive"),
      moneyMetric("outstanding", "逾期总额", sum(rows, "outstandingCny"), rows.length ? "danger" : "positive"),
      daysMetric("averageDays", "平均逾期", days.length ? days.reduce((total, value) => total + value, 0) / days.length : 0, rows.length ? "warning" : "positive"),
      daysMetric("maxDays", "最长逾期", days.length ? Math.max(...days) : 0, rows.length ? "danger" : "positive"),
      countMetric("over30", "逾期超 30 天", days.filter((value) => value > 30).length, days.some((value) => value > 30) ? "danger" : "positive"),
      countMetric("over90", "逾期超 90 天", days.filter((value) => value > 90).length, days.some((value) => value > 90) ? "danger" : "positive"),
    ],
    breakdowns: [breakdown("逾期账龄结构", aging, (row) => text(row.aging), (row) => numberField(row, "outstandingCny"))],
  };
}

function taxRefundSummary(rows: ReportRow[]): ReportSummary {
  const statusCount = (status: string) => rows.filter((row) => row.taxRefundStatus === status).length;
  const ratios = rows.map((row) => completenessRatio(row.overallCompleteness)).filter((value): value is number => value != null);
  const missingInvoices = rows.filter((row) => text(row.missingLogisticsInvoices || row.missingCustomsInvoices || row.missingPortInvoices));
  return {
    metrics: [
      countMetric("records", "退税订单", rows.length),
      countMetric("ready", "资料完整待提交", statusCount("READY"), "positive"),
      countMetric("problem", "资料异常", statusCount("PROBLEM"), statusCount("PROBLEM") ? "danger" : "positive"),
      countMetric("notReady", "资料不完整", statusCount("NOT_READY"), statusCount("NOT_READY") ? "warning" : "positive"),
      countMetric("submitted", "已提交退税", statusCount("SUBMITTED") + statusCount("REFUND_RECEIVED"), "positive"),
      percentMetric("completeness", "平均完整度", ratios.reduce((total, value) => total + value, 0), ratios.length || 1, ratios.some((value) => value < 1) ? "warning" : "positive", `${missingInvoices.length} 单存在费用资料缺口`),
    ],
    breakdowns: [breakdown("退税状态结构", rows, (row) => text(row.taxRefundStatusLabel), () => 1, "number")],
  };
}

function contributionSummary(type: "customer-analysis" | "salesperson-performance", rows: ReportRow[]): ReportSummary {
  const receivable = sum(rows, "receivableCny");
  const received = sum(rows, "receivedAmountCny");
  const profit = sum(rows, "expectedGrossProfit");
  const overdue = sum(rows, "overdueAmountCny");
  const marginBasis = profitMarginBasis(rows);
  const labelKey = type === "customer-analysis" ? "customerName" : "salespersonName";
  return {
    metrics: [
      countMetric("groups", type === "customer-analysis" ? "客户数" : "业务员数", rows.length),
      countMetric("orders", "订单数", sum(rows, "orderCount")),
      moneyMetric("receivable", "应收总额", receivable),
      moneyMetric("received", "已收金额", received, "positive"),
      moneyMetric("profit", "预计毛利", profit, profit >= 0 ? "positive" : "danger"),
      moneyMetric("overdue", "逾期金额", overdue, overdue > 0 ? "danger" : "positive"),
      percentMetric("collectionRate", "回款率", received, receivable, received < receivable ? "warning" : "positive"),
      nullablePercentMetric("grossMargin", "预计毛利率", marginBasis.profit, marginBasis.receivable, marginBasis.orderCount ? (marginBasis.profit >= 0 ? "positive" : "danger") : "neutral", `仅统计 ${marginBasis.orderCount} 个已发货订单`),
    ],
    breakdowns: [breakdown(
      type === "customer-analysis" ? "客户毛利贡献 Top10" : "业务员毛利贡献 Top10",
      rows,
      (row) => text(row[labelKey]),
      (row) => numberField(row, "expectedGrossProfit"),
    )],
  };
}

export function buildReportSummary(type: ReportType, rows: ReportRow[]): ReportSummary {
  if (type === "payments") return paymentSummary(rows);
  if (type === "costs") return costSummary(rows);
  if (type === "profits") return profitSummary(rows);
  if (type === "commissions") return commissionSummary(rows);
  if (type === "overdue") return overdueSummary(rows);
  if (type === "tax-refunds") return taxRefundSummary(rows);
  if (type === "customer-analysis" || type === "salesperson-performance") return contributionSummary(type, rows);
  return receivableSummary(rows);
}
