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
  return {
    ...logisticsBillPayState({ auditStatus, invoiceStatus, paymentStatus }),
    rule: PAY_BUTTON_RULE,
  };
}
