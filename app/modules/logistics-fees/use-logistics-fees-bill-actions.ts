import { useState, type Dispatch, type SetStateAction } from "react";
import { ApiRequestError, apiJson } from "../../api";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import { createDeleteLogisticsExpenseAction } from "./delete-logistics-expense-action";
import {
  PAY_BUTTON_DISABLED_TOOLTIP,
  todayInputInChinaClient,
  type LogisticsExpense,
  type LogisticsExpenseBatchSavePayload,
  type LogisticsExpenseBatchSaveResult,
  type LogisticsExpenseMutationResult,
} from "./model";
import {
  billSupplierIds,
  logisticsCurrencySummaryPlainText,
  logisticsExpenseBillAuditStatus,
  logisticsExpenseBillIsEditable,
  logisticsExpenseBillItems,
  logisticsExpenseCurrencySummaryFromItems,
  logisticsExpensePayButtonState,
  logisticsExpenseReviewFailureMessage,
  logisticsExpenseReviewNotice,
  logisticsExpenseShipmentBillIds,
  markLogisticsExpenseBillRejected,
  markLogisticsExpenseBillSubmitted,
  reconcileLogisticsExpenseMutationRows,
  reconcileLogisticsExpenseRowsAfterBatchSave,
  replaceLogisticsExpenseItemsInRows,
} from "./shared";

type UseLogisticsFeesBillActionsParams = {
  rows: LogisticsExpense[];
  setRows: Dispatch<SetStateAction<LogisticsExpense[]>>;
  setTotal: Dispatch<SetStateAction<number>>;
  selectedReviewableRows: LogisticsExpense[];
  setSelectedBillIds: Dispatch<SetStateAction<string[]>>;
  expandedId: string;
  setExpandedId: Dispatch<SetStateAction<string>>;
  page: number;
  submittedKeyword: string;
  status: string;
  costType: string;
  statementMonth: string;
  loadExpenses: (nextPage?: number, nextKeyword?: string, nextStatus?: string, nextCostType?: string) => Promise<LogisticsExpense[]>;
  loadStatement: (month?: string) => Promise<void>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  requestConfirmation: (options: ConfirmationDialogState) => Promise<ConfirmationResult>;
  onRefreshTodos?: () => Promise<void> | void;
};

