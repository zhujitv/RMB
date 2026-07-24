import { moneyText } from "../../formatters";
import { customerDisplayName } from "../../utils";
import type { PaymentOrderOption, PaymentRow, QuickPaymentForm } from "./types";

export type PaymentFieldErrors = Partial<Record<keyof QuickPaymentForm, string>>;
const FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE = "该订单尚无历史收款，不能登记尾款，请选择预付款、分批款或全款。";

function numericValue(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

export function validateQuickPaymentForm(form: QuickPaymentForm, order?: PaymentOrderOption | null) {
  const errors: PaymentFieldErrors = {};
  const currency = form.currency.trim().toUpperCase();
  const amount = Number(form.amount.trim());
  const exchangeRate = Number(form.exchangeRate.trim());
  if (!form.orderId.trim()) errors.orderId = "请选择关联订单";
  if (!form.paymentDate.trim()) errors.paymentDate = "请选择收款日期";
  if (!form.paymentType.trim()) errors.paymentType = "请选择收款类型";
  else if (form.paymentType === "尾款" && order && numericValue(order.receivedAmountCny, order.summary?.confirmedPaymentsCny) <= 0) {
    errors.paymentType = FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE;
  }
  if (!form.amount.trim()) errors.amount = "请输入收款金额";
  else if (!Number.isFinite(amount) || amount <= 0) errors.amount = "收款金额必须大于 0";
  if (!currency) errors.currency = "请选择币种";
  if (currency && currency !== "CNY") {
    if (!form.exchangeRate.trim()) errors.exchangeRate = "汇率不能为空";
    else if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) errors.exchangeRate = "汇率必须大于 0";
  }
  return errors;
}

export function normalizeQuickPaymentForm(form: QuickPaymentForm): QuickPaymentForm {
  const currency = form.currency.trim().toUpperCase();
  if (currency !== "CNY") return { ...form, currency };
  return {
    ...form,
    currency,
    exchangeRate: "1.0000",
    exchangeRateDate: form.exchangeRateDate || form.paymentDate,
    exchangeRateSource: form.exchangeRateSource || "系统",
    exchangeRateType: form.exchangeRateType || "人民币",
  };
}

export function quickPaymentPayload(form: QuickPaymentForm, editing: PaymentRow | null) {
  return {
    orderId: form.orderId,
    paymentDate: form.paymentDate,
    paymentType: form.paymentType,
    amount: Number(form.amount),
    currency: form.currency,
    exchangeRate: Number(form.exchangeRate),
    exchangeRateDate: form.exchangeRateDate || undefined,
    exchangeRateSource: form.exchangeRateSource || undefined,
    exchangeRateType: form.exchangeRateType || undefined,
    status: form.status,
    bankReference: form.bankReference.trim(),
    remark: form.remark.trim(),
    ...(editing?.id ? { expectedUpdatedAt: editing.updatedAt || undefined } : {}),
  };
}

export function createPaymentOrderOptions(editing: PaymentRow | null, orders: PaymentOrderOption[]) {
  if (!editing?.orderId || orders.some((order) => order.id === editing.orderId)) return orders;
  return [{
    id: editing.orderId,
    orderNo: editing.orderNo,
    customerName: editing.customerName,
    customerFullName: editing.customerFullName,
    customerShortName: editing.customerShortName,
    currency: editing.currency,
  }, ...orders];
}

export function createPaymentOrderSummary(order?: PaymentOrderOption | null) {
  if (!order) return [];
  const currency = order.currency || "CNY";
  return [
    { label: "订单号", value: order.orderNo || "-" },
    { label: "客户简称", value: customerDisplayName(order) || "-" },
    { label: "订单币种", value: order.currency || "-" },
    { label: "应收金额", value: moneyText(currency, order.finalReceivableAmount ?? order.receivableAmount ?? order.summary?.receivableAmount, order.finalReceivableAmountCny ?? order.receivableAmountCny ?? order.summary?.receivableCny) },
    { label: "已收金额", value: moneyText(currency, order.receivedAmount ?? order.summary?.confirmedPaymentsAmount, order.receivedAmountCny ?? order.summary?.confirmedPaymentsCny) },
    { label: "未收金额", value: moneyText(currency, order.outstandingAmount ?? order.summary?.outstandingAmount, order.outstandingCny ?? order.summary?.outstandingCny) },
  ];
}
