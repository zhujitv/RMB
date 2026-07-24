import type { Dispatch, SetStateAction } from "react";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import type { LogisticsExpense } from "./model";

export type WorkflowActionsContext = {
  busyId: string;
  statementMonth: string;
  billStatus: string;
  loadStatement: (month?: string) => Promise<void>;
  refreshCurrentPage: () => Promise<unknown>;
  requestConfirmation: (options: ConfirmationDialogState) => Promise<ConfirmationResult>;
  setBusyId: Dispatch<SetStateAction<string>>;
  setRows: Dispatch<SetStateAction<LogisticsExpense[]>>;
  setTotal: Dispatch<SetStateAction<number>>;
  setSelectedBillIds: Dispatch<SetStateAction<string[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  onRefreshTodos?: () => Promise<void> | void;
};
