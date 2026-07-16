import type { Dispatch, SetStateAction } from "react";
import { ApiRequestError, apiJson } from "../../api";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import type { LogisticsExpense, LogisticsExpenseMutationResult } from "./model";
import {
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
  loadExpenses: (
    nextPage?: number,
    nextKeyword?: string,
    nextStatus?: string,
    nextCostType?: string,
    nextBillStatus?: string,
  ) => Promise<LogisticsExpense[]>;
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

const LOGISTICS_REVIEW_RECONCILIATION_STATUSES = new Set([408, 502, 503, 504]);

export function shouldReconcileLogisticsExpenseReview(error: unknown) {
  return error instanceof TypeError || (
    error instanceof ApiRequestError
    && (
      LOGISTICS_REVIEW_RECONCILIATION_STATUSES.has(error.status)
      || error.code === "LOGISTICS_REVIEW_TIMEOUT"
    )
  );
}

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
  function applySuccessfulReview(
    result: LogisticsExpenseMutationResult,
    reviewedIds: string[],
    sourceExpense: LogisticsExpense | null,
    notice: string,
  ) {
    applyLogisticsExpenseMutationResultToRows(setRows, result);
    setSelectedBillIds((current) => current.filter((id) => !reviewedIds.includes(id)));
    if (sourceExpense && expandedId === sourceExpense.id) setExpandedId(sourceExpense.id);
    void loadStatement(statementMonth);
    void onRefreshTodos?.();
    setNotice(notice);
  }

  async function reconcileReviewResult(
    ids: string[],
    sourceExpense: LogisticsExpense | null,
    originalMessage: string,
  ) {
    const query = new URLSearchParams();
    for (const billId of ids) query.append("billId", billId);
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(
        `/api/logistics-costs/review?${query}`,
        { timeoutMs: 10000 },
      );
      if (result.success !== true) throw new Error("审核状态核验失败");
      const statusByBillId = new Map(
        (result.results || []).map((item) => [item.billId || "", item.auditStatus || ""]),
      );
      if (ids.some((id) => !statusByBillId.has(id))) throw new Error("审核状态核验结果不完整");

      const approvedIds = ids.filter((id) => statusByBillId.get(id) === "审核通过");
      if (approvedIds.length) {
        applySuccessfulReview(
          result,
          approvedIds,
          sourceExpense,
          approvedIds.length === ids.length
            ? "物流费用已审核，开票通知已进入后台发送队列"
            : `已确认 ${approvedIds.length} 票审核通过，其他账单请刷新确认`,
        );
      }
      if (approvedIds.length === ids.length) {
        setError("");
        return;
      }
      setError(approvedIds.length
        ? "部分账单审核结果已确认，请勿重复提交已完成账单。"
        : originalMessage);
    } catch {
      setNotice("");
      setError("审核结果未知，请刷新确认，勿重复操作。");
    }
  }

  async function reviewExpenseBills(billIds: string[], sourceExpense: LogisticsExpense | null = null) {
    const ids = [...new Set(billIds.filter(Boolean))];
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
      let result: LogisticsExpenseMutationResult;
      try {
        result = await apiJson<LogisticsExpenseMutationResult>("/api/logistics-costs/review", {
          method: "PATCH",
          body: JSON.stringify({ action: "approve", billIds: ids }),
        });
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "审核物流费用失败";
        if (shouldReconcileLogisticsExpenseReview(requestError)) {
          await reconcileReviewResult(ids, sourceExpense, message);
        } else {
          setError(message);
        }
        return;
      }
      const failureMessage = logisticsExpenseReviewFailureMessage(result);
      if (result.success !== true) throw new Error(failureMessage || result.message || "审核物流费用失败");
      applySuccessfulReview(result, ids, sourceExpense, logisticsExpenseReviewNotice(result));
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
	    const confirmationResult = await requestConfirmation({
	      title: "合并审核 / 批量审核",
	      message: "审核通过后系统会同步生成或更新成本管理记录，并通知物流供应商上传对应发票。",
	      details: [`选中账单：${selectedReviewableRows.length} 票`],
	      confirmLabel: "审核通过",
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
