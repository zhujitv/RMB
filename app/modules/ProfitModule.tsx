"use client";

import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, DetailField, PaginationBar, SideDetailDrawer, useConfirmationDialog } from "../components";
import { formatCny, formatPercent } from "../formatters";
import { ResponsiveDataView } from "../ResponsiveDataView";
import type { User } from "../types";
import { customerDisplayName, customerLegalName } from "../utils";
import styles from "../WorkspaceShell.module.css";

type ProfitSummary = {
  receivableCny?: number;
  arrivedPaymentsCny?: number;
  confirmedTotalCostCny?: number;
  totalCostCny?: number;
  logisticsCostCny?: number;
  commissionBaseCny?: number;
  commissionFormulaLabel?: string;
  commissionFormulaDescription?: string;
  taxLogisticsCostsComplete?: boolean;
  taxLogisticsMissingLabels?: string[];
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

export function ProfitModule({ currentUser }: { currentUser: User }) {
  const [rows, setRows] = useState<ProfitRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [detailRow, setDetailRow] = useState<ProfitRow | null>(null);
  const [settlingId, setSettlingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canSettleCommission = ["管理员", "财务"].includes(currentUser.role);

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

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setDetailRow(null);
      setNotice("");
      void loadRows(1, value);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, submittedKeyword]);

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setDetailRow(null);
    setNotice("");
    void loadRows(1, value);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setDetailRow(null);
    setNotice("");
    void loadRows(1, "");
  }

  function gotoPage(nextPage: number) {
    setDetailRow(null);
    setNotice("");
    void loadRows(nextPage, submittedKeyword);
  }

  async function settleCommission(row: ProfitRow) {
    const summary = row.summary || {};
    const confirmationResult = await requestConfirmation({
      title: "确认结算该订单业务员提成？",
      message: "结算后将写入提成结算记录，并刷新利润分析列表。",
      details: [
      `订单号：${row.orderNo || "-"}`,
      `已到账：${formatCny(summary.arrivedPaymentsCny)}`,
      `物流成本：${formatCny(summary.logisticsCostCny)}`,
      `提成基数：${formatCny(summary.commissionBaseCny)}`,
      `提成比例：${Number(summary.commissionRate || 0).toFixed(2)}%`,
      `应结算提成：${formatCny(summary.commissionAmountCny ?? summary.estimatedCommissionCny)}`,
      ],
      confirmLabel: "确认结算",
      cancelLabel: "取消",
      variant: "warning",
    });
    if (!confirmationResult.confirmed) return;
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
      setDetailRow(row);
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
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 业务员"
        />
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <ResponsiveDataView
        mobile={(
          <div className={styles.mobileCardList}>
            {loading ? (
              <div className={styles.emptyState}>数据加载中...</div>
            ) : rows.length ? (
              rows.map((row) => (
                <ProfitMobileCard
                  key={row.id}
                  row={row}
                  onViewDetail={() => setDetailRow(row)}
                />
              ))
            ) : (
              <div className={styles.emptyState}>未找到匹配的利润分析订单</div>
            )}
          </div>
        )}
        desktop={(
          <div className={`${styles.tableWrap} ${styles.tablePinnedTwoCols}`}>
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
                    onViewDetail={() => setDetailRow(row)}
                    settling={settlingId === row.id}
                    canSettleCommission={canSettleCommission}
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
        )}
      />

      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={gotoPage} />
      {detailRow ? (
        <ProfitDetailDrawer
          row={detailRow}
          settling={settlingId === detailRow.id}
          canSettleCommission={canSettleCommission}
          onSettle={() => void settleCommission(detailRow)}
          onClose={() => setDetailRow(null)}
        />
      ) : null}
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={cancelConfirmation}
          onConfirm={confirmConfirmation}
          onInputChange={updateConfirmationInput}
        />
      ) : null}
    </section>
  );
}

function ProfitRows({
  row,
  settling,
  canSettleCommission,
  onViewDetail,
  onSettle,
}: {
  row: ProfitRow;
  settling: boolean;
  canSettleCommission: boolean;
  onViewDetail: () => void;
  onSettle: () => void;
}) {
  const summary = row.summary || {};
  const commissionCanSettle = canSettleCommission && Boolean(summary.commissionCanSettle);
  return (
    <>
      <tr className={styles.clickableRow} onClick={onViewDetail}>
        <td><strong>{row.orderNo || "-"}</strong></td>
        <td title={customerLegalName(row)}>{customerDisplayName(row)}</td>
        <td>{formatCny(summary.receivableCny)}</td>
        <td>{formatCny(summary.confirmedTotalCostCny ?? summary.totalCostCny)}</td>
        <td><strong>{formatCny(summary.expectedGrossProfit)}</strong></td>
        <td>{formatPercent(summary.expectedGrossMargin)}</td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(); }}>详情</button></td>
      </tr>
    </>
  );
}

