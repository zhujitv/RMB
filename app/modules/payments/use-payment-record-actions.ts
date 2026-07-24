import { ApiRequestError, apiJson } from "../../api";
import { moneyText } from "../../formatters";
import { customerDisplayName } from "../../utils";
import type { PaymentFilters, PaymentRow } from "./types";

type ConfirmationRequester = (input: {
  title: string;
  message: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
}) => Promise<{ confirmed: boolean }>;

type PaymentActionControllerOptions = {
  page: number;
  submittedFilters: PaymentFilters;
  payments: PaymentRow[];
  requestConfirmation: ConfirmationRequester;
  loadPayments: (page: number, filters: PaymentFilters) => Promise<PaymentRow[] | null>;
  paymentMatchesSubmittedFilters: (payment: PaymentRow) => boolean;
  mergePaymentRow: (payment: PaymentRow, options?: { shouldShow?: boolean }) => void;
  setDetailPayment: (payment: PaymentRow | null) => void;
  setTotal: (updater: (current: number) => number) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  setDeletingId: (id: string) => void;
  setConfirmingId: (id: string) => void;
  beforeMutation: () => boolean;
};

async function refreshPaymentAfterConflict(
  payment: PaymentRow,
  options: PaymentActionControllerOptions,
  actionLabel: string,
) {
  const refreshedRows = await options.loadPayments(options.page, options.submittedFilters);
  if (!refreshedRows) {
    options.setError(`该收款记录已被其他人更新，但自动刷新失败。请手动刷新后再${actionLabel}。`);
    return;
  }
  const latestPayment = refreshedRows.find((row) => row.id === payment.id) || null;
  if (latestPayment) {
    options.mergePaymentRow(latestPayment, { shouldShow: true });
    options.setError(`该收款记录已被其他人更新，详情已刷新。请核对最新数据后再${actionLabel}。`);
    return;
  }
  options.setDetailPayment(null);
  options.setError("该收款记录已被删除或已不在当前筛选结果中，列表已刷新。");
}

export async function deletePaymentRecord(payment: PaymentRow, options: PaymentActionControllerOptions) {
  const result = await options.requestConfirmation({
    title: "确认删除这笔收款？",
    message: "删除后将重新计算订单已收金额、未收金额和回款率。",
    details: [
      `订单：${payment.orderNo || "-"}`,
      `金额：${moneyText(payment.currency, payment.amount, payment.amountCny)}`,
    ],
    confirmLabel: "删除收款",
    cancelLabel: "取消",
    variant: "danger",
  });
  if (!result.confirmed) return;
  if (!options.beforeMutation()) return;
  options.setDeletingId(payment.id);
  options.setError("");
  options.setNotice("");
  try {
    const expectedVersion = payment.updatedAt
      ? `?expectedUpdatedAt=${encodeURIComponent(payment.updatedAt)}`
      : "";
    const response = await apiJson<{ success?: boolean; message?: string }>(`/api/payments/${encodeURIComponent(payment.id)}${expectedVersion}`, {
      method: "DELETE",
    });
    if (response.success !== true) throw new Error(response.message || "删除收款失败");
    options.setDetailPayment(null);
    await options.loadPayments(options.page, options.submittedFilters);
    options.setNotice(response.message || "收款已删除");
  } catch (deleteError) {
    if (deleteError instanceof ApiRequestError && deleteError.status === 409) {
      await refreshPaymentAfterConflict(payment, options, "删除");
      return;
    }
    options.setError(deleteError instanceof Error ? deleteError.message : "删除收款失败");
  } finally {
    options.setDeletingId("");
  }
}

export async function confirmPaymentRecordArrived(payment: PaymentRow, options: PaymentActionControllerOptions) {
  const result = await options.requestConfirmation({
    title: "确认该笔收款已经到账？",
    message: "确认后该笔收款将计入正式回款统计、利润分析和提成结算判断。",
    details: [
      `订单：${payment.orderNo || "-"}`,
      `客户：${customerDisplayName(payment)}`,
      `金额：${moneyText(payment.currency, payment.amount, payment.amountCny)}`,
    ],
    confirmLabel: "确认到账",
    cancelLabel: "取消",
    variant: "default",
  });
  if (!result.confirmed) return;
  if (!options.beforeMutation()) return;
  options.setConfirmingId(payment.id);
  options.setError("");
  options.setNotice("");
  try {
    const response = await apiJson<{ success?: boolean; message?: string; payment?: PaymentRow; data?: { payment?: PaymentRow } }>(`/api/payments/${encodeURIComponent(payment.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        orderId: payment.orderId,
        paymentDate: payment.paymentDate,
        paymentType: payment.paymentType,
        amount: Number(payment.amount || 0),
        currency: payment.currency,
        exchangeRate: Number(payment.exchangeRate || 0),
        exchangeRateDate: payment.exchangeRateDate || undefined,
        exchangeRateSource: payment.exchangeRateSource || undefined,
        exchangeRateType: payment.exchangeRateType || undefined,
        status: "已到账",
        bankReference: payment.bankReference || "",
        remark: payment.remark || "",
        expectedUpdatedAt: payment.updatedAt || undefined,
      }),
    });
    if (response.success !== true) throw new Error(response.message || "确认到账失败");
    const nextPayment = response.payment || response.data?.payment || { ...payment, status: "已到账" };
    const existedInRows = options.payments.some((item) => item.id === nextPayment.id);
    const shouldShow = options.paymentMatchesSubmittedFilters(nextPayment);
    options.mergePaymentRow(nextPayment, { shouldShow });
    if (existedInRows && !shouldShow) options.setTotal((current) => Math.max(0, current - 1));
    options.setNotice(response.message || "收款已确认到账");
  } catch (confirmError) {
    if (confirmError instanceof ApiRequestError && confirmError.status === 409) {
      await refreshPaymentAfterConflict(payment, options, "确认到账");
      return;
    }
    options.setError(confirmError instanceof Error ? confirmError.message : "确认到账失败");
  } finally {
    options.setConfirmingId("");
  }
}
