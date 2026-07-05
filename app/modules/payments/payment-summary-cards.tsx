import { CurrencyTotalsDisplay } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import type { PaymentSummary } from "./types";

export function PaymentSummaryCards({ summary }: { summary: PaymentSummary }) {
  const cards = [
    {
      label: "已到账金额",
      value: (
        <CurrencyTotalsDisplay
          summary={summary.arrivedCurrencyTotals || { cnyActual: Number(summary.arrivedAmountCny || 0), foreignTotals: [], totalCny: Number(summary.arrivedAmountCny || 0) }}
          cnyLabel="人民币实际已到账"
          foreignLabel={(currency) => `${currency} 实际已到账`}
          totalLabel="折人民币到账总额"
        />
      ),
      note: "只统计已到账收款",
      tone: styles.metricGreen,
    },
    {
      label: "待确认金额",
      value: (
        <CurrencyTotalsDisplay
          summary={summary.pendingCurrencyTotals || { cnyActual: Number(summary.pendingAmountCny || 0), foreignTotals: [], totalCny: Number(summary.pendingAmountCny || 0) }}
          cnyLabel="人民币实际待确认"
          foreignLabel={(currency) => `${currency} 实际待确认`}
          totalLabel="折人民币待确认总额"
        />
      ),
      note: "待确认不计入经营数据",
      tone: styles.metricOrange,
    },
    {
      label: "本月收款笔数",
      value: `${Number(summary.currentMonthCount || 0)} 笔`,
      note: "按当前筛选条件统计",
      tone: styles.metricBlue,
    },
  ];

  return (
    <div className={styles.metricGrid} aria-label="收款汇总统计">
      {cards.map((card) => (
        <article key={card.label} className={`${styles.metricCard} ${card.tone}`}>
          <span>{card.label}</span>
          {typeof card.value === "string" ? <strong>{card.value}</strong> : <div className={styles.metricValue}>{card.value}</div>}
          <small>{card.note}</small>
        </article>
      ))}
    </div>
  );
}
