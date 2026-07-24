import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import {
  FACTORY_COST_TYPES,
  FOREIGN_CURRENCY_COST_TYPES,
  PRODUCT_SUPPLIER_TYPES,
  emptyCostItemForm,
  type CostItemForm,
  type CostOrderOption,
  type CostRow,
  type ExchangeRateResponse,
  type OrdersResponse,
  type QuickCostForm,
  type SupplierOption,
  type SuppliersResponse,
} from "./model";
import {
  costFormFromRow,
  costItemFromRow,
  exchangeRateMeta,
  initialSupplierFromCost,
  isProductSupplierPaymentFormLocked,
} from "./helpers";

function quickCostDraftSignature(form: QuickCostForm, items: CostItemForm[]) {
  return JSON.stringify({
    form,
    items: items.map(({ localId: _localId, ...item }) => item),
  });
}

export function useQuickCostForm({
  initialCost,
  canManageFactoryPayments,
  onSaved,
}: {
  initialCost?: CostRow | null;
  canManageFactoryPayments: boolean;
  onSaved: (saved?: CostRow | CostRow[] | null) => void | Promise<void>;
}) {
  const [form, setForm] = useState<QuickCostForm>(() => costFormFromRow(initialCost));
  const [items, setItems] = useState<CostItemForm[]>(() => [costItemFromRow(initialCost)]);
  const [orders, setOrders] = useState<CostOrderOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [exchangeMetaByItem, setExchangeMetaByItem] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const editMode = Boolean(initialCost?.id);
  const copyMode = Boolean(initialCost && !initialCost.id);

  useEffect(() => {
    const nextItem = costItemFromRow(initialCost);
    setForm(costFormFromRow(initialCost));
    setItems([nextItem]);
    setExchangeMetaByItem({ [nextItem.localId]: exchangeRateMeta(nextItem.currency) });
    setMessage("");
  }, [initialCost?.id, initialCost?.orderId, initialCost?.supplierId, initialCost?.costType, initialCost?.amount, initialCost?.updatedAt]);

  useEffect(() => {
    setExchangeMetaByItem((current) => {
      let changed = false;
      const next = { ...current };
      items.forEach((item) => {
        if (!next[item.localId]) {
          next[item.localId] = exchangeRateMeta(item.currency);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [items]);

  const initialOrder = initialCost?.orderId ? {
    id: initialCost.orderId,
    orderNo: initialCost.orderNo,
    blNo: initialCost.blNo,
    billOfLadingNo: initialCost.billOfLadingNo,
    customerName: initialCost.customerName,
    customerFullName: initialCost.customerFullName,
    customerShortName: initialCost.customerShortName,
  } : null;
  const initialSupplier = initialSupplierFromCost(initialCost);
  const orderOptions = initialOrder && !orders.some((order) => order.id === initialOrder.id) ? [initialOrder, ...orders] : orders;
  const supplierOptions = initialSupplier && !suppliers.some((supplier) => supplier.id === initialSupplier.id) ? [initialSupplier, ...suppliers] : suppliers;
  const selectedOrder = orderOptions.find((order) => order.id === form.orderId);

  async function searchOrders(keyword: string) {
    try {
      const params = new URLSearchParams({ q: keyword.trim() });
      const result = await apiJson<OrdersResponse>(`/api/receivables/search?${params}`);
      return Array.isArray(result.orders) ? result.orders : [];
    } catch (orderError) {
      setMessage(orderError instanceof Error ? orderError.message : "读取订单列表失败");
      return [];
    }
  }

  async function searchSuppliers(keyword: string, costType: string) {
    try {
      const params = new URLSearchParams({ status: "active" });
      if (keyword.trim()) params.set("keyword", keyword.trim());
      if (FACTORY_COST_TYPES.includes(costType)) params.set("type", "factory");
      const result = await apiJson<SuppliersResponse>(`/api/suppliers/search?${params}`);
      return Array.isArray(result.suppliers) ? result.suppliers : [];
    } catch (supplierError) {
      setMessage(supplierError instanceof Error ? supplierError.message : "读取供应商列表失败");
      return [];
    }
  }

  function setFormValue<K extends keyof QuickCostForm>(key: K, value: QuickCostForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setItemValue<K extends keyof CostItemForm>(localId: string, key: K, value: CostItemForm[K]) {
    setItems((current) => current.map((item) => item.localId === localId ? { ...item, [key]: value } : item));
  }

  function patchItemValue(localId: string, patch: Partial<CostItemForm>) {
    setItems((current) => current.map((item) => item.localId === localId ? { ...item, ...patch } : item));
  }

  function mergeSupplier(supplier: SupplierOption) {
    setSuppliers((current) => current.some((item) => item.id === supplier.id) ? current : [supplier, ...current]);
  }

  function handleOrderSelect(order: CostOrderOption) {
    setOrders((current) => current.some((item) => item.id === order.id) ? current : [order, ...current]);
    setFormValue("orderId", order.id);
  }

  function handleSupplierSelect(localId: string, supplier: SupplierOption) {
    mergeSupplier(supplier);
    setItemValue(localId, "supplierId", supplier.id);
  }

  async function resolveExchangeRate(localId: string, currency: string, paymentDate = items.find((item) => item.localId === localId)?.paymentDate || "") {
    const normalized = currency.trim().toUpperCase();
    if (normalized === "CNY") {
      setExchangeMetaByItem((current) => ({ ...current, [localId]: "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000" }));
      patchItemValue(localId, {
        exchangeRate: "1",
        exchangeRateDate: paymentDate || "",
        exchangeRateSource: "系统",
        exchangeRateType: "人民币",
      });
      return;
    }
    setExchangeMetaByItem((current) => ({ ...current, [localId]: "正在获取汇率..." }));
    try {
      const params = new URLSearchParams({ currency: normalized });
      if (paymentDate) params.set("date", paymentDate);
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?${params}`);
      const rateValue = result.rate?.exchangeRate ?? result.rate?.rateToCny ?? result.rate?.rate;
      if (rateValue) {
        patchItemValue(localId, {
          exchangeRate: String(rateValue),
          exchangeRateDate: result.rate?.rateDate || paymentDate || "",
          exchangeRateSource: result.rate?.source || "系统",
          exchangeRateType: result.rate?.rateType || "即期",
        });
        setExchangeMetaByItem((current) => ({
          ...current,
          [localId]: `来源：${result.rate?.source || "系统"} ｜ 类型：${result.rate?.rateType || "即期"} ｜ 汇率：${Number(rateValue).toFixed(4)}`,
        }));
      }
    } catch {
      setExchangeMetaByItem((current) => ({ ...current, [localId]: "汇率获取失败，请手工填写" }));
    }
  }

  async function handleCostTypeChange(localId: string, costType: string) {
    const item = items.find((row) => row.localId === localId);
    const selectedSupplier = supplierOptions.find((supplier) => supplier.id === item?.supplierId);
    const currency = FOREIGN_CURRENCY_COST_TYPES.includes(costType) ? (item?.currency || "CNY") : "CNY";
    setItems((current) => current.map((row) => row.localId === localId ? {
      ...row,
      costType,
      currency,
      exchangeRate: currency === "CNY" ? "1" : "",
      exchangeRateDate: currency === "CNY" ? "" : "",
      exchangeRateSource: currency === "CNY" ? "系统" : "",
      exchangeRateType: currency === "CNY" ? "人民币" : "",
      supplierId: FACTORY_COST_TYPES.includes(costType) && selectedSupplier?.supplierType && !PRODUCT_SUPPLIER_TYPES.includes(selectedSupplier.supplierType) ? "" : row.supplierId,
    } : row));
    if (FACTORY_COST_TYPES.includes(costType) && selectedSupplier?.supplierType && !PRODUCT_SUPPLIER_TYPES.includes(selectedSupplier.supplierType)) {
      setMessage("当前成本类型需要选择产品供应商，请重新选择供应商。");
    }
    await resolveExchangeRate(localId, currency);
  }

  async function handleCurrencyChange(localId: string, currency: string) {
    const normalized = currency.toUpperCase();
    setItems((current) => current.map((item) => item.localId === localId ? {
      ...item,
      currency: normalized,
      exchangeRate: normalized === "CNY" ? "1" : "",
      exchangeRateDate: normalized === "CNY" ? "" : "",
      exchangeRateSource: normalized === "CNY" ? "系统" : "",
      exchangeRateType: normalized === "CNY" ? "人民币" : "",
    } : item));
    await resolveExchangeRate(localId, normalized);
  }

  async function handlePaymentDateChange(localId: string, paymentDate: string) {
    const item = items.find((row) => row.localId === localId);
    patchItemValue(localId, { paymentDate });
    if (!item) return;
    await resolveExchangeRate(localId, item.currency, paymentDate);
  }

  function addCostItem(copyPrevious: boolean) {
    const source = copyPrevious ? items[items.length - 1] : null;
    const nextItem = source
      ? { ...source, localId: emptyCostItemForm().localId, supplierId: source.supplierId, amount: "", remark: "" }
      : emptyCostItemForm();
    setItems((current) => [...current, nextItem]);
    setExchangeMetaByItem((current) => ({ ...current, [nextItem.localId]: exchangeRateMeta(nextItem.currency) }));
  }

  async function submitQuickCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.orderId) {
      setMessage("请选择关联订单");
      return;
    }
    for (const [index, item] of items.entries()) {
      if (!item.supplierId) {
        setMessage(`第 ${index + 1} 条成本请选择供应商`);
        return;
      }
      if (!item.amount || Number(item.amount) <= 0) {
        setMessage(`第 ${index + 1} 条成本请填写供应商成本金额`);
        return;
      }
      if (!Number(item.exchangeRate)) {
        setMessage(`第 ${index + 1} 条成本请填写汇率；CNY 成本汇率应自动为 1`);
        return;
      }
      const selectedSupplier = supplierOptions.find((supplier) => supplier.id === item.supplierId) || null;
      if (!isProductSupplierPaymentFormLocked(item, selectedSupplier, canManageFactoryPayments) && item.paymentStatus === "已支付" && !item.paymentDate) {
        setMessage(`第 ${index + 1} 条成本已支付时必须填写付款日期`);
        return;
      }
    }

    setSaving(true);
    setMessage("");
    try {
      const payloadItems = items.map((item) => ({
        supplierId: item.supplierId,
        costType: item.costType,
        amount: Number(item.amount),
        currency: item.currency,
        exchangeRate: Number(item.exchangeRate),
        exchangeRateDate: item.exchangeRateDate || undefined,
        exchangeRateSource: item.exchangeRateSource || undefined,
        exchangeRateType: item.exchangeRateType || undefined,
        paymentStatus: item.paymentStatus,
        paymentDate: item.paymentDate || undefined,
        costConfirmed: item.costConfirmed === "true",
        remark: item.remark.trim(),
      }));
      const result = await apiJson<{ success?: boolean; message?: string; cost?: CostRow; costs?: CostRow[]; data?: { cost?: CostRow; costs?: CostRow[] } }>(
        editMode ? `/api/costs/${encodeURIComponent(initialCost?.id || "")}` : "/api/costs",
        {
          method: editMode ? "PATCH" : "POST",
          body: JSON.stringify(editMode ? { orderId: form.orderId, ...payloadItems[0] } : { orderId: form.orderId, items: payloadItems }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "保存成本失败");
      await onSaved(result.cost || result.costs || result.data?.cost || result.data?.costs || null);
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "保存成本失败");
    } finally {
      setSaving(false);
    }
  }

  return {
    editMode,
    copyMode,
    form,
    items,
    dirty: quickCostDraftSignature(form, items) !== quickCostDraftSignature(
      costFormFromRow(initialCost),
      [costItemFromRow(initialCost)],
    ),
    orderOptions,
    supplierOptions,
    selectedOrder,
    exchangeMetaByItem,
    saving,
    message,
    searchOrders,
    searchSuppliers,
    handleOrderSelect,
    handleSupplierSelect,
    handleCostTypeChange,
    handleCurrencyChange,
    handlePaymentDateChange,
    setItemValue,
    addCostItem,
    submitQuickCost,
  };
}
