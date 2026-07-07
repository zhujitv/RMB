import { dateFromInput, nonEmpty } from "./shared";

type LogisticsPaymentSource = {
  paymentStatus?: unknown;
  detailPaymentStatus?: unknown;
  paymentDate?: unknown;
  paidAt?: unknown;
  paidDate?: unknown;
  bill?: {
    paymentStatus?: unknown;
    paymentDate?: unknown;
  } | null;
};

const LOGISTICS_FULLY_PAID_STATUSES = new Set(["已付款", "已支付"]);
const LOGISTICS_PARTIAL_PAID_STATUSES = new Set(["部分付款", "部分已付款", "部分支付"]);

export function logisticsCostPaymentDataForStatus(paymentStatusInput: unknown, paymentDateInput: unknown) {
  const logisticsPaymentStatus = nonEmpty(paymentStatusInput);
  const paid = LOGISTICS_FULLY_PAID_STATUSES.has(logisticsPaymentStatus);
  const partiallyPaid = LOGISTICS_PARTIAL_PAID_STATUSES.has(logisticsPaymentStatus);
  const paymentDate = paid || partiallyPaid ? dateFromInput(paymentDateInput) : null;
  return {
    paymentStatus: paid ? "已支付" : (partiallyPaid ? "部分支付" : "待支付"),
    paid: paid || partiallyPaid,
    paidAt: paymentDate,
    paymentDate,
  };
}

export function logisticsCostPaymentDataFromExpense(expense: LogisticsPaymentSource = {}) {
  const bill = expense.bill || {};
  return logisticsCostPaymentDataForStatus(
    bill.paymentStatus || expense.detailPaymentStatus || expense.paymentStatus,
    bill.paymentDate || expense.paymentDate || expense.paidAt || expense.paidDate,
  );
}
