import { ApiRequestError, apiJson } from "../../api";
import type { LogisticsExpense, LogisticsExpenseMutationResult } from "./model";
import {
  logisticsCurrencySummaryPlainText,
  logisticsExpenseBillAuditStatus,
  logisticsExpenseBillIsEditable,
  logisticsExpenseBillItems,
  logisticsExpenseCurrencySummaryFromItems,
  markLogisticsExpenseBillRejected,
  markLogisticsExpenseBillSubmitted,
  replaceLogisticsExpenseItemsInRows,
} from "./shared";
import { applyLogisticsExpenseMutationResultToRows } from "./use-logistics-fees-review-actions";
import type { WorkflowActionsContext } from "./workflow-actions-context";

export function createLogisticsFeesWorkflowReviewActions(context: WorkflowActionsContext) {
  const {
    busyId, statementMonth, loadStatement, refreshCurrentPage, requestConfirmation,
    setBusyId, setRows, setSelectedBillIds, setError, setNotice, onRefreshTodos,
  } = context;
  const applyLogisticsExpenseMutationResult = (result: LogisticsExpenseMutationResult) =>
    applyLogisticsExpenseMutationResultToRows(setRows, result);
  async function withdrawExpense(expense: LogisticsExpense) {
    const items = logisticsExpenseBillItems(expense);
    const confirmationResult = await requestConfirmation({
      title: "确认撤回该物流费用账单？",
      message: "撤回后该账单下所有费用明细将同步回草稿，供应商可继续修改后重新提交。",
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
      const result = await apiJson<LogisticsExpenseMutationResult>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "withdraw" }),
      });
      if (result.success !== true) throw new Error(result.message || "撤回物流费用账单失败");
      applyLogisticsExpenseMutationResult(result);
      void refreshCurrentPage();
      void loadStatement(statementMonth);
      void onRefreshTodos?.();
      setNotice(result.message || "物流费用账单已撤回为草稿");
    } catch (withdrawError) {
      setError(withdrawError instanceof Error ? withdrawError.message : "撤回物流费用账单失败");
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
      const result = await apiJson<LogisticsExpenseMutationResult & { updatedIds?: string[]; submittedAt?: string }>(
        `/api/logistics-costs/${encodeURIComponent(expense.id)}`,
        { method: "PATCH", body: JSON.stringify({ action: "submitBill" }), timeoutMs: 10000 },
      );
      if (result.success !== true) throw new Error(result.message || "提交物流费用审核失败");
      if (result.bill || result.bills?.length || result.expenses?.length || result.expense) {
        applyLogisticsExpenseMutationResult(result);
      } else {
        const updatedIds = Array.isArray(result.updatedIds) && result.updatedIds.length ? result.updatedIds : items.map((item) => item.id);
        setRows((currentRows) => markLogisticsExpenseBillSubmitted(currentRows, expense.id, updatedIds, result.submittedAt));
      }
      setSelectedBillIds((current) => current.filter((id) => id !== expense.id));
      void onRefreshTodos?.();
      setNotice(result.message || "物流费用已提交审核");
    } catch (submitError) {
      const message = submitError instanceof ApiRequestError && submitError.status === 408
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
      const result = await apiJson<{ success?: boolean; message?: string; expenses?: LogisticsExpense[]; bill?: LogisticsExpense }>(
        `/api/logistics-costs/${encodeURIComponent(expense.id)}`,
        { method: "PATCH", body: JSON.stringify({ action: "reject", rejectReason }) },
      );
      if (result.success !== true) throw new Error(result.message || "驳回物流费用账单失败");
      const savedItems = Array.isArray(result.expenses) && result.expenses.length ? result.expenses : result.bill?.items || [];
      setRows((currentRows) => savedItems.length
        ? replaceLogisticsExpenseItemsInRows(currentRows, savedItems)
        : markLogisticsExpenseBillRejected(currentRows, expense.id, rejectReason));
      setSelectedBillIds((current) => current.filter((id) => id !== expense.id));
      void onRefreshTodos?.();
      setNotice(result.message || "物流费用账单已驳回");
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "驳回物流费用账单失败");
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
      const result = await apiJson<LogisticsExpenseMutationResult>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "resendInvoiceNotice" }),
      });
      if (result.success !== true) throw new Error(result.message || "重新发送开票通知失败");
      applyLogisticsExpenseMutationResult(result);
      void onRefreshTodos?.();
      setNotice(result.message || "开票通知已重新发送");
    } catch (noticeError) {
      setError(noticeError instanceof Error ? noticeError.message : "重新发送开票通知失败");
    } finally {
      setBusyId("");
    }
  }


  return { withdrawExpense, submitDraftExpenseBill, rejectExpense, resendInvoiceNotice };
}
