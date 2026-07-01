
import styles from "../../WorkspaceShell.module.css";
import type { LogisticsExpenseCurrencySummary, LogisticsStatementRow } from "./model";
import {
  emptyLogisticsCurrencySummary,
  formatOriginalCurrencyValue,
  logisticsCurrencyOrder,
  mergeLogisticsCurrencySummaries,
  normalizeCurrencyCode,
  statementRowSummary,
} from "./shared-currency";

export function SupplierSectionComponent({
  rows,
  loading,
}: {
  rows: LogisticsStatementRow[];
  loading: boolean;
}) {
  if (!rows.length) {
    return (
      <p className={styles.mutedText}>
        {loading ? "月结汇总加载中..." : "当前月份暂无已审核物流费用。"}
      </p>
    );
  }
  return (
    <div className={styles.statementList}>
      {rows.map((row) => (
        <div
          key={row.supplierId || row.supplierName || "-"}
          className={styles.statementRow}
        >
          <strong>{row.supplierName || "-"}</strong>
          <span>{row.orderCount || 0} 票</span>
          <span>供应商明细</span>
          <span>金额以上方月结汇总为准</span>
        </div>
      ))}
    </div>
  );
}

export function StatusPill({ value }: { value: string }) {
  let tone = styles.statusMuted;
  if (["审核通过", "已确认", "已付款", "已上传", "已上传发票"].includes(value))
    tone = styles.statusSuccess;
  if (
    ["待审核", "未通知", "已通知开票", "待付款", "待开票", "草稿"].includes(
      value,
    ) ||
    value.startsWith("部分")
  )
    tone = styles.statusWarning;
  if (
    [
      "已驳回",
      "已退回",
      "已取消",
      "部分驳回",
      "通知失败",
      "待开票 / 通知失败",
    ].includes(value)
  )
    tone = styles.statusDanger;
  return <span className={`${styles.statusPill} ${tone}`}>{value || "-"}</span>;
}

const MONTHLY_SUMMARY_STATUS_ROWS: Array<{
  key: "approved" | "pendingPayment" | "paid";
  label: string;
}> = [
  { key: "approved", label: "应付总额" },
  { key: "pendingPayment", label: "待付款" },
  { key: "paid", label: "已付款" },
];

export function MonthlySummaryComponent({
  rows,
}: {
  rows: LogisticsStatementRow[];
}) {
  const monthlySummary = buildMonthlySummary(rows);
  return (
    <div className={styles.monthlySummaryCard}>
      <table className={styles.monthlySummaryTable}>
        <thead>
          <tr>
            <th>状态</th>
            {monthlySummary.currencies.map((currency) => (
              <th key={currency}>{currency} 合计</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthlySummary.statusRows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              {monthlySummary.currencies.map((currency) => (
                <td key={`${row.key}-${currency}`}>
                  {formatOriginalCurrencyValue(
                    currency,
                    row.amounts[currency] || 0,
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function buildMonthlySummary(rows: LogisticsStatementRow[]) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.approved = mergeLogisticsCurrencySummaries(
        acc.approved,
        statementRowSummary(row, "approved"),
      );
      acc.pendingPayment = mergeLogisticsCurrencySummaries(
        acc.pendingPayment,
        statementRowSummary(row, "pendingPayment"),
      );
      acc.paid = mergeLogisticsCurrencySummaries(
        acc.paid,
        statementRowSummary(row, "paid"),
      );
      return acc;
    },
    {
      approved: emptyLogisticsCurrencySummary(),
      pendingPayment: emptyLogisticsCurrencySummary(),
      paid: emptyLogisticsCurrencySummary(),
    },
  );
  const currencies = monthlySummaryCurrencies(Object.values(totals));
  const statusRows = MONTHLY_SUMMARY_STATUS_ROWS.map((item) => ({
    ...item,
    amounts: monthlySummaryAmountsByCurrency(totals[item.key], currencies),
  }));
  return { currencies, statusRows };
}

export function monthlySummaryCurrencies(
  summaries: LogisticsExpenseCurrencySummary[],
) {
  const currencies = new Set<string>();
  for (const summary of summaries) {
    if (Math.abs(Number(summary.cnyActual || 0)) > 0.000001)
      currencies.add("CNY");
    for (const item of summary.foreignTotals || [])
      currencies.add(item.currency);
  }
  if (!currencies.size) currencies.add("CNY");
  return [...currencies].sort(
    (left, right) =>
      logisticsCurrencyOrder(left) - logisticsCurrencyOrder(right) ||
      left.localeCompare(right),
  );
}

export function monthlySummaryAmountsByCurrency(
  summary: LogisticsExpenseCurrencySummary,
  currencies: string[],
) {
  const amounts: Record<string, number> = {};
  for (const currency of currencies) {
    amounts[currency] =
      currency === "CNY"
        ? Number(summary.cnyActual || 0)
        : Number(
            (summary.foreignTotals || []).find(
              (item) => item.currency === currency,
            )?.amount || 0,
          );
  }
  return amounts;
}

export function logisticsCurrencyAmountByCode(
  summary: LogisticsExpenseCurrencySummary,
  currency: string,
) {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "CNY") return Number(summary.cnyActual || 0);
  return Number(
    (summary.foreignTotals || []).find((item) => item.currency === normalized)
      ?.amount || 0,
  );
}

export function LogisticsCurrencyAmountList({
  summary,
  compact = false,
}: {
  summary: LogisticsExpenseCurrencySummary;
  compact?: boolean;
}) {
  return (
    <div
      className={`${styles.logisticsCurrencySummary} ${compact ? styles.logisticsCurrencySummaryCompact : ""}`}
    >
      {Math.abs(summary.cnyActual) > 0.000001 ||
      !summary.foreignTotals.length ? (
        <div className={styles.logisticsCurrencySummaryRow}>
          <span>CNY：</span>
          <strong>
            {formatOriginalCurrencyValue("CNY", summary.cnyActual)}
          </strong>
        </div>
      ) : null}
      {summary.foreignTotals.map((item) => (
        <div className={styles.logisticsCurrencySummaryRow} key={item.currency}>
          <span>{item.currency}：</span>
          <strong>
            {formatOriginalCurrencyValue(item.currency, item.amount)}
          </strong>
        </div>
      ))}
    </div>
  );
}
