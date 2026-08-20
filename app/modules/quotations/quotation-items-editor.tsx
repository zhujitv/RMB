"use client";
import { useMemo, useState, type FocusEvent } from "react";
import { formatCurrencyAmount } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import styles from "./quotation-form.module.css";
import responsive from "./quotation-responsive.module.css";
import { customerProductDescription, customerProductSearchText, customerProductName, duplicateQuotationItemAfter, emptyQuotationItem, quotationItemDescription, quotationLineAmount, type CustomerProduct, type QuotationItemDraft } from "./types";
import { QuotationItemActions } from "./quotation-item-actions";
import { visibleProductDescriptionParts } from "./quotation-product-description-values";
const MAX_SUGGESTIONS = 8;

function matchingProducts(products: CustomerProduct[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return products.slice(0, MAX_SUGGESTIONS);
  return products.filter((product) => (
    customerProductSearchText(product).toLocaleLowerCase().includes(normalizedQuery)
  )).slice(0, MAX_SUGGESTIONS);
}

function latestPrice(product: CustomerProduct, currency: string) {
  const productCurrency = String(product.lastCurrency || "").toUpperCase();
  const requestedCurrency = currency.trim().toUpperCase();
  if (product.lastUnitPrice == null || product.lastUnitPrice === "" || productCurrency !== requestedCurrency) {
    return "";
  }
  return String(product.lastUnitPrice);
}

function ProductDescriptionInput({
  currency,
  item,
  products,
  productsLoading,
  productsMessage,
  disabled,
  onChange,
}: {
  currency: string;
  item: QuotationItemDraft;
  products: CustomerProduct[];
  productsLoading: boolean;
  productsMessage: string;
  disabled: boolean;
  onChange: (patch: Partial<QuotationItemDraft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const description = quotationItemDescription(item);
  const suggestions = useMemo(
    () => matchingProducts(products, description),
    [description, products],
  );
  const listId = `${item.key}-product-suggestions`;

  function suggestionId(product: CustomerProduct) {
    return `${listId}-${product.id}`;
  }

  function closeWhenFocusLeaves(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  }

  function chooseProduct(product: CustomerProduct) {
    const retainedPrice = latestPrice(product, currency);
    const manualPrice = item.unitPriceSource === "manual" ? item.unitPrice : "";
    onChange({
      customerProductId: product.id,
      description: customerProductName(product),
      specification: product.specification || "",
      unit: product.unit || item.unit || "PCS",
      unitPrice: retainedPrice || manualPrice,
      unitPriceSource: retainedPrice ? "history" : manualPrice ? "manual" : "",
      remark: product.remark || item.remark,
    });
    setOpen(false);
    setHighlightedIndex(-1);
  }

  return (
    <div className={styles.productDescriptionControl} onBlur={closeWhenFocusLeaves}>
      <input
        aria-label="产品描述（含规格）"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={open && highlightedIndex >= 0 && suggestions[highlightedIndex]
          ? suggestionId(suggestions[highlightedIndex])
          : undefined}
        role="combobox"
        autoComplete="off"
        value={description}
        disabled={disabled}
        placeholder="例如 Universal panel WPC (24*140*2900 mm)"
        onFocus={() => {
          setOpen(true);
          setHighlightedIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && suggestions.length) {
            event.preventDefault();
            setOpen(true);
            setHighlightedIndex((current) => current >= suggestions.length - 1 ? 0 : current + 1);
          } else if (event.key === "ArrowUp" && suggestions.length) {
            event.preventDefault();
            setOpen(true);
            setHighlightedIndex((current) => current <= 0 ? suggestions.length - 1 : current - 1);
          } else if (event.key === "Enter" && open && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
            event.preventDefault();
            chooseProduct(suggestions[highlightedIndex]);
          } else if (event.key === "Escape") {
            setOpen(false);
            setHighlightedIndex(-1);
          }
        }}
        onChange={(event) => {
          const keepUnitPrice = item.unitPriceSource !== "history";
          const normalized = visibleProductDescriptionParts(event.target.value, item.specification);
          onChange({
            customerProductId: "",
            ...normalized,
            unitPrice: keepUnitPrice ? item.unitPrice : "",
            unitPriceSource: keepUnitPrice ? item.unitPriceSource : "",
          });
          setOpen(true);
          setHighlightedIndex(-1);
        }}
      />

      {open && !disabled ? (
        <div className={styles.productSuggestions} id={listId} role="listbox" aria-label="历史产品建议">
          {productsLoading ? <div className={styles.productSuggestionMessage} role="status" aria-live="polite">正在查找历史产品...</div> : null}
          {!productsLoading && suggestions.map((product, index) => {
            const price = latestPrice(product, currency);
            return (
              <button
                className={styles.productSuggestion}
                id={suggestionId(product)}
                key={product.id}
                type="button"
                role="option"
                aria-selected={highlightedIndex >= 0
                  ? index === highlightedIndex
                  : product.id === item.customerProductId}
                data-product-id={product.id}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseProduct(product)}
              >
                <strong>{customerProductDescription(product)}</strong>
                <span>
                  {product.materialCode ? `物料编码 ${product.materialCode} · ` : ""}
                  {product.unit || "未设单位"}
                  {price ? ` · 最近单价 ${formatCurrencyAmount(currency, price)}` : " · 暂无该币种历史单价"}
                </span>
              </button>
            );
          })}
          {!productsLoading && !suggestions.length ? (
            <div className={styles.productSuggestionMessage} role="status" aria-live="polite">
              {productsMessage || "未找到历史产品，本次保存后会自动保留。"}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function QuotationItemsEditor({
  currency,
  items,
  products,
  productsLoading,
  productsMessage,
  disabled,
  onChange,
}: {
  currency: string;
  items: QuotationItemDraft[];
  products: CustomerProduct[];
  productsLoading: boolean;
  productsMessage: string;
  disabled: boolean;
  onChange: (items: QuotationItemDraft[]) => void;
}) {
  function updateItem(key: string, patch: Partial<QuotationItemDraft>) {
    onChange(items.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  const subtotal = items.reduce((total, item) => total + quotationLineAmount(item), 0);

  return (
    <section className={styles.itemSection}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>报价明细</h3>
          <small>在产品描述中选择历史记录，可自动带出单位和当前币种的最近单价。</small>
        </div>
        <button
          className={shell.secondaryButton}
          type="button"
          disabled={disabled}
          onClick={() => onChange([...items, emptyQuotationItem()])}
        >
          添加一行
        </button>
      </div>

      <div className={`${styles.itemTableWrap} ${responsive.itemTableWrap}`}>
        <table className={`${styles.itemTable} ${responsive.itemTable}`}>
          <thead>
            <tr>
              <th className={styles.descriptionCell}>产品描述（含规格）</th>
              <th className={styles.unitCell}>单位</th>
              <th className={styles.numberCell}>数量</th>
              <th className={styles.numberCell}>单价</th>
              <th className={styles.amountCell}>金额</th>
              <th className={styles.actionCell}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key}>
                <td className={`${styles.descriptionCell} ${responsive.descriptionCell}`} data-label="产品描述（含规格）">
                  <ProductDescriptionInput
                    currency={currency}
                    item={item}
                    products={products}
                    productsLoading={productsLoading}
                    productsMessage={productsMessage}
                    disabled={disabled}
                    onChange={(patch) => updateItem(item.key, patch)}
                  />
                </td>
                <td className={styles.unitCell} data-label="单位">
                  <input
                    aria-label="单位"
                    value={item.unit}
                    disabled={disabled}
                    placeholder="PCS"
                    onChange={(event) => updateItem(item.key, { unit: event.target.value })}
                  />
                </td>
                <td className={styles.numberCell} data-label="数量">
                  <input
                    aria-label="数量"
                    type="number"
                    min="0"
                    step="0.0001"
                    value={item.quantity}
                    disabled={disabled}
                    onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                  />
                </td>
                <td className={styles.numberCell} data-label="单价">
                  <input
                    aria-label="单价"
                    type="number"
                    min="0"
                    step="0.000001"
                    value={item.unitPrice}
                    disabled={disabled}
                    onChange={(event) => updateItem(item.key, {
                      unitPrice: event.target.value,
                      unitPriceSource: event.target.value === "" ? "" : "manual",
                    })}
                  />
                </td>
                <td className={`${styles.amountCell} ${responsive.amountCell}`} data-label="金额">{formatCurrencyAmount(currency, quotationLineAmount(item))}</td>
                <td className={`${styles.actionCell} ${responsive.actionCell}`} data-label="操作">
                  <QuotationItemActions
                    disabled={disabled}
                    canRemove={items.length > 1}
                    onDuplicate={() => onChange(duplicateQuotationItemAfter(items, item.key))}
                    onRemove={() => onChange(items.filter((candidate) => candidate.key !== item.key))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.summaryRow}>
        <span>报价小计</span>
        <strong>{formatCurrencyAmount(currency, subtotal)}</strong>
      </div>
    </section>
  );
}
