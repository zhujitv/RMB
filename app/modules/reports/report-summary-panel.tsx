import { formatCny, formatPercent } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import type { ReportSummary, ReportSummaryMetric } from "./model";

function metricTone(metric: ReportSummaryMetric) {
  if (metric.tone === "positive") return styles.metricGreen;
  if (metric.tone === "warning") return styles.metricOrange;
  if (metric.tone === "danger") return styles.metricRed;
  return styles.metricBlue;
}

function metricValue(metric: ReportSummaryMetric) {
  if (metric.format === "money") return formatCny(metric.value);
  if (metric.format === "percent") return formatPercent(metric.value);
  if (metric.format === "days") return `${Number(metric.value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 天`;
  return Number(metric.value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

export function ReportSummaryPanel({ summary }: { summary?: ReportSummary }) {
  if (!summary?.metrics?.length) return null;
  return (
    <section>
      <div className={styles.dashboardSectionTitle}>
        <span>汇</span>
        <h3>查询结果经营摘要</h3>
      </div>
      <div className={styles.infoStrip}>以下汇总基于全部筛选结果，不只是当前页。</div>
      <div className={styles.metricGrid}>
        {summary.metrics.map((metric) => (
          <article key={metric.key} className={`${styles.metricCard} ${metricTone(metric)}`}>
            <span>{metric.label}</span>
            <strong>{metricValue(metric)}</strong>
            <small>{metric.note || "随筛选条件实时计算"}</small>
          </article>
        ))}
      </div>
      {summary.breakdowns?.length ? (
        <div className={styles.dashboardTwoColumns}>
          {summary.breakdowns.map((group) => (
            <section key={group.title} className={styles.overviewPanel}>
              <div className={styles.panelHead}>
                <h3>{group.title}</h3>
                <span>{group.items.length} 项</span>
              </div>
              {group.items.map((item) => (
                <div key={item.label} className={styles.overviewRankRow}>
                  <span>{item.label}</span>
                  <small>{item.count} 条 · {formatPercent(item.share)}</small>
                  <strong>{group.format === "number" ? Number(item.amount).toLocaleString("zh-CN") : formatCny(item.amount)}</strong>
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
