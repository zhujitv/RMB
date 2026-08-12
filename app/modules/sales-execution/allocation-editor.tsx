"use client";

import { SearchAutocomplete } from "../../SearchAutocomplete";
import shell from "../../WorkspaceShell.module.css";
import { allocationIsExact, lineAllocatedQuantity, linePendingQuantity } from "./draft-utils";
import styles from "./sales-execution.module.css";
import { emptyAllocation, filterSupplierOptions, SALES_CURRENCIES, supplierName, type AllocationDraft, type SalesLineDraft, type SupplierOption } from "./types";

function balanceClass(line: SalesLineDraft) {
  const pending = linePendingQuantity(line);
  if (Math.abs(pending) < 0.000001) return styles.balanceExact;
  return pending > 0 ? styles.balancePending : styles.balanceOver;
}

function balanceText(line: SalesLineDraft) {
  const pending = linePendingQuantity(line);
  if (Math.abs(pending) < 0.000001) return "已精确分配";
  return pending > 0
    ? `待分配 ${pending.toLocaleString("zh-CN")}`
    : `超出 ${Math.abs(pending).toLocaleString("zh-CN")}`;
}

function FactorySearch({
  allocation,
  index,
  suppliers,
  disabled,
  onSelect,
}: {
  allocation: AllocationDraft;
  index: number;
  suppliers: SupplierOption[];
  disabled: boolean;
  onSelect: (supplierId: string) => void;
}) {
  const selectedSupplier = suppliers.find((supplier) => supplier.id === allocation.supplierId) || null;

  return (
    <label>
      工厂 {index + 1}
      <SearchAutocomplete
        value={selectedSupplier}
        disabled={disabled}
        cacheKey={`sales-execution-factories:${suppliers.map((supplier) => `${supplier.id}:${supplierName(supplier)}:${supplier.supplierType || ""}`).join("|")}`}
        emptyLabel="未找到匹配工厂，请先到系统设置维护产品供应商"
        placeholder="输入工厂名称模糊查找"
        getLabel={supplierName}
        getDescription={(supplier) => supplier.supplierType || "产品供应商"}
        search={(keyword) => Promise.resolve(filterSupplierOptions(suppliers, keyword))}
        onSelect={(supplier) => onSelect(supplier.id)}
        onSelectedValueInvalidated={() => onSelect("")}
      />
    </label>
  );
}

export function AllocationEditor({
  line,
  suppliers,
  disabled,
  onChange,
}: {
  line: SalesLineDraft;
  suppliers: SupplierOption[];
  disabled: boolean;
  onChange: (allocations: AllocationDraft[]) => void;
}) {
  function updateAllocation(key: string, patch: Partial<AllocationDraft>) {
    onChange(line.allocations.map((allocation) => allocation.key === key ? { ...allocation, ...patch } : allocation));
  }

  return (
    <div className={styles.allocationPanel}>
      <div className={styles.allocationHeader}>
        <div className={styles.allocationTitle}>
          <strong>工厂采购分配</strong>
          <small>采购价可留空等供应商回填，只供内部核算和工厂采购草稿使用。</small>
        </div>
        <div className={styles.allocationBalance}>
          <span>销售数量 {Number(line.quantity || 0).toLocaleString("zh-CN")}</span>
          <span>已分配 {lineAllocatedQuantity(line).toLocaleString("zh-CN")}</span>
          <strong className={balanceClass(line)}>{balanceText(line)}</strong>
          <button
            className={shell.secondaryButton}
            type="button"
            disabled={disabled}
            onClick={() => onChange([...line.allocations, emptyAllocation(line.id || "")])}
          >
            增加工厂
          </button>
        </div>
      </div>

      {line.allocations.map((allocation, index) => {
        return (
          <div className={styles.allocationRow} key={allocation.key}>
            <FactorySearch
              allocation={allocation}
              index={index}
              suppliers={suppliers}
              disabled={disabled}
              onSelect={(supplierId) => updateAllocation(allocation.key, { supplierId })}
            />
            <label>
              采购币种
              <select value={allocation.purchaseCurrency} disabled={disabled} onChange={(event) => updateAllocation(allocation.key, { purchaseCurrency: event.target.value })}>
                {SALES_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </label>
            <label>
              分配数量
              <input type="number" min="0" step="0.0001" value={allocation.allocatedQuantity} disabled={disabled} onChange={(event) => updateAllocation(allocation.key, { allocatedQuantity: event.target.value })} />
            </label>
            <label>
              采购单价{allocation.purchaseUnitPrice.trim() ? "（可后补）" : "（待供应商回填）"}
              <input type="number" min="0" step="0.0001" value={allocation.purchaseUnitPrice} disabled={disabled} placeholder="待供应商回填" onChange={(event) => updateAllocation(allocation.key, { purchaseUnitPrice: event.target.value })} />
            </label>
            <label>
              工厂备注
              <input value={allocation.remark} disabled={disabled} placeholder="颜色、包装等" onChange={(event) => updateAllocation(allocation.key, { remark: event.target.value })} />
            </label>
            <button
              className={shell.ghostButton}
              type="button"
              disabled={disabled || line.allocations.length <= 1}
              onClick={() => onChange(line.allocations.filter((item) => item.key !== allocation.key))}
            >
              移除
            </button>
          </div>
        );
      })}
      {!allocationIsExact(line) ? <small className={styles.fieldHint}>保存前，所有工厂分配数量之和必须与本行销售数量完全一致。</small> : null}
    </div>
  );
}
