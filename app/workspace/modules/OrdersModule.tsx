"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { DetailField, PaginationBar } from "../components";
import { formatCny, moneyText } from "../formatters";
import styles from "../WorkspaceShell.module.css";

const CURRENCIES = ["", "CNY", "USD", "EUR", "GBP", "HKD"];
const TRADE_TERMS = ["EXW", "FOB", "CFR", "CIF", "DDP", "DAP", "其他"];
const PAYMENT_TERMS = [
  { value: "COPY_BL", label: "见提单复印件付款" },
  { value: "OA", label: "OA账期" },
  { value: "AFTER_ARRIVAL", label: "到港后付款" },
  { value: "INSTALLMENT", label: "分期付款" },
];

type OrderSummary = {
  arrivedPaymentsCny?: number;
  arrivedOutstandingCny?: number;
  confirmedPaymentsCny?: number;
  outstandingCny?: number;
  overpaidCny?: number;
};

type OrderRow = {
  id: string;
  orderNo: string;
  customerId?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  currency?: string;
  exchangeRate?: number;
  finalReceivableAmount?: number;
  finalReceivableAmountCny?: number;
  estimatedReceivableAmount?: number;
  estimatedReceivableAmountCny?: number;
  actualShipmentAmount?: number | "";
  actualShipmentAmountCny?: number | "";
  tradeTerm?: string;
  paymentTerm?: string;
  paymentTermType?: string;
  dueDate?: string;
  creditDays?: number | string;
  blDate?: string;
  expectedShipmentDate?: string;
  expectedArrivalDate?: string;
  expectedPaymentDate?: string;
  salespersonName?: string;
  status?: string;
  remark?: string;
  summary?: OrderSummary;
};

type OrdersResponse = {
  orders: OrderRow[];
};

type CustomerOption = {
  id: string;
  name?: string;
  fullName?: string;
  shortName?: string;
  displayName?: string;
  defaultCurrency?: string;
  country?: string;
};

