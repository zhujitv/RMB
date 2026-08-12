"use client";

import { useRef, useState } from "react";
import { ConfirmationDialog, useConfirmationDialog } from "../components";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";
import { useWorkspaceTabBusy, useWorkspaceTabContext, useWorkspaceTabDiscardGuard, useWorkspaceTabPresentation, useWorkspaceTabReactivation } from "../workspace/workspace-tab-context";
import styles from "../WorkspaceShell.module.css";
import { PaymentDetailDrawer } from "./payments/payment-detail-drawer";
import { PaymentFilterToolbar } from "./payments/payment-filter-toolbar";
import { PaymentListTable } from "./payments/payment-list-table";
import { PaymentSummaryCards } from "./payments/payment-summary-cards";
import { QuickCreatePaymentPanel } from "./payments/quick-payment-panel";
import { confirmPaymentRecordArrived, deletePaymentRecord } from "./payments/use-payment-record-actions";
import { usePaymentsList } from "./payments/use-payments-list";

export function PaymentsModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialPaymentId = "",
  initialOpenToken = 0,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialPaymentId?: string;
  initialOpenToken?: number;
}) {
  const {
    payments, summary, filters, submittedFilters, page, total, totalPages,
    detailPayment, setDetailPayment, loading, error, setError, notice, setNotice,
    createOpen, setCreateOpen, editPayment, setEditPayment, setTotal, loadPayments,
    setFilter, submitSearch, resetSearch, gotoPage, paymentMatchesSubmittedFilters,
    mergePaymentRow,
  } = usePaymentsList(initialKeyword, initialOpenToken, initialPaymentId);
  const [deletingId, setDeletingId] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canManagePayments = canWritePermission(currentUser, permissions, "payments", ["管理员", "财务"])
    && ["管理员", "财务"].includes(currentUser.role);
  useWorkspaceTabBusy(Boolean(deletingId || confirmingId));
  const workspaceTab = useWorkspaceTabContext();
  const workspaceBusyRef = useRef(Boolean(workspaceTab?.busy));
  workspaceBusyRef.current = Boolean(workspaceTab?.busy);
  const confirmDiscardPaymentEdit = useWorkspaceTabDiscardGuard("当前收款内容尚未保存，确定放弃吗？");
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
