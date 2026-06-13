"use client";

import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { formatCny, formatDate, formatPercent } from "../formatters";
import styles from "../WorkspaceShell.module.css";

type OverviewTotals = {
  receivable?: number;
  confirmed?: number;
  outstanding?: number;
  overdueOrders?: number;
  dueSoonOrders?: number;
  expectedProfit?: number;
  expectedGrossMargin?: number | null;
  realizedProfit?: number;
  realizedGrossMargin?: number | null;
  orderCount?: number;
  paymentCount?: number;
  costCount?: number;
};

type OverviewGroup = {
  label?: string;
  amount?: number;
  count?: number;
};

type ReminderOrder = {
  id?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  dueDate?: string;
  summary?: {
    reminderStatus?: string;
    overdueDays?: number;
    outstandingCny?: number;
    arrivedOutstandingCny?: number;
  };
};

type OverviewResponse = {
  overview?: {
    totals?: OverviewTotals;
    costStructure?: OverviewGroup[];
    bySalesperson?: OverviewGroup[];
    byCustomer?: OverviewGroup[];
    byMonth?: OverviewGroup[];
    reminders?: ReminderOrder[];
  };
};

const currentMonth = new Date().toISOString().slice(0, 7);

export function DashboardModule() {
  const [month, setMonth] = useState(currentMonth);
  const [keyword, setKeyword] = useState("");
  const [overview, setOverview] = useState<OverviewResponse["overview"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadOverview(nextMonth = month, nextKeyword = keyword) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (nextMonth) params.set("month", nextMonth);
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<OverviewResponse>(`/api/overview?${params}`);
      setOverview(result.overview || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取经营总览失败");
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview(currentMonth, "");
  }, []);

  function submitSearch() {
    void loadOverview(month, keyword);
  }

  function resetSearch() {
    setMonth(currentMonth);
    setKeyword("");
    void loadOverview(currentMonth, "");
  }

  const totals = overview?.totals || {};
  const metrics = [
    { label: "应收总额", value: formatCny(totals.receivable), note: `${Number(totals.orderCount || 0)} 个订单`, tone: styles.metricBlue },
    { label: "已收回款", value: formatCny(totals.confirmed), note: "只统计已到账收款", tone: styles.metricGreen },
    { label: "未收余额", value: formatCny(totals.outstanding), note: "最终应收 - 已到账", tone: styles.metricRed },
    { label: "逾期订单", value: String(totals.overdueOrders || 0), note: "已过到期日且未收齐", tone: styles.metricOrange },
    { label: "预计毛利", value: formatCny(totals.expectedProfit), note: "最终应收 - 已确认总成本", tone: styles.metricGreen },
    { label: "预计毛利率", value: formatPercent(totals.expectedGrossMargin), note: "预计毛利 ÷ 最终应收", tone: styles.metricBlue },
    { label: "已实现毛利", value: formatCny(totals.realizedProfit), note: "已到账 - 已支付确认成本", tone: styles.metricGreen },
    { label: "已实现毛利率", value: formatPercent(totals.realizedGrossMargin), note: "已实现毛利 ÷ 已到账", tone: styles.metricBlue },
  ];

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <span className={styles.kicker}>React 迁移模块</span>
          <h2>经营总览</h2>
          <p>经营总览只在进入本模块后加载统计数据，不作为登录首页预加载。</p>
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
          placeholder="综合搜索：订单号 / 提单号 / 客户 / 供应商 / 业务员"
        />
        <button className={styles.primaryButtonCompact} type="button" disabled={loading} onClick={submitSearch}>查询</button>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={resetSearch}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}

      {loading ? (
        <div className={styles.emptyState}>数据加载中...</div>
      ) : overview ? (
        <>
          <div className={styles.metricGrid}>
            {metrics.map((metric) => (
              <article key={metric.label} className={`${styles.metricCard} ${metric.tone}`}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.note}</small>
              </article>
            ))}
          </div>

          <div className={styles.overviewPanels}>
            <TrendPanel rows={overview.byMonth || []} />
            <ReminderPanel rows={overview.reminders || []} />
          </div>

          <div className={styles.overviewPanels}>
            <OverviewPanel title="客户应收 Top" rows={overview.byCustomer || []} />
            <OverviewPanel title="业务员应收 Top" rows={overview.bySalesperson || []} />
            <OverviewPanel title="成本结构" rows={overview.costStructure || []} />
          </div>
        </>
      ) : (
        <div className={styles.emptyState}>当前筛选范围内还没有经营数据</div>
      )}
    </section>
  );
}

function TrendPanel({ rows }: { rows: OverviewGroup[] }) {
  const sortedRows = [...rows].sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""))).slice(-12);
  const maxAmount = Math.max(1, ...sortedRows.map((row) => Number(row.amount || 0)));
  return (
    <section className={`${styles.overviewPanel} ${styles.overviewPanelWide}`}>
      <h3>最近月份应收趋势</h3>
      {sortedRows.length ? (
        <div className={styles.trendList}>
          {sortedRows.map((row) => {
            const amount = Number(row.amount || 0);
            return (
              <div key={row.label || "-"} className={styles.trendRow}>
                <span>{row.label || "未填写"}</span>
                <div>
                  <i style={{ width: `${Math.max(6, (amount / maxAmount) * 100)}%` }} />
                </div>
                <strong>{formatCny(amount)}</strong>
              </div>
            );
          })}
        </div>
      ) : (
        <p>当前筛选范围内暂无趋势数据</p>
      )}
    </section>
  );
}

function ReminderPanel({ rows }: { rows: ReminderOrder[] }) {
  const topRows = rows.slice(0, 8);
  return (
    <section className={styles.overviewPanel}>
      <h3>风险预警</h3>
      {topRows.length ? topRows.map((order) => {
        const status = order.summary?.reminderStatus || "-";
        const outstanding = Number(order.summary?.arrivedOutstandingCny ?? order.summary?.outstandingCny ?? 0);
        return (
          <div key={order.id || order.orderNo || order.blNo || "-"} className={styles.reminderRow}>
            <div>
              <strong>{order.orderNo || "-"}</strong>
              <span title={order.customerFullName || order.customerName || ""}>{order.customerShortName || order.customerName || "-"}</span>
            </div>
            <small>{formatDate(order.dueDate)} · {status}{Number(order.summary?.overdueDays || 0) > 0 ? ` ${order.summary?.overdueDays} 天` : ""}</small>
            <b>{formatCny(outstanding)}</b>
          </div>
        );
      }) : (
        <p>当前没有逾期或即将到期订单</p>
      )}
    </section>
  );
}

function OverviewPanel({ title, rows }: { title: string; rows: OverviewGroup[] }) {
  const topRows = rows.slice(0, 6);
  return (
    <section className={styles.overviewPanel}>
      <h3>{title}</h3>
      {topRows.length ? topRows.map((row) => (
        <div key={row.label || "-"} className={styles.overviewRankRow}>
          <span>{row.label || "未填写"}</span>
          <strong>{formatCny(row.amount)}</strong>
          <small>{Number(row.count || 0)} 条</small>
        </div>
      )) : (
        <p>暂无可展示数据</p>
      )}
    </section>
  );
}
