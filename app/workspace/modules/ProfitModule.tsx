"use client";

import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { DetailField, PaginationBar } from "../components";
import { formatCny, formatPercent } from "../formatters";
import styles from "../WorkspaceShell.module.css";

type ProfitSummary = {
  receivableCny?: number;
  arrivedPaymentsCny?: number;
  confirmedTotalCostCny?: number;
  totalCostCny?: number;
  expectedGrossProfit?: number;
  expectedGrossMargin?: number | null;
  realizedGrossProfit?: number;
  realizedGrossMargin?: number | null;
  commissionAmountCny?: number;
  estimatedCommissionCny?: number;
  commissionRate?: number;
  commissionCanSettle?: boolean;
  commissionStatus?: string;
  costGroups?: Record<string, number>;
};

type ProfitRow = {
  id: string;
  orderNo?: string;
  blNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  salespersonName?: string;
  commissionStatus?: string;
  commissionSettledByName?: string;
  commissionSettledAt?: string | null;
  summary?: ProfitSummary;
};

type ProfitResponse = {
  data?: {
    rows?: ProfitRow[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
};

const PAGE_SIZE = 20;

export function ProfitModule() {
  const [rows, setRows] = useState<ProfitRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [settlingId, setSettlingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadRows(nextPage = page, nextKeyword = submittedKeyword) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<ProfitResponse>(`/api/profit?${params}`);
      const data = result.data || {};
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取利润分析失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows(1, "");
  }, []);

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setExpandedId("");
    setNotice("");
    void loadRows(1, value);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setExpandedId("");
    setNotice("");
    void loadRows(1, "");
  }

  function gotoPage(nextPage: number) {
    setExpandedId("");
    setNotice("");
    void loadRows(nextPage, submittedKeyword);
  }

  async function settleCommission(row: ProfitRow) {
    const summary = row.summary || {};
    const message = [
      "确认结算该订单业务员提成？",
      "",
      `订单号：${row.orderNo || "-"}`,
      `已到账：${formatCny(summary.arrivedPaymentsCny)}`,
      `已确认总成本：${formatCny(summary.confirmedTotalCostCny ?? summary.totalCostCny)}`,
      `预计毛利：${formatCny(summary.expectedGrossProfit)}`,
      `提成比例：${Number(summary.commissionRate || 0).toFixed(2)}%`,
      `应结算提成：${formatCny(summary.commissionAmountCny ?? summary.estimatedCommissionCny)}`,
    ].join("\n");
    if (!window.confirm(message)) return;
    setSettlingId(row.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(
        `/api/commissions/${encodeURIComponent(row.id)}/settle`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      if (result.success !== true) throw new Error(result.message || "结算业务员提成失败");
      await loadRows(page, submittedKeyword);
      setExpandedId(row.id);
      setNotice(result.message || "业务员提成已结算");
    } catch (settleError) {
      setError(settleError instanceof Error ? settleError.message : "结算业务员提成失败");
    } finally {
      setSettlingId("");
    }
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <span className={styles.kicker}>React 迁移模块</span>
          <h2>利润分析</h2>
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={() => {
            setNotice("");
            void loadRows(page);
          }}
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 提单号 / 客户 / 供应商 / 业务员"
        />
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>订单号</th>
              <th>客户简称</th>
              <th>最终应收</th>
              <th>总成本</th>
              <th>预计毛利</th>
              <th>预计毛利率</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : rows.length ? rows.map((row) => (
              <ProfitRows
                key={row.id}
                row={row}
                expanded={expandedId === row.id}
                onToggle={() => setExpandedId((current) => current === row.id ? "" : row.id)}
                settling={settlingId === row.id}
                onSettle={() => void settleCommission(row)}
              />
            )) : (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>未找到匹配的利润分析订单</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={gotoPage} />
    </section>
  );
}

function ProfitRows({
  row,
  expanded,
  settling,
  onToggle,
  onSettle,
}: {
  row: ProfitRow;
  expanded: boolean;
  settling: boolean;
  onToggle: () => void;
  onSettle: () => void;
}) {
  const summary = row.summary || {};
  const commissionCanSettle = Boolean(summary.commissionCanSettle);
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td><strong>{row.orderNo || "-"}</strong></td>
        <td title={row.customerFullName || row.customerName || ""}>{row.customerShortName || row.customerName || "-"}</td>
        <td>{formatCny(summary.receivableCny)}</td>
        <td>{formatCny(summary.confirmedTotalCostCny ?? summary.totalCostCny)}</td>
        <td><strong>{formatCny(summary.expectedGrossProfit)}</strong></td>
        <td>{formatPercent(summary.expectedGrossMargin)}</td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={7}>
            <div className={styles.detailCard}>
              <div className={styles.detailActions}>
                {commissionCanSettle ? (
                  <button
                    className={styles.primaryButtonCompact}
                    type="button"
                    disabled={settling}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSettle();
                    }}
                  >
                    {settling ? "结算中..." : "结算提成"}
                  </button>
                ) : null}
              </div>
              <div className={styles.detailGrid}>
                <DetailField label="客户全称" value={row.customerFullName || row.customerName || "-"} wide />
                <DetailField label="订单号" value={row.orderNo || "-"} />
                <DetailField label="提单号" value={row.blNo || "-"} />
                <DetailField label="业务员" value={row.salespersonName || "-"} />
                <DetailField label="已到账金额" value={formatCny(summary.arrivedPaymentsCny)} />
                <DetailField label="已实现毛利" value={formatCny(summary.realizedGrossProfit)} />
                <DetailField label="已实现毛利率" value={formatPercent(summary.realizedGrossMargin)} />
                <DetailField label="业务员提成" value={formatCny(summary.commissionAmountCny ?? summary.estimatedCommissionCny)} />
                <DetailField label="提成比例" value={`${Number(summary.commissionRate || 0).toFixed(2)}%`} />
                <DetailField label="提成状态" value={summary.commissionStatus || row.commissionStatus || "-"} />
                <DetailField label="结算人" value={row.commissionSettledByName || "-"} />
                <DetailField label="结算时间" value={row.commissionSettledAt ? new Date(row.commissionSettledAt).toLocaleString("zh-CN") : "-"} />
                <DetailField label="成本结构" value={costGroupText(summary.costGroups)} wide />
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function costGroupText(groups?: Record<string, number>) {
  const entries = Object.entries(groups || {}).filter(([, value]) => Number(value || 0) !== 0);
  if (!entries.length) return "-";
  return entries.map(([label, value]) => `${label} ${formatCny(value)}`).join(" / ");
}
