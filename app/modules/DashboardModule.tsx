"use client";

import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { formatCny, formatPercent } from "../formatters";
import styles from "../WorkspaceShell.module.css";
import { AmountBreakdownPanel, CommissionPanel, CostStructurePanel, LowMarginPanel, PeriodComparisonPanel, RiskPanel, SalespersonCollectionPanel, SalespersonProfitPanel, SectionTitle, TrendPanel } from "./dashboard/panels";
import type { OverviewGroup, OverviewResponse, RiskOrder } from "./dashboard/types";

const currentMonth = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
const OVERVIEW_TIMEOUT_MS = 15000;

type DashboardOpenTarget = "orders" | "payments" | "costs" | "profit" | "reports";

export function DashboardModule({ onOpenModule }: { onOpenModule?: (target: DashboardOpenTarget, keyword?: string) => void }) {
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
  const exchangeDifference = Number(totals.exchangeDifference || 0);
  const periodMetrics = [
    { label: "新增订单额", value: formatCny(totals.receivable), note: `${Number(totals.orderCount || 0)} 单 · ${Number(totals.customerCount || 0)} 个客户`, tone: styles.metricBlue, target: "orders" as const },
    { label: "实际到账回款", value: formatCny(totals.confirmed), note: `${Number(totals.paymentCount || 0)} 笔已到账收款`, tone: styles.metricGreen, target: "payments" as const },
    { label: "新增已确认成本", value: formatCny(totals.confirmedCost), note: `${Number(totals.costCount || 0)} 笔本期确认成本`, tone: styles.metricOrange, target: "costs" as const },
    { label: "实际成本付款", value: formatCny(totals.costPayments), note: "按成本实际支付日期统计", tone: styles.metricOrange, target: "costs" as const },
    { label: "现金净流入", value: formatCny(totals.netCashFlow), note: "实际回款 - 实际成本付款", tone: Number(totals.netCashFlow || 0) >= 0 ? styles.metricGreen : styles.metricRed, target: "payments" as const },
    { label: "新单预计毛利", value: formatCny(totals.expectedProfit), note: "最终应收 - 已确认成本", tone: Number(totals.expectedProfit || 0) >= 0 ? styles.metricGreen : styles.metricRed, target: "profit" as const },
    { label: "新单预计毛利率", value: formatPercent(totals.expectedGrossMargin), note: `统计 ${Number(totals.profitMarginEligibleOrders || 0)} 单已发货或已提交退税归档订单`, tone: styles.metricBlue, target: "profit" as const },
    { label: "本期汇兑差额", value: formatCny(exchangeDifference), note: "正数为收益，负数为损失", tone: exchangeDifference >= 0 ? styles.metricGreen : styles.metricRed, target: "orders" as const },
  ];
  const riskMetrics = [
    { label: "当前未收余额", value: formatCny(totals.outstanding), note: `${Number(totals.activeOrders || 0)} 单仍有余额`, tone: styles.metricOrange, target: "reports" as const },
    { label: "逾期应收总额", value: formatCny(totals.overdueAmount), note: `${Number(totals.overdueOrders || 0)} 个逾期订单，统计全部而非 Top10`, tone: styles.metricRed, target: "reports" as const },
    { label: "未来 7 天到期", value: formatCny(totals.dueSoonAmount), note: `${Number(totals.dueSoonOrders || 0)} 个临期订单`, tone: styles.metricOrange, target: "reports" as const },
    { label: "待确认成本", value: formatCny(totals.pendingCostAmount), note: `${Number(totals.pendingCostOrders || 0)} 个订单存在未确认成本`, tone: Number(totals.pendingCostOrders || 0) > 0 ? styles.metricOrange : styles.metricGreen, target: "costs" as const },
    { label: "缺少成本订单", value: `${Number(totals.missingCostOrders || 0)} 单`, note: "已有应收但未录入有效成本", tone: Number(totals.missingCostOrders || 0) > 0 ? styles.metricRed : styles.metricGreen, target: "costs" as const },
    { label: "亏损订单", value: `${Number(totals.negativeMarginOrders || 0)} 单`, note: "统计已发货或已提交退税归档且预计毛利小于 0 的订单", tone: Number(totals.negativeMarginOrders || 0) > 0 ? styles.metricRed : styles.metricGreen, target: "profit" as const },
    { label: "低毛利订单", value: `${Number(totals.lowMarginOrders || 0)} 单`, note: "统计已发货或已提交退税归档且毛利率低于 8% 的订单", tone: Number(totals.lowMarginOrders || 0) > 0 ? styles.metricOrange : styles.metricGreen, target: "profit" as const },
    { label: "本期业务员提成", value: formatCny(totals.commissionAmount), note: Number(totals.commissionSnapshotMissingOrders || 0) > 0 ? `${Number(totals.commissionSnapshotMissingOrders)} 单缺少历史快照` : "按当前提成口径统计", tone: styles.metricBlue, target: "profit" as const },
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
        <div className={styles.detailActions}>
          <button className={styles.secondaryButton} type="button" onClick={() => onOpenModule?.("reports")}>打开报表中心</button>
          <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => loadOverview()}>
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
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
      {overview?.dataWarnings?.length ? <div className={styles.inlineError}>{overview.dataWarnings.join("；")}</div> : null}

      {loading ? (
        <div className={styles.emptyState}>数据加载中...</div>
      ) : overview ? (
        <div className={styles.dashboardStack}>
          <section>
            <SectionTitle eyebrow="01" title="本期真实发生额" />
            <div className={styles.metricGrid}>
              {periodMetrics.map((metric) => (
                <button key={metric.label} type="button" className={`${styles.metricCard} ${styles.metricCardButton} ${metric.tone}`} onClick={() => onOpenModule?.(metric.target)}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small>{metric.note}</small>
                </button>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="02" title="当前资金与数据风险" />
            <div className={styles.metricGrid}>
              {riskMetrics.map((metric) => (
                <button key={metric.label} type="button" className={`${styles.metricCard} ${styles.metricCardButton} ${metric.tone}`} onClick={() => onOpenModule?.(metric.target)}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small>{metric.note}</small>
                </button>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="03" title="与上月对比" />
            <PeriodComparisonPanel rows={overview.periodComparison || []} previousMonth={overview.period?.previousMonth} />
          </section>

          <section>
            <SectionTitle eyebrow="04" title="近 12 个月真实收支趋势" />
            <TrendPanel rows={overview.monthlyTrend || []} />
          </section>

          <section>
            <SectionTitle eyebrow="05" title="账龄、客户与订单结构" />
            <div className={styles.overviewPanels}>
              <AmountBreakdownPanel title="应收账龄" rows={overview.agingBuckets || []} emptyText="当前没有应收余额" />
              <AmountBreakdownPanel title="本期客户贡献 Top10" rows={overview.customerRank || []} emptyText="本期没有客户订单" onSelect={(row: OverviewGroup) => onOpenModule?.("orders", row.label)} />
              <AmountBreakdownPanel title="本期订单状态" rows={overview.statusDistribution || []} emptyText="本期没有订单状态数据" />
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="06" title="应收风险明细" />
            <div className={styles.dashboardTwoColumns}>
              <RiskPanel title="逾期应收 Top10" rows={overview.overdueTop || []} mode="overdue" onOpenOrder={(row: RiskOrder) => onOpenModule?.("orders", row.orderNo)} />
              <RiskPanel title="即将到期 Top10" rows={overview.dueSoonTop || []} mode="dueSoon" onOpenOrder={(row: RiskOrder) => onOpenModule?.("orders", row.orderNo)} />
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="07" title="利润与成本分析" />
            <div className={styles.dashboardTwoColumns}>
              <LowMarginPanel rows={overview.lowMarginOrders || []} onOpenOrder={(row: RiskOrder) => onOpenModule?.("orders", row.orderNo)} />
              <CostStructurePanel rows={overview.costStructure || []} />
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="08" title="业务员绩效" />
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
