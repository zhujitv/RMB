import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "../../api";
import type { CustomerAutocompleteOption } from "../../CustomerAutocomplete";
import { customerDisplayName } from "../../utils";
import {
  LOGISTICS_SUPPLIER_TYPES,
  emptyQuickOrderForm,
  type BusinessEntityOption,
  type OrderRow,
  type QuickOrderForm,
  type SalespersonOption,
  type SupplierOption,
} from "./model";
import { loadLatestOrderAfterConflict } from "./order-conflict-refresh";
import { hasHistoricalBusinessDate, isExwTradeTerm } from "./quick-order-controller-utils";
import { loadQuickOrderFormOptions } from "./quick-order-form-options";
import { quickOrderPayload } from "./quick-order-payload";
import { useQuickOrderExchangeRate } from "./use-quick-order-exchange-rate";
import { derivedDueDate, installmentTotal, orderFormFromRow } from "./utils";

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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const {
    exchangeMeta,
    exchangeCacheMissing,
    refreshingExchangeRate,
    setExchangeCacheMissing,
    syncExchangeMetadata,
    clearExchangeMetadata,
    resolveExchangeRate,
    refreshOfficialExchangeRate,
  } = useQuickOrderExchangeRate({ form, setForm, setMessage });

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
    syncExchangeMetadata(order);
  }, [syncExchangeMetadata]);

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
      const options = await loadQuickOrderFormOptions(canManageOrderAssignments);
      setAllowMultipleLogisticsSuppliers(options.allowMultipleLogisticsSuppliers);
      setSuppliers(options.suppliers);
      setBusinessEntities(options.businessEntities);
      setSalespeople(options.salespeople);
    } catch (optionError) {
      setMessage(optionError instanceof Error ? optionError.message : "读取订单配置失败");
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
      const payload = quickOrderPayload(normalizedForm, {
        isEdit,
        expectedUpdatedAt: initialOrder?.updatedAt,
        canManageOrderAssignments,
        logisticsSupplierIds,
      });
      const result = await apiJson<{ success?: boolean; message?: string; order?: OrderRow; data?: OrderRow }>(
        isEdit ? `/api/orders/${encodeURIComponent(initialOrder?.id || "")}` : "/api/orders",
        { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      if (result.success !== true) throw new Error(result.message || "订单保存失败");
      setForm({ ...emptyQuickOrderForm });
      clearExchangeMetadata();
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
          onConflictRefreshed(latestOrder);
          setMessage("订单已被其他操作更新；本次未保存内容已保留。请先复制需要保留的内容，再取消编辑并重新打开订单核对最新数据。");
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
    dirty: JSON.stringify(form) !== JSON.stringify(orderFormFromRow(initialOrder)),
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
