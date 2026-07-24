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
import { useWorkspaceTabBusy, useWorkspaceTabContext, useWorkspaceTabDiscardGuard, useWorkspaceTabPresentation, useWorkspaceTabReactivation } from "../workspace/workspace-tab-context";

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
  useWorkspaceTabBusy(Boolean(deletingId || confirmingId));
  const workspaceTab = useWorkspaceTabContext();
  const workspaceBusyRef = useRef(Boolean(workspaceTab?.busy));
  workspaceBusyRef.current = Boolean(workspaceTab?.busy);
  const confirmDiscardPaymentEdit = useWorkspaceTabDiscardGuard("当前收款内容尚未保存，确定放弃吗？");
  async function loadPayments(nextPage = page, nextFilters = submittedFilters): Promise<PaymentRow[] | null> {
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
      if (requestId !== listRequestRef.current) return null;
      const data = result.data || {};
      const nextRows = Array.isArray(data.rows) ? data.rows : Array.isArray(result.payments) ? result.payments : [];
      setPayments(nextRows);
      setSummary(data.summary || result.summary || {});
      setTotal(Number(data.total ?? result.payments?.length ?? 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
      return nextRows;
    } catch (loadError) {
      if (requestId === listRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "读取收款明细失败");
      }
      return null;
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

  function confirmDiscardPaymentDraftBeforeMutation(paymentId: string) {
    if (!ensurePaymentTabIdle()) return false;
    if (!createOpen && editPayment?.id !== paymentId) return true;
    if (!confirmDiscardPaymentEdit()) return false;
    setCreateOpen(false);
    setEditPayment(null);
    return true;
  }

  function ensurePaymentTabIdle() {
    if (!workspaceBusyRef.current) return true;
    window.alert("当前收款操作正在进行，请完成后再继续。");
    return false;
  }

  const workspacePayment = editPayment || detailPayment;
  useWorkspaceTabPresentation({
    title: editPayment
      ? `编辑收款 · ${editPayment.orderNo || "未关联订单"}`
      : createOpen
        ? "登记收款"
        : detailPayment
          ? `收款 · ${detailPayment.orderNo || detailPayment.bankReference || "详情"}`
          : "收款管理",
    view: editPayment || createOpen ? "edit" : detailPayment ? "detail" : "list",
    contextKey: editPayment
      ? `edit:${editPayment.id}`
      : createOpen
        ? "create:payment"
        : workspacePayment
          ? `detail:${workspacePayment.id}`
          : "list:payments",
    ensureListTab: Boolean(editPayment || createOpen || detailPayment),
  });
  useWorkspaceTabReactivation(() => {
    void loadPayments(page, submittedFilters);
  });

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
                if ((createOpen || editPayment) && !confirmDiscardPaymentEdit()) return;
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
          key={editPayment?.id ? `edit:${editPayment.id}` : "create"}
          initialPayment={editPayment}
          canConfirmArrived={canManagePayments}
          onCancel={() => {
            if (!confirmDiscardPaymentEdit()) return;
            setCreateOpen(false);
            setEditPayment(null);
          }}
          onConflict={async (paymentId) => {
            const refreshedRows = await loadPayments(page, submittedFilters);
            const latestPayment = refreshedRows?.find((payment) => payment.id === paymentId) || null;
            setDetailPayment((current) => current?.id === paymentId
              ? (latestPayment ? { ...current, ...latestPayment } : null)
              : current);
            setError(refreshedRows
              ? "该收款记录已被其他人更新，列表已刷新；本次未保存内容仍保留在编辑区。请先复制需要保留的内容，再取消编辑并重新打开核对。"
              : "该收款记录已被其他人更新，自动刷新失败；本次未保存内容仍保留在编辑区。请先复制内容，再手动刷新后重新编辑。");
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
            void loadPayments(page, submittedFilters);
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
          busy={Boolean(workspaceTab?.busy)}
          onEdit={() => {
            if (!ensurePaymentTabIdle()) return;
            if (editPayment?.id === detailPayment.id) {
              setCreateOpen(false);
              setEditPayment(editPayment);
              return;
            }
            const replacingDraft = Boolean(
              (createOpen || editPayment)
              && (createOpen || editPayment?.id !== detailPayment.id),
            );
            if (replacingDraft && !confirmDiscardPaymentEdit()) return;
            setCreateOpen(false);
            setEditPayment(detailPayment);
          }}
          onDelete={() => {
            if (!ensurePaymentTabIdle()) return;
            void deletePaymentRecord(detailPayment, paymentActionOptions(detailPayment.id));
          }}
          onConfirmArrived={() => {
            if (!ensurePaymentTabIdle()) return;
            void confirmPaymentRecordArrived(detailPayment, paymentActionOptions(detailPayment.id));
          }}
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

  function paymentActionOptions(paymentId: string) {
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
      beforeMutation: () => confirmDiscardPaymentDraftBeforeMutation(paymentId),
    };
  }
}
