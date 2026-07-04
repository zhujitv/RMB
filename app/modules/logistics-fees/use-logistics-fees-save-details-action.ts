import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import type {
  LogisticsExpense,
  LogisticsExpenseBatchSavePayload,
  LogisticsExpenseBatchSaveResult,
} from "./model";
import {
  reconcileLogisticsExpenseMutationRows,
  reconcileLogisticsExpenseRowsAfterBatchSave,
} from "./shared";

type SaveDetailsActionParams = {
  savingBillId: string;
  setBusyId: Dispatch<SetStateAction<string>>;
  setSavingBillId: Dispatch<SetStateAction<string>>;
  setRows: Dispatch<SetStateAction<LogisticsExpense[]>>;
  setTotal: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  onRefreshTodos?: () => Promise<void> | void;
};

export function createLogisticsFeesSaveDetailsAction({
  savingBillId,
  setBusyId,
  setSavingBillId,
  setRows,
  setTotal,
  setError,
  setNotice,
  onRefreshTodos,
}: SaveDetailsActionParams) {
  return async function saveBillDetails(
    expense: LogisticsExpense,
    payload: LogisticsExpenseBatchSavePayload,
  ): Promise<LogisticsExpenseBatchSaveResult | null> {
    if (savingBillId === expense.id) return null;
    if (!payload.updates.length && !payload.creates.length && !payload.deletes.length) {
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
      if (result.success !== true) throw new Error(result.message || "保存本账单明细失败");
      const savedRows = result.bill?.items?.length
        ? result.bill.items
        : Array.isArray(result.items)
          ? result.items
          : Array.isArray(result.details)
            ? result.details
            : Array.isArray(result.rows)
              ? result.rows
              : [];
      const deletedIds = Array.isArray(result.deletedIds) ? result.deletedIds : payload.deletes;
      let removedBill = false;
      setRows((currentRows) => {
        if (result.bill) {
          return reconcileLogisticsExpenseMutationRows(currentRows, {
            bill: result.bill,
          });
        }
        const reconciliation = reconcileLogisticsExpenseRowsAfterBatchSave(currentRows, expense.id, savedRows, deletedIds);
        removedBill = reconciliation.removedBill;
        return reconciliation.rows;
      });
      if (removedBill) setTotal((current) => Math.max(0, current - 1));
      void onRefreshTodos?.();
      setNotice(result.message || "✓ 已保存");
      return { bill: result.bill, items: savedRows, deletedIds };
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存本账单明细失败");
      return null;
    } finally {
      setBusyId("");
      setSavingBillId("");
    }
  };
}
