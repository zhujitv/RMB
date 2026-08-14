"use client";

import { useMemo, useState, type FocusEvent } from "react";
import { formatCurrencyAmount } from "../../formatters";
import { visibleProductDescriptionParts } from "../quotations/quotation-product-description-values";
import styles from "./sales-execution.module.css";
import { salesItemDescription, type CustomerProduct, type SalesLineDraft } from "./types";

const MAX_SUGGESTIONS = 8;

function productDescription(product: CustomerProduct) {
  const name = String(product.name || product.productName || "").trim();
  const specification = String(product.specification || "").trim();
  if (!specification || name.toLowerCase().includes(specification.toLowerCase())) return name;
  return `${name} (${specification.replace(/^\(|\)$/g, "")})`;
}

function matchingProducts(products: CustomerProduct[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return products.slice(0, MAX_SUGGESTIONS);
  return products.filter((product) => productDescription(product).toLocaleLowerCase().includes(normalized)).slice(0, MAX_SUGGESTIONS);
}

function matchingPrice(product: CustomerProduct, currency: string) {
  if (product.lastUnitPrice == null || product.lastUnitPrice === "") return "";
  return String(product.lastCurrency || "").toUpperCase() === currency.toUpperCase()
    ? String(product.lastUnitPrice)
    : "";
}

export function ProductSuggestionInput({
  item,
  currency,
  products,
  productsLoading,
  productsMessage,
  disabled,
  onChange,
}: {
  item: SalesLineDraft;
  currency: string;
  products: CustomerProduct[];
  productsLoading: boolean;
  productsMessage: string;
  disabled: boolean;
  onChange: (patch: Partial<SalesLineDraft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const description = salesItemDescription(item);
  const suggestions = useMemo(() => matchingProducts(products, description), [description, products]);
  const listId = `${item.key}-history-products`;

  function closeWhenFocusLeaves(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  function selectProduct(product: CustomerProduct) {
    const retainedPrice = matchingPrice(product, currency);
    const manualPrice = item.salesPriceSource === "manual" ? item.salesUnitPrice : "";
    onChange({
      customerProductId: product.id,
      name: String(product.name || product.productName || ""),
      specification: String(product.specification || ""),
      unit: String(product.unit || item.unit || "PCS"),
      salesUnitPrice: retainedPrice || manualPrice,
      salesPriceSource: retainedPrice ? "history" : manualPrice ? "manual" : "",
      remark: String(product.remark || item.remark || ""),
    });
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div className={styles.productControl} onBlur={closeWhenFocusLeaves}>
      <input
        aria-label="产品描述"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        value={description}
        disabled={disabled}
        placeholder="例如 Universal panel WPC (24*140*2900 mm)"
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && suggestions.length) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => current >= suggestions.length - 1 ? 0 : current + 1);
          } else if (event.key === "ArrowUp" && suggestions.length) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => current <= 0 ? suggestions.length - 1 : current - 1);
          } else if (event.key === "Enter" && activeIndex >= 0 && suggestions[activeIndex]) {
            event.preventDefault();
            selectProduct(suggestions[activeIndex]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        onChange={(event) => {
          const normalized = visibleProductDescriptionParts(event.target.value, item.specification);
          const keepManualPrice = item.salesPriceSource === "manual";
          onChange({
            customerProductId: "",
            name: normalized.description,
            specification: normalized.specification,
            salesUnitPrice: keepManualPrice ? item.salesUnitPrice : "",
            salesPriceSource: keepManualPrice ? "manual" : "",
          });
          setOpen(true);
          setActiveIndex(-1);
        }}
      />
      {open && !disabled ? (
        <div className={styles.suggestions} id={listId} role="listbox" aria-label="客户历史产品和销售价">
          {productsLoading ? <div className={styles.fieldHint}>正在读取客户历史产品...</div> : null}
          {!productsLoading && suggestions.map((product, index) => {
            const price = matchingPrice(product, currency);
            return (
              <button
                className={styles.suggestion}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                key={product.id}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectProduct(product)}
              >
                <strong>{productDescription(product)}</strong>
                <small>{product.unit || "未设单位"}{price ? ` · 最近销售价 ${formatCurrencyAmount(currency, price)}` : " · 当前币种暂无历史价格"}</small>
              </button>
            );
          })}
          {!productsLoading && !suggestions.length ? <div className={styles.fieldHint}>{productsMessage || "暂无匹配产品，本次保存后会自动保留。"}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
