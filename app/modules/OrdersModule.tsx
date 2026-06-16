"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, DetailField, PaginationBar, useConfirmationDialog } from "../components";
import { CustomerAutocomplete, type CustomerAutocompleteOption } from "../CustomerAutocomplete";
import { formatCny, moneyText } from "../formatters";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission, customerDisplayName, customerLegalName } from "../utils";
import styles from "../WorkspaceShell.module.css";

const CURRENCIES = ["", "CNY", "USD", "EUR", "GBP", "HKD"];
const TRADE_TERMS = ["EXW", "FOB", "CFR", "CIF", "DDP", "DAP", "其他"];
const ORDER_STATUSES = ["草稿", "已确认", "生产中", "已发货", "部分收款", "已收齐", "多收款", "已关闭", "已取消"];
const PAYMENT_TERMS = [
  { value: "COPY_BL", label: "见提单复印件付款" },
  { value: "OA", label: "OA账期" },
  { value: "AFTER_ARRIVAL", label: "到港后付款" },
  { value: "INSTALLMENT", label: "分批付款" },
];
const LOGISTICS_SUPPLIER_TYPES = ["物流供应商", "报关供应商", "海运供应商", "港杂费用供应商"];

type OrderSummary = {
  arrivedPaymentsCny?: number;
  arrivedOutstandingCny?: number;
  confirmedPaymentsCny?: number;
  outstandingCny?: number;
  outstandingAmount?: number;
  overpaidCny?: number;
  overpaidAmount?: number;
  requiredDepositAmount?: number;
  receivedDepositCny?: number;
  depositGapCny?: number;
  reminderStatus?: string;
};

type SupplierOption = {
  id: string;
  supplierName?: string;
  name?: string;
  supplierType?: string;
  status?: string;
  isDefaultLogisticsSupplier?: boolean;
};

type PaymentInstallment = {
  ratio: string;
  condition: string;
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
  exchangeRateDate?: string;
  exchangeRateSource?: string;
  exchangeRateType?: string;
  finalReceivableAmount?: number;
  finalReceivableAmountCny?: number;
  estimatedReceivableAmount?: number;
  estimatedReceivableAmountCny?: number;
  actualShipmentAmount?: number | "";
  actualShipmentAmountCny?: number | "";
  tradeTerm?: string;
  paymentTerm?: string;
  paymentTermType?: string;
  paymentTermDisplay?: string;
  paymentInstallments?: Array<{ ratio?: number; condition?: string; amount?: number; amountCny?: number }>;
  paymentInstallmentText?: string;
  dueDate?: string;
  creditDays?: number | string;
  blDate?: string;
  expectedShipmentDate?: string;
  expectedArrivalDate?: string;
  expectedPaymentDate?: string;
  depositRatio?: number | string;
  reminderDays?: number | string;
  salespersonName?: string;
  status?: string;
  remark?: string;
  logisticsSupplierIds?: string[];
  logisticsSuppliers?: SupplierOption[];
  summary?: OrderSummary;
};

