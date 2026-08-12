"use client";

import { formatCurrencyAmount } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import { applyDefaultSupplier, duplicateSalesLine } from "./draft-utils";
import { AllocationEditor } from "./allocation-editor";
import { ProductSuggestionInput } from "./product-suggestion-input";
import styles from "./sales-execution.module.css";
import { emptySalesLine, numeric, type CustomerProduct, type SalesLineDraft, type SupplierOption } from "./types";

export function SalesLinesEditor({
  currency,
  sourceType,
  items,
  products,
  productsLoading,
  productsMessage,
  suppliers,
  defaultSupplierId,
  disabled,
  onChange,
}: {
  currency: string;
  sourceType: string;
  items: SalesLineDraft[];
  products: CustomerProduct[];
  productsLoading: boolean;
  productsMessage: string;
  suppliers: SupplierOption[];
  defaultSupplierId: string;
  disabled: boolean;
  onChange: (items: SalesLineDraft[]) => void;
}) {
  const quotationSource = sourceType === "QUOTATION";

  function updateLine(key: string, patch: Partial<SalesLineDraft>) {
    onChange(items.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function updateQuantity(item: SalesLineDraft, quantity: string) {
    const allocation = item.allocations.length === 1 ? item.allocations[0] : null;
    const followsSalesQuantity = allocation
      && defaultSupplierId
      && (!allocation.supplierId || allocation.supplierId === defaultSupplierId)
      && (!allocation.allocatedQuantity.trim() || allocation.allocatedQuantity.trim() === item.quantity.trim());
    updateLine(item.key, {
      quantity,
      allocations: followsSalesQuantity
        ? [{ ...allocation, supplierId: defaultSupplierId, allocatedQuantity: quantity }]
        : item.allocations,
    });
  }

  return (
    <section className={styles.salesSection}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          <h3>销售明细与工厂分配</h3>
          <small>蓝色区域为客户销售数据；橙色区域为工厂采购数据。两类价格独立保存。</small>
        </div>
        {!quotationSource ? (
          <button className={shell.secondaryButton} type="button" disabled={disabled} onClick={() => onChange(applyDefaultSupplier([...items, emptySalesLine()], defaultSupplierId))}>
            添加销售明细
          </button>
        ) : <span className={`${styles.sourcePill} ${styles.sourceQuote}`}>销售数据来自已接受报价，不可修改</span>}
      </div>

      {items.map((item, index) => (
        <article className={styles.salesLineCard} key={item.key}>
          <div className={styles.salesLineHeader}>
            <strong>销售明细 #{index + 1}</strong>
            {!quotationSource ? (
              <div className={styles.lineActions}>
                <button className={shell.ghostButton} type="button" disabled={disabled} onClick={() => onChange(duplicateSalesLine(items, item.key))}>复制</button>
                <button className={shell.ghostButton} type="button" disabled={disabled || items.length <= 1} onClick={() => onChange(items.filter((line) => line.key !== item.key))}>移除</button>
              </div>
            ) : null}
          </div>

          <div className={styles.salesFields}>
            <label>
              产品描述
              {quotationSource ? (
                <span className={styles.readonlyValue}>{item.name}{item.specification ? ` (${item.specification.replace(/^\(|\)$/g, "")})` : ""}</span>
              ) : (
                <ProductSuggestionInput
                  item={item}
                  currency={currency}
                  products={products}
                  productsLoading={productsLoading}
                  productsMessage={productsMessage}
                  disabled={disabled}
                  onChange={(patch) => updateLine(item.key, patch)}
                />
              )}
            </label>
            <label>
              单位
              <input value={item.unit} disabled={disabled || quotationSource} onChange={(event) => updateLine(item.key, { unit: event.target.value })} />
            </label>
            <label>
              销售数量
              <input type="number" min="0" step="0.0001" value={item.quantity} disabled={disabled || quotationSource} onChange={(event) => updateQuantity(item, event.target.value)} />
            </label>
            <label>
              客户销售单价
              <input
                type="number"
                min="0"
                step="0.0001"
                value={item.salesUnitPrice}
                disabled={disabled || quotationSource}
                onChange={(event) => updateLine(item.key, { salesUnitPrice: event.target.value, salesPriceSource: "manual" })}
              />
            </label>
            <label>
              单件/单套净重 (kg)
              <input
                type="number"
                min="0"
                step="0.0001"
                value={item.unitNetWeightKg}
                disabled={disabled}
                placeholder="可后续补录"
                onChange={(event) => updateLine(item.key, { unitNetWeightKg: event.target.value })}
              />
            </label>
            <label>
              销售金额
              <span className={styles.amountValue}>{formatCurrencyAmount(currency, numeric(item.quantity) * numeric(item.salesUnitPrice))}</span>
            </label>
          </div>

          <AllocationEditor
            line={item}
            suppliers={suppliers}
            disabled={disabled}
            onChange={(allocations) => updateLine(item.key, { allocations })}
          />
        </article>
      ))}
    </section>
  );
}
