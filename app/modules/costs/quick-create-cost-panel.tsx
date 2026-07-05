import { preventEnterFormSubmit } from "../../formGuards";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import { customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import {
  COST_CONFIRMATION_OPTIONS,
  COST_PAYMENT_STATUSES,
  CURRENCIES,
  FOREIGN_CURRENCY_COST_TYPES,
  QUICK_COST_TYPES,
  type CostRow,
} from "./model";
import {
  isProductSupplierPaymentFormLocked,
  orderLabel,
  supplierLabel,
} from "./helpers";
import { useQuickCostForm } from "./use-quick-cost-form";

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
  onSaved: (saved?: CostRow | CostRow[] | null) => void | Promise<void>;
}) {
  const controller = useQuickCostForm({
    initialCost,
    canManageFactoryPayments,
    onSaved,
  });

  return (
    <form
      className={`${styles.quickCreatePanel} ${drawerMode ? styles.quickCreatePanelInDrawer : ""}`}
      onKeyDown={preventEnterFormSubmit}
      onSubmit={controller.submitQuickCost}
    >
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{controller.editMode ? "编辑成本" : "批量登记成本"}</strong>
        </div>
        {!controller.editMode ? (
          <div className={styles.detailActions}>
            <button className={styles.secondaryButton} type="button" onClick={() => controller.addCostItem(false)}>添加一条</button>
            <button className={styles.secondaryButton} type="button" onClick={() => controller.addCostItem(true)}>复制上一条</button>
          </div>
        ) : null}
      </div>

      {controller.message ? <div className={styles.inlineError}>{controller.message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          关联订单
          <SearchAutocomplete
            value={controller.selectedOrder || null}
            disabled={controller.editMode}
            cacheKey="cost-orders"
            emptyLabel="未找到订单"
            placeholder="输入订单号 / 提单号 / 客户简称"
            getLabel={orderLabel}
            getDescription={customerLegalName}
            search={controller.searchOrders}
            onSelect={controller.handleOrderSelect}
          />
        </label>
      </div>

      <div className={styles.documentGroupCard}>
        <strong>成本明细</strong>
        {controller.items.map((item, index) => {
          const selectedSupplier = controller.supplierOptions.find((supplier) => supplier.id === item.supplierId) || null;
          const forceCny = !FOREIGN_CURRENCY_COST_TYPES.includes(item.costType);
          const paymentLocked = isProductSupplierPaymentFormLocked(item, selectedSupplier, canManageFactoryPayments);
          return (
            <div className={styles.documentGroupCard} key={item.localId}>
              <div className={styles.quickCreateHeader}>
                <div>
                  <strong>第 {index + 1} 条成本</strong>
                  <span>{selectedSupplier ? supplierLabel(selectedSupplier) : "-"}</span>
                </div>
              </div>
              <div className={styles.reportFilterGrid}>
                <label>
                  供应商
                  <SearchAutocomplete
                    value={selectedSupplier}
                    cacheKey={`cost-suppliers:${item.costType}:${item.localId}`}
                    emptyLabel="未找到匹配供应商，可先到系统设置新增供应商"
                    placeholder="输入供应商 / 类型 / 开票名称 / 税号"
                    getLabel={supplierLabel}
                    getDescription={(supplier) => supplier.invoiceTitle || supplier.supplierType || ""}
                    search={(keyword) => controller.searchSuppliers(keyword, item.costType)}
                    onSelect={(supplier) => controller.handleSupplierSelect(item.localId, supplier)}
                  />
                </label>
                <label>
                  成本类型
                  <select value={item.costType} onChange={(event) => void controller.handleCostTypeChange(item.localId, event.target.value)}>
                    {QUICK_COST_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label>
                  成本金额
                  <input value={item.amount} onChange={(event) => controller.setItemValue(item.localId, "amount", event.target.value)} inputMode="decimal" required />
                </label>
                <label>
                  币种
                  <select value={item.currency} onChange={(event) => void controller.handleCurrencyChange(item.localId, event.target.value)} disabled={forceCny}>
                    {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                </label>
                <label>
                  汇率
                  <input
                    value={item.exchangeRate}
                    onChange={(event) => controller.setItemValue(item.localId, "exchangeRate", event.target.value)}
                    readOnly={item.currency === "CNY"}
                    inputMode="decimal"
                    required
                  />
                </label>
                <label>
                  付款状态
                  <select value={item.paymentStatus} disabled={paymentLocked} onChange={(event) => controller.setItemValue(item.localId, "paymentStatus", event.target.value)}>
                    {COST_PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
                {item.paymentStatus === "已支付" ? (
                  <label>
                    付款日期
                    <input
                      value={item.paymentDate}
                      onChange={(event) => void controller.handlePaymentDateChange(item.localId, event.target.value)}
                      type="date"
                      disabled={paymentLocked}
                      required
                    />
                  </label>
                ) : null}
                <label>
                  成本确认
                  <select value={item.costConfirmed} onChange={(event) => controller.setItemValue(item.localId, "costConfirmed", event.target.value)}>
                    {COST_CONFIRMATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  备注
                  <input value={item.remark} onChange={(event) => controller.setItemValue(item.localId, "remark", event.target.value)} placeholder="可选" />
                </label>
              </div>
              <div className={styles.quickCreateMeta}>
                <span>供应商：{selectedSupplier ? supplierLabel(selectedSupplier) : "-"}</span>
                <span>{controller.exchangeMetaByItem[item.localId] || "汇率来源：待获取"}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.quickCreateMeta}>
        <span>订单：{controller.selectedOrder ? orderLabel(controller.selectedOrder) : "-"}</span>
        <span>成本条数：{controller.items.length}</span>
      </div>

      <div className={`${styles.detailActions} ${drawerMode ? styles.drawerFormActions : ""}`}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={controller.saving}>
          {controller.saving ? "保存中..." : controller.editMode ? "更新成本" : `保存 ${controller.items.length} 条成本`}
        </button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={controller.saving}>取消</button>
      </div>
    </form>
  );
}
