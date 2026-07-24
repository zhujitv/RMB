import { DetailField } from "../../components";
import { preventEnterFormSubmit } from "../../formGuards";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import { customerDisplayName, customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { CURRENCIES, type ExpenseForm, type ExpenseItemForm, type ExpenseOrderOption, type SupplierOption } from "./model";
import {
  containerSummaryText,
  filterLogisticsFeeSuppliers,
  formatOriginalCurrencyAccounting,
  lineSubtotal,
  LogisticsCurrencyAmountList,
  orderLabel,
  supplierLabel,
} from "./shared";

export function LogisticsExpenseFormView({
  form,
  message,
  saving,
  selectedOrder,
  selectedSupplier,
  isLockedSupplier,
  canSelectTemporarySupplier,
  supplierSummaryText,
  supplierAllowedCostTypes,
  costTypeOptions,
  formCurrencySummary,
  searchOrders,
  searchSuppliers,
  onOrderSelect,
  onSupplierSelect,
  onItemCostTypeChange,
  onItemCurrencyChange,
  onItemFieldChange,
  onAddItem,
  onRemoveItem,
  onSubmitExpense,
  onCancel,
}: {
  form: ExpenseForm;
  message: string;
  saving: boolean;
  selectedOrder: ExpenseOrderOption | undefined;
  selectedSupplier: SupplierOption | null;
  isLockedSupplier: boolean;
  canSelectTemporarySupplier: boolean;
  supplierSummaryText: string;
  supplierAllowedCostTypes: string;
  costTypeOptions: string[];
  formCurrencySummary: Parameters<typeof LogisticsCurrencyAmountList>[0]["summary"];
  searchOrders: (keyword: string) => Promise<ExpenseOrderOption[]>;
  searchSuppliers: (keyword: string) => Promise<SupplierOption[]>;
  onOrderSelect: (order: ExpenseOrderOption) => void;
  onSupplierSelect: (supplier: SupplierOption) => void;
  onItemCostTypeChange: (index: number, costType: string) => void;
  onItemCurrencyChange: (index: number, currency: string) => void;
  onItemFieldChange: <K extends keyof ExpenseItemForm>(index: number, key: K, value: ExpenseItemForm[K]) => void;
  onAddItem: (copyLast?: boolean) => void;
  onRemoveItem: (index: number) => void;
  onSubmitExpense: (auditStatus: "草稿" | "待审核") => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <form
      className={styles.quickCreatePanel}
      onKeyDown={preventEnterFormSubmit}
      onSubmit={(event) => {
        event.preventDefault();
      }}
      inert={saving}
      aria-busy={saving}
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
              if (isLockedSupplier) return customerLegalName(order);
              const supplierCount = filterLogisticsFeeSuppliers(order.logisticsSuppliers || []).length;
              return `${customerLegalName(order)}${supplierCount ? ` · 已绑定 ${supplierCount} 家物流供应商` : ""}`;
            }}
            search={searchOrders}
            onSelect={onOrderSelect}
          />
        </label>
        {!isLockedSupplier ? (
          <label>
            供应商
            <SearchAutocomplete
              value={selectedSupplier || null}
              cacheKey={`logistics-fee-suppliers:${form.orderId || "none"}`}
              emptyLabel={selectedOrder ? (canSelectTemporarySupplier ? "未找到启用的物流类供应商" : "该订单未分配物流相关供应商") : "请先选择订单"}
              placeholder={selectedOrder ? (canSelectTemporarySupplier ? "选择订单绑定或临时物流供应商" : "选择该订单绑定物流相关供应商") : "请先选择订单"}
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
              onSelect={onSupplierSelect}
            />
          </label>
        ) : null}
      </div>
      {selectedOrder ? (
        <div className={styles.detailGrid}>
          <DetailField label="订单号" value={selectedOrder.orderNo || "-"} />
          <DetailField label="提单号" value={selectedOrder.blNo || selectedOrder.billOfLadingNo || "-"} />
          <DetailField label="客户简称" value={customerDisplayName(selectedOrder)} />
          <DetailField label="集装箱" value={containerSummaryText(selectedOrder)} />
          <DetailField label="车牌" value={selectedOrder.truckPlateNo || "-"} />
          <DetailField label="货物" value={selectedOrder.cargoName || "-"} wide />
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
            <span>适用数量</span>
            <span>单价/金额</span>
            <span>币种</span>
            <span>汇率</span>
            <span>小计</span>
            <span>备注</span>
            <span>操作</span>
          </div>
          {form.items.map((item, index) => (
            <div className={styles.logisticsItemsRow} key={`${index}-${item.costType}`}>
              <select value={item.costType} onChange={(event) => onItemCostTypeChange(index, event.target.value)}>
                {costTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {logisticsCostTypeLabel(type)}
                  </option>
                ))}
              </select>
              <input
                value={item.appliedContainerCount}
                onChange={(event) => onItemFieldChange(index, "appliedContainerCount", event.target.value)}
                type="number"
                min="1"
                step="1"
                inputMode="decimal"
                required
              />
              <input value={item.amount} onChange={(event) => onItemFieldChange(index, "amount", event.target.value)} inputMode="decimal" required />
              <select value={item.currency} onChange={(event) => onItemCurrencyChange(index, event.target.value)}>
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
              <input
                value={item.exchangeRate}
                onChange={(event) => onItemFieldChange(index, "exchangeRate", event.target.value)}
                readOnly={item.currency === "CNY"}
                inputMode="decimal"
                required
              />
              <strong>{formatOriginalCurrencyAccounting(item.currency, lineSubtotal(item))}</strong>
              <input value={item.remark} onChange={(event) => onItemFieldChange(index, "remark", event.target.value)} placeholder="可选" />
              <button className={styles.secondaryButton} type="button" disabled={form.items.length <= 1} onClick={() => onRemoveItem(index)}>
                删除
              </button>
            </div>
          ))}
          <div className={styles.logisticsItemsInlineActions}>
            <button className={styles.secondaryButton} type="button" onKeyDown={preventEnterFormSubmit} onClick={() => onAddItem(false)}>
              添加费用
            </button>
            <button className={styles.secondaryButton} type="button" onKeyDown={preventEnterFormSubmit} onClick={() => onAddItem(true)}>
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
          {canSelectTemporarySupplier ? <span>可选择订单绑定或临时物流供应商</span> : null}
          {supplierAllowedCostTypes ? <span>允许费用：{supplierAllowedCostTypes}</span> : null}
        </div>
      ) : null}
      <div className={styles.detailActions}>
        <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => void onSubmitExpense("草稿")}>
          {saving ? "保存中..." : "保存草稿"}
        </button>
        <button className={styles.primaryButtonCompact} type="button" disabled={saving} onKeyDown={preventEnterFormSubmit} onClick={() => void onSubmitExpense("待审核")}>
          {saving ? "提交中..." : "提交审核"}
        </button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>
          取消
        </button>
      </div>
    </form>
  );
}
