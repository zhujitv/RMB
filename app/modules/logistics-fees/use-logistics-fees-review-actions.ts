import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import type { LogisticsExpense, LogisticsExpenseMutationResult } from "./model";
import {
  billSupplierIds,
  logisticsExpenseReviewFailureMessage,
  logisticsExpenseReviewNotice,
  logisticsExpenseShipmentBillIds,
  reconcileLogisticsExpenseMutationRows,
} from "./shared";

type ReviewActionsParams = {
  selectedReviewableRows: LogisticsExpense[];
  expandedId: string;
  page: number;
  submittedKeyword: string;
  status: string;
  costType: string;
  statementMonth: string;
  loadExpenses: (nextPage?: number, nextKeyword?: string, nextStatus?: string, nextCostType?: string) => Promise<LogisticsExpense[]>;
  loadStatement: (month?: string) => Promise<void>;
  requestConfirmation: (options: ConfirmationDialogState) => Promise<ConfirmationResult>;
  setBusyId: Dispatch<SetStateAction<string>>;
  setRows: Dispatch<SetStateAction<LogisticsExpense[]>>;
  setSelectedBillIds: Dispatch<SetStateAction<string[]>>;
  setExpandedId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  onRefreshTodos?: () => Promise<void> | void;
};

export function createLogisticsFeesReviewActions({
  selectedReviewableRows,
  expandedId,
  page,
  submittedKeyword,
  status,
  costType,
  statementMonth,
  loadExpenses,
  loadStatement,
  requestConfirmation,
  setBusyId,
  setRows,
  setSelectedBillIds,
  setExpandedId,
  setError,
  setNotice,
  onRefreshTodos,
}: ReviewActionsParams) {
  async function reviewExpenseBills(billIds: string[], sourceExpense: LogisticsExpense | null = null) {
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
      const result = await apiJson<LogisticsExpenseMutationResult>("/api/logistics-costs/review", {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", billIds: ids }),
      });
      const failureMessage = logisticsExpenseReviewFailureMessage(result);
      if (result.success !== true) throw new Error(failureMessage || result.message || "审核物流费用失败");
      applyLogisticsExpenseMutationResultToRows(setRows, result);
      setSelectedBillIds((current) => current.filter((id) => !ids.includes(id)));
      if (sourceExpense && expandedId === sourceExpense.id) setExpandedId(sourceExpense.id);
      void loadStatement(statementMonth);
      void onRefreshTodos?.();
      setNotice(logisticsExpenseReviewNotice(result));
      if (failureMessage) setError(failureMessage);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "审核物流费用失败");
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
    const supplierCount = new Set(selectedReviewableRows.flatMap((row) => billSupplierIds(row))).size;
    const confirmationResult = await requestConfirmation({
      title: "合并审核 / 批量审核",
      message: "审核通过后系统会按供应商合并发送开票通知，同一供应商只发送一封邮件。",
      details: [`选中账单：${selectedReviewableRows.length} 票`, `涉及供应商：${supplierCount || 0} 家`],
      confirmLabel: "审核通过并通知",
      cancelLabel: "取消",
      variant: "warning",
    });
    if (!confirmationResult.confirmed) return;
    await reviewExpenseBills(selectedReviewableRows.flatMap(logisticsExpenseShipmentBillIds));
  }

  return { reviewExpenseBills, reviewSelectedBills };
}

export function applyLogisticsExpenseMutationResultToRows(
  setRows: Dispatch<SetStateAction<LogisticsExpense[]>>,
  result: LogisticsExpenseMutationResult,
) {
  setRows((currentRows) => reconcileLogisticsExpenseMutationRows(currentRows, result));
}
