import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "../../api";
import { customerDisplayName } from "../../utils";
import type { CustomerAutocompleteOption } from "../../CustomerAutocomplete";
import {
  LOGISTICS_SUPPLIER_TYPES,
  emptyQuickOrderForm,
  type BusinessEntityOption,
  type ExchangeRateResponse,
  type QuickOrderForm,
  type SettingsResponse,
  type SuppliersResponse,
  type OrderRow,
  type SalespersonOption,
  type SupplierOption,
} from "./model";
import { loadLatestOrderAfterConflict } from "./order-conflict-refresh";
import { derivedDueDate, installmentTotal, orderFormFromRow } from "./utils";

type BusinessEntitiesResponse = {
  entities?: BusinessEntityOption[];
};

type SalespeopleResponse = {
  salespeople?: SalespersonOption[];
};

function normalizedOrderTradeTerm(value: string) {
  return String(value || "").trim().toUpperCase();
}

function isExwTradeTerm(value: string) {
  return normalizedOrderTradeTerm(value).includes("EXW");
}

function hasHistoricalBusinessDate(form: QuickOrderForm) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    form.actualShipmentDate,
    form.blDate,
    form.expectedArrivalDate,
    form.expectedPaymentDate,
    form.dueDate,
  ].some((value) => Boolean(value && value < today));
}

export type UseQuickOrderPanelControllerParams = {
  initialOrder?: OrderRow | null;
  canManageOrderAssignments?: boolean;
  onOpenExchangeSettings?: () => void;
  onConflictRefreshed: (order: OrderRow) => void;
  onSaved: (order?: OrderRow | null) => void;
};

