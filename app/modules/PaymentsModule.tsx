"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, useConfirmationDialog } from "../components";
import styles from "../WorkspaceShell.module.css";
import type { User } from "../types";
import { PaymentDetailDrawer } from "./payments/payment-detail-drawer";
import { PaymentFilterToolbar } from "./payments/payment-filter-toolbar";
import { PaymentListTable } from "./payments/payment-list-table";
import { PaymentSummaryCards } from "./payments/payment-summary-cards";
import { QuickCreatePaymentPanel } from "./payments/quick-payment-panel";
import { confirmPaymentRecordArrived, deletePaymentRecord } from "./payments/use-payment-record-actions";
import { PAGE_SIZE, emptyPaymentFilters, type PaymentFilters, type PaymentRow, type PaymentSummary, type PaymentsResponse } from "./payments/types";

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
  const listRequestRef = useRef(0);
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canManagePayments = ["管理员", "财务"].includes(currentUser.role);
  async function loadPayments(nextPage = page, nextFilters = submittedFilters) {
    const requestId = ++listRequestRef.current;
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
      if (requestId !== listRequestRef.current) return;
      const data = result.data || {};
      setPayments(Array.isArray(data.rows) ? data.rows : Array.isArray(result.payments) ? result.payments : []);
      setSummary(data.summary || result.summary || {});
      setTotal(Number(data.total ?? result.payments?.length ?? 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch (loadError) {
      if (requestId === listRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "读取收款明细失败");
      }
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
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

  function normalizedSearchText(value: unknown) {
    return String(value || "").trim().toLowerCase();
  }

  function paymentMatchesSubmittedFilters(payment: PaymentRow) {
    const keywordValue = normalizedSearchText(submittedFilters.keyword);
    if (keywordValue) {
      const haystack = [
        payment.orderNo,
        payment.customerName,
        payment.customerFullName,
        payment.customerShortName,
        payment.bankReference,
        payment.remark,
      ].map(normalizedSearchText).join(" ");
      if (!haystack.includes(keywordValue)) return false;
    }
    if (submittedFilters.month && !String(payment.paymentDate || "").startsWith(submittedFilters.month)) return false;
    if (submittedFilters.currency && payment.currency !== submittedFilters.currency) return false;
    if (submittedFilters.paymentType && payment.paymentType !== submittedFilters.paymentType) return false;
    if (submittedFilters.paymentStatus && payment.status !== submittedFilters.paymentStatus) return false;
    return true;
  }

  function mergePaymentRow(payment: PaymentRow, options: { shouldShow?: boolean } = {}) {
    const shouldShow = options.shouldShow ?? paymentMatchesSubmittedFilters(payment);
    setPayments((current) => {
      const exists = current.some((item) => item.id === payment.id);
      if (exists) {
        return shouldShow
          ? current.map((item) => item.id === payment.id ? { ...item, ...payment } : item)
          : current.filter((item) => item.id !== payment.id);
      }
      return page === 1 && shouldShow ? [payment, ...current].slice(0, PAGE_SIZE) : current;
    });
    setDetailPayment((current) => current?.id === payment.id ? { ...current, ...payment } : current);
    setEditPayment((current) => current?.id === payment.id ? { ...current, ...payment } : current);
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
          onSaved={(payment) => {
            if (payment?.id) {
              const existedInRows = payments.some((item) => item.id === payment.id);
              const shouldShow = paymentMatchesSubmittedFilters(payment);
              mergePaymentRow(payment, { shouldShow });
              if (!editPayment && shouldShow) setTotal((current) => current + 1);
              if (editPayment && existedInRows && !shouldShow) setTotal((current) => Math.max(0, current - 1));
            }
            setCreateOpen(false);
            setEditPayment(null);
            setNotice(editPayment ? "收款已更新" : "收款已保存");
          }}
        />
      ) : null}

      <PaymentSummaryCards summary={summary} />

      <PaymentFilterToolbar
        filters={filters}
        loading={loading}
        onFilterChange={setFilter}
        onSubmit={submitSearch}
        onReset={resetSearch}
      />

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <PaymentListTable
        payments={payments}
        loading={loading}
        total={total}
        page={page}
        totalPages={totalPages}
        onPage={gotoPage}
        onViewDetail={setDetailPayment}
      />
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
          onDelete={() => void deletePaymentRecord(detailPayment, paymentActionOptions())}
          onConfirmArrived={() => void confirmPaymentRecordArrived(detailPayment, paymentActionOptions())}
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

  function paymentActionOptions() {
    return {
      page,
      submittedFilters,
      payments,
      requestConfirmation,
      loadPayments,
      paymentMatchesSubmittedFilters,
      mergePaymentRow,
      setDetailPayment,
      setTotal,
      setError,
      setNotice,
      setDeletingId,
      setConfirmingId,
    };
  }
}
