import { preventEnterFormSubmit } from "../../formGuards";
import styles from "../../WorkspaceShell.module.css";
import { PAY_BUTTON_DISABLED_TOOLTIP, type LogisticsExpense } from "./model";
import { logisticsExpensePayButtonState } from "./shared";

export function LogisticsExpenseBillActions({
  expense,
  busyId,
  saving,
  billAuditStatus,
  billSaved,
  canEditBillDetails,
  canMarkPaid,
  canReview,
  canReviewBill,
  canSubmitThisBill,
  canWithdraw,
  hasInvoiceNoticeFailure,
  hasPendingChanges,
  shouldShowSubmitBill,
  onAddLine,
  onApprove,
  onMarkPaid,
  onReversePayment,
  onReject,
  onResendInvoiceNotice,
  onSave,
  onSubmitDraft,
  onWithdraw,
}: {
  expense: LogisticsExpense;
  busyId: string;
  saving: boolean;
  billAuditStatus: string;
  billSaved: boolean;
  canEditBillDetails: boolean;
  canMarkPaid: boolean;
  canReview: boolean;
  canReviewBill: boolean;
  canSubmitThisBill: boolean;
  canWithdraw: boolean;
  hasInvoiceNoticeFailure: boolean;
  hasPendingChanges: boolean;
  shouldShowSubmitBill: boolean;
  onAddLine: () => void;
  onApprove: (expense: LogisticsExpense) => void;
  onMarkPaid: (expense: LogisticsExpense) => void;
  onReversePayment: (expense: LogisticsExpense) => void;
  onReject: (expense: LogisticsExpense) => void;
  onResendInvoiceNotice: (expense: LogisticsExpense) => void;
  onSave: () => void | Promise<void>;
  onSubmitDraft: (expense: LogisticsExpense) => void;
  onWithdraw: (expense: LogisticsExpense) => void;
}) {
  const busy = busyId === expense.id;
  const payState = logisticsExpensePayButtonState(expense);
  const paymentDisabled = busy || saving || !payState.canMarkPaid;
  const submitDisabled = !canSubmitThisBill || hasPendingChanges || busy || saving;
  const submitTitle = hasPendingChanges
    ? "请先保存本账单明细，再提交审核"
    : canSubmitThisBill
      ? "将当前账单提交给管理员审核"
      : "只有草稿或已驳回的账单可以提交审核";

  return (
    <>
      {shouldShowSubmitBill ? (
        <button
          className={styles.primaryButtonCompact}
          type="button"
          disabled={submitDisabled}
          title={submitTitle}
          onClick={(event) => {
            event.stopPropagation();
            onSubmitDraft(expense);
          }}
        >
          {busy ? "提交中..." : "提交审核"}
        </button>
      ) : null}
      {canWithdraw && billAuditStatus === "待审核" ? (
        <button
          className={styles.billAddLineButton}
          type="button"
          disabled={busy || saving}
          title="撤回当前账单，账单下所有费用明细同步回草稿"
          onClick={(event) => {
            event.stopPropagation();
            onWithdraw(expense);
          }}
        >
          {busy ? "撤回中..." : "撤回账单"}
        </button>
      ) : null}
      {canReviewBill ? (
        <>
          <button
            className={styles.billApproveButton}
            type="button"
            disabled={busy || saving}
	            title="审核当前提单账单，通过后同步成本并通知供应商上传发票"
            onClick={(event) => {
              event.stopPropagation();
              onApprove(expense);
            }}
          >
	            {busy ? "处理中..." : "审核通过"}
          </button>
          <button
            className={styles.billRejectButton}
            type="button"
            disabled={busy || saving}
            title="驳回当前提单账单并要求供应商修改"
            onClick={(event) => {
              event.stopPropagation();
              onReject(expense);
            }}
          >
            {busy ? "处理中..." : "驳回"}
          </button>
        </>
      ) : null}
      {canReview && hasInvoiceNoticeFailure ? (
        <button
          className={styles.billAddLineButton}
          type="button"
          disabled={busy || saving}
          title="仅重新发送当前账单开票通知，不重新审核"
          onClick={(event) => {
            event.stopPropagation();
            onResendInvoiceNotice(expense);
          }}
        >
          {busy ? "发送中..." : "重新发送开票通知"}
        </button>
      ) : null}
      {canMarkPaid ? (
        <button
          className={styles.billPayButton}
          type="button"
          disabled={paymentDisabled}
          title={payState.canMarkPaid ? "将当前账单标记为已付款" : PAY_BUTTON_DISABLED_TOOLTIP}
          onClick={(event) => {
            event.stopPropagation();
            if (!payState.canMarkPaid) return;
            onMarkPaid(expense);
          }}
        >
          {busy ? "更新中..." : payState.alreadyPaid ? "已付款" : "标记已付款"}
        </button>
      ) : null}
      {canMarkPaid && payState.canReversePayment ? (
        <button
          className={styles.billRejectButton}
          type="button"
          disabled={busy || saving}
          title="冲销物流账单及关联成本的付款状态，之后可作废并重新录入"
          onClick={(event) => {
            event.stopPropagation();
            onReversePayment(expense);
          }}
        >
          {busy ? "冲销中..." : "付款更正/冲销"}
        </button>
      ) : null}
      {canEditBillDetails ? (
        <>
          <span className={`${styles.saveStateBadge} ${hasPendingChanges ? styles.saveStateDirty : billSaved ? styles.saveStateSaved : ""}`}>
            {hasPendingChanges ? "● 有未保存修改" : billSaved ? "✓ 已保存" : ""}
          </span>
          <button
            className={styles.billAddLineButton}
            type="button"
            disabled={saving}
            onKeyDown={preventEnterFormSubmit}
            onClick={(event) => {
              event.stopPropagation();
              onAddLine();
            }}
          >
            + 新增费用明细
          </button>
          <button
            className={styles.billSaveButton}
            type="button"
            disabled={!hasPendingChanges || saving}
            onKeyDown={preventEnterFormSubmit}
            onClick={(event) => {
              event.stopPropagation();
              void onSave();
            }}
          >
            {saving ? "保存中..." : "保存本账单明细"}
          </button>
        </>
      ) : null}
    </>
  );
}
