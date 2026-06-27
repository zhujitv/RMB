"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, CurrencyTotalsDisplay, DetailField, MoneyAmount, PaginationBar, SideDetailDrawer, useConfirmationDialog } from "../components";
import type { CurrencyTotals } from "../../lib/platform/currency-totals";
import { formatCny, formatDateTime, moneyText } from "../formatters";
import { SearchAutocomplete } from "../SearchAutocomplete";
import { customerDisplayName, customerLegalName } from "../utils";
import styles from "../WorkspaceShell.module.css";
import type { User } from "../types";

const CURRENCIES = ["", "CNY", "USD", "EUR", "GBP", "HKD"];
const PAYMENT_TYPES = ["预付款", "尾款", "补差款", "其他"];
const PAYMENT_STATUSES = ["待确认", "已到账", "已退回", "已取消"];

type UserLite = {
  name?: string;
};

type PaymentRow = {
  id: string;
  orderId?: string;
  orderNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  paymentDate?: string;
  currency?: string;
  exchangeRate?: number;
  exchangeRateSource?: string;
  exchangeRateType?: string;
  amount?: number;
  amountCny?: number;
  paymentType?: string;
  status?: string;
  bankReference?: string;
  remark?: string;
  createdBy?: UserLite;
  updatedBy?: UserLite;
  createdAt?: string;
  updatedAt?: string;
};