export function useLogisticsFeesBillActions({
  rows,
  setRows,
  setTotal,
  selectedReviewableRows,
  setSelectedBillIds,
  expandedId,
  setExpandedId,
  page,
  submittedKeyword,
  status,
  costType,
  statementMonth,
  loadExpenses,
  loadStatement,
  setError,
  setNotice,
  requestConfirmation,
  onRefreshTodos,
}: UseLogisticsFeesBillActionsParams) {
  const [busyId, setBusyId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [savingBillId, setSavingBillId] = useState("");

  function applyLogisticsExpenseMutationResult(
    result: LogisticsExpenseMutationResult,
  ) {
    setRows((currentRows) =>
      reconcileLogisticsExpenseMutationRows(currentRows, result),
    );
  }

  async function reviewExpenseBills(
    billIds: string[],
    sourceExpense: LogisticsExpense | null = null,
  ) {
    const ids = billIds.filter(Boolean);
    if (!ids.length) {
      setError("请选择需要审核的物流费用账单");
      setNotice("");
      return;
    }
    const busyKey = ids.length === 1 ? ids[0] : "__batch_review__";
    setBusyId(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(
        `/api/logistics-costs/review`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "approve", billIds: ids }),
        },
      );
      const failureMessage = logisticsExpenseReviewFailureMessage(result);
      if (result.success !== true)
        throw new Error(failureMessage || result.message || "审核物流费用失败");
      await loadExpenses(page, submittedKeyword, status, costType);
      setSelectedBillIds((current) =>
        current.filter((id) => !ids.includes(id)),
      );
      if (sourceExpense && expandedId === sourceExpense.id)
        setExpandedId(sourceExpense.id);
      void loadStatement(statementMonth);
      void onRefreshTodos?.();
      setNotice(logisticsExpenseReviewNotice(result));
      if (failureMessage) setError(failureMessage);
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : "审核物流费用失败",
      );
    } finally {
      setBusyId("");
    }
  }

  async function reviewSelectedBills() {
    if (!selectedReviewableRows.length) {
      setError("请选择待审核的物流费用账单");
      setNotice("");
      return;
    }
    const supplierCount = new Set(
      selectedReviewableRows.flatMap((row) => billSupplierIds(row)),
    ).size;
    const confirmationResult = await requestConfirmation({
      title: "合并审核 / 批量审核",
      message:
        "审核通过后系统会按供应商合并发送开票通知，同一供应商只发送一封邮件。",
      details: [
        `选中账单：${selectedReviewableRows.length} 票`,
        `涉及供应商：${supplierCount || 0} 家`,
      ],
      confirmLabel: "审核通过并通知",
      cancelLabel: "取消",
      variant: "warning",
    });
    if (!confirmationResult.confirmed) return;
    await reviewExpenseBills(
      selectedReviewableRows.flatMap(logisticsExpenseShipmentBillIds),
    );
  }

  async function saveBillDetails(
    expense: LogisticsExpense,
    payload: LogisticsExpenseBatchSavePayload,
  ): Promise<LogisticsExpenseBatchSaveResult | null> {
    if (savingBillId === expense.id) return null;
    if (
      !payload.updates.length &&
      !payload.creates.length &&
      !payload.deletes.length
    ) {
      setNotice("没有需要保存的修改");
      return null;
    }
    setBusyId(expense.id);
    setSavingBillId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{
        success?: boolean;
        bill?: LogisticsExpense;
        items?: LogisticsExpense[];
        details?: LogisticsExpense[];
        rows?: LogisticsExpense[];
        deletedIds?: string[];
        message?: string;
      }>("/api/logistics-expenses/batch-save", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (result.success !== true)
        throw new Error(result.message || "保存本账单明细失败");
      const savedRows = result.bill?.items?.length
        ? result.bill.items
        : Array.isArray(result.items)
          ? result.items
          : Array.isArray(result.details)
            ? result.details
            : Array.isArray(result.rows)
              ? result.rows
              : [];
      const deletedIds = Array.isArray(result.deletedIds)
        ? result.deletedIds
        : payload.deletes;
      let removedBill = false;
      setRows((currentRows) => {
        if (result.bill)
          return reconcileLogisticsExpenseMutationRows(currentRows, {
            bill: result.bill,
          });
        const reconciliation = reconcileLogisticsExpenseRowsAfterBatchSave(
          currentRows,
          expense.id,
          savedRows,
          deletedIds,
        );
        removedBill = reconciliation.removedBill;
        return reconciliation.rows;
      });
      if (removedBill) setTotal((current) => Math.max(0, current - 1));
      void onRefreshTodos?.();
      setNotice(result.message || "✓ 已保存");
      return { bill: result.bill, items: savedRows, deletedIds };
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存本账单明细失败",
      );
      return null;
    } finally {
      setBusyId("");
      setSavingBillId("");
    }
  }

  async function withdrawExpense(expense: LogisticsExpense) {
    const items = logisticsExpenseBillItems(expense);
    const confirmationResult = await requestConfirmation({
      title: "确认撤回该物流费用账单？",
      message:
        "撤回后该账单下所有费用明细将同步回草稿，供应商可继续修改后重新提交。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`,
        `明细：${items.length} 项`,
        `账单合计：${logisticsCurrencySummaryPlainText(logisticsExpenseCurrencySummaryFromItems(items))}`,
      ],
      confirmLabel: "撤回账单",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(
        `/api/logistics-costs/${encodeURIComponent(expense.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "withdraw" }),
        },
      );
      if (result.success !== true)
        throw new Error(result.message || "撤回物流费用账单失败");
      applyLogisticsExpenseMutationResult(result);
      await loadStatement(statementMonth);
      void onRefreshTodos?.();
      setNotice(result.message || "物流费用账单已撤回为草稿");
    } catch (withdrawError) {
      setError(
        withdrawError instanceof Error
          ? withdrawError.message
          : "撤回物流费用账单失败",
      );
    } finally {
      setBusyId("");
    }
  }

  async function submitDraftExpenseBill(expense: LogisticsExpense) {
    if (busyId === expense.id) return;
    const items = logisticsExpenseBillItems(expense);
    const billAuditStatus = logisticsExpenseBillAuditStatus(items);
    if (!logisticsExpenseBillIsEditable(billAuditStatus)) {
      setError("只有草稿或已驳回的物流费用账单可以提交审核");
      setNotice("");
      return;
    }
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<
        LogisticsExpenseMutationResult & {
          updatedIds?: string[];
          submittedAt?: string;
        }
      >(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "submitBill" }),
        timeoutMs: 10000,
      });
      if (result.success !== true)
        throw new Error(result.message || "提交物流费用审核失败");
      if (
        result.bill ||
        result.bills?.length ||
        result.expenses?.length ||
        result.expense
      ) {
        applyLogisticsExpenseMutationResult(result);
      } else {
        const updatedIds =
          Array.isArray(result.updatedIds) && result.updatedIds.length
            ? result.updatedIds
            : items.map((item) => item.id);
        setRows((currentRows) =>
          markLogisticsExpenseBillSubmitted(
            currentRows,
            expense.id,
            updatedIds,
            result.submittedAt,
          ),
        );
      }
      setSelectedBillIds((current) =>
        current.filter((id) => id !== expense.id),
      );
      void onRefreshTodos?.();
      setNotice(result.message || "物流费用已提交审核");
    } catch (submitError) {
      const message =
        submitError instanceof ApiRequestError && submitError.status === 408
          ? "提交超时，请重试"
          : submitError instanceof Error
            ? submitError.message
            : "提交物流费用审核失败";
      setError(`提交失败：${message}`);
    } finally {
      setBusyId("");
    }
  }

  async function rejectExpense(expense: LogisticsExpense) {
    const confirmationResult = await requestConfirmation({
      title: "驳回物流费用账单",
      message: "请填写驳回原因，供应商将看到该原因并补充修改。",
      requireInput: true,
      inputLabel: "驳回原因",
      inputPlaceholder: "请输入需要供应商修改的内容",
      inputRequiredMessage: "请填写驳回原因。",
      confirmLabel: "确认驳回",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    const rejectReason = confirmationResult.inputValue || "";
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{
        success?: boolean;
        message?: string;
        expenses?: LogisticsExpense[];
        bill?: LogisticsExpense;
      }>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reject", rejectReason }),
      });
      if (result.success !== true)
        throw new Error(result.message || "驳回物流费用账单失败");
      const savedItems =
        Array.isArray(result.expenses) && result.expenses.length
          ? result.expenses
          : result.bill?.items || [];
      setRows((currentRows) =>
        savedItems.length
          ? replaceLogisticsExpenseItemsInRows(currentRows, savedItems)
          : markLogisticsExpenseBillRejected(
              currentRows,
              expense.id,
              rejectReason,
            ),
      );
      setSelectedBillIds((current) =>
        current.filter((id) => id !== expense.id),
      );
      void onRefreshTodos?.();
      setNotice(result.message || "物流费用账单已驳回");
    } catch (rejectError) {
      setError(
        rejectError instanceof Error
          ? rejectError.message
          : "驳回物流费用账单失败",
      );
    } finally {
      setBusyId("");
    }
  }

  async function resendInvoiceNotice(expense: LogisticsExpense) {
    if (busyId === expense.id) return;
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(
        `/api/logistics-costs/${encodeURIComponent(expense.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "resendInvoiceNotice" }),
        },
      );
      if (result.success !== true)
        throw new Error(result.message || "重新发送开票通知失败");
      applyLogisticsExpenseMutationResult(result);
      void onRefreshTodos?.();
      setNotice(result.message || "开票通知已重新发送");
    } catch (noticeError) {
      setError(
        noticeError instanceof Error
          ? noticeError.message
          : "重新发送开票通知失败",
      );
    } finally {
      setBusyId("");
    }
  }

  async function markExpenseBillPaid(expense: LogisticsExpense) {
    if (busyId === expense.id) return;
    const payState = logisticsExpensePayButtonState(expense);
    if (!payState.canMarkPaid) {
      setError(PAY_BUTTON_DISABLED_TOOLTIP);
      setNotice("");
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "标记物流费用为已付款？",
      message: "确认后该账单付款状态将更新为已付款，并同步关联成本付款状态。",
      requireInput: true,
      inputType: "date",
      inputLabel: "付款时间",
      inputValue: expense.paymentDate || todayInputInChinaClient(),
      inputRequiredMessage: "请选择付款时间。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`,
        `账单合计：${logisticsCurrencySummaryPlainText(logisticsExpenseCurrencySummaryFromItems(logisticsExpenseBillItems(expense)))}`,
      ],
      confirmLabel: "标记已付款",
      cancelLabel: "取消",
      variant: "warning",
    });
    if (!confirmationResult.confirmed) return;
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(
        `/api/logistics-costs/${encodeURIComponent(expense.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action: "markPaid",
            paymentStatus: "已付款",
            paymentDate: confirmationResult.inputValue,
          }),
        },
      );
      if (result.success !== true)
        throw new Error(result.message || "标记已付款失败");
      applyLogisticsExpenseMutationResult(result);
      await loadStatement(statementMonth);
      void onRefreshTodos?.();
      setNotice(result.message || "物流费用已标记为已付款");
    } catch (paymentError) {
      setError(
        paymentError instanceof Error ? paymentError.message : "标记已付款失败",
      );
    } finally {
      setBusyId("");
    }
  }

  const deleteExpense = createDeleteLogisticsExpenseAction({
    rows,
    setRows,
    setTotal,
    statementMonth,
    loadStatement,
    setBusyId,
    setDeletingId,
    setError,
    setNotice,
    requestConfirmation,
    onRefreshTodos,
  });
  return {
    busyId,
    deletingId,
    savingBillId,
    applyLogisticsExpenseMutationResult,
    reviewExpenseBills,
    reviewSelectedBills,
    saveBillDetails,
    deleteExpense,
    withdrawExpense,
    submitDraftExpenseBill,
    rejectExpense,
    resendInvoiceNotice,
    markExpenseBillPaid,
  };
}