type CustomersResponse = {
  customers: CustomerOption[];
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

type QuickOrderForm = {
  customerId: string;
  orderNo: string;
  blNo: string;
  currency: string;
  exchangeRate: string;
  estimatedReceivableAmount: string;
  finalReceivableAmount: string;
  tradeTerm: string;
  paymentTermType: string;
  actualShipmentAmount: string;
  expectedShipmentDate: string;
  blDate: string;
  expectedArrivalDate: string;
  expectedPaymentDate: string;
  dueDate: string;
  creditDays: string;
  remark: string;
};

const PAGE_SIZE = 20;

const emptyQuickOrderForm: QuickOrderForm = {
  customerId: "",
  orderNo: "",
  blNo: "",
  currency: "",
  exchangeRate: "",
  estimatedReceivableAmount: "",
  finalReceivableAmount: "",
  tradeTerm: "FOB",
  paymentTermType: "COPY_BL",
  actualShipmentAmount: "",
  expectedShipmentDate: "",
  blDate: "",
  expectedArrivalDate: "",
  expectedPaymentDate: "",
  dueDate: "",
  creditDays: "30",
  remark: "",
};

export function OrdersModule() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<OrderRow | null>(null);
  const [deletingId, setDeletingId] = useState("");

  async function loadOrders(nextKeyword = submittedKeyword) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<OrdersResponse>(`/api/orders${params.size ? `?${params}` : ""}`);
      setOrders(Array.isArray(result.orders) ? result.orders : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取应收订单失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders("");
  }, []);

  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return orders.slice(start, start + PAGE_SIZE);
  }, [orders, page]);

  function submitSearch() {
    setPage(1);
    setExpandedId("");
    setSubmittedKeyword(keyword.trim());
    void loadOrders(keyword.trim());
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setPage(1);
    setExpandedId("");
    void loadOrders("");
  }

  async function deleteOrder(order: OrderRow) {
    const confirmed = window.confirm(`确认删除订单 ${order.orderNo || "-"} 吗？\n删除后不会物理清除数据，但会从当前业务列表隐藏。`);
    if (!confirmed) return;
    setDeletingId(order.id);
    setError("");
    try {
      await apiJson(`/api/orders/${encodeURIComponent(order.id)}`, { method: "DELETE" });
      setExpandedId("");
      setEditOrder(null);
      setCreateOpen(false);
      await loadOrders(submittedKeyword);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除应收订单失败");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <span className={styles.kicker}>React 迁移模块</span>
          <h2>应收订单</h2>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.primaryButtonCompact}
            type="button"
            onClick={() => {
              setEditOrder(null);
              setCreateOpen((current) => !current);
            }}
          >
            {createOpen ? "收起新建" : "新建订单"}
          </button>
          <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => loadOrders()}>
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {createOpen || editOrder ? (
        <QuickCreateOrderPanel
          initialOrder={editOrder}
          onCancel={() => {
            setCreateOpen(false);
            setEditOrder(null);
          }}
          onSaved={() => {
            setCreateOpen(false);
            setEditOrder(null);
            setPage(1);
            setExpandedId("");
            void loadOrders(submittedKeyword);
          }}
        />
      ) : null}

      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 提单号 / 客户简称"
        />
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      {error ? (
        <div className={styles.inlineError}>{error}</div>
      ) : null}

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>订单号</th>
              <th>客户简称</th>
              <th>提单号</th>
              <th>最终应收</th>
              <th>已收</th>
              <th>未收</th>
              <th>状态</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8}>
                  <div className={styles.emptyState}>数据加载中...</div>
                </td>
              </tr>
            ) : pageRows.length ? pageRows.map((order) => (
              <OrderTableRows
                key={order.id}
                order={order}
                expanded={expandedId === order.id}
                onToggle={() => setExpandedId((current) => current === order.id ? "" : order.id)}
                onEdit={() => {
                  setCreateOpen(false);
                  setEditOrder(order);
                  setExpandedId(order.id);
                }}
                onDelete={() => void deleteOrder(order)}
                deleting={deletingId === order.id}
              />
            )) : (
              <tr>
                <td colSpan={8}>
                  <div className={styles.emptyState}>未找到匹配的应收订单</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={orders.length} page={page} totalPages={totalPages} onPage={setPage} />
    </section>
  );
}

