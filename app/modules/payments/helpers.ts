import styles from "../../WorkspaceShell.module.css";
import { customerDisplayName } from "../../utils";
import { PAYMENT_STATUSES, emptyQuickPaymentForm, type PaymentOrderOption, type PaymentRow, type QuickPaymentForm } from "./types";

export function paymentFormFromRow(payment?: PaymentRow | null): QuickPaymentForm {
  if (!payment) return { ...emptyQuickPaymentForm, paymentDate: new Date().toISOString().slice(0, 10) };
  return {
    orderId: payment.orderId || "",
    paymentDate: payment.paymentDate || new Date().toISOString().slice(0, 10),
    paymentType: payment.paymentType || "",
    amount: payment.amount == null ? "" : String(payment.amount),
    currency: payment.currency || "",
    exchangeRate: payment.exchangeRate == null ? "" : String(payment.exchangeRate),
    status: payment.status || "待确认",
    bankReference: payment.bankReference || "",
    remark: payment.remark || "",
  };
}

export function paymentStatusClass(status = "") {
  if (status === "已到账") return styles.statusSuccess;
  if (status === "待确认") return styles.statusWarning;
  if (status === "已退回") return styles.statusDanger;
  if (status === "已取消") return styles.statusMuted;
  return "";
}

export function paymentStatusOptions(canConfirmArrived: boolean) {
  return canConfirmArrived ? PAYMENT_STATUSES : PAYMENT_STATUSES.filter((status) => status !== "已到账");
}

export function rateMeta(payment: PaymentRow) {
  const source = payment.exchangeRateSource || "待获取";
  const type = payment.exchangeRateType || "-";
  return `来源：${source} / 类型：${type}`;
}

export function orderLabel(order: PaymentOrderOption) {
  const customer = customerDisplayName(order);
  const blNo = order.blNo || order.billOfLadingNo;
  return `${order.orderNo || "未编号"} / ${customer}${blNo ? ` / ${blNo}` : ""}`;
}
