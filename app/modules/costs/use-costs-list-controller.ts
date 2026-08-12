"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson } from "../../api";
import { costMatchesFilters } from "./filter-matching";
import { PAGE_SIZE, emptyCostFilters, type CostFilters, type CostInvoiceGroupRow, type CostOrderSummary, type CostRow, type CostsResponse, type CostView } from "./model";

type CostsListControllerOptions = {
  initialKeyword: string;
  initialOpenToken: number;
  clearTransientState: () => void;
};

export function useCostsListController({
  initialKeyword,
  initialOpenToken,
  clearTransientState,
}: CostsListControllerOptions) {
  const [rows, setRows] = useState<CostRow[]>([]);
  const [orderRows, setOrderRows] = useState<CostOrderSummary[]>([]);
  const [invoiceGroupRows, setInvoiceGroupRows] = useState<CostInvoiceGroupRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<CostFilters>({ ...emptyCostFilters });
  const [submittedFilters, setSubmittedFilters] = useState<CostFilters>({ ...emptyCostFilters });
  const [costView, setCostView] = useState<CostView>("invoiceGroups");
  const [archiveScope, setArchiveScope] = useState("current");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadCostsDataRequestRef = useRef(0);
  const loadCostsVisibleRequestRef = useRef(0);

  async function loadCosts(
    nextPage = page,
    nextFilters = submittedFilters,
    nextArchiveScope = archiveScope,
    nextView: CostView = costView,
    options: { silent?: boolean } = {},
  ) {
    const dataRequestId = ++loadCostsDataRequestRef.current;
    const visibleRequestId = options.silent
      ? loadCostsVisibleRequestRef.current
      : ++loadCostsVisibleRequestRef.current;
    if (!options.silent) {
      setLoading(true);
      setError("");
    }
    try {
      const effectiveFilters = nextView === "invoiceExceptions"
        ? { ...nextFilters, invoiceStatus: "未收到" }
        : nextFilters;
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
        archiveScope: nextArchiveScope,
        view: nextView,
      });
      if (effectiveFilters.keyword.trim()) params.set("keyword", effectiveFilters.keyword.trim());
      Object.entries(effectiveFilters).forEach(([key, value]) => {
        if (key === "keyword") return;
        const text = String(value || "").trim();
        if (text) params.set(key, text);
      });
      const result = await apiJson<CostsResponse>(`/api/costs?${params}`);
      if (dataRequestId !== loadCostsDataRequestRef.current) return;
      const data = result.data || { rows: result.costs || [], total: result.costs?.length || 0, page: nextPage, pageSize: PAGE_SIZE };
      if (nextView === "orders") {
        setOrderRows(Array.isArray(data.rows) ? (data.rows as CostOrderSummary[]) : []);
        setRows([]);
        setInvoiceGroupRows([]);
      } else if (nextView === "invoiceGroups" || nextView === "invoiceExceptions") {
        setInvoiceGroupRows(Array.isArray(data.rows) ? (data.rows as CostInvoiceGroupRow[]) : []);
        setRows([]);
        setOrderRows([]);
      } else {
        setRows(Array.isArray(data.rows) ? (data.rows as CostRow[]) : []);
        setOrderRows([]);
        setInvoiceGroupRows([]);
      }
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || nextPage));
    } catch (loadError) {
      if (!options.silent && visibleRequestId === loadCostsVisibleRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "读取成本数据失败");
      }
    } finally {
      if (!options.silent && visibleRequestId === loadCostsVisibleRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    const nextFilters = { ...emptyCostFilters, keyword: value };
    setFilters(nextFilters);
    setSubmittedFilters(nextFilters);
    clearTransientState();
    setNotice("");
    void loadCosts(1, nextFilters, archiveScope, "invoiceGroups");
  }, [initialKeyword, initialOpenToken]);

  useEffect(() => {
    if (initialOpenToken && initialKeyword.trim()) return;
    void loadCosts(1, { ...emptyCostFilters });
  }, []);

  useEffect(() => {
    const value = filters.keyword.trim();
    if (value === submittedFilters.keyword) return;
    const timer = window.setTimeout(() => {
      const nextFilters = Object.fromEntries(
        Object.entries(filters).map(([key, filterValue]) => [
          key,
          key === "keyword" ? value : String(filterValue || "").trim(),
        ]),
      ) as CostFilters;
      setSubmittedFilters(nextFilters);
      clearTransientState();
      setNotice("");
      void loadCosts(1, nextFilters, archiveScope, costView);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    filters.keyword,
    filters.costType,
    filters.paymentStatus,
    filters.costConfirmed,
    filters.invoiceStatus,
    filters.dateFrom,
    filters.dateTo,
    submittedFilters.keyword,
    archiveScope,
    costView,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeRows = costView === "orders" ? orderRows : (costView === "invoiceGroups" || costView === "invoiceExceptions" ? invoiceGroupRows : rows);

  function setFilter<K extends keyof CostFilters>(key: K, value: CostFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function submitSearch() {
    const nextFilters = Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [key, String(value || "").trim()]),
    ) as CostFilters;
    setSubmittedFilters(nextFilters);
    clearTransientState();
    setNotice("");
    void loadCosts(1, nextFilters, archiveScope, costView);
  }

  function resetSearch() {
    setFilters({ ...emptyCostFilters });
    setSubmittedFilters({ ...emptyCostFilters });
    setArchiveScope("current");
    clearTransientState();
    setNotice("");
    void loadCosts(1, { ...emptyCostFilters }, "current", costView);
  }

  function gotoPage(nextPage: number) {
    clearTransientState();
    void loadCosts(nextPage, submittedFilters, archiveScope, costView);
  }

  function changeArchiveScope(nextArchiveScope: string) {
    setArchiveScope(nextArchiveScope);
    clearTransientState();
    setNotice("");
    void loadCosts(1, submittedFilters, nextArchiveScope, costView);
  }

  function changeCostView(nextView: CostView) {
    const nextFilters = nextView === "invoiceExceptions"
      ? { ...submittedFilters, invoiceStatus: "未收到" }
      : submittedFilters;
    if (nextView === "invoiceExceptions") {
      setFilters((current) => ({ ...current, invoiceStatus: "未收到" }));
      setSubmittedFilters(nextFilters);
    }
    setCostView(nextView);
    clearTransientState();
    setNotice("");
    void loadCosts(1, nextFilters, archiveScope, nextView);
  }

  function costMatchesSubmittedFilters(cost: CostRow) {
    const effectiveFilters = costView === "invoiceExceptions"
      ? { ...submittedFilters, invoiceStatus: "未收到" }
      : submittedFilters;
    return costMatchesFilters(cost, effectiveFilters);
  }

  function refreshCostAggregatesInBackground() {
    void loadCosts(page, submittedFilters, archiveScope, costView, { silent: true });
  }

  return {
    rows,
    orderRows,
    invoiceGroupRows,
    total,
    page,
    filters,
    submittedFilters,
    costView,
    archiveScope,
    loading,
    error,
    notice,
    totalPages,
    activeRows,
    setRows,
    setOrderRows,
    setInvoiceGroupRows,
    setTotal,
    setError,
    setNotice,
    loadCosts,
    setFilter,
    submitSearch,
    resetSearch,
    gotoPage,
    changeArchiveScope,
    changeCostView,
    costMatchesSubmittedFilters,
    refreshCostAggregatesInBackground,
  };
}