export function useQuickOrderPanelController({
  initialOrder,
  canManageOrderAssignments = false,
  onOpenExchangeSettings,
  onConflictRefreshed,
  onSaved,
}: UseQuickOrderPanelControllerParams) {
  const [form, setForm] = useState<QuickOrderForm>(() => orderFormFromRow(initialOrder));
  const [customers, setCustomers] = useState<CustomerAutocompleteOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [businessEntities, setBusinessEntities] = useState<BusinessEntityOption[]>([]);
  const [salespeople, setSalespeople] = useState<SalespersonOption[]>([]);
  const [allowMultipleLogisticsSuppliers, setAllowMultipleLogisticsSuppliers] = useState(false);
  const [exchangeMeta, setExchangeMeta] = useState("");
  const [exchangeCacheMissing, setExchangeCacheMissing] = useState(false);
  const [refreshingExchangeRate, setRefreshingExchangeRate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const logisticsSuppliers = useMemo(() => (
    suppliers.filter((supplier) => supplier.status !== "停用" && LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType || ""))
  ), [suppliers]);
  const defaultLogisticsSupplier = useMemo(() => (
    logisticsSuppliers.find((supplier) => supplier.isDefaultLogisticsSupplier) || null
  ), [logisticsSuppliers]);
  const defaultBusinessEntity = useMemo(() => (
    businessEntities.find((entity) => entity.isDefault) || businessEntities[0] || null
  ), [businessEntities]);

  const loadOrderSnapshot = useCallback((order?: OrderRow | null) => {
    setForm(orderFormFromRow(order));
    setExchangeCacheMissing(false);
    if (order?.currency) {
      const hasExchangeMeta = Boolean(order.exchangeRate && order.exchangeRateDate && order.exchangeRateSource && order.exchangeRateType);
      setExchangeMeta(order.currency === "CNY"
        ? "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000"
        : hasExchangeMeta
          ? `来源：${order.exchangeRateSource} ｜ 类型：${order.exchangeRateType} ｜ 更新时间：${order.exchangeRateDate}`
          : "当前订单缺少官方汇率，请点击【刷新官方汇率】后再保存。");
    } else {
      setExchangeMeta("");
    }
  }, []);

  useEffect(() => {
    loadOrderSnapshot(initialOrder);
  }, [initialOrder, initialOrder?.updatedAt, loadOrderSnapshot]);

  useEffect(() => {
    setMessage("");
  }, [initialOrder?.id]);

  useEffect(() => {
    void loadFormOptions();
  }, []);

  useEffect(() => {
    if (allowMultipleLogisticsSuppliers) return;
    if (!defaultLogisticsSupplier) return;
    setForm((current) => (
      isExwTradeTerm(current.tradeTerm) ? current :
      current.logisticsSupplierIds.length ? current : { ...current, logisticsSupplierIds: [defaultLogisticsSupplier.id] }
    ));
  }, [allowMultipleLogisticsSuppliers, defaultLogisticsSupplier?.id, form.tradeTerm]);

  useEffect(() => {
    if (initialOrder?.id) return;
    if (!defaultBusinessEntity?.id) return;
    setForm((current) => current.businessEntityId ? current : ({ ...current, businessEntityId: defaultBusinessEntity.id }));
  }, [defaultBusinessEntity?.id, initialOrder?.id]);

  useEffect(() => {
    if (form.paymentTermType === "INSTALLMENT") return;
    const nextDueDate = derivedDueDate(form);
    if (nextDueDate !== form.dueDate) setFormValue("dueDate", nextDueDate);
  }, [form.paymentTermType, form.actualShipmentDate, form.blDate, form.expectedArrivalDate, form.creditDays]);

  async function loadFormOptions() {
    try {
      const [settingsResult, suppliersResult, businessEntitiesResult, salespeopleResult] = await Promise.all([
        apiJson<SettingsResponse>("/api/exchange-rates/settings").catch(() => null),
        apiJson<SuppliersResponse>("/api/suppliers/available").catch(() => null),
        apiJson<BusinessEntitiesResponse>("/api/business-entities").catch(() => null),
        canManageOrderAssignments
          ? apiJson<SalespeopleResponse>("/api/settings/customers?page=1&pageSize=1").catch(() => null)
          : Promise.resolve(null),
      ]);
      setAllowMultipleLogisticsSuppliers(Boolean(settingsResult?.settings?.allowMultipleOrderLogisticsSuppliers));
      setSuppliers(Array.isArray(suppliersResult?.suppliers) ? suppliersResult.suppliers : []);
      setBusinessEntities(Array.isArray(businessEntitiesResult?.entities) ? businessEntitiesResult.entities : []);
      setSalespeople(Array.isArray(salespeopleResult?.salespeople) ? salespeopleResult.salespeople : []);
    } catch (optionError) {
      setMessage(optionError instanceof Error ? optionError.message : "读取订单配置失败");
    }
  }

  async function resolveExchangeRate(currency: string) {
    const normalized = currency.trim().toUpperCase();
    if (!normalized) {
      setExchangeMeta("");
      setExchangeCacheMissing(false);
      setForm((current) => ({ ...current, exchangeRate: "", exchangeRateDate: "", exchangeRateSource: "", exchangeRateType: "" }));
      return;
    }
    if (normalized === "CNY") {
      setExchangeMeta("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
      setExchangeCacheMissing(false);
      setForm((current) => ({ ...current, exchangeRate: "1", exchangeRateDate: "", exchangeRateSource: "系统", exchangeRateType: "人民币" }));
      return;
    }
    await refreshOfficialExchangeRate(normalized, { quiet: true });
  }

  async function refreshOfficialExchangeRate(currencyInput = form.currency, options: { quiet?: boolean } = {}) {
    const normalized = currencyInput.trim().toUpperCase();
    if (!normalized) {
      setMessage("请先选择币种");
      return false;
    }
    if (normalized === "CNY") {
      setForm((current) => ({ ...current, currency: "CNY", exchangeRate: "1", exchangeRateDate: "", exchangeRateSource: "系统", exchangeRateType: "人民币" }));
      setExchangeMeta("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
      setExchangeCacheMissing(false);
      if (!options.quiet) setMessage("");
      return true;
    }
    setRefreshingExchangeRate(true);
    setExchangeCacheMissing(false);
    setExchangeMeta("正在读取官方汇率缓存...");
    try {
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?currency=${encodeURIComponent(normalized)}&cacheOnly=1`);
      const rate = Number(result.rate?.rateToCny ?? result.rate?.exchangeRate ?? result.rate?.rate ?? 0);
      if (rate > 0) {
        setForm((current) => ({
          ...current,
          currency: normalized,
          exchangeRate: String(rate),
          exchangeRateDate: result.rate?.rateDate || "",
          exchangeRateSource: result.rate?.source || "",
          exchangeRateType: result.rate?.rateType || "",
        }));
        setExchangeMeta(`来源：${result.rate?.source || "系统"} ｜ 类型：${result.rate?.rateType || "现汇买入价"} ｜ 更新时间：${result.rate?.rateDate || "-"}`);
        setMessage("");
        setExchangeCacheMissing(false);
        return true;
      } else {
        throw new Error("当前币种暂无官方汇率缓存，请到系统设置刷新汇率。");
      }
    } catch (rateError) {
      const typedError = rateError as { status?: number; code?: string; message?: string };
      const isMissingCache = typedError.status === 404 || typedError.code === "EXCHANGE_RATE_NOT_FOUND";
      const nextMessage = isMissingCache
        ? "当前币种暂无官方汇率缓存，请到系统设置刷新汇率。"
        : (typedError.message || "读取官方汇率失败，请稍后重试。");
      setExchangeMeta(nextMessage);
      setMessage(nextMessage);
      setExchangeCacheMissing(isMissingCache);
      return false;
    } finally {
      setRefreshingExchangeRate(false);
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
  }, [initialOrder?.currency, initialOrder?.customerFullName, initialOrder?.customerId, initialOrder?.customerName, initialOrder?.customerShortName]);

  const customerOptions = useMemo(() => {
    if (!initialCustomer) return customers;
    return customers.some((customer) => customer.id === initialCustomer.id)
      ? customers
      : [initialCustomer, ...customers];
  }, [customers, initialCustomer]);
  const customer = customerOptions.find((option) => option.id === form.customerId);
  const currencyLockedByPayments = Boolean(initialOrder?.id && (
    initialOrder.hasCurrencyLockPayments === true
    || Number(initialOrder.summary?.arrivedPaymentsAmount || 0) > 0
    || Number(initialOrder.summary?.pendingPaymentsAmount || 0) > 0
  ));
  const historicalDateNotice = hasHistoricalBusinessDate(form)
    ? "当前为历史日期，请确认是否为补录订单。"
    : "";

  async function handleCustomerSelect(customerOption: CustomerAutocompleteOption) {
    setCustomers((current) => current.some((item) => item.id === customerOption.id) ? current : [customerOption, ...current]);
    setForm((current) => ({
      ...current,
      customerId: customerOption.id,
      currency: currencyLockedByPayments ? current.currency : (customerOption.defaultCurrency || current.currency),
      exchangeRate: !currencyLockedByPayments && customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRate,
      exchangeRateDate: !currencyLockedByPayments && customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRateDate,
      exchangeRateSource: !currencyLockedByPayments && customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRateSource,
      exchangeRateType: !currencyLockedByPayments && customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRateType,
      paymentTermType: customerOption.defaultPaymentTermType || current.paymentTermType,
      tradeTerm: customerOption.defaultTradeTerm || current.tradeTerm,
      salespersonUserId: canManageOrderAssignments && !initialOrder?.id ? (customerOption.salespersonUserId || current.salespersonUserId) : current.salespersonUserId,
    }));
    if (!currencyLockedByPayments && customerOption.defaultCurrency) await resolveExchangeRate(customerOption.defaultCurrency);
  }

  async function handleCurrencyChange(currency: string) {
    if (currencyLockedByPayments) {
      setMessage("订单已有待确认或已到账收款，币种已锁定；如需更正请先处理收款记录。");
      return;
    }
    const normalized = currency.toUpperCase();
    setForm((current) => ({ ...current, currency: normalized, exchangeRate: "", exchangeRateDate: "", exchangeRateSource: "", exchangeRateType: "" }));
    await resolveExchangeRate(normalized);
  }

  function hasOfficialExchangeRate(current = form) {
    const currency = current.currency.trim().toUpperCase();
    if (currency === "CNY") return Number(current.exchangeRate || 0) === 1;
    return Boolean(
      currency
      && Number(current.exchangeRate || 0) > 0
      && current.exchangeRateDate
      && current.exchangeRateSource
      && current.exchangeRateSource !== "手动"
      && current.exchangeRateType
    );
  }

  function selectedLogisticsSupplierIds(current = form) {
    const selectedIds = current.logisticsSupplierIds.filter(Boolean);
    if (allowMultipleLogisticsSuppliers) return selectedIds;
    if (selectedIds[0]) return [selectedIds[0]];
    if (isExwTradeTerm(current.tradeTerm)) return [];
    return defaultLogisticsSupplier ? [defaultLogisticsSupplier.id] : [];
  }

  async function submitQuickOrder() {
    if (!form.customerId) return setMessage("请选择客户");
    if (!form.orderNo.trim()) return setMessage("请填写订单号");
    if (!form.currency) return setMessage("请选择币种");
    const normalizedForm = form.currency === "CNY" && Number(form.exchangeRate || 0) !== 1
      ? { ...form, exchangeRate: "1", exchangeRateSource: "系统", exchangeRateType: "人民币" }
      : form;
    if (form.currency === "CNY" && Number(form.exchangeRate || 0) !== 1) {
      setForm(normalizedForm);
    }
    if (!hasOfficialExchangeRate(normalizedForm)) {
      setExchangeCacheMissing(form.currency !== "CNY");
      return setMessage("当前订单缺少官方汇率，请点击【刷新官方汇率】后再保存。");
    }
    if (!normalizedForm.estimatedReceivableAmount || Number(normalizedForm.estimatedReceivableAmount) <= 0) return setMessage("请填写预计应收金额");
    if (normalizedForm.paymentTermType === "AFTER_ARRIVAL" && !normalizedForm.expectedArrivalDate) return setMessage("到港后付款请填写预计到港日期");
    if (["OA", "AFTER_ARRIVAL"].includes(normalizedForm.paymentTermType) && Number(normalizedForm.creditDays) < 0) return setMessage("请填写有效账期天数");
    if (normalizedForm.paymentTermType === "INSTALLMENT" && installmentTotal(normalizedForm.paymentInstallments) !== 100) return setMessage("分批付款比例合计必须等于 100%");
    const logisticsSupplierIds = selectedLogisticsSupplierIds(normalizedForm);
    if (!isExwTradeTerm(normalizedForm.tradeTerm) && !logisticsSupplierIds.length) return setMessage("请选择物流供应商");

    setSaving(true);
    setMessage("");
    try {
      const isEdit = Boolean(initialOrder?.id);
      const payload = {
        ...(isEdit ? { expectedUpdatedAt: normalizedForm.expectedUpdatedAt || initialOrder?.updatedAt || undefined } : {}),
        customerId: normalizedForm.customerId,
        orderNo: normalizedForm.orderNo.trim(),
        blNo: normalizedForm.blNo.trim(),
        currency: normalizedForm.currency,
        exchangeRate: Number(normalizedForm.exchangeRate),
        exchangeRateDate: normalizedForm.exchangeRateDate || undefined,
        exchangeRateSource: normalizedForm.exchangeRateSource || undefined,
        exchangeRateType: normalizedForm.exchangeRateType || undefined,
        estimatedReceivableAmount: Number(normalizedForm.estimatedReceivableAmount),
        finalReceivableAmount: normalizedForm.finalReceivableAmount ? Number(normalizedForm.finalReceivableAmount) : undefined,
        actualShipmentAmount: normalizedForm.actualShipmentAmount ? Number(normalizedForm.actualShipmentAmount) : undefined,
        actualShipmentDate: normalizedForm.actualShipmentDate || undefined,
        tradeTerm: normalizedForm.tradeTerm,
        paymentTermType: normalizedForm.paymentTermType,
        blDate: normalizedForm.blDate || undefined,
        expectedArrivalDate: normalizedForm.expectedArrivalDate || undefined,
        expectedPaymentDate: normalizedForm.expectedPaymentDate || undefined,
        dueDate: normalizedForm.dueDate || undefined,
        creditDays: ["OA", "AFTER_ARRIVAL"].includes(normalizedForm.paymentTermType) ? Number(normalizedForm.creditDays || 0) : undefined,
        paymentInstallments: normalizedForm.paymentTermType === "INSTALLMENT"
          ? normalizedForm.paymentInstallments.map((row) => ({ ratio: Number(row.ratio), condition: row.condition.trim() }))
          : undefined,
        reminderDays: Number(normalizedForm.reminderDays || 7),
        status: normalizedForm.status,
        businessEntityId: normalizedForm.businessEntityId || undefined,
        ...(canManageOrderAssignments ? { salespersonUserId: normalizedForm.salespersonUserId } : {}),
        logisticsSupplierIds,
        remark: normalizedForm.remark.trim(),
      };
      const result = await apiJson<{ success?: boolean; message?: string; order?: OrderRow; data?: OrderRow }>(
        isEdit ? `/api/orders/${encodeURIComponent(initialOrder?.id || "")}` : "/api/orders",
        { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      if (result.success !== true) throw new Error(result.message || "订单保存失败");
      setForm({ ...emptyQuickOrderForm });
      setExchangeMeta("");
      onSaved(result.order || result.data || null);
    } catch (saveError) {
      const orderId = initialOrder?.id || "";
      try {
        const latestOrder = await loadLatestOrderAfterConflict(
          saveError,
          orderId,
          (path) => apiJson<{ order?: OrderRow; data?: OrderRow }>(path),
        );
        if (latestOrder) {
          loadOrderSnapshot(latestOrder);
          onConflictRefreshed(latestOrder);
          setMessage("订单已被其他操作更新，系统已载入服务器最新数据并替换本次未保存内容。请重新核对后再保存。");
          return;
        }
      } catch (refreshError) {
        const conflictMessage = saveError instanceof Error ? saveError.message : "订单保存发生冲突";
        const refreshMessage = refreshError instanceof Error ? refreshError.message : "读取最新订单失败";
        setMessage(`${conflictMessage}；自动读取最新订单失败：${refreshMessage}。请取消编辑后重新打开订单。`);
        return;
      }
      setMessage(saveError instanceof Error ? saveError.message : "订单保存失败");
    } finally {
      setSaving(false);
    }
  }

  return {
    form,
    businessEntities,
    salespeople,
    allowMultipleLogisticsSuppliers,
    logisticsSuppliers,
    defaultLogisticsSupplier,
    isExwOrder: isExwTradeTerm(form.tradeTerm),
    currencyLockedByPayments,
    exchangeMeta,
    exchangeCacheMissing,
    refreshingExchangeRate,
    saving,
    message,
    historicalDateNotice,
    customer,
    setMessage,
    setForm,
    setFormValue,
    handleCustomerSelect,
    handleCurrencyChange,
    refreshOfficialExchangeRate,
    onOpenExchangeSettings,
    selectedLogisticsSupplierIds,
    submitQuickOrder,
  };
}
