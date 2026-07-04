import type { Pagination, SettingsFilters, SettingsTabKey } from "./types";

export function kebabTab(tab: SettingsTabKey) {
  if (tab === "businessEntities") return "business-entities";
  if (tab === "exchangeRates") return "exchange-rates";
  if (tab === "commissionFormula") return "commission-formula";
  if (tab === "auditLogs") return "audit-logs";
  if (tab === "apiPerformance") return "api-performance";
  return tab;
}

export function emptyPagination(pageSize: number): Pagination {
  return { page: 1, pageSize, total: 0, totalPages: 1 };
}

export function filtersForTab(filters: SettingsFilters, tab: SettingsTabKey) {
  if (tab === "customers") return filters.customers;
  if (tab === "suppliers") return filters.suppliers;
  if (tab === "users") return filters.users;
  if (tab === "apiPerformance") return filters.apiPerformance;
  return filters.auditLogs;
}

export function appendFilterParams(params: URLSearchParams, tab: SettingsTabKey, filters: SettingsFilters[keyof SettingsFilters]) {
  if ("keyword" in filters && filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  if (tab === "suppliers") {
    const supplierFilters = filters as SettingsFilters["suppliers"];
    if (supplierFilters.type) params.set("type", supplierFilters.type);
    if (supplierFilters.status) params.set("status", supplierFilters.status);
  }
  if (tab === "users") {
    const userFilters = filters as SettingsFilters["users"];
    if (userFilters.role) params.set("role", userFilters.role);
    if (userFilters.status) params.set("status", userFilters.status);
  }
  if (tab === "auditLogs") {
    const logFilters = filters as SettingsFilters["auditLogs"];
    if (logFilters.action.trim()) params.set("action", logFilters.action.trim());
  }
  if (tab === "apiPerformance") {
    const performanceFilters = filters as SettingsFilters["apiPerformance"];
    if (performanceFilters.source) params.set("source", performanceFilters.source);
    if (performanceFilters.minDurationMs.trim()) params.set("minDurationMs", performanceFilters.minDurationMs.trim());
    if (performanceFilters.windowHours) params.set("windowHours", performanceFilters.windowHours);
  }
}

export function emptyFiltersForTab(tab: SettingsTabKey) {
  if (tab === "customers") return { keyword: "" };
  if (tab === "suppliers") return { keyword: "", type: "", status: "" };
  if (tab === "users") return { keyword: "", role: "", status: "" };
  if (tab === "apiPerformance") return { keyword: "", source: "", minDurationMs: "", windowHours: "24" };
  return { keyword: "", action: "" };
}

export function resetFilters(filters: SettingsFilters, tab: SettingsTabKey): SettingsFilters {
  return {
    ...filters,
    [tab]: emptyFiltersForTab(tab),
  } as SettingsFilters;
}
