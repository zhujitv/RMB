import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import type { LogisticsExpense } from "./model";
import {
  formatOriginalCurrencyAccounting,
  logisticsExpenseDeleteBlockReason,
  removeLogisticsExpenseFromRows,
  replaceLogisticsExpenseBillsInRows,
} from "./shared";

type DeleteLogisticsExpenseParams = {
  rows: LogisticsExpense[];
  setRows: Dispatch<SetStateAction<LogisticsExpense[]>>;
  setTotal: Dispatch<SetStateAction<number>>;
  setBusyId: Dispatch<SetStateAction<string>>;
  setDeletingId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  requestConfirmation: (options: ConfirmationDialogState) => Promise<ConfirmationResult>;
  onRefreshTodos?: () => Promise<void> | void;
};

export function createDeleteLogisticsExpenseAction({
  rows,
  setRows,
  setTotal,
  setBusyId,
  setDeletingId,
  setError,
  setNotice,
  requestConfirmation,
  onRefreshTodos,
}: DeleteLogisticsExpenseParams) {
  async function deleteExpense(expense: LogisticsExpense) {
    const blockReason = logisticsExpenseDeleteBlockReason(expense);
    if (blockReason) {
      setError(blockReason);
      setNotice("");
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "删除物流费用明细",
      message: "确定删除这条费用明细吗？删除后不可恢复，账单金额将自动重新计算。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `费用：${logisticsCostTypeLabel(expense.costType || "") || "-"} ${formatOriginalCurrencyAccounting(expense.currency || "CNY", expense.amount || 0)}`,
      ],
      confirmLabel: "确认删除",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setBusyId(expense.id);
    setDeletingId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; bill?: LogisticsExpense | null }>(
        `/api/logistics-expenses/${encodeURIComponent(expense.id)}`,
        {
          method: "DELETE",
        },
      );
      if (result.success !== true) {
        throw new Error(result.message || "删除物流费用明细失败");
      }
      const removal = removeLogisticsExpenseFromRows(rows, expense.id);
      setRows(result.bill ? replaceLogisticsExpenseBillsInRows(removal.rows, [result.bill]) : removal.rows);
      if (removal.removedBill) setTotal((current) => Math.max(0, current - 1));
      void onRefreshTodos?.();
      setNotice("已删除");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "删除物流费用明细失败",
      );
    } finally {
      setBusyId("");
      setDeletingId("");
    }
  }

  return deleteExpense;
}
