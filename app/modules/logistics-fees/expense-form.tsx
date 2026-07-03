import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import { DetailField } from "../../components";
import { preventEnterFormSubmit } from "../../formGuards";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import { customerDisplayName, customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import {
  logisticsCostTypeDefaultCurrency,
  logisticsCostTypeLabel,
  logisticsCostTypeRequiresDeclarationScope,
} from "../../../lib/platform/logistics-cost-types";
import {
  CURRENCIES,
  DEFAULT_BILLING_METHOD,
  LOGISTICS_EXPENSE_ALLOCATION_METHODS,
  emptyExpenseForm,
  emptyExpenseItem,
  type ExchangeRateResponse,
  type ExpenseForm,
  type ExpenseItemForm,
  type ExpenseOrderOption,
  type SupplierOption,
} from "./model";
import {
  allowedCostTypeOptions,
  containerSummaryText,
  customsDeclarationLabel,
  filterLogisticsFeeSuppliers,
  formatOriginalCurrencyAccounting,
  lineSubtotal,
  logisticsExpenseFormCurrencySummary,
  LogisticsCurrencyAmountList,
  mergeOrders,
  mergeSuppliers,
  normalizeExpenseItemCostType,
  normalizeExpenseOrder,
  orderLabel,
  supplierLabel,
  validBillingQuantity,
} from "./shared";

export function LogisticsExpenseForm({
  onCancel,
  onSaved,
  initialOrder,
  currentUserRole = "",
  currentUserSupplierId = "",
}: {
  onCancel: () => void;
  onSaved: (message?: string) => void;
  initialOrder?: Partial<ExpenseOrderOption> | null;
  currentUserRole?: string;
  currentUserSupplierId?: string;
}) {
  const normalizedInitialOrder = initialOrder
    ? normalizeExpenseOrder(initialOrder)
    : null;
  const initialOrderId = normalizedInitialOrder?.id || "";
  const initialSuppliers = normalizedInitialOrder?.logisticsSuppliers || [];
  const isLockedSupplier =
    currentUserRole === "物流供应商" && Boolean(currentUserSupplierId);
  const [form, setForm] = useState<ExpenseForm>(() => ({
    ...emptyExpenseForm,
    orderId: initialOrderId,
    supplierId: isLockedSupplier
      ? currentUserSupplierId
      : initialSuppliers.length === 1
        ? initialSuppliers[0].id
        : "",
    items: [emptyExpenseItem()],
  }));
  const [orders, setOrders] = useState<ExpenseOrderOption[]>(() =>
    normalizedInitialOrder ? [normalizedInitialOrder] : [],
  );
  const [suppliers, setSuppliers] = useState<SupplierOption[]>(
    () => initialSuppliers,
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (initialOrder) {
      const order = normalizeExpenseOrder(initialOrder);
      const orderSuppliers = order.logisticsSuppliers || [];
      setOrders([order]);
      setSuppliers(orderSuppliers);
      setForm((current) => ({
        ...current,
        orderId: order.id,
        supplierId: isLockedSupplier
          ? currentUserSupplierId
          : orderSuppliers.length === 1
            ? orderSuppliers[0].id
            : orderSuppliers.some(
                  (supplier) => supplier.id === current.supplierId,
                )
              ? current.supplierId
              : "",
        items: current.items.map((item) =>
          normalizeItemOwnershipForOrder(item, order),
        ),
      }));
    }
  }, [initialOrder, isLockedSupplier, currentUserSupplierId]);

  useEffect(() => {
    if (!isLockedSupplier) return;
    setForm((current) => ({ ...current, supplierId: currentUserSupplierId }));
  }, [isLockedSupplier, currentUserSupplierId]);

  async function searchOrders(nextKeyword: string) {
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<{ rows: ExpenseOrderOption[] }>(
        `/api/logistics-costs/orders${params.size ? `?${params}` : ""}`,
      );
      const rows = (Array.isArray(result.rows) ? result.rows : []).map(
        (order) => normalizeExpenseOrder(order),
      );
      setOrders((current) => mergeOrders(current, rows));
      return rows;
    } catch (orderError) {
      setMessage(
        orderError instanceof Error ? orderError.message : "读取可录入订单失败",
      );
      return [];
    }
  }

  async function searchSuppliers(nextKeyword: string) {
    setMessage("");
    const selected = orders.find((order) => order.id === form.orderId);
    const orderSuppliers = filterLogisticsFeeSuppliers(
      selected?.logisticsSuppliers || [],
    );
    if (!selected) {
      setMessage("请先选择关联订单");
      return [];
    }
    setSuppliers((current) => mergeSuppliers(current, orderSuppliers));
    const keyword = nextKeyword.trim().toLowerCase();
    if (!keyword) return orderSuppliers;
    return orderSuppliers.filter((supplier) =>
      [supplier.supplierName, supplier.name, supplier.supplierType].some(
        (value) =>
          String(value || "")
            .toLowerCase()
            .includes(keyword),
      ),
    );
  }

  function setField<K extends keyof ExpenseForm>(
    key: K,
    value: ExpenseForm[K],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function resolveExpenseItemExchangeRate(
    index: number,
    currency: string,
  ) {
    const normalized = String(currency || "CNY").toUpperCase();
    if (normalized === "CNY") {
      setForm((current) => ({
        ...current,
        items: current.items.map((item, itemIndex) =>
          itemIndex === index
            ? { ...item, currency: "CNY", exchangeRate: "1" }
            : item,
        ),
      }));
      return;
    }
    try {
      const result = await apiJson<ExchangeRateResponse>(
        `/api/exchange-rates?${new URLSearchParams({ currency: normalized })}`,
      );
      const rate = Number(
        result.rate?.rateToCny ??
          result.rate?.exchangeRate ??
          result.rate?.rate ??
          0,
      );
      if (rate > 0) {
        setForm((current) => ({
          ...current,
          items: current.items.map((item, itemIndex) =>
            itemIndex === index
              ? { ...item, currency: normalized, exchangeRate: String(rate) }
              : item,
          ),
        }));
      } else {
        setMessage(`${normalized} 系统汇率未配置，请先刷新汇率。`);
      }
    } catch (rateError) {
      setMessage(
        rateError instanceof Error
          ? rateError.message
          : `${normalized} 汇率获取失败，请先刷新汇率。`,
      );
    }
  }

  function setItemField<K extends keyof ExpenseItemForm>(
    index: number,
    key: K,
    value: ExpenseItemForm[K],
  ) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [key]: value,
              ...(key === "currency" && value === "CNY"
                ? { exchangeRate: "1" }
                : {}),
            }
          : item,
      ),
    }));
  }

  function normalizeItemOwnershipForOrder(
    item: ExpenseItemForm,
    order: ExpenseOrderOption,
  ): ExpenseItemForm {
    const declarations = order.customsDeclarations || [];
    if (item.ownershipScope !== "DECLARATION") {
      return { ...item, customsDeclarationId: "", allocatedAmount: "" };
    }
    if (declarations.some((declaration) => declaration.id === item.customsDeclarationId)) {
      return item;
    }
    const fallbackDeclarationId = declarations.length === 1 ? declarations[0]?.id || "" : "";
    return fallbackDeclarationId
      ? { ...item, customsDeclarationId: fallbackDeclarationId }
      : !declarations.length
        ? {
            ...item,
            ownershipScope: "SHIPMENT",
            customsDeclarationId: "",
            allocationMethod: "",
            allocatedAmount: "",
          }
      : {
          ...item,
          customsDeclarationId: "",
          allocationMethod: "",
          allocatedAmount: "",
        };
  }

  function handleOwnershipScopeChange(index: number, scope: ExpenseItemForm["ownershipScope"]) {
    const declarations = selectedOrder?.customsDeclarations || [];
    const defaultDeclarationId = declarations.length === 1 ? declarations[0]?.id || "" : "";
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              ownershipScope: scope,
              customsDeclarationId:
                scope === "DECLARATION"
                  ? item.customsDeclarationId || defaultDeclarationId
                  : "",
              allocationMethod: "",
              allocatedAmount: "",
            }
          : item,
      ),
    }));
  }

  function handleItemCostTypeChange(index: number, costType: string) {
    const defaultCurrency = logisticsCostTypeDefaultCurrency(costType);
    const declarationScoped = logisticsCostTypeRequiresDeclarationScope(costType)
      && (selectedOrder?.customsDeclarations || []).length > 1;
    const declarations = selectedOrder?.customsDeclarations || [];
    const defaultDeclarationId = declarations.length === 1 ? declarations[0]?.id || "" : "";
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              costType,
              ownershipScope: declarationScoped ? "DECLARATION" : item.ownershipScope,
              customsDeclarationId: declarationScoped
                ? item.customsDeclarationId || defaultDeclarationId
                : item.customsDeclarationId,
              allocationMethod: declarationScoped ? "" : item.allocationMethod,
              allocatedAmount: declarationScoped ? "" : item.allocatedAmount,
              currency: item.currencyTouched ? item.currency : defaultCurrency,
              exchangeRate: item.currencyTouched
                ? item.exchangeRate
                : defaultCurrency === "CNY"
                  ? "1"
                  : "",
            }
          : item,
      ),
    }));
    const currentItem = form.items[index];
    if (!currentItem?.currencyTouched && defaultCurrency !== "CNY")
      void resolveExpenseItemExchangeRate(index, defaultCurrency);
  }

  function handleItemCurrencyChange(index: number, currency: string) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, currency, currencyTouched: true }
          : item,
      ),
    }));
    void resolveExpenseItemExchangeRate(index, currency);
  }

  function addExpenseItem(copyLast = false) {
    setForm((current) => {
      const lastItem = current.items[current.items.length - 1];
      return {
        ...current,
        items: [
          ...current.items,
          copyLast && lastItem
            ? { ...lastItem, amount: "", allocatedAmount: "", remark: "" }
            : emptyExpenseItem(),
        ],
      };
    });
  }

  function removeExpenseItem(index: number) {
    setForm((current) => ({
      ...current,
      items:
        current.items.length > 1
          ? current.items.filter((_, itemIndex) => itemIndex !== index)
          : current.items,
    }));
  }

  function handleOrderSelect(order: ExpenseOrderOption) {
    const normalizedOrder = normalizeExpenseOrder(order);
    const orderSuppliers = filterLogisticsFeeSuppliers(
      normalizedOrder.logisticsSuppliers || [],
    );
    const nextSupplierId = isLockedSupplier
      ? currentUserSupplierId
      : orderSuppliers.length === 1
        ? orderSuppliers[0].id
        : "";
    const nextSupplier =
      orderSuppliers.find((supplier) => supplier.id === nextSupplierId) || null;
    const nextCostTypes = allowedCostTypeOptions(
      nextSupplier,
      isLockedSupplier,
    );
    setOrders((current) => mergeOrders(current, [normalizedOrder]));
    setSuppliers((current) => mergeSuppliers(current, orderSuppliers));
    const availableSupplierIds = new Set(
      orderSuppliers.map((supplier) => supplier.id),
    );
    setForm((current) => ({
      ...current,
      orderId: normalizedOrder.id,
      supplierId:
        nextSupplierId ||
        (current.supplierId && availableSupplierIds.has(current.supplierId)
          ? current.supplierId
          : ""),
      items: current.items.map((item) =>
        normalizeItemOwnershipForOrder(
          normalizeExpenseItemCostType(item, nextCostTypes),
          normalizedOrder,
        ),
      ),
    }));
  }

  async function submitExpense(auditStatus: "草稿" | "待审核") {
    if (!form.orderId) {
      setMessage("请选择关联订单");
      return;
    }
    const normalizedItems = form.items.map((item) => {
      const allocatedAmountText = item.allocatedAmount.trim();
      return {
        ownershipScope: item.ownershipScope,
        customsDeclarationId:
          item.ownershipScope === "DECLARATION"
            ? item.customsDeclarationId
            : "",
        allocationMethod:
          item.ownershipScope === "SHIPMENT"
            ? item.allocationMethod
            : allocatedAmountText
              ? "手工金额"
              : item.allocationMethod,
        allocatedAmount:
          item.ownershipScope === "DECLARATION" && allocatedAmountText
            ? Number(allocatedAmountText)
            : item.ownershipScope === "SHIPMENT"
              ? null
              : undefined,
        costType: item.costType,
        billingMethod: DEFAULT_BILLING_METHOD,
        amount: lineSubtotal(item),
        billingQuantity: Number(item.appliedContainerCount || 1),
        appliedContainerCount: Number(item.appliedContainerCount || 1),
        currency: item.currency,
        exchangeRate: Number(item.exchangeRate),
        remark: item.remark.trim(),
      };
    });
    const declarationIds = new Set(
      (selectedOrder?.customsDeclarations || []).map((declaration) => declaration.id),
    );
    const hasMultipleDeclarations = declarationIds.size > 1;
    const ownershipErrorIndex = normalizedItems.findIndex((item) => (
      item.ownershipScope === "DECLARATION"
      && (!item.customsDeclarationId || !declarationIds.has(item.customsDeclarationId))
    ));
    if (ownershipErrorIndex >= 0) {
      setMessage(`请为第 ${ownershipErrorIndex + 1} 行选择有效报关批次`);
      return;
    }
    const shipmentAllocationMissingIndex = normalizedItems.findIndex((item) => (
      hasMultipleDeclarations
      && item.ownershipScope === "SHIPMENT"
      && !item.allocationMethod
    ));
    if (shipmentAllocationMissingIndex >= 0) {
      setMessage(`一票提单多次报关时，请为第 ${shipmentAllocationMissingIndex + 1} 行整票费用选择分摊方式`);
      return;
    }
    const manualAllocationMissingIndex = normalizedItems.findIndex((item) => (
      item.ownershipScope === "DECLARATION"
      && item.allocationMethod === "手工金额"
      && item.allocatedAmount == null
    ));
    if (manualAllocationMissingIndex >= 0) {
      setMessage(`请填写第 ${manualAllocationMissingIndex + 1} 行手工分摊金额`);
      return;
    }
    const allocationErrorIndex = normalizedItems.findIndex((item) => (
      item.allocatedAmount != null
      && (!Number.isFinite(item.allocatedAmount) || item.allocatedAmount < 0 || item.allocatedAmount - item.amount > 0.01)
    ));
    if (allocationErrorIndex >= 0) {
      setMessage(`第 ${allocationErrorIndex + 1} 行分摊金额必须大于等于 0，且不能超过小计`);
      return;
    }
    const invalidIndex = normalizedItems.findIndex(
      (item) =>
        !item.costType ||
        !item.amount ||
        item.amount <= 0 ||
        !item.currency ||
        !item.exchangeRate ||
        item.exchangeRate <= 0 ||
        !validBillingQuantity(item.appliedContainerCount) ||
        item.appliedContainerCount <= 0,
    );
    if (invalidIndex >= 0) {
      setMessage(
        `请完整填写第 ${invalidIndex + 1} 行费用类型、单价/金额、适用数量、币种和汇率`,
      );
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(
        "/api/logistics-costs",
        {
          method: "POST",
          body: JSON.stringify({
            orderId: form.orderId,
            supplierId: isLockedSupplier
              ? undefined
              : form.supplierId || undefined,
            items: normalizedItems,
            auditStatus,
          }),
        },
      );
      if (result.success !== true)
        throw new Error(result.message || "保存物流费用失败");
      setForm({ ...emptyExpenseForm, items: [emptyExpenseItem()] });
      onSaved(
        result.message ||
          (auditStatus === "草稿"
            ? "物流费用草稿已保存"
            : "物流费用已提交审核"),
      );
    } catch (saveError) {
      setMessage(
        saveError instanceof Error ? saveError.message : "保存物流费用失败",
      );
    } finally {
      setSaving(false);
    }
  }

  const selectedOrder = orders.find((order) => order.id === form.orderId);
  const customsDeclarationOptions = selectedOrder?.customsDeclarations || [];
  const selectedSupplier =
    suppliers.find((supplier) => supplier.id === form.supplierId) || null;
  useEffect(() => {
    const nextCostTypes = allowedCostTypeOptions(
      selectedSupplier,
      isLockedSupplier,
    );
    setForm((current) => {
      const items = current.items.map((item) =>
        normalizeExpenseItemCostType(item, nextCostTypes),
      );
      if (
        items.every(
          (item, index) => item.costType === current.items[index]?.costType,
        )
      )
        return current;
      return { ...current, items };
    });
  }, [selectedSupplier?.id, isLockedSupplier]);
  const supplierSummaryText = selectedSupplier
    ? supplierLabel(selectedSupplier)
    : isLockedSupplier
      ? "加载供应商信息中..."
      : selectedOrder
        ? "未选择"
        : "请先选择订单";
  const supplierAllowedCostTypes = selectedSupplier?.allowedLogisticsCostTypes
    ?.length
    ? selectedSupplier.allowedLogisticsCostTypes
        .map((type) => logisticsCostTypeLabel(type))
        .join(" / ")
    : "";
  const costTypeOptions = allowedCostTypeOptions(
    selectedSupplier,
    isLockedSupplier,
  );
  const formCurrencySummary = logisticsExpenseFormCurrencySummary(form.items);

  return (
    <form
      className={styles.quickCreatePanel}
      onKeyDown={preventEnterFormSubmit}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>新增物流费用</strong>
        </div>
      </div>
      {message ? <div className={styles.inlineError}>{message}</div> : null}
      <div className={styles.reportFilterGrid}>
        <label>
          关联订单
          <SearchAutocomplete
            value={selectedOrder || null}
            cacheKey="logistics-fee-orders"
            emptyLabel="未找到可录入订单"
            placeholder="输入订单号 / 提单号 / 客户简称"
            getLabel={orderLabel}
            getDescription={(order) => {
              if (isLockedSupplier) {
                return customerLegalName(order);
              }
              const supplierCount = filterLogisticsFeeSuppliers(
                order.logisticsSuppliers || [],
              ).length;
              return `${customerLegalName(order)}${supplierCount ? ` · 已绑定 ${supplierCount} 家物流供应商` : ""}`;
            }}
            search={searchOrders}
            onSelect={handleOrderSelect}
          />
        </label>
        {!isLockedSupplier ? (
          <label>
            供应商
            <SearchAutocomplete
              value={selectedSupplier || null}
              cacheKey={`logistics-fee-suppliers:${form.orderId || "none"}`}
              emptyLabel={
                selectedOrder ? "该订单未分配物流相关供应商" : "请先选择订单"
              }
              placeholder={
                selectedOrder ? "选择该订单绑定物流相关供应商" : "请先选择订单"
              }
              disabled={isLockedSupplier || !selectedOrder}
              searchOnFocus
              getLabel={supplierLabel}
              getDescription={(supplier) => {
                const allowedTypes = supplier.allowedLogisticsCostTypes?.length
                  ? ` · 允许：${supplier.allowedLogisticsCostTypes.join(" / ")}`
                  : "";
                return `${supplier.supplierType || "物流费用供应商"}${allowedTypes}`;
              }}
              search={searchSuppliers}
              onSelect={(supplier) => {
                setSuppliers((current) => mergeSuppliers(current, [supplier]));
                const nextCostTypes = allowedCostTypeOptions(
                  supplier,
                  isLockedSupplier,
                );
                setForm((current) => ({
                  ...current,
                  supplierId: supplier.id,
                  items: current.items.map((item) =>
                    normalizeExpenseItemCostType(item, nextCostTypes),
                  ),
                }));
              }}
            />
          </label>
        ) : null}
      </div>
      {selectedOrder ? (
        <div className={styles.detailGrid}>
          <DetailField label="订单号" value={selectedOrder.orderNo || "-"} />
          <DetailField
            label="提单号"
            value={selectedOrder.blNo || selectedOrder.billOfLadingNo || "-"}
          />
          <DetailField
            label="客户简称"
            value={customerDisplayName(selectedOrder)}
          />
          <DetailField
            label="集装箱"
            value={containerSummaryText(selectedOrder)}
          />
          <DetailField label="车牌" value={selectedOrder.truckPlateNo || "-"} />
          <DetailField
            label="货物"
            value={selectedOrder.cargoName || "-"}
            wide
          />
        </div>
      ) : null}
      <div className={styles.logisticsItemsPanel}>
        <div className={styles.logisticsItemsHeader}>
          <div>
            <strong>费用明细</strong>
          </div>
        </div>
        <div className={styles.logisticsItemsTable}>
          <div className={styles.logisticsItemsHead}>
            <span>费用类型</span>
            <span>费用归属</span>
            <span>报关批次</span>
            <span>分摊方式</span>
            <span>分摊金额</span>
            <span>适用数量</span>
            <span>单价/金额</span>
            <span>币种</span>
            <span>汇率</span>
            <span>小计</span>
            <span>备注</span>
            <span>操作</span>
          </div>
          {form.items.map((item, index) => (
            <div
              className={styles.logisticsItemsRow}
              key={`${index}-${item.costType}`}
            >
              <select
                value={item.costType}
                onChange={(event) =>
                  handleItemCostTypeChange(index, event.target.value)
                }
              >
                {costTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {logisticsCostTypeLabel(type)}
                  </option>
                ))}
              </select>
              <select
                value={item.ownershipScope}
                onChange={(event) =>
                  handleOwnershipScopeChange(
                    index,
                    event.target.value as ExpenseItemForm["ownershipScope"],
                  )
                }
              >
                <option
                  value="SHIPMENT"
                  disabled={logisticsCostTypeRequiresDeclarationScope(item.costType) && customsDeclarationOptions.length > 1}
                >
                  整票提单
                </option>
                <option value="DECLARATION" disabled={!customsDeclarationOptions.length}>
                  指定报关批次
                </option>
              </select>
              <select
                value={item.customsDeclarationId}
                disabled={item.ownershipScope !== "DECLARATION" || !customsDeclarationOptions.length}
                onChange={(event) =>
                  setItemField(index, "customsDeclarationId", event.target.value)
                }
              >
                <option value="">
                  {customsDeclarationOptions.length ? "请选择" : "暂无报关批次"}
                </option>
                {customsDeclarationOptions.map((declaration) => (
                  <option key={declaration.id} value={declaration.id}>
                    {customsDeclarationLabel(declaration)}
                  </option>
                ))}
              </select>
              <select
                value={item.allocationMethod}
                onChange={(event) =>
                  setItemField(index, "allocationMethod", event.target.value)
                }
              >
                <option value="">
                  {item.ownershipScope === "DECLARATION"
                    ? "直接计入"
                    : customsDeclarationOptions.length > 1
                      ? "请选择分摊方式"
                      : "整票费用"}
                </option>
                {(item.ownershipScope === "DECLARATION"
                  ? LOGISTICS_EXPENSE_ALLOCATION_METHODS.filter((method) => method === "手工金额")
                  : LOGISTICS_EXPENSE_ALLOCATION_METHODS.filter((method) => method !== "手工金额")
                ).map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
              <input
                value={item.allocatedAmount}
                disabled={item.ownershipScope !== "DECLARATION"}
                onChange={(event) =>
                  setItemField(index, "allocatedAmount", event.target.value)
                }
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder={item.ownershipScope === "DECLARATION" ? "默认小计" : "-"}
              />
              <input
                value={item.appliedContainerCount}
                onChange={(event) =>
                  setItemField(
                    index,
                    "appliedContainerCount",
                    event.target.value,
                  )
                }
                type="number"
                min="1"
                step="1"
                inputMode="decimal"
                required
              />
              <input
                value={item.amount}
                onChange={(event) =>
                  setItemField(index, "amount", event.target.value)
                }
                inputMode="decimal"
                required
              />
              <select
                value={item.currency}
                onChange={(event) =>
                  handleItemCurrencyChange(index, event.target.value)
                }
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
              <input
                value={item.exchangeRate}
                onChange={(event) =>
                  setItemField(index, "exchangeRate", event.target.value)
                }
                readOnly={item.currency === "CNY"}
                inputMode="decimal"
                required
              />
              <strong>
                {formatOriginalCurrencyAccounting(
                  item.currency,
                  lineSubtotal(item),
                )}
              </strong>
              <input
                value={item.remark}
                onChange={(event) =>
                  setItemField(index, "remark", event.target.value)
                }
                placeholder="可选"
              />
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={form.items.length <= 1}
                onClick={() => removeExpenseItem(index)}
              >
                删除
              </button>
            </div>
          ))}
          <div className={styles.logisticsItemsInlineActions}>
            <button
              className={styles.secondaryButton}
              type="button"
              onKeyDown={preventEnterFormSubmit}
              onClick={() => addExpenseItem(false)}
            >
              添加费用
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onKeyDown={preventEnterFormSubmit}
              onClick={() => addExpenseItem(true)}
            >
              复制上一行
            </button>
          </div>
        </div>
        <div className={styles.logisticsItemsTotal}>
          <LogisticsCurrencyAmountList summary={formCurrencySummary} />
        </div>
      </div>
      {!isLockedSupplier ? (
        <div className={styles.quickCreateMeta}>
          <span>供应商：{supplierSummaryText}</span>
          {supplierAllowedCostTypes ? (
            <span>允许费用：{supplierAllowedCostTypes}</span>
          ) : null}
        </div>
      ) : null}
      <div className={styles.detailActions}>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={saving}
          onClick={() => void submitExpense("草稿")}
        >
          {saving ? "保存中..." : "保存草稿"}
        </button>
        <button
          className={styles.primaryButtonCompact}
          type="button"
          disabled={saving}
          onKeyDown={preventEnterFormSubmit}
          onClick={() => void submitExpense("待审核")}
        >
          {saving ? "提交中..." : "提交审核"}
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onCancel}
          disabled={saving}
        >
          取消
        </button>
      </div>
    </form>
  );
}