type OrdersResponse = {
  orders: OrderRow[];
  data?: {
    rows?: OrderRow[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
};

type CustomersResponse = {
  customers?: CustomerAutocompleteOption[];
};

type SuppliersResponse = {
  suppliers?: SupplierOption[];
};

type SettingsResponse = {
  settings?: {
    allowMultipleOrderLogisticsSuppliers?: boolean;
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

type QuickOrderForm = {
  customerId: string;
  orderNo: string;
  blNo: string;
  currency: string;
  exchangeRate: string;
  estimatedReceivableAmount: string;
  finalReceivableAmount: string;
  actualShipmentAmount: string;
  tradeTerm: string;
  paymentTermType: string;
  expectedShipmentDate: string;
  blDate: string;
  expectedArrivalDate: string;
  expectedPaymentDate: string;
  dueDate: string;
  creditDays: string;
  reminderDays: string;
  status: string;
  logisticsSupplierIds: string[];
  paymentInstallments: PaymentInstallment[];
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
  actualShipmentAmount: "",
  tradeTerm: "FOB",
  paymentTermType: "COPY_BL",
  expectedShipmentDate: "",
  blDate: "",
  expectedArrivalDate: "",
  expectedPaymentDate: "",
  dueDate: "",
  creditDays: "30",
  reminderDays: "7",
  status: "草稿",
  logisticsSupplierIds: [],
  paymentInstallments: [{ ratio: "100", condition: "按约定付款" }],
  remark: "",
};

export function OrdersModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialOpenToken = 0,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialOpenToken?: number;
}) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [submittedOrderStatus, setSubmittedOrderStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<OrderRow | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canWriteOrders = canWritePermission(currentUser, permissions, "orders", ["管理员", "业务员"]);

  async function loadOrders(nextPage = page, nextKeyword = submittedKeyword, nextOrderStatus = submittedOrderStatus) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        workspace: "1",
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextOrderStatus) params.set("orderStatus", nextOrderStatus);
      const result = await apiJson<OrdersResponse>(`/api/orders?${params}`);
      const data = result.data || {};
      setOrders(Array.isArray(data.rows) ? data.rows : Array.isArray(result.orders) ? result.orders : []);
      setTotal(Number(data.total ?? result.orders?.length ?? 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取应收订单失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders(1, "");
  }, []);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    setKeyword(value);
    setSubmittedKeyword(value);
    setExpandedId("");
    setNotice("");
    void loadOrders(1, value, submittedOrderStatus);
  }, [initialKeyword, initialOpenToken]);

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setSubmittedOrderStatus(orderStatus);
    setExpandedId("");
    setNotice("");
    void loadOrders(1, value, orderStatus);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setOrderStatus("");
    setSubmittedOrderStatus("");
    setExpandedId("");
    setNotice("");
    void loadOrders(1, "", "");
  }

  function gotoPage(nextPage: number) {
    setExpandedId("");
    setNotice("");
    void loadOrders(nextPage, submittedKeyword, submittedOrderStatus);
  }

  async function deleteOrder(order: OrderRow) {
    if (!canWriteOrders) {
      setError("当前账号没有权限删除应收订单");
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "确认删除该订单？",
      message: "删除后不会物理清除数据，但会从当前业务列表隐藏。",
      details: [`订单：${order.orderNo || "-"}`],
      confirmLabel: "删除订单",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId(order.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(
        `/api/orders/${encodeURIComponent(order.id)}`,
        { method: "DELETE" },
      );
      if (result.success === false) throw new Error(result.message || "删除应收订单失败");
      setExpandedId("");
      setEditOrder(null);
      setCreateOpen(false);
      await loadOrders(page, submittedKeyword);
      setNotice(result.message || "订单已删除");
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
          <span className={styles.kicker}>业务模块</span>
          <h2>应收订单</h2>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.primaryButtonCompact}
            type="button"
            onClick={() => {
              if (canWriteOrders) {
                setEditOrder(null);
                setCreateOpen((current) => !current);
              }
            }}
            disabled={!canWriteOrders}
          >
            {createOpen ? "收起新建" : "新建订单"}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => {
              setNotice("");
              void loadOrders(page, submittedKeyword, submittedOrderStatus);
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {canWriteOrders && (createOpen || editOrder) ? (
        <QuickCreateOrderPanel
          initialOrder={editOrder}
          onCancel={() => {
            setCreateOpen(false);
            setEditOrder(null);
          }}
          onSaved={() => {
            setNotice(editOrder ? "订单已更新" : "订单已保存");
            setCreateOpen(false);
            setEditOrder(null);
            setExpandedId("");
            void loadOrders(1, submittedKeyword, submittedOrderStatus);
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
          placeholder="搜索订单号 / 提单号 / 客户简称 / 供应商"
        />
        <select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)} disabled={loading}>
          <option value="">全部订单状态</option>
          {ORDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

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
                <td colSpan={8}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : orders.length ? orders.map((order) => (
              <OrderTableRows
                key={order.id}
                order={order}
                expanded={expandedId === order.id}
                onToggle={() => setExpandedId((current) => current === order.id ? "" : order.id)}
                onEdit={() => {
                  if (!canWriteOrders) return;
                  setCreateOpen(false);
                  setEditOrder(order);
                  setExpandedId(order.id);
                }}
                onDelete={() => void deleteOrder(order)}
                deleting={deletingId === order.id}
                canWrite={canWriteOrders}
              />
            )) : (
              <tr>
                <td colSpan={8}><div className={styles.emptyState}>未找到匹配的应收订单</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} onPage={gotoPage} />
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
  const [customers, setCustomers] = useState<CustomerAutocompleteOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [allowMultipleLogisticsSuppliers, setAllowMultipleLogisticsSuppliers] = useState(false);
  const [exchangeMeta, setExchangeMeta] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const logisticsSuppliers = useMemo(() => (
    suppliers.filter((supplier) => supplier.status !== "停用" && LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType || ""))
  ), [suppliers]);
  const defaultLogisticsSupplier = useMemo(() => (
    logisticsSuppliers.find((supplier) => supplier.isDefaultLogisticsSupplier) || null
  ), [logisticsSuppliers]);

  useEffect(() => {
    setForm(orderFormFromRow(initialOrder));
    setMessage("");
    if (initialOrder?.currency) {
      setExchangeMeta(initialOrder.currency === "CNY"
        ? "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000"
        : initialOrder.exchangeRate
          ? `当前订单汇率：${Number(initialOrder.exchangeRate).toFixed(4)}`
          : "汇率来源：待获取，请手工填写");
    } else {
      setExchangeMeta("");
    }
  }, [initialOrder?.id]);

  useEffect(() => {
    void loadFormOptions();
  }, []);

  useEffect(() => {
    if (allowMultipleLogisticsSuppliers) return;
    if (!defaultLogisticsSupplier) return;
    setForm((current) => ({
      ...current,
      logisticsSupplierIds: [defaultLogisticsSupplier.id],
    }));
  }, [allowMultipleLogisticsSuppliers, defaultLogisticsSupplier?.id]);

  useEffect(() => {
    if (form.paymentTermType === "INSTALLMENT") return;
    const nextDueDate = derivedDueDate(form);
    if (nextDueDate !== form.dueDate) setFormValue("dueDate", nextDueDate);
  }, [form.paymentTermType, form.expectedShipmentDate, form.blDate, form.expectedArrivalDate, form.creditDays]);

  async function loadFormOptions() {
    try {
      const [settingsResult, suppliersResult] = await Promise.all([
        apiJson<SettingsResponse>("/api/exchange-rates/settings").catch(() => null),
        apiJson<SuppliersResponse>("/api/suppliers/available").catch(() => null),
      ]);
      setAllowMultipleLogisticsSuppliers(Boolean(settingsResult?.settings?.allowMultipleOrderLogisticsSuppliers));
      setSuppliers(Array.isArray(suppliersResult?.suppliers) ? suppliersResult.suppliers : []);
    } catch (optionError) {
      setMessage(optionError instanceof Error ? optionError.message : "读取订单配置失败");
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
      displayName: customerDisplayName(initialOrder),
      defaultCurrency: initialOrder.currency,
    } satisfies CustomerAutocompleteOption;
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
  const customer = customerOptions.find((option) => option.id === form.customerId);

  async function handleCustomerSelect(customerOption: CustomerAutocompleteOption) {
    setCustomers((current) => current.some((item) => item.id === customerOption.id) ? current : [customerOption, ...current]);
    setForm((current) => ({
      ...current,
      customerId: customerOption.id,
      currency: customerOption.defaultCurrency || current.currency,
      exchangeRate: customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRate,
      paymentTermType: customerOption.defaultPaymentTermType || current.paymentTermType,
      tradeTerm: customerOption.defaultTradeTerm || current.tradeTerm,
    }));
    if (customerOption.defaultCurrency) await resolveExchangeRate(customerOption.defaultCurrency);
  }

  async function handleCurrencyChange(currency: string) {
    const normalized = currency.toUpperCase();
    setForm((current) => ({ ...current, currency: normalized, exchangeRate: "" }));
    await resolveExchangeRate(normalized);
  }

  function setInstallment(index: number, key: keyof PaymentInstallment, value: string) {
    setForm((current) => ({
      ...current,
      paymentInstallments: current.paymentInstallments.map((row, rowIndex) => (
        rowIndex === index ? { ...row, [key]: value } : row
      )),
    }));
  }

  function addInstallment() {
    setForm((current) => ({
      ...current,
      paymentInstallments: [...current.paymentInstallments, { ratio: "", condition: "" }],
    }));
  }

  function removeInstallment(index: number) {
    setForm((current) => ({
      ...current,
      paymentInstallments: current.paymentInstallments.filter((_, rowIndex) => rowIndex !== index).length
        ? current.paymentInstallments.filter((_, rowIndex) => rowIndex !== index)
        : [{ ratio: "100", condition: "按约定付款" }],
    }));
  }

  function selectedLogisticsSupplierIds() {
    if (!allowMultipleLogisticsSuppliers) return defaultLogisticsSupplier ? [defaultLogisticsSupplier.id] : [];
    return form.logisticsSupplierIds;
  }

  async function submitQuickOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.customerId) return setMessage("请选择客户");
    if (!form.orderNo.trim()) return setMessage("请填写订单号");
    if (!form.currency) return setMessage("请选择币种");
    if (!Number(form.exchangeRate)) return setMessage("请填写汇率；CNY 订单汇率应自动为 1");
    if (!form.estimatedReceivableAmount || Number(form.estimatedReceivableAmount) <= 0) return setMessage("请填写预计应收金额");
    if (form.paymentTermType === "AFTER_ARRIVAL" && !form.expectedArrivalDate) return setMessage("到港后付款请填写预计到港日期");
    if (["OA", "AFTER_ARRIVAL"].includes(form.paymentTermType) && Number(form.creditDays) < 0) return setMessage("请填写有效账期天数");
    if (form.paymentTermType === "INSTALLMENT" && installmentTotal(form.paymentInstallments) !== 100) return setMessage("分批付款比例合计必须等于 100%");
    if (!allowMultipleLogisticsSuppliers && !defaultLogisticsSupplier) return setMessage("请先在供应商资料中设置默认物流供应商");

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
        dueDate: form.dueDate || undefined,
        creditDays: ["OA", "AFTER_ARRIVAL"].includes(form.paymentTermType) ? Number(form.creditDays || 0) : undefined,
        paymentInstallments: form.paymentTermType === "INSTALLMENT"
          ? form.paymentInstallments.map((row) => ({ ratio: Number(row.ratio), condition: row.condition.trim() }))
          : undefined,
        reminderDays: Number(form.reminderDays || 7),
        status: form.status,
        logisticsSupplierIds: selectedLogisticsSupplierIds(),
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
      if (result.success !== true) throw new Error(result.message || "订单保存失败");
      setForm({ ...emptyQuickOrderForm });
      setExchangeMeta("");
      onSaved();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "订单保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={submitQuickOrder}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{initialOrder?.id ? "编辑应收订单" : "新建应收订单"}</strong>
          <span>基础订单信息在本页维护；收款、成本、物流和退税资料在对应模块处理。</span>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label className={styles.autocompleteField}>
          客户搜索
          <CustomerAutocomplete
            value={customer || null}
            onSelect={(selected) => void handleCustomerSelect(selected)}
            onCreateRequested={(name) => setMessage(`请先到系统设置 > 客户资料中新建客户：${name}`)}
          />
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
          订单状态
          <select value={form.status} onChange={(event) => setFormValue("status", event.target.value)}>
            {ORDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
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
          <input value={form.exchangeRate} onChange={(event) => setFormValue("exchangeRate", event.target.value)} readOnly={form.currency === "CNY"} placeholder="自动获取或手工填写" inputMode="decimal" required />
        </label>
        <label>
          预计应收金额
          <input value={form.estimatedReceivableAmount} onChange={(event) => setFormValue("estimatedReceivableAmount", event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          最终应收金额
          <input value={form.finalReceivableAmount} onChange={(event) => setFormValue("finalReceivableAmount", event.target.value)} inputMode="decimal" placeholder="为空则等于实际/预计应收" />
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
        {["OA", "AFTER_ARRIVAL"].includes(form.paymentTermType) ? (
          <label>
            账期天数
            <input value={form.creditDays} onChange={(event) => setFormValue("creditDays", event.target.value)} inputMode="numeric" required />
          </label>
        ) : null}
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
          <input value={form.expectedArrivalDate} onChange={(event) => setFormValue("expectedArrivalDate", event.target.value)} type="date" required={form.paymentTermType === "AFTER_ARRIVAL"} />
        </label>
        <label>
          预计收款日期
          <input value={form.expectedPaymentDate} onChange={(event) => setFormValue("expectedPaymentDate", event.target.value)} type="date" />
        </label>
        <label>
          到期日
          <input value={form.dueDate} onChange={(event) => setFormValue("dueDate", event.target.value)} type="date" readOnly={form.paymentTermType !== "INSTALLMENT"} />
        </label>
        <label>
          提醒天数
          <input value={form.reminderDays} onChange={(event) => setFormValue("reminderDays", event.target.value)} inputMode="numeric" />
        </label>
        <label className={styles.autocompleteField}>
          物流供应商
          <select
            multiple={allowMultipleLogisticsSuppliers}
            size={allowMultipleLogisticsSuppliers ? 4 : 1}
            value={allowMultipleLogisticsSuppliers ? form.logisticsSupplierIds : (selectedLogisticsSupplierIds()[0] || "")}
            disabled={!allowMultipleLogisticsSuppliers}
            onChange={(event) => setFormValue("logisticsSupplierIds", Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}
          >
            {logisticsSuppliers.length ? logisticsSuppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplierName(supplier)} · {supplier.supplierType || "-"}{supplier.isDefaultLogisticsSupplier ? " · 默认" : ""}
              </option>
            )) : <option value="">请先设置默认物流供应商</option>}
          </select>
          <small className={styles.mutedText}>
            {allowMultipleLogisticsSuppliers ? "可多选物流、报关、海运或港杂费用供应商。" : defaultLogisticsSupplier ? "当前使用默认物流供应商，暂不允许手动切换。" : "请先在系统设置中设置默认物流供应商。"}
          </small>
        </label>
        {form.paymentTermType === "INSTALLMENT" ? (
          <div className={`${styles.installmentPanel} ${styles.autocompleteField}`}>
            <div className={styles.panelHead}>
              <h3>分批付款节点</h3>
              <button className={styles.secondaryButton} type="button" onClick={addInstallment}>添加节点</button>
            </div>
            {form.paymentInstallments.map((row, index) => (
              <div key={`${index}-${row.condition}`} className={styles.installmentRow}>
                <label>
                  比例%
                  <input value={row.ratio} onChange={(event) => setInstallment(index, "ratio", event.target.value)} inputMode="decimal" />
                </label>
                <label>
                  付款条件
                  <input value={row.condition} onChange={(event) => setInstallment(index, "condition", event.target.value)} placeholder="例如 发货前 / 见提单" />
                </label>
                <button className={styles.secondaryButton} type="button" onClick={() => removeInstallment(index)}>删除</button>
              </div>
            ))}
            <small className={styles.mutedText}>当前合计：{installmentTotal(form.paymentInstallments)}%</small>
          </div>
        ) : null}
        <label className={styles.autocompleteField}>
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
  canWrite,
}: {
  order: OrderRow;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  canWrite: boolean;
}) {
  const receivedCny = Number(order.summary?.arrivedPaymentsCny ?? order.summary?.confirmedPaymentsCny ?? 0);
  const outstandingCny = Number(order.summary?.arrivedOutstandingCny ?? order.summary?.outstandingCny ?? 0);
  const outstanding = Number(order.summary?.overpaidCny || 0) > 0
    ? `多收 ${formatCny(order.summary?.overpaidCny)}`
    : formatCny(outstandingCny);
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td><strong>{order.orderNo || "-"}</strong></td>
        <td title={customerLegalName(order)}>{customerDisplayName(order)}</td>
        <td>{order.blNo || order.billOfLadingNo || "-"}</td>
        <td>{moneyCell(order.currency, order.finalReceivableAmount, order.finalReceivableAmountCny)}</td>
        <td>{formatCny(receivedCny)}</td>
        <td>{outstanding}</td>
        <td><span className={`${styles.statusPill} ${orderStatusClass(order.status)}`}>{order.status || "-"}</span></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={8}>
            <div className={styles.detailCard}>
              {canWrite ? (
                <div className={styles.detailActions}>
                  <button className={styles.primaryButtonCompact} type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }}>
                    编辑订单
                  </button>
                  <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={(event) => { event.stopPropagation(); onDelete(); }}>
                    {deleting ? "删除中..." : "删除订单"}
                  </button>
                </div>
              ) : null}
              <div className={styles.detailGrid}>
                <DetailField label="客户全称" value={customerLegalName(order)} wide />
                <DetailField label="业务员" value={order.salespersonName || "-"} />
                <DetailField label="贸易条款" value={order.tradeTerm || "-"} />
                <DetailField label="付款条款" value={paymentTermText(order)} />
                <DetailField label="到期日" value={`${order.dueDate || "-"} ${order.summary?.reminderStatus ? `· ${order.summary.reminderStatus}` : ""}`} />
                <DetailField label="提醒天数" value={`${order.reminderDays ?? "-"} 天`} />
                <DetailField label="提单日期" value={order.blDate || "-"} />
                <DetailField label="预计发货" value={order.expectedShipmentDate || "-"} />
                <DetailField label="预计到港" value={order.expectedArrivalDate || "-"} />
                <DetailField label="预计收款" value={order.expectedPaymentDate || "-"} />
                <DetailField label="预计应收" value={moneyText(order.currency, order.estimatedReceivableAmount, order.estimatedReceivableAmountCny)} />
                <DetailField label="实际发货金额" value={moneyText(order.currency, order.actualShipmentAmount, order.actualShipmentAmountCny)} />
                <DetailField label="最终应收" value={moneyText(order.currency, order.finalReceivableAmount, order.finalReceivableAmountCny)} />
                <DetailField label="预付款要求" value={formatCny(order.summary?.requiredDepositAmount)} />
                <DetailField label="已收预付款" value={formatCny(order.summary?.receivedDepositCny)} />
                <DetailField label="预付款差额" value={formatCny(order.summary?.depositGapCny)} />
                <DetailField label="币种 / 汇率" value={`${order.currency || "-"} / ${Number(order.exchangeRate || 0).toFixed(4)}`} />
                <DetailField label="汇率来源" value={rateMeta(order)} />
                <DetailField label="物流供应商" value={logisticsSupplierText(order.logisticsSuppliers)} wide />
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

function orderFormFromRow(order?: OrderRow | null): QuickOrderForm {
  if (!order) return { ...emptyQuickOrderForm };
  const paymentTermType = order.paymentTermType || (String(order.paymentTerm || "").toUpperCase().includes("OA") ? "OA" : "COPY_BL");
  return {
    customerId: order.customerId || "",
    orderNo: order.orderNo || "",
    blNo: order.blNo || order.billOfLadingNo || "",
    currency: order.currency || "",
    exchangeRate: order.exchangeRate == null ? "" : String(order.exchangeRate),
    estimatedReceivableAmount: order.estimatedReceivableAmount == null ? "" : String(order.estimatedReceivableAmount),
    finalReceivableAmount: order.finalReceivableAmount == null ? "" : String(order.finalReceivableAmount),
    actualShipmentAmount: order.actualShipmentAmount == null || order.actualShipmentAmount === "" ? "" : String(order.actualShipmentAmount),
    tradeTerm: order.tradeTerm || "FOB",
    paymentTermType,
    expectedShipmentDate: order.expectedShipmentDate || "",
    blDate: order.blDate || "",
    expectedArrivalDate: order.expectedArrivalDate || "",
    expectedPaymentDate: order.expectedPaymentDate || "",
    dueDate: order.dueDate || "",
    creditDays: order.creditDays == null || order.creditDays === "" ? "30" : String(order.creditDays),
    reminderDays: order.reminderDays == null || order.reminderDays === "" ? "7" : String(order.reminderDays),
    status: order.status || "草稿",
    logisticsSupplierIds: order.logisticsSupplierIds || [],
    paymentInstallments: order.paymentInstallments?.length
      ? order.paymentInstallments.map((row) => ({ ratio: String(row.ratio || ""), condition: row.condition || "" }))
      : [{ ratio: "100", condition: "按约定付款" }],
    remark: order.remark || "",
  };
}

function derivedDueDate(form: QuickOrderForm) {
  if (form.paymentTermType === "COPY_BL") return form.blDate || form.expectedShipmentDate || "";
  if (form.paymentTermType === "AFTER_ARRIVAL") return addDaysText(form.expectedArrivalDate, Number(form.creditDays || 0));
  if (form.paymentTermType === "OA") return addDaysText(new Date().toISOString().slice(0, 10), Number(form.creditDays || 0));
  return form.dueDate;
}

function addDaysText(dateText: string, days: number) {
  if (!dateText || !Number.isFinite(days)) return "";
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Math.round(days));
  return date.toISOString().slice(0, 10);
}

function installmentTotal(rows: PaymentInstallment[]) {
  return Math.round(rows.reduce((sum, row) => sum + Number(row.ratio || 0), 0) * 100) / 100;
}

function supplierName(supplier?: SupplierOption) {
  return supplier?.supplierName || supplier?.name || "-";
}

function logisticsSupplierText(suppliers: SupplierOption[] = []) {
  return suppliers.length ? suppliers.map((supplier) => `${supplierName(supplier)}${supplier.supplierType ? `（${supplier.supplierType}）` : ""}`).join("；") : "-";
}

function paymentTermText(order: OrderRow) {
  const base = order.paymentTermDisplay || order.paymentTerm || "-";
  return order.paymentInstallmentText ? `${base}：${order.paymentInstallmentText}` : base;
}

function rateMeta(order: OrderRow) {
  const source = order.exchangeRateSource || "待获取";
  const type = order.exchangeRateType || "-";
  return `来源：${source} / 类型：${type}${order.exchangeRateDate ? ` / 日期：${order.exchangeRateDate}` : ""}`;
}

function orderStatusClass(status = "") {
  if (["已收齐", "多收款"].includes(status)) return styles.statusSuccess;
  if (["部分收款", "生产中", "已发货"].includes(status)) return styles.statusWarning;
  if (["已取消"].includes(status)) return styles.statusMuted;
  if (["已关闭"].includes(status)) return styles.statusDanger;
  return "";
}
