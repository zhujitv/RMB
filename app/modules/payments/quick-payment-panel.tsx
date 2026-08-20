"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { ApiRequestError, apiJson } from "../../api";
import { useWorkspaceTabBusy, useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import { paymentFormFromRow } from "./helpers";
import { QuickPaymentFormView } from "./quick-payment-form-view";
import {
  createPaymentOrderOptions,
  createPaymentOrderSummary,
  normalizeQuickPaymentForm,
  quickPaymentPayload,
  validateQuickPaymentForm,
  type PaymentFieldErrors,
} from "./quick-payment-utils";
import { type ExchangeRateResponse, type OrdersResponse, type PaymentOrderOption, type PaymentRow, type QuickPaymentForm } from "./types";

export function QuickCreatePaymentPanel({
  initialPayment,
  initialOrder,
  canConfirmArrived,
  onCancel,
  onConflict,
  onSaved,
}: {
  initialPayment?: PaymentRow | null;
  initialOrder?: PaymentOrderOption | null;
  canConfirmArrived: boolean;
  onCancel: () => void;
  onConflict: (paymentId: string) => Promise<void>;
  onSaved: (payment?: PaymentRow | null) => void;
}) {
  const [editingSnapshot] = useState<PaymentRow | null>(() => initialPayment ? { ...initialPayment } : null);
  const initialCreateOrder = !editingSnapshot && initialOrder?.id ? { ...initialOrder, currency: (initialOrder.currency || "").toUpperCase() } : null;
  const [form, setForm] = useState<QuickPaymentForm>(() => {
    const base = paymentFormFromRow(editingSnapshot);
    if (!initialCreateOrder) return base;
    return {
      ...base,
      orderId: initialCreateOrder.id,
      currency: initialCreateOrder.currency || "",
      exchangeRate: initialCreateOrder.currency === "CNY" ? "1.0000" : "",
      exchangeRateDate: initialCreateOrder.currency === "CNY" ? base.paymentDate : "",
      exchangeRateSource: initialCreateOrder.currency === "CNY" ? "系统" : "",
      exchangeRateType: initialCreateOrder.currency === "CNY" ? "人民币" : "",
    };
  });
  const [orders, setOrders] = useState<PaymentOrderOption[]>(() => initialCreateOrder ? [initialCreateOrder] : []);
  const [exchangeMeta, setExchangeMeta] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<PaymentFieldErrors>({});
  useWorkspaceTabBusy(saving);
  useWorkspaceTabDirty(JSON.stringify(form) !== JSON.stringify(paymentFormFromRow(editingSnapshot)));

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

  useEffect(() => {
    if (initialCreateOrder?.currency && initialCreateOrder.currency !== "CNY") void resolveExchangeRate(initialCreateOrder.currency);
  }, []);

  async function submitQuickPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedForm = normalizeQuickPaymentForm(form);
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
      const isEdit = Boolean(editingSnapshot?.id);
      const result = await apiJson<{ success?: boolean; message?: string; payment?: PaymentRow; data?: { payment?: PaymentRow } }>(
        isEdit ? `/api/payments/${encodeURIComponent(editingSnapshot?.id || "")}` : "/api/payments",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify(quickPaymentPayload(normalizedForm, editingSnapshot)),
        },
      );
      if (result.success !== true) throw new Error(result.message || "收款保存失败");
      setFieldErrors({});
      setForm(paymentFormFromRow(null));
      setExchangeMeta("");
      onSaved(result.payment || result.data?.payment || null);
    } catch (saveError) {
      if (saveError instanceof ApiRequestError && saveError.status === 409 && editingSnapshot?.id) {
        await onConflict(editingSnapshot.id);
        return;
      }
      setMessage(saveError instanceof Error ? saveError.message : "收款保存失败");
    } finally {
      setSaving(false);
    }
  }

  const orderOptions = createPaymentOrderOptions(editingSnapshot, orders);
  const selectedOrder = orderOptions.find((order) => order.id === form.orderId);
  const selectedOrderMeta = createPaymentOrderSummary(selectedOrder);
  const currencyLocked = Boolean(selectedOrder?.currency);

  function handleExchangeRateChange(value: string) {
    setForm((current) => ({
      ...current,
      exchangeRate: value,
      exchangeRateDate: current.currency === "CNY" ? current.exchangeRateDate : "",
      exchangeRateSource: current.currency === "CNY" ? current.exchangeRateSource : "",
      exchangeRateType: current.currency === "CNY" ? current.exchangeRateType : "",
    }));
  }

  return (
    <QuickPaymentFormView
      editing={Boolean(editingSnapshot?.id)}
      form={form}
      selectedOrder={selectedOrder}
      selectedOrderMeta={selectedOrderMeta}
      currencyLocked={currencyLocked}
      exchangeMeta={exchangeMeta}
      fieldErrors={fieldErrors}
      message={message}
      saving={saving}
      canConfirmArrived={canConfirmArrived}
      searchOrders={searchOrders}
      onSubmit={submitQuickPayment}
      onCancel={onCancel}
      onOrderSelect={(order) => void handleOrderSelect(order)}
      onPaymentDateChange={(value) => void handlePaymentDateChange(value)}
      onCurrencyChange={(value) => void handleCurrencyChange(value)}
      onExchangeRateChange={handleExchangeRateChange}
      onFieldChange={setFormValue}
    />
  );
}
