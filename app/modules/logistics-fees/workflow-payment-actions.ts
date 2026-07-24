import { apiJson } from "../../api";
import {
  PAY_BUTTON_DISABLED_TOOLTIP,
  todayInputInChinaClient,
  type LogisticsExpense,
  type LogisticsExpenseMutationResult,
} from "./model";
import {
  logisticsCurrencySummaryPlainText,
  logisticsExpenseBillItems,
  logisticsExpenseCurrencySummaryFromItems,
  logisticsExpensePayButtonState,
} from "./shared";
import { applyLogisticsExpenseMutationResultToRows } from "./use-logistics-fees-review-actions";
import type { WorkflowActionsContext } from "./workflow-actions-context";

export function createLogisticsFeesWorkflowPaymentActions(context: WorkflowActionsContext) {
  const {
    busyId, statementMonth, billStatus, loadStatement, refreshCurrentPage,
    requestConfirmation, setBusyId, setRows, setTotal, setSelectedBillIds,
    setError, setNotice, onRefreshTodos,
  } = context;
  const applyLogisticsExpenseMutationResult = (result: LogisticsExpenseMutationResult) =>
    applyLogisticsExpenseMutationResultToRows(setRows, result);
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
      details: [`订单：${expense.orderNo || "-"}`, `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`, `账单合计：${logisticsCurrencySummaryPlainText(logisticsExpenseCurrencySummaryFromItems(logisticsExpenseBillItems(expense)))}`],
      confirmLabel: "标记已付款",
      cancelLabel: "取消",
      variant: "warning",
    });
    if (!confirmationResult.confirmed) return;
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "markPaid", paymentStatus: "已付款", paymentDate: confirmationResult.inputValue }),
      });
      if (result.success !== true) throw new Error(result.message || "标记已付款失败");
      applyLogisticsExpenseMutationResult(result);
      void refreshCurrentPage();
      void loadStatement(statementMonth);
      void onRefreshTodos?.();
      setNotice(result.message || "物流费用已标记为已付款");
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "标记已付款失败");
    } finally {
      setBusyId("");
    }
  }

  async function reverseExpenseBillPayment(expense: LogisticsExpense) {
    if (busyId === expense.id) return;
    const payState = logisticsExpensePayButtonState(expense);
    if (!payState.canReversePayment) {
      setError("只有审核通过且已付款的物流费用账单可以冲销付款");
      setNotice("");
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "付款更正/冲销",
      message: "冲销后物流账单恢复为待付款，关联成本同步恢复为待支付；原付款信息和冲销原因保留在操作日志中。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`,
        `原付款时间：${expense.paymentDate || "-"}`,
        `账单合计：${logisticsCurrencySummaryPlainText(logisticsExpenseCurrencySummaryFromItems(logisticsExpenseBillItems(expense)))}`,
      ],
      requireInput: true,
      inputLabel: "冲销原因",
      inputPlaceholder: "例如：物流费用金额录入错误，需要作废后重新录入",
      inputRequiredMessage: "请填写冲销原因。",
      confirmLabel: "确认冲销",
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
        body: JSON.stringify({ action: "reversePayment", reason: confirmationResult.inputValue }),
      });
      if (result.success !== true) throw new Error(result.message || "冲销物流费用付款失败");
      applyLogisticsExpenseMutationResult(result);
      void refreshCurrentPage();
      void loadStatement(statementMonth);
      void onRefreshTodos?.();
      setNotice(result.message || "物流费用付款已冲销");
    } catch (reversalError) {
      setError(reversalError instanceof Error ? reversalError.message : "冲销物流费用付款失败");
    } finally {
      setBusyId("");
    }
  }

  async function voidExpenseBill(expense: LogisticsExpense) {
    if (busyId === expense.id) return;
    const items = logisticsExpenseBillItems(expense);
    const confirmationResult = await requestConfirmation({
      title: "作废物流费用账单",
      message: "作废后该账单不再计入月结、待付款、成本、退税资料和待办，原始金额、附件、发票和日志会保留。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`,
        `账单合计：${logisticsCurrencySummaryPlainText(logisticsExpenseCurrencySummaryFromItems(items))}`,
      ],
      requireInput: true,
      inputLabel: "作废原因",
      inputPlaceholder: "请填写订单号录入错误、重复账单等原因",
      inputRequiredMessage: "请填写作废原因。",
      secondaryInputLabel: "备注",
      secondaryInputPlaceholder: "选填，可记录处理说明",
      confirmLabel: "确认作废",
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
          body: JSON.stringify({
            action: "voidBill",
            reason: confirmationResult.inputValue,
            remark: confirmationResult.secondaryInputValue || "",
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "作废物流费用账单失败");
      if (billStatus === "normal" || !billStatus) {
        setRows((currentRows) => currentRows.filter((row) => row.id !== expense.id));
        setTotal((current) => Math.max(0, current - 1));
      } else {
        applyLogisticsExpenseMutationResult(result);
      }
      setSelectedBillIds((current) => current.filter((id) => id !== expense.id));
      void loadStatement(statementMonth);
      void onRefreshTodos?.();
      setNotice(result.message || "物流费用账单已作废");
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "作废物流费用账单失败");
    } finally {
      setBusyId("");
    }
  }


  return { markExpenseBillPaid, reverseExpenseBillPayment, voidExpenseBill };
}
