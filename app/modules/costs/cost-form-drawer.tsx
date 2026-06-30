import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import { SideDetailDrawer } from "../../components";
import { preventEnterFormSubmit } from "../../formGuards";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import { customerDisplayName, customerLegalName } from "../../utils";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import styles from "../../WorkspaceShell.module.css";
import { COST_CONFIRMATION_OPTIONS, COST_PAYMENT_STATUSES, CURRENCIES, FACTORY_COST_TYPES, FOREIGN_CURRENCY_COST_TYPES, PRODUCT_SUPPLIER_TYPES, QUICK_COST_TYPES, emptyCostItemForm, type CostFormDrawerState, type CostItemForm, type CostOrderOption, type CostRow, type ExchangeRateResponse, type OrdersResponse, type QuickCostForm, type SupplierOption, type SuppliersResponse } from "./model";
import { costFormFromRow, costItemFromRow, exchangeRateMeta, initialSupplierFromCost, isProductSupplierPaymentFormLocked, orderLabel, supplierLabel } from "./helpers";

export function CostFormDrawer({
  drawer,
  canManageFactoryPayments,
  onCancel,
  onSaved,
}: {
  drawer: CostFormDrawerState;
  canManageFactoryPayments: boolean;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const cost = drawer.cost;
  const editMode = drawer.mode === "edit";
  const supplierName = cost ? (cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-") : "-";
  const title = editMode
    ? `${cost?.orderNo || "-"} · ${customerDisplayName(cost || {})}`
    : "登记成本";
  const subtitle = editMode
    ? `成本类型：${logisticsCostTypeLabel(cost?.costType || "") || cost?.costType || "-"} · 付款状态：${cost?.paymentStatus || "-"} · 供应商：${supplierName}`
    : "选择订单后登记供应商成本，保存后当前筛选和页码保持不变。";

  return (
    <SideDetailDrawer
      ariaLabel={editMode ? "编辑成本" : "登记成本"}
      kicker="成本管理"
      title={title}
      subtitle={subtitle}
      onClose={onCancel}
    >
      <QuickCreateCostPanel
        drawerMode
        initialCost={cost}
        canManageFactoryPayments={canManageFactoryPayments}
        onCancel={onCancel}
        onSaved={onSaved}
      />
    </SideDetailDrawer>
  );
}

export function QuickCreateCostPanel({
  initialCost,
  canManageFactoryPayments = false,
  drawerMode = false,
  onCancel,
  onSaved,
}: {
  initialCost?: CostRow | null;
  canManageFactoryPayments?: boolean;
  drawerMode?: boolean;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<QuickCostForm>(() => costFormFromRow(initialCost));
  const [items, setItems] = useState<CostItemForm[]>(() => [costItemFromRow(initialCost)]);
  const [orders, setOrders] = useState<CostOrderOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [exchangeMetaByItem, setExchangeMetaByItem] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const editMode = Boolean(initialCost?.id);

  useEffect(() => {
    const nextItem = costItemFromRow(initialCost);
    setForm(costFormFromRow(initialCost));
    setItems([nextItem]);
    setExchangeMetaByItem({ [nextItem.localId]: exchangeRateMeta(nextItem.currency) });
    setMessage("");
  }, [initialCost?.id]);

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
      setItemValue(localId, "exchangeRate", "1");
      return;
    }
    setExchangeMetaByItem((current) => ({ ...current, [localId]: "正在获取汇率..." }));
    try {
      const params = new URLSearchParams({ currency: normalized });
      if (paymentDate) params.set("date", paymentDate);
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?${params}`);
      const rate = Number(result.rate?.rateToCny ?? result.rate?.exchangeRate ?? result.rate?.rate ?? 0);
      if (rate > 0) {
        setItemValue(localId, "exchangeRate", String(rate));
        setExchangeMetaByItem((current) => ({
          ...current,
          [localId]: `来源：${result.rate?.source || "系统"} ｜ 类型：${result.rate?.rateType || "现汇买入价"} ｜ 更新时间：${result.rate?.rateDate || "-"}`,
        }));
      } else {
        setExchangeMetaByItem((current) => ({ ...current, [localId]: "汇率来源：待获取，请手工填写" }));
      }
    } catch (rateError) {
      setExchangeMetaByItem((current) => ({ ...current, [localId]: rateError instanceof Error ? rateError.message : "汇率获取失败，请手工填写" }));
    }
  }

  async function handleCostTypeChange(localId: string, costType: string) {
    const item = items.find((row) => row.localId === localId);
    const selectedSupplier = suppliers.find((supplier) => supplier.id === item?.supplierId);
    const currency = FOREIGN_CURRENCY_COST_TYPES.includes(costType) ? (item?.currency || "CNY") : "CNY";
    setItems((current) => current.map((row) => row.localId === localId ? {
      ...row,
      costType,
      currency,
      exchangeRate: currency === "CNY" ? "1" : "",
      supplierId: FACTORY_COST_TYPES.includes(costType) && selectedSupplier?.supplierType && !PRODUCT_SUPPLIER_TYPES.includes(selectedSupplier.supplierType) ? "" : row.supplierId,
    } : row));
    if (FACTORY_COST_TYPES.includes(costType) && selectedSupplier?.supplierType && !PRODUCT_SUPPLIER_TYPES.includes(selectedSupplier.supplierType)) {
      setMessage("当前成本类型需要选择产品供应商，请重新选择供应商。");
    }
    await resolveExchangeRate(localId, currency);
  }

  async function handleCurrencyChange(localId: string, currency: string) {
    const normalized = currency.toUpperCase();
    setItems((current) => current.map((item) => item.localId === localId ? { ...item, currency: normalized, exchangeRate: normalized === "CNY" ? "1" : "" } : item));
    await resolveExchangeRate(localId, normalized);
  }

  function addCostItem(copyPrevious = false) {
    setItems((current) => {
      const previous = current[current.length - 1] || emptyCostItemForm();
      const next = copyPrevious
        ? { ...previous, localId: emptyCostItemForm().localId, supplierId: previous.supplierId, amount: "", remark: "" }
        : emptyCostItemForm();
      setExchangeMetaByItem((meta) => ({ ...meta, [next.localId]: next.currency === "CNY" ? "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000" : "汇率来源：待获取" }));
      return [...current, next];
    });
  }

  function removeCostItem(localId: string) {
    setItems((current) => current.length <= 1 ? current : current.filter((item) => item.localId !== localId));
    setExchangeMetaByItem((current) => {
      const next = { ...current };
      delete next[localId];
      return next;
    });
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
      if (!item.currency) {
        setMessage(`第 ${index + 1} 条成本请选择币种`);
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
      const isEdit = editMode;
      const payloadItems = items.map((item) => ({
        supplierId: item.supplierId,
        costType: item.costType,
        amount: Number(item.amount),
        currency: item.currency,
        exchangeRate: Number(item.exchangeRate),
        paymentStatus: item.paymentStatus,
        paymentDate: item.paymentDate || undefined,
        costConfirmed: item.costConfirmed === "true",
        remark: item.remark.trim(),
      }));
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/costs/${encodeURIComponent(initialCost?.id || "")}` : "/api/costs",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify(isEdit
            ? { orderId: form.orderId, ...payloadItems[0] }
            : { orderId: form.orderId, items: payloadItems }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "成本保存失败");
      setForm(costFormFromRow(null));
      const freshItem = emptyCostItemForm();
      setItems([freshItem]);
      setExchangeMetaByItem({ [freshItem.localId]: "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000" });
      await onSaved();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "成本保存失败");
    } finally {
      setSaving(false);
    }
  }

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

  return (
    <form className={`${styles.quickCreatePanel} ${drawerMode ? styles.quickCreatePanelInDrawer : ""}`} onKeyDown={preventEnterFormSubmit} onSubmit={submitQuickCost}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{editMode ? "编辑成本" : "批量登记成本"}</strong>
        </div>
        {!editMode ? (
          <div className={styles.detailActions}>
            <button className={styles.secondaryButton} type="button" onClick={() => addCostItem(false)}>添加一条</button>
            <button className={styles.secondaryButton} type="button" onClick={() => addCostItem(true)}>复制上一条</button>
          </div>
        ) : null}
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          关联订单
          <SearchAutocomplete
            value={selectedOrder || null}
            disabled={editMode}
            cacheKey="cost-orders"
            emptyLabel="未找到订单"
            placeholder="输入订单号 / 提单号 / 客户简称"
            getLabel={orderLabel}
            getDescription={customerLegalName}
            search={searchOrders}
            onSelect={handleOrderSelect}
          />
        </label>
      </div>

      <div className={styles.documentGroupCard}>
        <strong>成本明细</strong>
        {items.map((item, index) => {
          const selectedSupplier = supplierOptions.find((supplier) => supplier.id === item.supplierId) || null;
          const forceCny = !FOREIGN_CURRENCY_COST_TYPES.includes(item.costType);
          const paymentLocked = isProductSupplierPaymentFormLocked(item, selectedSupplier, canManageFactoryPayments);
          return (
            <div className={styles.documentGroupCard} key={item.localId}>
              <div className={styles.quickCreateHeader}>
                <div>
                  <strong>第 {index + 1} 条成本</strong>
                  <span>{selectedSupplier ? supplierLabel(selectedSupplier) : "请选择供应商"}</span>
                </div>
                {!editMode && items.length > 1 ? (
                  <button className={styles.secondaryButton} type="button" onClick={() => removeCostItem(item.localId)}>删除此条</button>
                ) : null}
              </div>
              <div className={styles.reportFilterGrid}>
                <label>
                  供应商
                  <SearchAutocomplete
                    value={selectedSupplier}
                    cacheKey={`cost-suppliers:${FACTORY_COST_TYPES.includes(item.costType) ? "factory" : "all"}:${item.localId}`}
                    emptyLabel="未找到匹配供应商，可先到系统设置新增供应商"
                    placeholder={FACTORY_COST_TYPES.includes(item.costType) ? "输入产品供应商 / 开票名称 / 税号" : "输入供应商 / 类型 / 开票名称 / 税号"}
                    getLabel={supplierLabel}
                    getDescription={(supplier) => supplier.invoiceTitle || supplier.supplierType || ""}
                    search={(keyword) => searchSuppliers(keyword, item.costType)}
                    onSelect={(supplier) => handleSupplierSelect(item.localId, supplier)}
                  />
                </label>
                <label>
                  成本类型
                  <select value={item.costType} onChange={(event) => void handleCostTypeChange(item.localId, event.target.value)}>
                    {QUICK_COST_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label>
                  成本金额
                  <input value={item.amount} onChange={(event) => setItemValue(item.localId, "amount", event.target.value)} inputMode="decimal" required />
                </label>
                <label>
                  币种
                  <select value={item.currency} onChange={(event) => void handleCurrencyChange(item.localId, event.target.value)} disabled={forceCny}>
                    {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                </label>
                <label>
                  汇率
                  <input
                    value={item.exchangeRate}
                    onChange={(event) => setItemValue(item.localId, "exchangeRate", event.target.value)}
                    readOnly={item.currency === "CNY"}
                    inputMode="decimal"
                    required
                  />
                </label>
                <label>
                  付款状态
                  <select value={item.paymentStatus} disabled={paymentLocked} onChange={(event) => setItemValue(item.localId, "paymentStatus", event.target.value)}>
                    {COST_PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
                {item.paymentStatus === "已支付" ? (
                  <label>
                    付款日期
                    <input
                      value={item.paymentDate}
                      onChange={(event) => setItemValue(item.localId, "paymentDate", event.target.value)}
                      type="date"
                      disabled={paymentLocked}
                      required
                    />
                  </label>
                ) : null}
                <label>
                  成本确认
                  <select value={item.costConfirmed} onChange={(event) => setItemValue(item.localId, "costConfirmed", event.target.value)}>
                    {COST_CONFIRMATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  备注
                  <input value={item.remark} onChange={(event) => setItemValue(item.localId, "remark", event.target.value)} placeholder="可选" />
                </label>
              </div>
              <div className={styles.quickCreateMeta}>
                <span>供应商：{selectedSupplier ? supplierLabel(selectedSupplier) : "-"}</span>
                <span>{exchangeMetaByItem[item.localId] || "汇率来源：待获取"}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.quickCreateMeta}>
        <span>订单：{selectedOrder ? orderLabel(selectedOrder) : "-"}</span>
        <span>成本条数：{items.length}</span>
      </div>

      <div className={`${styles.detailActions} ${drawerMode ? styles.drawerFormActions : ""}`}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : editMode ? "更新成本" : `保存 ${items.length} 条成本`}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}

