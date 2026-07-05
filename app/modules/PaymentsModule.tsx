"use client";

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, CurrencyTotalsDisplay, PaginationBar, useConfirmationDialog } from "../components";
import { formatCny, moneyText } from "../formatters";
import { customerDisplayName } from "../utils";
import styles from "../WorkspaceShell.module.css";
import type { User } from "../types";
import { PaymentDetailDrawer } from "./payments/payment-detail-drawer";
import { PaymentTableRows } from "./payments/payment-table-rows";
import { QuickCreatePaymentPanel } from "./payments/quick-payment-panel";
import { CURRENCIES, PAGE_SIZE, PAYMENT_STATUSES, PAYMENT_TYPES, emptyPaymentFilters, type PaymentFilters, type PaymentRow, type PaymentSummary, type PaymentsResponse } from "./payments/types";

export function PaymentsModule({
  currentUser,
  initialKeyword = "",
  initialOpenToken = 0,
}: {
  currentUser: User;
  initialKeyword?: string;
  initialOpenToken?: number;
}) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [summary, setSummary] = useState<PaymentSummary>({});
  const [filters, setFilters] = useState<PaymentFilters>({ ...emptyPaymentFilters });
  const [submittedFilters, setSubmittedFilters] = useState<PaymentFilters>({ ...emptyPaymentFilters });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [detailPayment, setDetailPayment] = useState<PaymentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<PaymentRow | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canManagePayments = ["管理员", "财务"].includes(currentUser.role);
  const summaryCards = useMemo(() => ([
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
  ]), [summary]);

  async function loadPayments(nextPage = page, nextFilters = submittedFilters) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        workspace: "1",
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextFilters.keyword.trim()) params.set("keyword", nextFilters.keyword.trim());
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (key === "keyword") return;
        const text = String(value || "").trim();
        if (text) params.set(key, text);
      });
      const result = await apiJson<PaymentsResponse>(`/api/payments?${params}`);
      const data = result.data || {};
      setPayments(Array.isArray(data.rows) ? data.rows : Array.isArray(result.payments) ? result.payments : []);
      setSummary(data.summary || result.summary || {});
      setTotal(Number(data.total ?? result.payments?.length ?? 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取收款明细失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPayments(1, { ...emptyPaymentFilters });
  }, []);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    const nextFilters = { ...emptyPaymentFilters, keyword: value };
    setFilters(nextFilters);
    setSubmittedFilters(nextFilters);
    setDetailPayment(null);
    setNotice("");
    void loadPayments(1, nextFilters);
  }, [initialKeyword, initialOpenToken]);

  useEffect(() => {
    const value = filters.keyword.trim();
    if (value === submittedFilters.keyword) return;
    const timer = window.setTimeout(() => {
      const nextFilters = {
        ...filters,
        keyword: value,
        month: filters.month.trim(),
        currency: filters.currency.trim(),
        paymentType: filters.paymentType.trim(),
        paymentStatus: filters.paymentStatus.trim(),
      };
      setSubmittedFilters(nextFilters);
      setDetailPayment(null);
      setNotice("");
      void loadPayments(1, nextFilters);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.keyword, filters.month, filters.currency, filters.paymentType, filters.paymentStatus, submittedFilters.keyword]);

  function setFilter<K extends keyof PaymentFilters>(key: K, value: PaymentFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function submitSearch() {
    setDetailPayment(null);
    setNotice("");
    const nextFilters = Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [key, String(value || "").trim()]),
    ) as PaymentFilters;
    setSubmittedFilters(nextFilters);
    void loadPayments(1, nextFilters);
  }

  function resetSearch() {
    setFilters({ ...emptyPaymentFilters });
    setSubmittedFilters({ ...emptyPaymentFilters });
    setDetailPayment(null);
    setNotice("");
    void loadPayments(1, { ...emptyPaymentFilters });
  }

  function gotoPage(nextPage: number) {
    setDetailPayment(null);
    setNotice("");
    void loadPayments(nextPage, submittedFilters);
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>收款管理</h2>
        </div>
        <div className={styles.headerActions}>
          {canManagePayments ? (
            <button
              className={styles.primaryButtonCompact}
              type="button"
              onClick={() => {
                setEditPayment(null);
                setCreateOpen((current) => !current);
              }}
            >
              {createOpen ? "收起登记" : "登记收款"}
            </button>
          ) : null}
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => {
              setNotice("");
              void loadPayments(page, submittedFilters);
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {canManagePayments && (createOpen || editPayment) ? (
        <QuickCreatePaymentPanel
          initialPayment={editPayment}
          canConfirmArrived={canManagePayments}
          onCancel={() => {
            setCreateOpen(false);
            setEditPayment(null);
          }}
          onSaved={() => {
            setCreateOpen(false);
            setEditPayment(null);
            setDetailPayment(null);
            setNotice(editPayment ? "收款已更新" : "收款已保存");
            void loadPayments(1, submittedFilters);
          }}
        />
      ) : null}

      <div className={styles.metricGrid} aria-label="收款汇总统计">
        {summaryCards.map((card) => (
          <article key={card.label} className={`${styles.metricCard} ${card.tone}`}>
            <span>{card.label}</span>
            {typeof card.value === "string" ? <strong>{card.value}</strong> : <div className={styles.metricValue}>{card.value}</div>}
            <small>{card.note}</small>
          </article>
        ))}
      </div>

      <div className={styles.listToolbar}>
        <input
          value={filters.keyword}
          onChange={(event) => setFilter("keyword", event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 备注"
        />
        <input value={filters.month} onChange={(event) => setFilter("month", event.target.value)} type="month" />
        <select value={filters.currency} onChange={(event) => setFilter("currency", event.target.value)} disabled={loading}>
          <option value="">全部币种</option>
          {CURRENCIES.filter(Boolean).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
        </select>
        <select value={filters.paymentType} onChange={(event) => setFilter("paymentType", event.target.value)} disabled={loading}>
          <option value="">全部收款类型</option>
          {PAYMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={filters.paymentStatus} onChange={(event) => setFilter("paymentStatus", event.target.value)} disabled={loading}>
          <option value="">全部收款状态</option>
          {PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <div className={`${styles.tableWrap} ${styles.tablePinnedTwoCols}`}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th className={styles.orderNoColumn}>订单号</th>
              <th className={styles.customerColumn}>客户简称</th>
              <th>收款日期</th>
              <th>收款类型</th>
              <th className={styles.amountColumn}>金额</th>
              <th>状态</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : payments.length ? payments.map((payment) => (
              <PaymentTableRows
                key={payment.id}
                payment={payment}
                onViewDetail={() => setDetailPayment(payment)}
              />
            )) : (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>未找到匹配的收款明细</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} onPage={gotoPage} />
      {detailPayment ? (
        <PaymentDetailDrawer
          payment={detailPayment}
          canManage={canManagePayments}
          deleting={deletingId === detailPayment.id}
          confirming={confirmingId === detailPayment.id}
          onEdit={() => {
            setCreateOpen(false);
            setEditPayment(detailPayment);
          }}
          onDelete={() => void deletePayment(detailPayment)}
          onConfirmArrived={() => void confirmPaymentArrived(detailPayment)}
          onClose={() => setDetailPayment(null)}
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

  async function deletePayment(payment: PaymentRow) {
    const result = await requestConfirmation({
      title: "确认删除这笔收款？",
      message: "删除后将重新计算订单已收金额、未收金额和回款率。",
      details: [
        `订单：${payment.orderNo || "-"}`,
        `金额：${moneyText(payment.currency, payment.amount, payment.amountCny)}`,
      ],
      confirmLabel: "删除收款",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!result.confirmed) return;
    setDeletingId(payment.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/payments/${encodeURIComponent(payment.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除收款失败");
      setDetailPayment(null);
      await loadPayments(page, submittedFilters);
      setNotice(result.message || "收款已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除收款失败");
    } finally {
      setDeletingId("");
    }
  }

  async function confirmPaymentArrived(payment: PaymentRow) {
    const result = await requestConfirmation({
      title: "确认该笔收款已经到账？",
      message: "确认后该笔收款将计入正式回款统计、利润分析和提成结算判断。",
      details: [
        `订单：${payment.orderNo || "-"}`,
        `客户：${customerDisplayName(payment)}`,
        `金额：${moneyText(payment.currency, payment.amount, payment.amountCny)}`,
      ],
      confirmLabel: "确认到账",
      cancelLabel: "取消",
      variant: "default",
    });
    if (!result.confirmed) return;
    setConfirmingId(payment.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/payments/${encodeURIComponent(payment.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          orderId: payment.orderId,
          paymentDate: payment.paymentDate,
          paymentType: payment.paymentType,
          amount: Number(payment.amount || 0),
          currency: payment.currency,
          exchangeRate: Number(payment.exchangeRate || 0),
          exchangeRateDate: payment.exchangeRateDate || undefined,
          exchangeRateSource: payment.exchangeRateSource || undefined,
          exchangeRateType: payment.exchangeRateType || undefined,
          status: "已到账",
          bankReference: payment.bankReference || "",
          remark: payment.remark || "",
        }),
      });
      if (result.success !== true) throw new Error(result.message || "确认到账失败");
      setDetailPayment(null);
      await loadPayments(page, submittedFilters);
      setNotice(result.message || "收款已确认到账");
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "确认到账失败");
    } finally {
      setConfirmingId("");
    }
  }
}
