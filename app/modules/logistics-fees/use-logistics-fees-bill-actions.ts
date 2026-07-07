import { useState, type Dispatch, type SetStateAction } from "react";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import { createDeleteLogisticsExpenseAction } from "./delete-logistics-expense-action";
import type {
  LogisticsExpense,
  LogisticsExpenseBatchSavePayload,
  LogisticsExpenseBatchSaveResult,
  LogisticsExpenseMutationResult,
} from "./model";
import { applyLogisticsExpenseMutationResultToRows, createLogisticsFeesReviewActions } from "./use-logistics-fees-review-actions";
import { createLogisticsFeesSaveDetailsAction } from "./use-logistics-fees-save-details-action";
import { createLogisticsFeesWorkflowActions } from "./use-logistics-fees-workflow-actions";

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
  billStatus: string;
  statementMonth: string;
  loadExpenses: (
    nextPage?: number,
    nextKeyword?: string,
    nextStatus?: string,
    nextCostType?: string,
    nextBillStatus?: string,
  ) => Promise<LogisticsExpense[]>;
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
  billStatus,
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

  function applyLogisticsExpenseMutationResult(result: LogisticsExpenseMutationResult) {
    applyLogisticsExpenseMutationResultToRows(setRows, result);
  }

  const { reviewExpenseBills, reviewSelectedBills } = createLogisticsFeesReviewActions({
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
  });

  const saveBillDetails = createLogisticsFeesSaveDetailsAction({
    savingBillId,
    setBusyId,
    setSavingBillId,
    setRows,
    setTotal,
    setError,
    setNotice,
    onRefreshTodos,
  });

  const {
    withdrawExpense,
    submitDraftExpenseBill,
    rejectExpense,
    resendInvoiceNotice,
    markExpenseBillPaid,
    voidExpenseBill,
  } = createLogisticsFeesWorkflowActions({
    busyId,
    statementMonth,
    billStatus,
    loadStatement,
    requestConfirmation,
    setBusyId,
    setRows,
    setTotal,
    setSelectedBillIds,
    setError,
    setNotice,
    onRefreshTodos,
  });

  const deleteExpense = createDeleteLogisticsExpenseAction({
    rows,
    setRows,
    setTotal,
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
    saveBillDetails: (expense: LogisticsExpense, payload: LogisticsExpenseBatchSavePayload): Promise<LogisticsExpenseBatchSaveResult | null> => saveBillDetails(expense, payload),
    deleteExpense,
    withdrawExpense,
    submitDraftExpenseBill,
    rejectExpense,
    resendInvoiceNotice,
    markExpenseBillPaid,
    voidExpenseBill,
  };
}
