import { logisticsBillPayState } from "../../../lib/platform/logistics-bill-state-machine";
import { PAY_BUTTON_RULE, type LogisticsExpense } from "./model";
import {
  compactStatusLabel,
  normalizePayButtonInvoiceStatus,
} from "./shared-status-core";
import {
  logisticsExpenseBillAuditStatusFromRow,
  logisticsExpenseBillInvoiceStatusFromRow,
  logisticsExpenseBillItems,
  logisticsExpenseBillPaymentStatusFromRow,
  isVoidedLogisticsExpenseBill,
} from "./shared-status-bill";

export function logisticsExpensePayButtonState(expense: LogisticsExpense) {
  const items = logisticsExpenseBillItems(expense);
  const auditStatus = compactStatusLabel(
    logisticsExpenseBillAuditStatusFromRow(expense),
    "audit",
  );
  const invoiceStatus = normalizePayButtonInvoiceStatus([
    logisticsExpenseBillInvoiceStatusFromRow(expense),
    expense.billInvoiceStatus,
    expense.invoiceStatus,
    ...items.flatMap((item) => [
      item.billInvoiceStatus,
      item.invoiceStatus,
      item.detailInvoiceStatus,
    ]),
  ]);
  const paymentStatus = compactStatusLabel(
    logisticsExpenseBillPaymentStatusFromRow(expense),
    "payment",
  );
  const validationBlocked = items.some((item) =>
    !["校验通过", "人工确认通过"].includes(String(item.invoiceValidationStatus || "未上传")),
  );
  const state = {
    ...logisticsBillPayState({
      auditStatus,
      invoiceStatus,
      paymentStatus,
      status: isVoidedLogisticsExpenseBill(expense) ? "voided" : expense.status,
    }),
    rule: PAY_BUTTON_RULE,
  };
  return {
    ...state,
    canMarkPaid: state.canMarkPaid && !validationBlocked,
    validationBlocked,
  };
}
