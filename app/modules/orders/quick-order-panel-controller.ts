import { useEffect, useMemo, useState } from "react";
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
import { derivedDueDate, installmentTotal, orderFormFromRow } from "./utils";

type BusinessEntitiesResponse = {
  entities?: BusinessEntityOption[];
};

type SalespeopleResponse = {
  salespeople?: SalespersonOption[];
};

export type UseQuickOrderPanelControllerParams = {
  initialOrder?: OrderRow | null;
  canManageOrderAssignments?: boolean;
  onSaved: () => void;
};

export function useQuickOrderPanelController({
  initialOrder,
  canManageOrderAssignments = false,
  onSaved,
}: UseQuickOrderPanelControllerParams) {
  const [form, setForm] = useState<QuickOrderForm>(() => orderFormFromRow(initialOrder));
  const [customers, setCustomers] = useState<CustomerAutocompleteOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [businessEntities, setBusinessEntities] = useState<BusinessEntityOption[]>([]);
  const [salespeople, setSalespeople] = useState<SalespersonOption[]>([]);
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
  const defaultBusinessEntity = useMemo(() => (
    businessEntities.find((entity) => entity.isDefault) || businessEntities[0] || null
  ), [businessEntities]);

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
    setForm((current) => ({ ...current, logisticsSupplierIds: [defaultLogisticsSupplier.id] }));
  }, [allowMultipleLogisticsSuppliers, defaultLogisticsSupplier?.id]);

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
      setForm((current) => ({ ...current, exchangeRate: "", exchangeRateDate: "", exchangeRateSource: "", exchangeRateType: "" }));
      return;
    }
    if (normalized === "CNY") {
      setExchangeMeta("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
      setForm((current) => ({ ...current, exchangeRate: "1", exchangeRateDate: "", exchangeRateSource: "系统", exchangeRateType: "人民币" }));
      return;
    }
    setExchangeMeta("正在获取汇率...");
    try {
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?currency=${encodeURIComponent(normalized)}`);
      const rate = Number(result.rate?.rateToCny ?? result.rate?.exchangeRate ?? result.rate?.rate ?? 0);
      if (rate > 0) {
        setForm((current) => ({
          ...current,
          exchangeRate: String(rate),
          exchangeRateDate: result.rate?.rateDate || "",
          exchangeRateSource: result.rate?.source || "",
          exchangeRateType: result.rate?.rateType || "",
        }));
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
  }, [initialOrder?.currency, initialOrder?.customerFullName, initialOrder?.customerId, initialOrder?.customerName, initialOrder?.customerShortName]);

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
      exchangeRateDate: customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRateDate,
      exchangeRateSource: customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRateSource,
      exchangeRateType: customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRateType,
      paymentTermType: customerOption.defaultPaymentTermType || current.paymentTermType,
      tradeTerm: customerOption.defaultTradeTerm || current.tradeTerm,
      salespersonUserId: canManageOrderAssignments && !initialOrder?.id ? (customerOption.salespersonUserId || current.salespersonUserId) : current.salespersonUserId,
      salespersonCommissionRate: canManageOrderAssignments && !initialOrder?.id && customerOption.commissionRate != null
        ? String(customerOption.commissionStatus === "停用" ? 0 : customerOption.commissionRate)
        : current.salespersonCommissionRate,
    }));
    if (customerOption.defaultCurrency) await resolveExchangeRate(customerOption.defaultCurrency);
  }

  async function handleCurrencyChange(currency: string) {
    const normalized = currency.toUpperCase();
    setForm((current) => ({ ...current, currency: normalized, exchangeRate: "", exchangeRateDate: "", exchangeRateSource: "", exchangeRateType: "" }));
    await resolveExchangeRate(normalized);
  }

  function handleExchangeRateChange(value: string) {
    setForm((current) => ({ ...current, exchangeRate: value, ...(current.currency && current.currency !== "CNY" ? { exchangeRateSource: "手动" } : {}) }));
    if (form.currency && form.currency !== "CNY") setExchangeMeta(`来源：手动 ｜ 类型：${form.exchangeRateType || "手动录入"} ｜ 汇率：${value || "-"}`);
  }

  function selectedLogisticsSupplierIds() {
    if (!allowMultipleLogisticsSuppliers) return defaultLogisticsSupplier ? [defaultLogisticsSupplier.id] : [];
    return form.logisticsSupplierIds;
  }

  async function submitQuickOrder() {
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
        exchangeRateDate: form.exchangeRateDate || undefined,
        exchangeRateSource: form.exchangeRateSource || undefined,
        exchangeRateType: form.exchangeRateType || undefined,
        estimatedReceivableAmount: Number(form.estimatedReceivableAmount),
        finalReceivableAmount: form.finalReceivableAmount ? Number(form.finalReceivableAmount) : undefined,
        actualShipmentAmount: form.actualShipmentAmount ? Number(form.actualShipmentAmount) : undefined,
        actualShipmentDate: form.actualShipmentDate || undefined,
        tradeTerm: form.tradeTerm,
        paymentTermType: form.paymentTermType,
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
        businessEntityId: form.businessEntityId || undefined,
        ...(canManageOrderAssignments ? { salespersonUserId: form.salespersonUserId, salespersonCommissionRate: form.salespersonCommissionRate === "" ? undefined : Number(form.salespersonCommissionRate) } : {}),
        logisticsSupplierIds: selectedLogisticsSupplierIds(),
        remark: form.remark.trim(),
      };
      const isEdit = Boolean(initialOrder?.id);
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/orders/${encodeURIComponent(initialOrder?.id || "")}` : "/api/orders",
        { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(payload) },
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

  return {
    form,
    businessEntities,
    salespeople,
    allowMultipleLogisticsSuppliers,
    logisticsSuppliers,
    defaultLogisticsSupplier,
    exchangeMeta,
    saving,
    message,
    customer,
    setMessage,
    setForm,
    setFormValue,
    handleCustomerSelect,
    handleCurrencyChange,
    handleExchangeRateChange,
    selectedLogisticsSupplierIds,
    submitQuickOrder,
  };
}
