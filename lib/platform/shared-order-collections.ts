import { nonEmpty, num } from "./shared-base-utils";
import type { OrderLike, PaymentLike } from "./shared-order-calculation-types";

export function confirmedPayment(payment: PaymentLike) {
  return payment.status === "已到账" && !payment.deletedAt;
}

export function hasArrivedPaymentCurrencyMismatch(order: OrderLike) {
  const orderCurrency = nonEmpty(order.currency).toUpperCase() || "CNY";
  return (order.payments || []).some((payment) => {
    if (!confirmedPayment(payment)) return false;
    const paymentCurrency = nonEmpty(payment.currency).toUpperCase();
    return Boolean(paymentCurrency) && paymentCurrency !== orderCurrency;
  });
}

export function roundMoney(value: unknown) {
  return Math.round(num(value) * 100) / 100;
}

export function paymentAmountForOrderCurrency(payment: PaymentLike, orderCurrencyInput: unknown, orderExchangeRateInput: unknown) {
  const orderCurrency = String(orderCurrencyInput || "CNY").toUpperCase();
  const paymentCurrency = String(payment.currency || orderCurrency).toUpperCase();
  if (paymentCurrency === orderCurrency) return Number(payment.amount || 0);
  return Number(payment.amountCny || 0) / (Number(orderExchangeRateInput) || 1);
}

export function deriveOrderCollectionBalance({ receivableAmount, receivedAmount, receivedAmountCny, orderExchangeRate }: {
  receivableAmount: unknown; receivedAmount: unknown; receivedAmountCny: unknown; orderExchangeRate: unknown;
}) {
  const normalizedReceivableAmount = roundMoney(receivableAmount);
  const normalizedReceivedAmount = roundMoney(receivedAmount);
  const exchangeRate = Number(orderExchangeRate) > 0 ? Number(orderExchangeRate) : 1;
  const balanceAmount = roundMoney(normalizedReceivableAmount - normalizedReceivedAmount);
  const outstandingAmount = Math.max(balanceAmount, 0);
  const overpaidAmount = Math.max(-balanceAmount, 0);
  return {
    receivedAmount: normalizedReceivedAmount, balanceAmount, outstandingAmount, overpaidAmount,
    balanceCny: roundMoney(balanceAmount * exchangeRate),
    outstandingCny: roundMoney(outstandingAmount * exchangeRate),
    overpaidCny: roundMoney(overpaidAmount * exchangeRate),
    exchangeDifferenceCny: roundMoney(Number(receivedAmountCny || 0) - roundMoney(normalizedReceivedAmount * exchangeRate)),
  };
}

export function deriveOrderCollectionStatus({ currentStatus, actualShipmentAmount, receivedAmount, outstandingAmount, overpaidAmount }: {
  currentStatus?: string | null; actualShipmentAmount?: unknown; receivedAmount: unknown; outstandingAmount: unknown; overpaidAmount: unknown;
}) {
  const status = String(currentStatus || "");
  if (["草稿", "已关闭", "已取消"].includes(status)) return status;
  if (roundMoney(overpaidAmount) > 0) return "多收款";
  if (roundMoney(outstandingAmount) <= 0) return "已收齐";
  if (roundMoney(receivedAmount) > 0) return "部分收款";
  if (["部分收款", "已收齐", "多收款"].includes(status)) return actualShipmentAmount == null ? "已确认" : "已发货";
  return status;
}
