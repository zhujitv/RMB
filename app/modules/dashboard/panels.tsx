import { formatCny, formatDate, formatPercent } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import type { OverviewGroup, RiskOrder, SalespersonRank, TrendRow } from "./types";
import { barHeight, displayCustomer, monthLabel, sumBy } from "./utils";

export function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className={styles.dashboardSectionTitle}>
      <span>{eyebrow}</span>
      <h3>{title}</h3>
    </div>
  );
}

export function TrendPanel({ rows }: { rows: TrendRow[] }) {
  const maxAmount = Math.max(1, ...rows.flatMap((row) => [Number(row.receivable || 0), Number(row.paid || 0), Number(row.unpaid || 0)]));
  return (
    <section className={`${styles.overviewPanel} ${styles.dashboardTrendPanel}`}>
      {maxAmount > 1 ? (
        <>
          <div className={styles.dashboardLegend}>
            <span><i className={styles.legendBlue} />应收</span>
            <span><i className={styles.legendGreen} />回款</span>
            <span><i className={styles.legendOrange} />未收</span>
          </div>
          <div className={styles.dashboardTrendGrid}>
            {rows.map((row) => (
              <div key={row.label || "-"} className={styles.dashboardTrendMonth}>
                <div className={styles.trendBars}>
                  <TrendBar className={styles.trendReceivable} value={row.receivable} max={maxAmount} label={`应收 ${formatCny(row.receivable)}`} />
                  <TrendBar className={styles.trendPaid} value={row.paid} max={maxAmount} label={`回款 ${formatCny(row.paid)}`} />
                  <TrendBar className={styles.trendUnpaid} value={row.unpaid} max={maxAmount} label={`未收 ${formatCny(row.unpaid)}`} />
                </div>
                <span>{monthLabel(row.label)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <EmptyPanel title="最近 12 个月还没有趋势数据" note="录入订单、回款和成本后，这里会显示经营曲线。" />
      )}
    </section>
  );
}

export function RiskPanel({ title, rows, mode }: { title: string; rows: RiskOrder[]; mode: "overdue" | "dueSoon" }) {
  return (
    <section className={styles.overviewPanel}>
      <PanelHead title={title} count={rows.length} />
      {rows.length ? rows.map((row, index) => (
        <article key={row.id || row.orderNo || index} className={`${styles.rankItem} ${mode === "overdue" ? styles.rankDanger : styles.rankWarning}`}>
          <span className={styles.rankIndex}>{index + 1}</span>
          <div className={styles.rankMain}>
            <strong>{displayCustomer(row)} · {row.orderNo || "-"}</strong>
            <small>提单号 {row.blNo || "待发货"} · 到期日 {formatDate(row.dueDate)} · {row.salespersonName || "-"}</small>
          </div>
          <div className={styles.rankValue}>
            <strong>{formatCny(row.unpaid)}</strong>
            <small>{mode === "overdue" ? `逾期 ${Math.abs(Number(row.remainingDays || 0))} 天` : `剩余 ${row.remainingDays ?? "-"} 天`}</small>
          </div>
        </article>
      )) : (
        <EmptyPanel title={mode === "overdue" ? "当前没有逾期应收风险" : "未来 7 天内没有临期应收"} note="筛选变化后会自动更新。" />
      )}
    </section>
  );
}

export function LowMarginPanel({ rows }: { rows: RiskOrder[] }) {
  return (
    <section className={styles.overviewPanel}>
      <PanelHead title="低毛利订单 Top10" count={rows.length} />
      {rows.length ? rows.map((row, index) => (
        <article key={row.id || row.orderNo || index} className={`${styles.rankItem} ${Number(row.expectedGrossMargin || 0) < 0.08 ? styles.rankDanger : ""}`}>
          <span className={styles.rankIndex}>{index + 1}</span>
          <div className={styles.rankMain}>
            <strong>{row.orderNo || "-"} · {displayCustomer(row)}</strong>
            <small>应收 {formatCny(row.receivable)} · 成本 {formatCny(row.cost)} · {row.salespersonName || "-"}</small>
          </div>
          <div className={styles.rankValue}>
            <strong>{formatCny(row.expectedGrossProfit)}</strong>
            <small>毛利率 {formatPercent(row.expectedGrossMargin)}</small>
          </div>
        </article>
      )) : (
        <EmptyPanel title="还没有发现低毛利订单" note="有订单和成本数据后，低毛利风险会在这里聚合。" />
      )}
    </section>
  );
}

export function CostStructurePanel({ rows }: { rows: OverviewGroup[] }) {
  const total = sumBy(rows, (row) => Number(row.amount || 0));
  const palette = [
    styles.costColorBlue,
    styles.costColorGreen,
    styles.costColorOrange,
    styles.costColorPurple,
    styles.costColorTeal,
    styles.costColorRose,
    styles.costColorAmber,
    styles.costColorSlate,
  ];
  let cursor = 0;
  const segments = rows.slice(0, 8).map((row, index) => {
    const start = cursor;
    const end = total > 0 ? cursor + (Number(row.amount || 0) / total) * 100 : cursor;
    cursor = end;
    return { ...row, colorClass: palette[index % palette.length], start, end };
  });
  return (
    <section className={styles.overviewPanel}>
      <PanelHead title="成本结构分析" count={rows.length} />
      {total > 0 ? (
        <div className={styles.costStructureLayout}>
          <div className={styles.donutRing}>
            <DonutSegments segments={segments} />
            <span>总成本<strong>{formatCny(total)}</strong></span>
          </div>
          <div className={styles.costLegendList}>
            {segments.map((row) => (
              <div key={row.label || "-"} className={styles.costLegendRow}>
                <i className={row.colorClass} />
                <span>{row.label || "未填写"}</span>
                <strong>{formatCny(row.amount)}</strong>
                <small>{formatPercent(total > 0 ? Number(row.amount || 0) / total : null)}</small>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyPanel title="还没有成本结构数据" note="录入成本后会自动生成环形分析。" />
      )}
    </section>
  );
}

function TrendBar({ value, max, className, label }: { value: unknown; max: number; className: string; label: string }) {
  const height = barHeight(value, max);
  return (
    <svg className={styles.trendBarSvg} viewBox="0 0 8 100" role="img" aria-label={label}>
      <title>{label}</title>
      <rect className={className} x="0" y={100 - height} width="8" height={height} rx="4" />
    </svg>
  );
}

function DonutSegments({ segments }: { segments: Array<OverviewGroup & { colorClass: string; start: number; end: number }> }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className={styles.donutSvg} viewBox="0 0 120 120" aria-hidden="true">
      <circle className={styles.donutTrack} cx="60" cy="60" r={radius} />
      {segments.map((row) => {
        const length = Math.max(0, ((row.end - row.start) / 100) * circumference);
        const offset = -((row.start / 100) * circumference);
        return (
          <circle
            key={row.label || `${row.start}-${row.end}`}
            className={`${styles.donutSegment} ${row.colorClass}`}
            cx="60"
            cy="60"
            r={radius}
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={offset}
          />
        );
      })}
    </svg>
  );
}

export function SalespersonCollectionPanel({ rows }: { rows: SalespersonRank[] }) {
  return (
    <section className={styles.overviewPanel}>
      <PanelHead title="回款排行" count={rows.length} />
      {rows.length ? rows.map((row, index) => (
        <CompactRank key={row.label || index} index={index} label={row.label} amount={row.paid} note={`回款率 ${formatPercent(row.collectionRate)} · 未收 ${formatCny(row.unpaid)}`} />
      )) : <EmptyPanel title="还没有业务员回款数据" note="收款确认到账后自动形成排行。" />}
    </section>
  );
}

export function CommissionPanel({ rows }: { rows: SalespersonRank[] }) {
  return (
    <section className={styles.overviewPanel}>
      <PanelHead title="提成排行" count={rows.length} />
      {rows.length ? rows.map((row, index) => (
        <CompactRank key={row.label || index} index={index} label={row.label} amount={row.commissionMonth} note={`本年 ${formatCny(row.commissionYear)} · 未结算 ${formatCny(row.commissionPending)}`} />
      )) : <EmptyPanel title="还没有提成排行数据" note="订单回款和成本确认后自动形成排行。" />}
    </section>
  );
}

export function SalespersonProfitPanel({ rows }: { rows: SalespersonRank[] }) {
  return (
    <section className={styles.overviewPanel}>
      <PanelHead title="毛利贡献排行" count={rows.length} />
      {rows.length ? rows.map((row, index) => (
        <CompactRank key={row.label || index} index={index} label={row.label} amount={row.expectedProfit} note={`毛利率 ${formatPercent(row.expectedGrossMargin)} · 应收 ${formatCny(row.receivable)}`} />
      )) : <EmptyPanel title="还没有毛利贡献数据" note="录入订单和成本后自动展示。" />}
    </section>
  );
}

function PanelHead({ title, count }: { title: string; count: number }) {
  return (
    <div className={styles.panelHead}>
      <h3>{title}</h3>
      <span>{count} 条</span>
    </div>
  );
}

function CompactRank({ index, label, amount, note }: { index: number; label?: string; amount?: number; note: string }) {
  return (
    <article className={styles.rankItem}>
      <span className={styles.rankIndex}>{index + 1}</span>
      <div className={styles.rankMain}>
        <strong>{label || "未填写"}</strong>
        <small>{note}</small>
      </div>
      <div className={styles.rankValue}>
        <strong>{formatCny(amount)}</strong>
      </div>
    </article>
  );
}

function EmptyPanel({ title, note }: { title: string; note: string }) {
  return (
    <div className={styles.dashboardEmpty}>
      <strong>{title}</strong>
      <small>{note}</small>
    </div>
  );
}