function QuickCreateOrderPanel({
  initialOrder,
  onCancel,
  onSaved,
}: {
  initialOrder?: OrderRow | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<QuickOrderForm>(() => orderFormFromRow(initialOrder));
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerKeyword, setCustomerKeyword] = useState("");
  const [customersLoading, setCustomersLoading] = useState(false);
  const [exchangeMeta, setExchangeMeta] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadCustomers("");
  }, []);

  useEffect(() => {
    setForm(orderFormFromRow(initialOrder));
    if (initialOrder?.currency) {
      if (initialOrder.currency === "CNY") {
        setExchangeMeta("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
      } else {
        setExchangeMeta(
          initialOrder.exchangeRate
            ? `当前订单汇率：${Number(initialOrder.exchangeRate).toFixed(4)}`
            : "汇率来源：待获取，请手工填写",
        );
      }
    } else {
      setExchangeMeta("");
    }
    setMessage("");
  }, [initialOrder?.id]);

  async function loadCustomers(nextKeyword = customerKeyword) {
    setCustomersLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (nextKeyword.trim()) params.set("q", nextKeyword.trim());
      const result = await apiJson<CustomersResponse>(`/api/customers/available${params.size ? `?${params}` : ""}`);
      setCustomers(Array.isArray(result.customers) ? result.customers : []);
    } catch (customerError) {
      setMessage(customerError instanceof Error ? customerError.message : "读取客户列表失败");
    } finally {
      setCustomersLoading(false);
    }
  }

  async function resolveExchangeRate(currency: string) {
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
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?currency=${encodeURIComponent(normalized)}`);
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

  function setFormValue<K extends keyof QuickOrderForm>(key: K, value: QuickOrderForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const initialCustomer = useMemo(() => {
    if (!initialOrder?.customerId) return null;
    return {
      id: initialOrder.customerId,
      name: initialOrder.customerFullName || initialOrder.customerName,
      fullName: initialOrder.customerFullName || initialOrder.customerName,
      shortName: initialOrder.customerShortName,
      displayName: initialOrder.customerShortName || initialOrder.customerName || initialOrder.customerFullName,
      defaultCurrency: initialOrder.currency,
    } satisfies CustomerOption;
  }, [
    initialOrder?.currency,
    initialOrder?.customerFullName,
    initialOrder?.customerId,
    initialOrder?.customerName,
    initialOrder?.customerShortName,
  ]);

  const customerOptions = useMemo(() => {
    if (!initialCustomer) return customers;
    return customers.some((customer) => customer.id === initialCustomer.id)
      ? customers
      : [initialCustomer, ...customers];
  }, [customers, initialCustomer]);

  function selectedCustomer() {
    return customerOptions.find((customer) => customer.id === form.customerId);
  }

  async function handleCustomerChange(customerId: string) {
    const customer = customerOptions.find((item) => item.id === customerId);
    setForm((current) => ({
      ...current,
      customerId,
      currency: customer?.defaultCurrency || "",
      exchangeRate: "",
    }));
    await resolveExchangeRate(customer?.defaultCurrency || "");
  }

  async function handleCurrencyChange(currency: string) {
    const normalized = currency.toUpperCase();
    setForm((current) => ({ ...current, currency: normalized, exchangeRate: "" }));
    await resolveExchangeRate(normalized);
  }

  async function submitQuickOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.customerId) {
      setMessage("请选择客户");
      return;
    }
    if (!form.currency) {
      setMessage("请选择币种");
      return;
    }
    if (!Number(form.exchangeRate)) {
      setMessage("请填写汇率；CNY 订单汇率应自动为 1");
      return;
    }
    if (!form.estimatedReceivableAmount || Number(form.estimatedReceivableAmount) <= 0) {
      setMessage("请填写预计应收金额");
      return;
    }
    if (form.paymentTermType === "COPY_BL" && !form.dueDate) {
      setMessage("见提单复印件付款请填写到期日");
      return;
    }
    if (form.paymentTermType === "OA" && Number(form.creditDays) < 0) {
      setMessage("请填写有效 OA 账期天数");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const payload = {
        customerId: form.customerId,
        orderNo: form.orderNo.trim(),
        blNo: form.blNo.trim(),
        currency: form.currency,
        exchangeRate: Number(form.exchangeRate),
        estimatedReceivableAmount: Number(form.estimatedReceivableAmount),
        finalReceivableAmount: form.finalReceivableAmount ? Number(form.finalReceivableAmount) : undefined,
        actualShipmentAmount: form.actualShipmentAmount ? Number(form.actualShipmentAmount) : undefined,
        tradeTerm: form.tradeTerm,
        paymentTermType: form.paymentTermType,
        expectedShipmentDate: form.expectedShipmentDate || undefined,
        blDate: form.blDate || undefined,
        expectedArrivalDate: form.expectedArrivalDate || undefined,
        expectedPaymentDate: form.expectedPaymentDate || undefined,
        dueDate: ["COPY_BL", "INSTALLMENT"].includes(form.paymentTermType) ? form.dueDate : undefined,
        creditDays: ["OA", "AFTER_ARRIVAL"].includes(form.paymentTermType) ? Number(form.creditDays || 0) : undefined,
        ...(initialOrder?.id ? {} : { status: "已确认" }),
        remark: form.remark.trim(),
      };
      const isEdit = Boolean(initialOrder?.id);
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/orders/${encodeURIComponent(initialOrder?.id || "")}` : "/api/orders",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      if (result.success !== true) {
        throw new Error(result.message || "订单保存失败");
      }
      setForm(emptyQuickOrderForm);
      setExchangeMeta("");
      onSaved();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "订单保存失败");
    } finally {
      setSaving(false);
    }
  }

  const customer = selectedCustomer();

  return (
    <form className={styles.quickCreatePanel} onSubmit={submitQuickOrder}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{initialOrder?.id ? "编辑应收订单" : "快速新建应收订单"}</strong>
          <span>基础订单信息已迁移；收款、成本、国内物流和退税资料请在对应模块维护。</span>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          客户搜索
          <div className={styles.inlineInputGroup}>
            <input
              value={customerKeyword}
              onChange={(event) => setCustomerKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void loadCustomers(customerKeyword);
                }
              }}
              placeholder="搜索客户全称 / 简称"
            />
            <button className={styles.secondaryButton} type="button" onClick={() => loadCustomers(customerKeyword)} disabled={customersLoading}>
              {customersLoading ? "搜索中..." : "搜索"}
            </button>
          </div>
        </label>
        <label>
          客户
          <select value={form.customerId} onChange={(event) => void handleCustomerChange(event.target.value)}>
            <option value="">请选择客户</option>
            {customerOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {customerLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          订单号
          <input value={form.orderNo} onChange={(event) => setFormValue("orderNo", event.target.value)} placeholder="例如 PV263" required />
        </label>
        <label>
          提单号
          <input value={form.blNo} onChange={(event) => setFormValue("blNo", event.target.value)} placeholder="可稍后补充" />
        </label>
        <label>
          币种
          <select value={form.currency} onChange={(event) => void handleCurrencyChange(event.target.value)}>
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
            placeholder="自动获取或手工填写"
            inputMode="decimal"
            required
          />
        </label>
        <label>
          预计应收金额
          <input value={form.estimatedReceivableAmount} onChange={(event) => setFormValue("estimatedReceivableAmount", event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          最终应收金额
          <input value={form.finalReceivableAmount} onChange={(event) => setFormValue("finalReceivableAmount", event.target.value)} inputMode="decimal" placeholder="为空则等于预计应收" />
        </label>
        <label>
          实际发货金额
          <input value={form.actualShipmentAmount} onChange={(event) => setFormValue("actualShipmentAmount", event.target.value)} inputMode="decimal" placeholder="可发货后补录" />
        </label>
        <label>
          贸易条款
          <select value={form.tradeTerm} onChange={(event) => setFormValue("tradeTerm", event.target.value)}>
            {TRADE_TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
          </select>
        </label>
        <label>
          付款条款
          <select value={form.paymentTermType} onChange={(event) => setFormValue("paymentTermType", event.target.value)}>
            {PAYMENT_TERMS.map((term) => <option key={term.value} value={term.value}>{term.label}</option>)}
          </select>
        </label>
        {form.paymentTermType === "COPY_BL" ? (
          <label>
            到期日
            <input value={form.dueDate} onChange={(event) => setFormValue("dueDate", event.target.value)} type="date" required />
          </label>
        ) : form.paymentTermType === "INSTALLMENT" ? (
          <label>
            分期最终到期日
            <input value={form.dueDate} onChange={(event) => setFormValue("dueDate", event.target.value)} type="date" />
          </label>
        ) : (
          <label>
            OA账期天数
            <input value={form.creditDays} onChange={(event) => setFormValue("creditDays", event.target.value)} inputMode="numeric" required />
          </label>
        )}
        <label>
          预计发货日期
          <input value={form.expectedShipmentDate} onChange={(event) => setFormValue("expectedShipmentDate", event.target.value)} type="date" />
        </label>
        <label>
          提单日期
          <input value={form.blDate} onChange={(event) => setFormValue("blDate", event.target.value)} type="date" />
        </label>
        <label>
          预计到港日期
          <input value={form.expectedArrivalDate} onChange={(event) => setFormValue("expectedArrivalDate", event.target.value)} type="date" />
        </label>
        <label>
          预计收款日期
          <input value={form.expectedPaymentDate} onChange={(event) => setFormValue("expectedPaymentDate", event.target.value)} type="date" />
        </label>
        <label>
          备注
          <input value={form.remark} onChange={(event) => setFormValue("remark", event.target.value)} placeholder="可选" />
        </label>
      </div>

      <div className={styles.quickCreateMeta}>
        <span>客户全称：{customer?.name || customer?.fullName || "-"}</span>
        <span>{exchangeMeta || "汇率来源：待获取"}</span>
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : initialOrder?.id ? "更新订单" : "保存订单"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}

function OrderTableRows({
  order,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  deleting,
}: {
  order: OrderRow;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const receivedCny = Number(order.summary?.arrivedPaymentsCny || 0);
  const outstandingCny = Number(order.summary?.arrivedOutstandingCny ?? order.summary?.outstandingCny ?? 0);
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td><strong>{order.orderNo || "-"}</strong></td>
        <td title={order.customerFullName || order.customerName || ""}>{order.customerShortName || order.customerName || "-"}</td>
        <td>{order.blNo || order.billOfLadingNo || "-"}</td>
        <td>{moneyCell(order.currency, order.finalReceivableAmount, order.finalReceivableAmountCny)}</td>
        <td>{formatCny(receivedCny)}</td>
        <td>{formatCny(outstandingCny)}</td>
        <td><span className={styles.statusPill}>{order.status || "-"}</span></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={8}>
            <div className={styles.detailCard}>
              <div className={styles.detailActions}>
                <button className={styles.primaryButtonCompact} type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }}>
                  编辑订单
                </button>
                <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={(event) => { event.stopPropagation(); onDelete(); }}>
                  {deleting ? "删除中..." : "删除订单"}
                </button>
              </div>
              <div className={styles.detailGrid}>
                <DetailField label="客户全称" value={order.customerFullName || order.customerName || "-"} wide />
                <DetailField label="业务员" value={order.salespersonName || "-"} />
                <DetailField label="付款条款" value={order.paymentTerm || "-"} />
                <DetailField label="到期日" value={order.dueDate || "-"} />
                <DetailField label="提单日期" value={order.blDate || "-"} />
                <DetailField label="预计发货" value={order.expectedShipmentDate || "-"} />
                <DetailField label="预计应收" value={moneyText(order.currency, order.estimatedReceivableAmount, order.estimatedReceivableAmountCny)} />
                <DetailField label="实际发货金额" value={moneyText(order.currency, order.actualShipmentAmount, order.actualShipmentAmountCny)} />
                <DetailField label="币种 / 汇率" value={`${order.currency || "-"} / ${Number(order.exchangeRate || 0).toFixed(4)}`} />
                <DetailField label="备注" value={order.remark || "-"} wide hidden={!order.remark} />
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function moneyCell(currency = "CNY", amount: unknown, amountCny: unknown) {
  return <span className={styles.moneyCell}>{moneyText(currency, amount, amountCny)}</span>;
}

function customerLabel(customer: CustomerOption) {
  const displayName = customer.displayName || customer.shortName || customer.name || customer.fullName || "未命名客户";
  const fullName = customer.name || customer.fullName;
  return fullName && fullName !== displayName ? `${displayName} / ${fullName}` : displayName;
}

function orderFormFromRow(order?: OrderRow | null): QuickOrderForm {
  if (!order) {
    return { ...emptyQuickOrderForm };
  }
  const paymentTermType = order.paymentTermType || (String(order.paymentTerm || "").toUpperCase().includes("OA") ? "OA" : "COPY_BL");
  return {
    customerId: order.customerId || "",
    orderNo: order.orderNo || "",
    blNo: order.blNo || order.billOfLadingNo || "",
    currency: order.currency || "",
    exchangeRate: order.exchangeRate == null ? "" : String(order.exchangeRate),
    estimatedReceivableAmount: order.estimatedReceivableAmount == null ? "" : String(order.estimatedReceivableAmount),
    finalReceivableAmount: order.finalReceivableAmount == null ? "" : String(order.finalReceivableAmount),
    tradeTerm: order.tradeTerm || "FOB",
    paymentTermType,
    actualShipmentAmount: order.actualShipmentAmount == null || order.actualShipmentAmount === "" ? "" : String(order.actualShipmentAmount),
    expectedShipmentDate: order.expectedShipmentDate || "",
    blDate: order.blDate || "",
    expectedArrivalDate: order.expectedArrivalDate || "",
    expectedPaymentDate: "",
    dueDate: order.dueDate || "",
    creditDays: order.creditDays == null || order.creditDays === "" ? "30" : String(order.creditDays),
    remark: order.remark || "",
  };
}