function ProfitMobileCard({
  row,
  onViewDetail,
}: {
  row: ProfitRow;
  onViewDetail: () => void;
}) {
  const summary = row.summary || {};
  return (
    <article className={styles.mobileDataCard}>
      <div className={styles.mobileDataHeader}>
        <div className={styles.mobileDataMeta}>
          <strong>{row.orderNo || "-"}</strong>
          <span title={customerLegalName(row)}>{customerDisplayName(row)}</span>
          <span>业务员：{row.salespersonName || "-"}</span>
        </div>
        <span className={`${styles.statusPill} ${summary.commissionCanSettle ? styles.statusSuccess : styles.statusMuted}`}>
          {summary.commissionStatus || row.commissionStatus || "-"}
        </span>
      </div>
      <div className={styles.mobileMetricGrid}>
        <div className={styles.mobileMetricItem}>
          <span>最终应收</span>
          <strong>{formatCny(summary.receivableCny)}</strong>
        </div>
        <div className={styles.mobileMetricItem}>
          <span>总成本</span>
          <strong>{formatCny(summary.confirmedTotalCostCny ?? summary.totalCostCny)}</strong>
        </div>
        <div className={styles.mobileMetricItem}>
          <span>预计毛利</span>
          <strong>{formatCny(summary.expectedGrossProfit)}</strong>
        </div>
        <div className={styles.mobileMetricItem}>
          <span>预计毛利率</span>
          <strong>{formatPercent(summary.expectedGrossMargin)}</strong>
        </div>
      </div>
      <div className={styles.mobileDataActions}>
        <button className={styles.rowDetailButton} type="button" onClick={onViewDetail}>详情</button>
      </div>
    </article>
  );
}

function ProfitDetailDrawer({
  row,
  settling,
  canSettleCommission,
  onSettle,
  onClose,
}: {
  row: ProfitRow;
  settling: boolean;
  canSettleCommission: boolean;
  onSettle: () => void;
  onClose: () => void;
}) {
  const summary = row.summary || {};
  const commissionCanSettle = canSettleCommission && Boolean(summary.commissionCanSettle);
  return (
    <SideDetailDrawer
      ariaLabel="利润分析详情"
      kicker="利润分析"
      title={`${row.orderNo || "-"} · ${customerLegalName(row)}`}
      subtitle={`提单号：${row.blNo || "-"} · 业务员：${row.salespersonName || "-"}`}
      onClose={onClose}
      actions={commissionCanSettle ? (
        <button className={styles.primaryButtonCompact} type="button" disabled={settling} onClick={onSettle}>
          {settling ? "结算中..." : "结算提成"}
        </button>
      ) : undefined}
    >
      <div className={styles.detailGrid}>
        <DetailField label="客户全称" value={customerLegalName(row)} wide />
        <DetailField label="订单号" value={row.orderNo || "-"} />
        <DetailField label="提单号" value={row.blNo || "-"} />
        <DetailField label="业务员" value={row.salespersonName || "-"} />
        <DetailField label="最终应收" value={formatCny(summary.receivableCny)} />
        <DetailField label="已到账金额" value={formatCny(summary.arrivedPaymentsCny)} />
        <DetailField label="总成本" value={formatCny(summary.confirmedTotalCostCny ?? summary.totalCostCny)} />
        <DetailField label="物流成本" value={formatCny(summary.logisticsCostCny)} />
        <DetailField label="预计毛利" value={formatCny(summary.expectedGrossProfit)} />
        <DetailField label="预计毛利率" value={formatPercent(summary.expectedGrossMargin)} />
        <DetailField label="已实现毛利" value={formatCny(summary.realizedGrossProfit)} />
        <DetailField label="已实现毛利率" value={formatPercent(summary.realizedGrossMargin)} />
        <DetailField label="提成公式" value={summary.commissionFormulaLabel || summary.commissionFormulaDescription || "-"} />
        <DetailField label="提成前置缺失" value={(summary.taxLogisticsMissingLabels || []).join("、") || "-"} wide />
        <DetailField label="提成基数" value={formatCny(summary.commissionBaseCny)} />
        <DetailField label="业务员提成" value={formatCny(summary.commissionAmountCny ?? summary.estimatedCommissionCny)} />
        <DetailField label="提成比例" value={`${Number(summary.commissionRate || 0).toFixed(2)}%`} />
        <DetailField label="提成状态" value={summary.commissionStatus || row.commissionStatus || "-"} />
        <DetailField label="结算人" value={row.commissionSettledByName || "-"} />
        <DetailField label="结算时间" value={row.commissionSettledAt ? new Date(row.commissionSettledAt).toLocaleString("zh-CN") : "-"} />
        <DetailField label="成本结构" value={costGroupText(summary.costGroups)} wide />
      </div>
    </SideDetailDrawer>
  );
}

function costGroupText(groups?: Record<string, number>) {
  const entries = Object.entries(groups || {}).filter(([, value]) => Number(value || 0) !== 0);
  if (!entries.length) return "-";
  return entries.map(([label, value]) => `${label} ${formatCny(value)}`).join(" / ");
}
