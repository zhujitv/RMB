"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./WorkspaceShell.module.css";

type SearchAutocompleteProps<T extends { id: string }> = {
  value?: T | null;
  placeholder?: string;
  disabled?: boolean;
  cacheKey: string;
  emptyLabel: string;
  loadingLabel?: string;
  searchOnFocus?: boolean;
  getLabel: (item: T) => string;
  getDescription?: (item: T) => string;
  search: (keyword: string) => Promise<T[]>;
  onSelect: (item: T) => void;
  onCreateRequested?: (keyword: string) => void;
};

const autocompleteCache = new Map<string, unknown[]>();

export function SearchAutocomplete<T extends { id: string }>({
  value,
  placeholder,
  disabled = false,
  cacheKey,
  emptyLabel,
  loadingLabel = "搜索中...",
  searchOnFocus = false,
  getLabel,
  getDescription,
  search,
  onSelect,
  onCreateRequested,
}: SearchAutocompleteProps<T>) {
  const [keyword, setKeyword] = useState(() => value ? getLabel(value) : "");
  const [options, setOptions] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setKeyword(value ? getLabel(value) : "");
  }, [value?.id]);

  useEffect(() => {
    if (disabled) return;
    const query = keyword.trim();
    if (!query || (value && query === getLabel(value))) {
      setOptions([]);
      setOpen(false);
      setMessage("");
      return;
    }
    const timer = window.setTimeout(() => {
      void runSearch(query);
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

  async function runSearch(query: string) {
    const normalizedKey = `${cacheKey}:${query.toLowerCase()}`;
    if (autocompleteCache.has(normalizedKey)) {
      const cached = (autocompleteCache.get(normalizedKey) || []) as T[];
      setOptions(cached);
      setActiveIndex(0);
      setOpen(true);
      setMessage(cached.length ? "" : emptyLabel);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const result = (await search(query)).slice(0, 10);
      autocompleteCache.set(normalizedKey, result);
      setOptions(result);
      setActiveIndex(0);
      setOpen(true);
      setMessage(result.length ? "" : emptyLabel);
    } catch (error) {
      setOptions([]);
      setOpen(true);
      setMessage(error instanceof Error ? error.message : emptyLabel);
    } finally {
      setLoading(false);
    }
  }

  function selectOption(option: T) {
    setKeyword(getLabel(option));
    setOptions([]);
    setOpen(false);
    setMessage("");
    onSelect(option);
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
            if (searchOnFocus && !disabled && !value) {
              void runSearch(keyword.trim());
              return;
            }
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
              if (selected) selectOption(selected);
            }
          }}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
        />
      </div>
      {open ? (
        <div className={styles.autocompletePanel}>
          {loading ? <div className={styles.autocompleteEmpty}>{loadingLabel}</div> : null}
          {!loading && visibleOptions.length ? visibleOptions.map((option, index) => (
            <button
              className={`${styles.autocompleteOption} ${index === activeIndex ? styles.autocompleteOptionActive : ""}`}
              key={option.id}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
            >
              <strong>{getLabel(option)}</strong>
              {getDescription ? <span>{getDescription(option)}</span> : null}
            </button>
          )) : null}
          {!loading && !visibleOptions.length ? (
            <div className={styles.autocompleteEmpty}>
              <span>{message || emptyLabel}</span>
              {keyword.trim() && onCreateRequested ? (
                <button type="button" onClick={() => onCreateRequested(keyword.trim())}>
                  新建 “{keyword.trim()}”
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