type PaymentsResponse = {
  payments: PaymentRow[];
  data?: {
    rows?: PaymentRow[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
    summary?: PaymentSummary;
  };
  summary?: PaymentSummary;
};

type PaymentSummary = {
  arrivedAmountCny?: number;
  pendingAmountCny?: number;
  arrivedCurrencyTotals?: CurrencyTotals;
  pendingCurrencyTotals?: CurrencyTotals;
  currentMonthCount?: number;
};

type PaymentOrderOption = {
  id: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  currency?: string;
  receivableAmount?: number;
  receivableAmountCny?: number;
  finalReceivableAmount?: number;
  finalReceivableAmountCny?: number;
  receivedAmountCny?: number;
  receivedAmount?: number;
  outstandingAmount?: number;
  outstandingCny?: number;
  summary?: {
    receivableAmount?: number;
    receivableCny?: number;
    confirmedPaymentsCny?: number;
    confirmedPaymentsAmount?: number;
    outstandingAmount?: number;
    outstandingCny?: number;
  };
};

type OrdersResponse = {
  orders?: PaymentOrderOption[];
  data?: {
    orders?: PaymentOrderOption[];
    rows?: PaymentOrderOption[];
  };
};

type ExchangeRateResponse = {
  rate?: {
    rateToCny?: number;
    exchangeRate?: number;
    rate?: number;
    source?: string;
    rateType?: string;
    rateDate?: string;
  };
};

type QuickPaymentForm = {
  orderId: string;
  paymentDate: string;
  paymentType: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  status: string;
  bankReference: string;
  remark: string;
};

type PaymentFilters = {
  keyword: string;
  month: string;
  currency: string;
  paymentStatus: string;
};

const PAGE_SIZE = 20;

const emptyQuickPaymentForm: QuickPaymentForm = {
  orderId: "",
  paymentDate: new Date().toISOString().slice(0, 10),
  paymentType: "尾款",
  amount: "",
  currency: "",
  exchangeRate: "",
  status: "待确认",
  bankReference: "",
  remark: "",
};

const emptyPaymentFilters: PaymentFilters = {
  keyword: "",
  month: "",
  currency: "",
  paymentStatus: "",
};

export function PaymentsModule({
  currentUser,
  initialKeyword = "",
  initialOpenToken = 0,
}: {
  currentUser: User;
  initialKeyword?: string;
  initialOpenToken?: number;
}) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [summary, setSummary] = useState<PaymentSummary>({});
  const [filters, setFilters] = useState<PaymentFilters>({ ...emptyPaymentFilters });
  const [submittedFilters, setSubmittedFilters] = useState<PaymentFilters>({ ...emptyPaymentFilters });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [detailPayment, setDetailPayment] = useState<PaymentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<PaymentRow | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canManagePayments = ["管理员", "财务"].includes(currentUser.role);
  const summaryCards = useMemo(() => ([
    {
      label: "已到账金额",
      value: (
        <CurrencyTotalsDisplay
          summary={summary.arrivedCurrencyTotals || { cnyActual: Number(summary.arrivedAmountCny || 0), foreignTotals: [], totalCny: Number(summary.arrivedAmountCny || 0) }}
          cnyLabel="人民币实际已到账"
          foreignLabel={(currency) => `${currency} 实际已到账`}
          totalLabel="折人民币到账总额"
        />
      ),
      note: "只统计已到账收款",
      tone: styles.metricGreen,
    },
    {
      label: "待确认金额",
      value: (
        <CurrencyTotalsDisplay
          summary={summary.pendingCurrencyTotals || { cnyActual: Number(summary.pendingAmountCny || 0), foreignTotals: [], totalCny: Number(summary.pendingAmountCny || 0) }}
          cnyLabel="人民币实际待确认"
          foreignLabel={(currency) => `${currency} 实际待确认`}
          totalLabel="折人民币待确认总额"
        />
      ),
      note: "待确认不计入经营数据",
      tone: styles.metricOrange,
    },
    {
      label: "本月收款笔数",
      value: `${Number(summary.currentMonthCount || 0)} 笔`,
      note: "按当前筛选条件统计",
      tone: styles.metricBlue,
    },
  ]), [summary]);

  async function loadPayments(nextPage = page, nextFilters = submittedFilters) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        workspace: "1",
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextFilters.keyword.trim()) params.set("keyword", nextFilters.keyword.trim());
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (key === "keyword") return;
        const text = String(value || "").trim();
        if (text) params.set(key, text);
      });
      const result = await apiJson<PaymentsResponse>(`/api/payments?${params}`);
      const data = result.data || {};
      setPayments(Array.isArray(data.rows) ? data.rows : Array.isArray(result.payments) ? result.payments : []);
      setSummary(data.summary || result.summary || {});
      setTotal(Number(data.total ?? result.payments?.length ?? 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取收款明细失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPayments(1, { ...emptyPaymentFilters });
  }, []);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    const nextFilters = { ...emptyPaymentFilters, keyword: value };
    setFilters(nextFilters);
    setSubmittedFilters(nextFilters);
    setDetailPayment(null);
    setNotice("");
    void loadPayments(1, nextFilters);
  }, [initialKeyword, initialOpenToken]);

  useEffect(() => {
    const value = filters.keyword.trim();
    if (value === submittedFilters.keyword) return;
    const timer = window.setTimeout(() => {
      const nextFilters = {
        ...filters,
        keyword: value,
        month: filters.month.trim(),
        currency: filters.currency.trim(),
        paymentStatus: filters.paymentStatus.trim(),
      };
      setSubmittedFilters(nextFilters);
      setDetailPayment(null);
      setNotice("");
      void loadPayments(1, nextFilters);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.keyword, filters.month, filters.currency, filters.paymentStatus, submittedFilters.keyword]);

  function setFilter<K extends keyof PaymentFilters>(key: K, value: PaymentFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function submitSearch() {
    setDetailPayment(null);
    setNotice("");
    const nextFilters = Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [key, String(value || "").trim()]),
    ) as PaymentFilters;
    setSubmittedFilters(nextFilters);
    void loadPayments(1, nextFilters);
  }

  function resetSearch() {
    setFilters({ ...emptyPaymentFilters });
    setSubmittedFilters({ ...emptyPaymentFilters });
    setDetailPayment(null);
    setNotice("");
    void loadPayments(1, { ...emptyPaymentFilters });
  }

  function gotoPage(nextPage: number) {
    setDetailPayment(null);
    setNotice("");
    void loadPayments(nextPage, submittedFilters);
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>收款管理</h2>
        </div>
        <div className={styles.headerActions}>
          {canManagePayments ? (
            <button
              className={styles.primaryButtonCompact}
              type="button"
              onClick={() => {
                setEditPayment(null);
                setCreateOpen((current) => !current);
              }}
            >
              {createOpen ? "收起登记" : "登记收款"}
            </button>
          ) : null}
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => {
              setNotice("");
              void loadPayments(page, submittedFilters);
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {canManagePayments && (createOpen || editPayment) ? (
        <QuickCreatePaymentPanel
          initialPayment={editPayment}
          canConfirmArrived={canManagePayments}
          onCancel={() => {
            setCreateOpen(false);
            setEditPayment(null);
          }}
          onSaved={() => {
            setCreateOpen(false);
            setEditPayment(null);
            setDetailPayment(null);
            setNotice(editPayment ? "收款已更新" : "收款已保存");
            void loadPayments(1, submittedFilters);
          }}
        />
      ) : null}

      <div className={styles.metricGrid} aria-label="收款汇总统计">
        {summaryCards.map((card) => (
          <article key={card.label} className={`${styles.metricCard} ${card.tone}`}>
            <span>{card.label}</span>
            {typeof card.value === "string" ? <strong>{card.value}</strong> : <div className={styles.metricValue}>{card.value}</div>}
            <small>{card.note}</small>
          </article>
        ))}
      </div>

      <div className={styles.listToolbar}>
        <input
          value={filters.keyword}
          onChange={(event) => setFilter("keyword", event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 备注"
        />
        <input value={filters.month} onChange={(event) => setFilter("month", event.target.value)} type="month" />
        <select value={filters.currency} onChange={(event) => setFilter("currency", event.target.value)} disabled={loading}>
          <option value="">全部币种</option>
          {CURRENCIES.filter(Boolean).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
        </select>
        <select value={filters.paymentStatus} onChange={(event) => setFilter("paymentStatus", event.target.value)} disabled={loading}>
          <option value="">全部收款状态</option>
          {PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <div className={`${styles.tableWrap} ${styles.tablePinnedTwoCols}`}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th className={styles.orderNoColumn}>订单号</th>
              <th className={styles.customerColumn}>客户简称</th>
              <th>收款日期</th>
              <th className={styles.amountColumn}>金额</th>
              <th>状态</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : payments.length ? payments.map((payment) => (
              <PaymentTableRows
                key={payment.id}
                payment={payment}
                onViewDetail={() => setDetailPayment(payment)}
                deleting={deletingId === payment.id}
                onEdit={() => {
                  setCreateOpen(false);
                  setEditPayment(payment);
                  setDetailPayment(payment);
                }}
                onDelete={() => void deletePayment(payment)}
                onConfirmArrived={() => void confirmPaymentArrived(payment)}
                canManage={canManagePayments}
                confirming={confirmingId === payment.id}
              />
            )) : (
              <tr>
                <td colSpan={6}><div className={styles.emptyState}>未找到匹配的收款明细</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} onPage={gotoPage} />
      {detailPayment ? (
        <PaymentDetailDrawer
          payment={detailPayment}
          canManage={canManagePayments}
          deleting={deletingId === detailPayment.id}
          confirming={confirmingId === detailPayment.id}
          onEdit={() => {
            setCreateOpen(false);
            setEditPayment(detailPayment);
          }}
          onDelete={() => void deletePayment(detailPayment)}
          onConfirmArrived={() => void confirmPaymentArrived(detailPayment)}
          onClose={() => setDetailPayment(null)}
        />
      ) : null}
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={cancelConfirmation}
          onConfirm={confirmConfirmation}
          onInputChange={updateConfirmationInput}
        />
      ) : null}
    </section>
  );

  async function deletePayment(payment: PaymentRow) {
    const result = await requestConfirmation({
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
    setDeletingId(payment.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/payments/${encodeURIComponent(payment.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除收款失败");
      setDetailPayment(null);
      await loadPayments(page, submittedFilters);
      setNotice(result.message || "收款已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除收款失败");
    } finally {
      setDeletingId("");
    }
  }

  async function confirmPaymentArrived(payment: PaymentRow) {
    const result = await requestConfirmation({
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
    setConfirmingId(payment.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/payments/${encodeURIComponent(payment.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          orderId: payment.orderId,
          paymentDate: payment.paymentDate,
          paymentType: payment.paymentType,
          amount: Number(payment.amount || 0),
          currency: payment.currency,
          exchangeRate: Number(payment.exchangeRate || 0),
          status: "已到账",
          bankReference: payment.bankReference || "",
          remark: payment.remark || "",
        }),
      });
      if (result.success !== true) throw new Error(result.message || "确认到账失败");
      setDetailPayment(null);
      await loadPayments(page, submittedFilters);
      setNotice(result.message || "收款已确认到账");
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "确认到账失败");
    } finally {
      setConfirmingId("");
    }
  }
}

function QuickCreatePaymentPanel({
  initialPayment,
  canConfirmArrived,
  onCancel,
  onSaved,
}: {
  initialPayment?: PaymentRow | null;
  canConfirmArrived: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<QuickPaymentForm>(() => paymentFormFromRow(initialPayment));
  const [orders, setOrders] = useState<PaymentOrderOption[]>([]);
  const [exchangeMeta, setExchangeMeta] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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
  }

  async function resolveExchangeRate(currency: string, paymentDate = form.paymentDate) {
    const normalized = currency.trim().toUpperCase();
    if (!normalized) {
      setExchangeMeta("");
      setFormValue("exchangeRate", "");
      return;
    }
    if (normalized === "CNY") {
      setExchangeMeta("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
      setFormValue("exchangeRate", "1");
      return;
    }
    setExchangeMeta("正在获取汇率...");
    try {
      const params = new URLSearchParams({ currency: normalized });
      if (paymentDate) params.set("date", paymentDate);
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?${params}`);
      const rate = Number(result.rate?.rateToCny ?? result.rate?.exchangeRate ?? result.rate?.rate ?? 0);
      if (rate > 0) {
        setFormValue("exchangeRate", String(rate));
        setExchangeMeta(`来源：${result.rate?.source || "系统"} ｜ 类型：${result.rate?.rateType || "现汇买入价"} ｜ 更新时间：${result.rate?.rateDate || "-"}`);
      } else {
        setExchangeMeta("汇率来源：待获取，请手工填写");
      }
    } catch (rateError) {
      setExchangeMeta(rateError instanceof Error ? rateError.message : "汇率获取失败，请手工填写");
    }
  }

  async function handleOrderSelect(order: PaymentOrderOption) {
    setOrders((current) => current.some((item) => item.id === order.id) ? current : [order, ...current]);
    setForm((current) => ({
      ...current,
      orderId: order.id,
      currency: order?.currency || "",
      exchangeRate: "",
    }));
    await resolveExchangeRate(order?.currency || "");
  }

  async function handleCurrencyChange(currency: string) {
    const selectedOrder = orders.find((order) => order.id === form.orderId);
    if (selectedOrder?.currency) {
      setMessage("收款币种必须与订单币种一致。");
      return;
    }
    const normalized = currency.toUpperCase();
    setForm((current) => ({ ...current, currency: normalized, exchangeRate: "" }));
    await resolveExchangeRate(normalized);
  }

  async function handlePaymentDateChange(paymentDate: string) {
    setFormValue("paymentDate", paymentDate);
    if (form.currency && form.currency !== "CNY") await resolveExchangeRate(form.currency, paymentDate);
  }

  async function submitQuickPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.orderId) {
      setMessage("请选择关联订单");
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      setMessage("请填写收款金额");
      return;
    }
    if (!form.currency) {
      setMessage("请选择币种");
      return;
    }
    const selectedOrder = orderOptions.find((order) => order.id === form.orderId);
    const orderCurrency = selectedOrder?.currency?.toUpperCase();
    if (orderCurrency && form.currency.toUpperCase() !== orderCurrency) {
      setMessage("收款币种必须与订单币种一致。");
      return;
    }
    if (!Number(form.exchangeRate)) {
      setMessage("请填写汇率；CNY 收款汇率应自动为 1");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const isEdit = Boolean(initialPayment?.id);
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/payments/${encodeURIComponent(initialPayment?.id || "")}` : "/api/payments",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify({
            orderId: form.orderId,
            paymentDate: form.paymentDate,
            paymentType: form.paymentType,
            amount: Number(form.amount),
            currency: form.currency,
            exchangeRate: Number(form.exchangeRate),
            status: form.status,
            bankReference: form.bankReference.trim(),
            remark: form.remark.trim(),
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "收款保存失败");
      setForm(paymentFormFromRow(null));
      setExchangeMeta("");
      onSaved();
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
    <form className={styles.quickCreatePanel} onSubmit={submitQuickPayment}>
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
        </label>
        <label>
          收款日期
          <input type="date" value={form.paymentDate} onChange={(event) => void handlePaymentDateChange(event.target.value)} required />
        </label>
        <label>
          收款类型
          <select value={form.paymentType} onChange={(event) => setFormValue("paymentType", event.target.value)}>
            {PAYMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          收款金额
          <input value={form.amount} onChange={(event) => setFormValue("amount", event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          币种
          <select value={form.currency} onChange={(event) => void handleCurrencyChange(event.target.value)} disabled={currencyLocked}>
            <option value="">请选择币种</option>
            {CURRENCIES.filter(Boolean).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </label>
        <label>
          汇率
          <input
            value={form.exchangeRate}
            onChange={(event) => setFormValue("exchangeRate", event.target.value)}
            readOnly={form.currency === "CNY"}
            inputMode="decimal"
            required
          />
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

function PaymentTableRows({
  payment,
  onViewDetail,
  deleting,
  onEdit,
  onDelete,
  onConfirmArrived,
  canManage,
  confirming,
}: {
  payment: PaymentRow;
  onViewDetail: () => void;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onConfirmArrived: () => void;
  canManage: boolean;
  confirming: boolean;
}) {
  return (
    <>
      <tr className={styles.clickableRow} onClick={onViewDetail}>
        <td className={styles.orderNoColumn}><strong>{payment.orderNo || "-"}</strong></td>
        <td className={styles.customerColumn} title={customerLegalName(payment)}>{customerDisplayName(payment)}</td>
        <td>{payment.paymentDate || "-"}</td>
        <td className={styles.amountColumn}><MoneyAmount currency={payment.currency} amount={payment.amount} amountCny={payment.amountCny} /></td>
        <td><span className={`${styles.statusPill} ${paymentStatusClass(payment.status)}`}>{payment.status || "-"}</span></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(); }}>详情</button></td>
      </tr>
    </>
  );
}

function PaymentDetailDrawer({
  payment,
  canManage,
  deleting,
  confirming,
  onEdit,
  onDelete,
  onConfirmArrived,
  onClose,
}: {
  payment: PaymentRow;
  canManage: boolean;
  deleting: boolean;
  confirming: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onConfirmArrived: () => void;
  onClose: () => void;
}) {
  return (
    <SideDetailDrawer
      ariaLabel="收款详情"
      kicker="收款管理"
      title={`${payment.orderNo || "-"} · ${customerLegalName(payment)}`}
      subtitle={`收款日期：${payment.paymentDate || "-"} · 状态：${payment.status || "-"}`}
      onClose={onClose}
      actions={canManage ? (
        <>
          {payment.status === "待确认" ? (
            <button className={styles.primaryButtonCompact} type="button" disabled={confirming} onClick={onConfirmArrived}>
              {confirming ? "确认中..." : "确认到账"}
            </button>
          ) : null}
          <button className={styles.primaryButtonCompact} type="button" onClick={onEdit}>编辑收款</button>
          <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={onDelete}>
            {deleting ? "删除中..." : "删除收款"}
          </button>
        </>
      ) : undefined}
    >
      <div className={styles.detailGrid}>
        <DetailField label="订单号" value={payment.orderNo || "-"} />
        <DetailField label="客户全称" value={customerLegalName(payment)} wide />
        <DetailField label="客户简称" value={customerDisplayName(payment) || "-"} />
        <DetailField label="收款日期" value={payment.paymentDate || "-"} />
        <DetailField label="收款金额" value={moneyText(payment.currency, payment.amount, payment.amountCny)} />
        <DetailField label="收款币种" value={payment.currency || "-"} />
        <DetailField label="收款类型" value={payment.paymentType || "-"} />
        <DetailField label="收款状态" value={payment.status || "-"} />
        <DetailField label="关联销售订单" value={payment.orderNo || "-"} />
        <DetailField label="币种 / 汇率" value={`${payment.currency || "-"} / ${Number(payment.exchangeRate || 0).toFixed(4)}`} />
        <DetailField label="折人民币" value={formatCny(Number(payment.amountCny || 0))} />
        <DetailField label="银行流水号" value={payment.bankReference || "-"} hidden={!payment.bankReference} />
        <DetailField label="汇率来源" value={rateMeta(payment)} />
        <DetailField label="创建人" value={payment.createdBy?.name || "-"} />
        <DetailField label="修改人" value={payment.updatedBy?.name || "-"} />
        <DetailField label="备注" value={payment.remark || "-"} wide hidden={!payment.remark} />
        <DetailField label="创建时间" value={formatDateTime(payment.createdAt)} />
        <DetailField label="更新时间" value={formatDateTime(payment.updatedAt)} />
      </div>
    </SideDetailDrawer>
  );
}

function paymentFormFromRow(payment?: PaymentRow | null): QuickPaymentForm {
  if (!payment) return { ...emptyQuickPaymentForm, paymentDate: new Date().toISOString().slice(0, 10) };
  return {
    orderId: payment.orderId || "",
    paymentDate: payment.paymentDate || new Date().toISOString().slice(0, 10),
    paymentType: payment.paymentType || "尾款",
    amount: payment.amount == null ? "" : String(payment.amount),
    currency: payment.currency || "",
    exchangeRate: payment.exchangeRate == null ? "" : String(payment.exchangeRate),
    status: payment.status || "待确认",
    bankReference: payment.bankReference || "",
    remark: payment.remark || "",
  };
}

function paymentStatusClass(status = "") {
  if (status === "已到账") return styles.statusSuccess;
  if (status === "待确认") return styles.statusWarning;
  if (status === "已退回") return styles.statusDanger;
  if (status === "已取消") return styles.statusMuted;
  return "";
}

function paymentStatusOptions(canConfirmArrived: boolean) {
  return canConfirmArrived ? PAYMENT_STATUSES : PAYMENT_STATUSES.filter((status) => status !== "已到账");
}

function rateMeta(payment: PaymentRow) {
  const source = payment.exchangeRateSource || "待获取";
  const type = payment.exchangeRateType || "-";
  return `来源：${source} / 类型：${type}`;
}

function orderLabel(order: PaymentOrderOption) {
  const customer = customerDisplayName(order);
  const blNo = order.blNo || order.billOfLadingNo;
  return `${order.orderNo || "未编号"} / ${customer}${blNo ? ` / ${blNo}` : ""}`;
}
