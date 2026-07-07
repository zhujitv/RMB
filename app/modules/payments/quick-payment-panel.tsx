"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { apiJson } from "../../api";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import { customerDisplayName, customerLegalName } from "../../utils";
import { moneyText } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { CURRENCIES, PAYMENT_TYPES, type ExchangeRateResponse, type OrdersResponse, type PaymentOrderOption, type PaymentRow, type QuickPaymentForm } from "./types";
import { orderLabel, paymentFormFromRow, paymentStatusOptions } from "./helpers";

type PaymentFieldErrors = Partial<Record<keyof QuickPaymentForm, string>>;
const FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE = "该订单尚无历史收款，不能登记尾款，请选择预付款、分批款或全款。";

function numericValue(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function orderReceivedCny(order?: PaymentOrderOption | null) {
  return numericValue(order?.receivedAmountCny, order?.summary?.confirmedPaymentsCny);
}

export function QuickCreatePaymentPanel({
  initialPayment,
  canConfirmArrived,
  onCancel,
  onSaved,
}: {
  initialPayment?: PaymentRow | null;
  canConfirmArrived: boolean;
  onCancel: () => void;
  onSaved: (payment?: PaymentRow | null) => void;
}) {
  const [form, setForm] = useState<QuickPaymentForm>(() => paymentFormFromRow(initialPayment));
  const [orders, setOrders] = useState<PaymentOrderOption[]>([]);
  const [exchangeMeta, setExchangeMeta] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<PaymentFieldErrors>({});

  async function searchOrders(keyword: string) {
    try {
      const params = new URLSearchParams({ q: keyword.trim(), purpose: "payment" });
      const result = await apiJson<OrdersResponse>(`/api/receivables/search?${params}`);
      if (Array.isArray(result.orders)) return result.orders;
      if (Array.isArray(result.data?.orders)) return result.data.orders;
      if (Array.isArray(result.data?.rows)) return result.data.rows;
      return [];
    } catch (orderError) {
      setMessage(orderError instanceof Error ? orderError.message : "搜索应收订单失败");
      return [];
    }
  }

  function setFormValue<K extends keyof QuickPaymentForm>(key: K, value: QuickPaymentForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function setExchangeSnapshot({
    exchangeRate,
    exchangeRateDate,
    exchangeRateSource,
    exchangeRateType,
  }: Pick<QuickPaymentForm, "exchangeRate" | "exchangeRateDate" | "exchangeRateSource" | "exchangeRateType">) {
    setForm((current) => ({
      ...current,
      exchangeRate,
      exchangeRateDate,
      exchangeRateSource,
      exchangeRateType,
    }));
  }

  async function resolveExchangeRate(currency: string, paymentDate = form.paymentDate) {
    const normalized = currency.trim().toUpperCase();
    if (!normalized) {
      setExchangeMeta("");
      setExchangeSnapshot({
        exchangeRate: "",
        exchangeRateDate: "",
        exchangeRateSource: "",
        exchangeRateType: "",
      });
      return;
    }
    if (normalized === "CNY") {
      setExchangeMeta("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
      setExchangeSnapshot({
        exchangeRate: "1.0000",
        exchangeRateDate: paymentDate || new Date().toISOString().slice(0, 10),
        exchangeRateSource: "系统",
        exchangeRateType: "人民币",
      });
      return;
    }
    setExchangeMeta("正在获取汇率...");
    try {
      const params = new URLSearchParams({ currency: normalized });
      if (paymentDate) params.set("date", paymentDate);
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?${params}`);
      const rate = Number(result.rate?.rateToCny ?? result.rate?.exchangeRate ?? result.rate?.rate ?? 0);
      if (rate > 0) {
        setExchangeSnapshot({
          exchangeRate: String(rate),
          exchangeRateDate: result.rate?.rateDate || paymentDate || "",
          exchangeRateSource: result.rate?.source || "系统",
          exchangeRateType: result.rate?.rateType || "现汇买入价",
        });
        setExchangeMeta(`来源：${result.rate?.source || "系统"} ｜ 类型：${result.rate?.rateType || "现汇买入价"} ｜ 更新时间：${result.rate?.rateDate || "-"}`);
      } else {
        setExchangeSnapshot({
          exchangeRate: "",
          exchangeRateDate: "",
          exchangeRateSource: "",
          exchangeRateType: "",
        });
        setExchangeMeta("汇率来源：待获取，请手工填写");
      }
    } catch (rateError) {
      setExchangeSnapshot({
        exchangeRate: "",
        exchangeRateDate: "",
        exchangeRateSource: "",
        exchangeRateType: "",
      });
      setExchangeMeta(rateError instanceof Error ? rateError.message : "汇率获取失败，请手工填写");
    }
  }

  async function handleOrderSelect(order: PaymentOrderOption) {
    const currency = (order?.currency || "").toUpperCase();
    setOrders((current) => current.some((item) => item.id === order.id) ? current : [order, ...current]);
    setForm((current) => ({
      ...current,
      orderId: order.id,
      currency,
      exchangeRate: "",
      exchangeRateDate: "",
      exchangeRateSource: "",
      exchangeRateType: "",
    }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.orderId;
      delete next.currency;
      delete next.exchangeRate;
      return next;
    });
    await resolveExchangeRate(currency);
  }

  async function handleCurrencyChange(currency: string) {
    const selectedOrder = orders.find((order) => order.id === form.orderId);
    if (selectedOrder?.currency) {
      setMessage("收款币种必须与订单币种一致。");
      return;
    }
    const normalized = currency.toUpperCase();
    setForm((current) => ({
      ...current,
      currency: normalized,
      exchangeRate: "",
      exchangeRateDate: "",
      exchangeRateSource: "",
      exchangeRateType: "",
    }));
    await resolveExchangeRate(normalized);
  }

  async function handlePaymentDateChange(paymentDate: string) {
    setFormValue("paymentDate", paymentDate);
    if (form.currency && form.currency !== "CNY") await resolveExchangeRate(form.currency, paymentDate);
    if (form.currency === "CNY") {
      setExchangeSnapshot({
        exchangeRate: "1.0000",
        exchangeRateDate: paymentDate,
        exchangeRateSource: "系统",
        exchangeRateType: "人民币",
      });
    }
  }

  function validateQuickPaymentForm(nextForm: QuickPaymentForm, selectedOrder?: PaymentOrderOption | null) {
    const errors: PaymentFieldErrors = {};
    const currency = nextForm.currency.trim().toUpperCase();
    const amountText = nextForm.amount.trim();
    const amount = Number(amountText);
    const exchangeRateText = nextForm.exchangeRate.trim();
    const exchangeRate = Number(exchangeRateText);

    if (!nextForm.orderId.trim()) errors.orderId = "请选择关联订单";
    if (!nextForm.paymentDate.trim()) errors.paymentDate = "请选择收款日期";
    if (!nextForm.paymentType.trim()) errors.paymentType = "请选择收款类型";
    else if (nextForm.paymentType === "尾款" && selectedOrder && orderReceivedCny(selectedOrder) <= 0) {
      errors.paymentType = FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE;
    }
    if (!amountText) errors.amount = "请输入收款金额";
    else if (!Number.isFinite(amount) || amount <= 0) errors.amount = "收款金额必须大于 0";
    if (!currency) errors.currency = "请选择币种";
    if (currency && currency !== "CNY") {
      if (!exchangeRateText) errors.exchangeRate = "汇率不能为空";
      else if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) errors.exchangeRate = "汇率必须大于 0";
    }
    return errors;
  }

  async function submitQuickPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCurrency = form.currency.trim().toUpperCase();
    const normalizedForm: QuickPaymentForm = normalizedCurrency === "CNY"
      ? {
        ...form,
        currency: normalizedCurrency,
        exchangeRate: "1.0000",
        exchangeRateDate: form.exchangeRateDate || form.paymentDate,
        exchangeRateSource: form.exchangeRateSource || "系统",
        exchangeRateType: form.exchangeRateType || "人民币",
      }
      : { ...form, currency: normalizedCurrency };
    const selectedOrder = orderOptions.find((order) => order.id === form.orderId);
    const errors = validateQuickPaymentForm(normalizedForm, selectedOrder);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setMessage(errors.paymentType || "请完善收款信息");
      setForm(normalizedForm);
      return;
    }
    const orderCurrency = selectedOrder?.currency?.toUpperCase();
    if (orderCurrency && normalizedForm.currency !== orderCurrency) {
      setMessage("收款币种必须与订单币种一致。");
      return;
    }
    setForm(normalizedForm);
    setSaving(true);
    setMessage("");
    try {
      const isEdit = Boolean(initialPayment?.id);
      const result = await apiJson<{ success?: boolean; message?: string; payment?: PaymentRow; data?: { payment?: PaymentRow } }>(
        isEdit ? `/api/payments/${encodeURIComponent(initialPayment?.id || "")}` : "/api/payments",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify({
            orderId: normalizedForm.orderId,
            paymentDate: normalizedForm.paymentDate,
            paymentType: normalizedForm.paymentType,
            amount: Number(normalizedForm.amount),
            currency: normalizedForm.currency,
            exchangeRate: Number(normalizedForm.exchangeRate),
            exchangeRateDate: normalizedForm.exchangeRateDate || undefined,
            exchangeRateSource: normalizedForm.exchangeRateSource || undefined,
            exchangeRateType: normalizedForm.exchangeRateType || undefined,
            status: form.status,
            bankReference: normalizedForm.bankReference.trim(),
            remark: normalizedForm.remark.trim(),
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "收款保存失败");
      setFieldErrors({});
      setForm(paymentFormFromRow(null));
      setExchangeMeta("");
      onSaved(result.payment || result.data?.payment || null);
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "收款保存失败");
    } finally {
      setSaving(false);
    }
  }

  const initialOrder: PaymentOrderOption | null = initialPayment?.orderId ? {
    id: initialPayment.orderId,
    orderNo: initialPayment.orderNo,
    customerName: initialPayment.customerName,
    customerFullName: initialPayment.customerFullName,
    customerShortName: initialPayment.customerShortName,
    currency: initialPayment.currency,
  } : null;
  const orderOptions = initialOrder && !orders.some((order) => order.id === initialOrder.id)
    ? [initialOrder, ...orders]
    : orders;
  const selectedOrder = orderOptions.find((order) => order.id === form.orderId);
  const selectedOrderMeta = selectedOrder ? [
    { label: "订单号", value: selectedOrder.orderNo || "-" },
    { label: "客户简称", value: customerDisplayName(selectedOrder) || "-" },
    { label: "订单币种", value: selectedOrder.currency || "-" },
    {
      label: "应收金额",
      value: moneyText(
        selectedOrder.currency || "CNY",
        selectedOrder.finalReceivableAmount ?? selectedOrder.receivableAmount ?? selectedOrder.summary?.receivableAmount,
        selectedOrder.finalReceivableAmountCny ?? selectedOrder.receivableAmountCny ?? selectedOrder.summary?.receivableCny,
      ),
    },
    {
      label: "已收金额",
      value: moneyText(
        selectedOrder.currency || "CNY",
        selectedOrder.receivedAmount ?? selectedOrder.summary?.confirmedPaymentsAmount,
        selectedOrder.receivedAmountCny ?? selectedOrder.summary?.confirmedPaymentsCny,
      ),
    },
    {
      label: "未收金额",
      value: moneyText(
        selectedOrder.currency || "CNY",
        selectedOrder.outstandingAmount ?? selectedOrder.summary?.outstandingAmount,
        selectedOrder.outstandingCny ?? selectedOrder.summary?.outstandingCny,
      ),
    },
  ] : [];
  const currencyLocked = Boolean(selectedOrder?.currency);

  return (
    <form className={styles.quickCreatePanel} onSubmit={submitQuickPayment} noValidate>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{initialPayment?.id ? "编辑收款" : "快速登记收款"}</strong>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          关联订单
          <SearchAutocomplete
            value={selectedOrder || null}
            cacheKey="payment-orders"
            emptyLabel="未找到应收订单"
            placeholder="输入订单号 / 提单号 / 客户简称"
            getLabel={orderLabel}
            getDescription={(order) => `${customerLegalName(order)}${order.currency ? ` · ${order.currency}` : ""}${order.outstandingCny != null ? ` · 未收 ${moneyText(order.currency || "CNY", order.outstandingAmount, order.outstandingCny)}` : ""}`}
            search={searchOrders}
            onSelect={(order) => void handleOrderSelect(order)}
          />
          {fieldErrors.orderId ? <small className={styles.inlineError}>{fieldErrors.orderId}</small> : null}
        </label>
        <label>
          收款日期
          <input type="date" value={form.paymentDate} onChange={(event) => void handlePaymentDateChange(event.target.value)} aria-invalid={Boolean(fieldErrors.paymentDate)} />
          {fieldErrors.paymentDate ? <small className={styles.inlineError}>{fieldErrors.paymentDate}</small> : null}
        </label>
        <label>
          收款类型
          <select value={form.paymentType} onChange={(event) => setFormValue("paymentType", event.target.value)}>
            <option value="">请选择收款类型</option>
            {PAYMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          {fieldErrors.paymentType ? <small className={styles.inlineError}>{fieldErrors.paymentType}</small> : null}
        </label>
        <label>
          收款金额
          <input value={form.amount} onChange={(event) => setFormValue("amount", event.target.value)} inputMode="decimal" aria-invalid={Boolean(fieldErrors.amount)} />
          {fieldErrors.amount ? <small className={styles.inlineError}>{fieldErrors.amount}</small> : null}
        </label>
        <label>
          币种
          <select value={form.currency} onChange={(event) => void handleCurrencyChange(event.target.value)} disabled={currencyLocked}>
            <option value="">请选择币种</option>
            {CURRENCIES.filter(Boolean).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
          {fieldErrors.currency ? <small className={styles.inlineError}>{fieldErrors.currency}</small> : null}
        </label>
        <label>
          汇率
          <input
            value={form.exchangeRate}
            onChange={(event) => {
              const value = event.target.value;
              setForm((current) => ({
                ...current,
                exchangeRate: value,
                exchangeRateDate: current.currency === "CNY" ? current.exchangeRateDate : "",
                exchangeRateSource: current.currency === "CNY" ? current.exchangeRateSource : "",
                exchangeRateType: current.currency === "CNY" ? current.exchangeRateType : "",
              }));
            }}
            readOnly={form.currency === "CNY"}
            inputMode="decimal"
            aria-invalid={Boolean(fieldErrors.exchangeRate)}
          />
          {fieldErrors.exchangeRate ? <small className={styles.inlineError}>{fieldErrors.exchangeRate}</small> : null}
        </label>
        <label>
          收款状态
          <select value={form.status} onChange={(event) => setFormValue("status", event.target.value)}>
            {paymentStatusOptions(canConfirmArrived).map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          银行流水号
          <input value={form.bankReference} onChange={(event) => setFormValue("bankReference", event.target.value)} placeholder="可选" />
        </label>
        <label>
          备注
          <input value={form.remark} onChange={(event) => setFormValue("remark", event.target.value)} placeholder="可选" />
        </label>
      </div>

      <div className={styles.quickCreateMeta}>
        {selectedOrderMeta.length ? selectedOrderMeta.map((item) => (
          <span key={item.label}>{item.label}：{item.value}</span>
        )) : <span>订单：-</span>}
        {currencyLocked ? <span>收款币种已锁定为订单币种，不能混用其它币种。</span> : null}
        <span>{exchangeMeta || "汇率来源：待获取"}</span>
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : initialPayment?.id ? "更新收款" : "保存收款"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}
