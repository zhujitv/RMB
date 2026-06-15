"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { apiJson } from "./api";
import styles from "./WorkspaceShell.module.css";

export type CustomerAutocompleteOption = {
  id: string;
  name?: string;
  fullName?: string;
  shortName?: string;
  displayName?: string;
  defaultCurrency?: string;
  defaultPaymentTermType?: string;
  defaultTradeTerm?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  customerCode?: string;
};

type CustomersResponse = {
  customers?: CustomerAutocompleteOption[];
};

type CustomerAutocompleteProps = {
  value?: CustomerAutocompleteOption | null;
  placeholder?: string;
  disabled?: boolean;
  onSelect: (customer: CustomerAutocompleteOption) => void;
  onCreateRequested?: (keyword: string) => void;
};

const customerSearchCache = new Map<string, CustomerAutocompleteOption[]>();

export function CustomerAutocomplete({
  value,
  placeholder = "搜索客户简称 / 全称 / 联系人",
  disabled = false,
  onSelect,
  onCreateRequested,
}: CustomerAutocompleteProps) {
  const [keyword, setKeyword] = useState(() => customerDisplayName(value));
  const [options, setOptions] = useState<CustomerAutocompleteOption[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reactId = useId();
  const listboxId = `${reactId}-customer-autocomplete-listbox`;

  useEffect(() => {
    setKeyword(customerDisplayName(value));
  }, [value?.id]);

  useEffect(() => {
    if (disabled) return;
    const query = keyword.trim();
    if (!query || query === customerDisplayName(value)) {
      setOptions([]);
      setOpen(false);
      setMessage("");
      return;
    }
    const timer = window.setTimeout(() => {
      void searchCustomers(query);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, disabled, value?.id]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current || rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const visibleOptions = useMemo(() => options.slice(0, 10), [options]);

  async function searchCustomers(query: string) {
    const cacheKey = query.toLowerCase();
    if (customerSearchCache.has(cacheKey)) {
      const cached = customerSearchCache.get(cacheKey) || [];
      setOptions(cached);
      setActiveIndex(0);
      setOpen(true);
      setMessage(cached.length ? "" : "未找到客户");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ q: query });
      const result = await apiJson<CustomersResponse>(`/api/customers/available?${params}`);
      const customers = Array.isArray(result.customers) ? result.customers.slice(0, 10) : [];
      customerSearchCache.set(cacheKey, customers);
      setOptions(customers);
      setActiveIndex(0);
      setOpen(true);
      setMessage(customers.length ? "" : "未找到客户");
    } catch (error) {
      setOptions([]);
      setOpen(true);
      setMessage(error instanceof Error ? error.message : "客户搜索失败");
    } finally {
      setLoading(false);
    }
  }

  function selectCustomer(customer: CustomerAutocompleteOption) {
    setKeyword(customerDisplayName(customer));
    setOptions([]);
    setOpen(false);
    setMessage("");
    onSelect(customer);
  }

  return (
    <div className={styles.autocompleteRoot} ref={rootRef}>
      <div className={styles.autocompleteInputWrap}>
        <span aria-hidden="true">⌕</span>
        <input
          value={keyword}
          disabled={disabled}
          onChange={(event) => {
            setKeyword(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (visibleOptions.length || message) setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              return;
            }
            if (event.key === "ArrowDown" && visibleOptions.length) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => (current + 1) % visibleOptions.length);
              return;
            }
            if (event.key === "ArrowUp" && visibleOptions.length) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => (current - 1 + visibleOptions.length) % visibleOptions.length);
              return;
            }
            if (event.key === "Enter" && open) {
              event.preventDefault();
              const selected = visibleOptions[activeIndex];
              if (selected) {
                selectCustomer(selected);
                return;
              }
              const nextKeyword = keyword.trim();
              if (nextKeyword && onCreateRequested && !loading) onCreateRequested(nextKeyword);
            }
          }}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && visibleOptions[activeIndex] ? `${listboxId}-option-${visibleOptions[activeIndex].id}` : undefined}
        />
      </div>
      {open ? (
        <div className={styles.autocompletePanel} id={listboxId} role="listbox">
          {loading ? <div className={styles.autocompleteEmpty}>搜索中...</div> : null}
          {!loading && visibleOptions.length ? visibleOptions.map((customer, index) => (
            <button
              className={`${styles.autocompleteOption} ${index === activeIndex ? styles.autocompleteOptionActive : ""}`}
              key={customer.id}
              id={`${listboxId}-option-${customer.id}`}
              role="option"
              aria-selected={index === activeIndex}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectCustomer(customer)}
            >
              <strong>{customerDisplayName(customer)}</strong>
              <span>{customerFullName(customer)}</span>
            </button>
          )) : null}
          {!loading && !visibleOptions.length ? (
            <div className={styles.autocompleteEmpty}>
              <span>{message || "未找到客户"}</span>
              {keyword.trim() ? (
                <button type="button" onClick={() => onCreateRequested?.(keyword.trim())}>
                  新建客户 “{keyword.trim()}”
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function customerDisplayName(customer?: CustomerAutocompleteOption | null) {
  return customer?.displayName || customer?.shortName || customer?.name || customer?.fullName || "";
}

export function customerFullName(customer?: CustomerAutocompleteOption | null) {
  return customer?.fullName || customer?.name || customer?.displayName || customer?.shortName || "";
}
