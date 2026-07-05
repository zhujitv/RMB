"use client";

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { formatCny, formatPercent } from "../formatters";
import styles from "../WorkspaceShell.module.css";
import { CommissionPanel, CostStructurePanel, LowMarginPanel, RiskPanel, SalespersonCollectionPanel, SalespersonProfitPanel, SectionTitle, TrendPanel } from "./dashboard/panels";
import type { OverviewResponse } from "./dashboard/types";
import { sumBy } from "./dashboard/utils";

const currentMonth = new Date().toISOString().slice(0, 7);
const OVERVIEW_TIMEOUT_MS = 15000;

export function DashboardModule() {
  const [month, setMonth] = useState(currentMonth);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [overview, setOverview] = useState<OverviewResponse["overview"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadOverview(nextMonth = month, nextKeyword = submittedKeyword) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (nextMonth) params.set("month", nextMonth);
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<OverviewResponse>(`/api/overview?${params}`, { timeoutMs: OVERVIEW_TIMEOUT_MS });
      setOverview(result.overview || null);
    } catch (loadError) {
      const detail = loadError instanceof Error ? loadError.message : "";
      setError(detail && detail !== "统计数据加载失败" ? `统计数据加载失败：${detail}` : "统计数据加载失败");
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview(currentMonth, "");
  }, []);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      void loadOverview(month, value);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, month, submittedKeyword]);

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    void loadOverview(month, value);
  }

  function resetSearch() {
    setMonth(currentMonth);
    setKeyword("");
    setSubmittedKeyword("");
    void loadOverview(currentMonth, "");
  }

  const totals = overview?.totals || {};
  const overdueAmount = useMemo(() => sumBy(overview?.overdueTop || [], (row) => Number(row.unpaid || 0)), [overview]);
  const metrics = [
    { label: "应收总额", value: formatCny(totals.receivable), note: `${Number(totals.orderCount || 0)} 个订单`, tone: styles.metricBlue },
    { label: "已收回款", value: formatCny(totals.confirmed), note: "只统计已到账收款", tone: styles.metricGreen },
    { label: "未收余额", value: formatCny(totals.outstanding), note: "最终应收 - 已到账", tone: styles.metricOrange },
    { label: "逾期金额", value: formatCny(overdueAmount), note: `${Number(totals.overdueOrders || 0)} 个逾期订单`, tone: styles.metricRed },
    { label: "预计毛利", value: formatCny(totals.expectedProfit), note: "最终应收 - 已确认总成本", tone: Number(totals.expectedProfit || 0) >= 0 ? styles.metricGreen : styles.metricRed },
    { label: "预计毛利率", value: formatPercent(totals.expectedGrossMargin), note: "订单盈利能力", tone: styles.metricBlue },
    { label: "已实现毛利", value: formatCny(totals.realizedProfit), note: "收齐订单：最终应收 - 总成本", tone: Number(totals.realizedProfit || 0) >= 0 ? styles.metricGreen : styles.metricRed },
    { label: "业务员提成", value: formatCny(totals.commissionAmount), note: "按当前提成口径统计", tone: styles.metricBlue },
  ];

  const activeFilterText = [
    month || "全部月份",
    submittedKeyword || "",
  ].filter(Boolean).join(" / ");

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>经营总览</h2>
        </div>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => loadOverview()}>
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className={styles.listToolbar}>
        <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 业务员"
        />
        <button className={styles.primaryButtonCompact} type="button" disabled={loading} onClick={submitSearch}>查询</button>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={resetSearch}>重置</button>
        <span className={styles.filterHint}>当前筛选：{activeFilterText}</span>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}

      {loading ? (
        <div className={styles.emptyState}>数据加载中...</div>
      ) : overview ? (
        <div className={styles.dashboardStack}>
          <section>
            <SectionTitle eyebrow="01" title="核心经营指标" />
            <div className={styles.metricGrid}>
              {metrics.map((metric) => (
                <article key={metric.label} className={`${styles.metricCard} ${metric.tone}`}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small>{metric.note}</small>
                </article>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="02" title="趋势分析" />
            <TrendPanel rows={overview.monthlyTrend || []} />
          </section>

          <section>
            <SectionTitle eyebrow="03" title="风险预警" />
            <div className={styles.dashboardTwoColumns}>
              <RiskPanel title="逾期应收 Top10" rows={overview.overdueTop || []} mode="overdue" />
              <RiskPanel title="即将到期 Top10" rows={overview.dueSoonTop || []} mode="dueSoon" />
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="04" title="利润分析" />
            <div className={styles.dashboardTwoColumns}>
              <LowMarginPanel rows={overview.lowMarginOrders || []} />
              <CostStructurePanel rows={overview.costStructure || []} />
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="05" title="业务员绩效" />
            <div className={styles.overviewPanels}>
              <SalespersonCollectionPanel rows={overview.salespersonCollections || []} />
              <CommissionPanel rows={overview.commissionRank || []} />
              <SalespersonProfitPanel rows={overview.salespersonProfitRank || []} />
            </div>
          </section>
        </div>
      ) : (
        <div className={styles.emptyState}>当前筛选范围内还没有经营数据</div>
      )}
    </section>
  );
}
