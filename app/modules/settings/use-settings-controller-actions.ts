import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import type { CompanyProfileSettings } from "../../types";
import { API_PERFORMANCE_PAGE_SIZE, AUDIT_PAGE_SIZE, PAGE_SIZE } from "./constants";
import {
  appendFilterParams,
  businessEntityFormFromRow,
  commissionFormulaFormFromSettings,
  companyProfileFormFromSettings,
  customerFormFromRow,
  emptyBusinessEntityForm,
  emptyCustomerForm,
  emptyFiltersForTab,
  emptySupplierForm,
  emptyUserForm,
  exchangeFormFromSettings,
  filtersForTab,
  kebabTab,
  notificationTemplateFormFromSettings,
  notificationTemplateRows,
  ocrIntegrationFormFromSettings,
  resetFilters,
  shipsgoIntegrationFormFromSettings,
  supplierFormFromRow,
  userFormFromRow,
} from "./helpers";
import type {
  ApiPerformanceRow,
  AuditLogRow,
  BusinessEntityForm,
  BusinessEntityRow,
  CommissionFormulaForm,
  CommissionFormulaSettings,
  CompanyProfileForm,
  CustomerForm,
  CustomerRow,
  ExchangeRateForm,
  ExchangeRateSettings,
  NotificationTemplateForm,
  NotificationTemplateSettings,
  OcrIntegrationForm,
  OcrIntegrationSettings,
  Pagination,
  PermissionConfig,
  SalespersonOption,
  SettingsFilters,
  SettingsTabKey,
  ShipsgoIntegrationForm,
  ShipsgoIntegrationSettings,
  SupplierForm,
  SupplierRow,
  UserForm,
  UserRow,
} from "./types";

type Setter<T> = Dispatch<SetStateAction<T>>;

type SettingsControllerActionsContext = {
  activePagination: Pagination;
  activeTab: SettingsTabKey;
  exchangeForm: ExchangeRateForm | null;
  exchangeSettings: ExchangeRateSettings | null;
  filters: SettingsFilters;
  loadTab: (...args: any[]) => Promise<void>;
  ensureActiveSuppliers: () => Promise<void>;
  ensurePermissionConfig: () => Promise<PermissionConfig>;
  supplierForm: SupplierForm | null;
  suppliers: SupplierRow[];
  setActiveTab: Setter<SettingsTabKey>;
  setBusinessEntityForm: Setter<BusinessEntityForm | null>;
  setBusinessEntityMessage: Setter<string>;
  setCommissionFormulaForm: Setter<CommissionFormulaForm | null>;
  setCommissionFormulaMessage: Setter<string>;
  setCommissionFormulaSettings: Setter<CommissionFormulaSettings | null>;
  setCompanyProfileForm: Setter<CompanyProfileForm | null>;
  setCompanyProfileMessage: Setter<string>;
  setCompanyProfileSettings: Setter<CompanyProfileSettings | null>;
  setCustomerForm: Setter<CustomerForm | null>;
  setCustomerMessage: Setter<string>;
  setDetailRow: Setter<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow | null>;
  setError: Setter<string>;
  setExchangeForm: Setter<ExchangeRateForm | null>;
  setExchangeMessage: Setter<string>;
  setExchangeRefreshing: Setter<boolean>;
  setExchangeSettings: Setter<ExchangeRateSettings | null>;
  setFilters: Setter<SettingsFilters>;
  setForceDeletingRejectedUserId: Setter<string>;
  setNotificationTemplateForm: Setter<NotificationTemplateForm | null>;
  setNotificationTemplateMessage: Setter<string>;
  setNotificationTemplateSettings: Setter<NotificationTemplateSettings | null>;
  setOcrIntegrationMessage: Setter<string>;
  setSelectedNotificationTemplateType: Setter<string>;
  setSelectedUserId: Setter<string>;
  setShipsgoIntegrationMessage: Setter<string>;
  setSupplierForm: Setter<SupplierForm | null>;
  setSupplierMessage: Setter<string>;
  setSupplierPanelMode: Setter<"view" | "edit">;
  setSuppliers: Setter<SupplierRow[]>;
  setUserForm: Setter<UserForm | null>;
  setUserMessage: Setter<string>;
};

export function useSettingsControllerActions(context: SettingsControllerActionsContext) {
  const {
    activePagination,
    activeTab,
    exchangeForm,
    exchangeSettings,
    filters,
    loadTab,
    ensureActiveSuppliers,
    ensurePermissionConfig,
    supplierForm,
    suppliers,
    setActiveTab,
    setBusinessEntityForm,
    setBusinessEntityMessage,
    setCommissionFormulaForm,
    setCommissionFormulaMessage,
    setCommissionFormulaSettings,
    setCompanyProfileForm,
    setCompanyProfileMessage,
    setCompanyProfileSettings,
    setCustomerForm,
    setCustomerMessage,
    setDetailRow,
    setError,
    setExchangeForm,
    setExchangeMessage,
    setExchangeRefreshing,
    setExchangeSettings,
    setFilters,
    setForceDeletingRejectedUserId,
    setNotificationTemplateForm,
    setNotificationTemplateMessage,
    setNotificationTemplateSettings,
    setOcrIntegrationMessage,
    setSelectedNotificationTemplateType,
    setSelectedUserId,
    setShipsgoIntegrationMessage,
    setSupplierForm,
    setSupplierMessage,
    setSupplierPanelMode,
    setSuppliers,
    setUserForm,
    setUserMessage,
  } = context;

function selectTab(tab: SettingsTabKey) {
    setActiveTab(tab);
    setDetailRow(null);
    setCustomerForm(null);
    setCustomerMessage("");
    setBusinessEntityForm(null);
    setBusinessEntityMessage("");
    setSupplierForm(null);
    setSupplierPanelMode("view");
    setSupplierMessage("");
    setUserForm(null);
    setSelectedUserId("");
    setUserMessage("");
    setCompanyProfileMessage("");
    setExchangeMessage("");
    setCommissionFormulaMessage("");
    setNotificationTemplateMessage("");
    setOcrIntegrationMessage("");
    setShipsgoIntegrationMessage("");
  }

function submitSearch() {
    if (activeTab === "home") return;
    void loadTab(activeTab, 1, filtersForTab(filters, activeTab));
  }

function resetSearch() {
    if (activeTab === "home") return;
    setFilters((current) => resetFilters(current, activeTab));
    void loadTab(activeTab, 1, emptyFiltersForTab(activeTab));
  }

function refreshCurrent() {
    if (activeTab === "home") return;
    void loadTab(activeTab, activePagination.page || 1, filtersForTab(filters, activeTab));
  }

async function refreshExchangeRatesManually() {
    setExchangeRefreshing(true);
    setExchangeMessage("");
    try {
      const payload = exchangeForm || exchangeFormFromSettings(exchangeSettings);
      const result = await apiJson<{ ok?: boolean; message?: string; settings?: ExchangeRateSettings }>(
        "/api/exchange-rates/refresh",
        {
          method: "POST",
          body: JSON.stringify({
            date: new Date().toISOString().slice(0, 10),
            source: payload.source,
            rateType: payload.rateType,
          }),
        },
      );
      setExchangeMessage(result.ok ? "今日汇率已刷新" : (result.message || "今日汇率获取失败，已使用最近可用汇率。"));
    } catch (refreshError) {
      setExchangeMessage(refreshError instanceof Error ? refreshError.message : "刷新汇率失败");
    } finally {
      setExchangeRefreshing(false);
    }
  }

async function deleteRecord(kind: "customer" | "supplier" | "user", id: string) {
    const labels = { customer: "客户", supplier: "供应商", user: "用户" };
    const message = kind === "user"
      ? "确认停用该用户吗？该操作会写入操作日志。"
      : `确认删除该${labels[kind]}吗？该操作会写入操作日志。`;
    if (!window.confirm(message)) return;
    setError("");
    try {
      const result = await apiJson<{ success?: boolean; ok?: boolean; message?: string }>(
        kind === "customer"
          ? `/api/customers/${encodeURIComponent(id)}`
          : kind === "supplier"
            ? `/api/suppliers/${encodeURIComponent(id)}`
            : `/api/users/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      await loadTab(activeTab, activePagination.page || 1, filtersForTab(filters, activeTab));
      if (kind === "supplier") {
        closeSupplierPanel();
      }
      if (kind === "user") {
        setExchangeMessage("");
        setError(result.message || "用户已停用");
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : `${labels[kind]}操作失败`);
    }
  }

async function forceDeleteRejectedUser(user: UserRow) {
    if (user.approvalStatus !== "REJECTED") {
      setError("仅审核状态为已拒绝的用户允许强制删除。");
      return;
    }
    if (!window.confirm("确认强制删除该拒绝用户？此操作不可恢复。")) return;
    setError("");
    setForceDeletingRejectedUserId(user.id);
    try {
      const result = await apiJson<{ success?: boolean; ok?: boolean; message?: string }>(
        `/api/users/${encodeURIComponent(user.id)}?forceRejected=1`,
        { method: "DELETE" },
      );
      await loadTab(activeTab, activePagination.page || 1, filtersForTab(filters, activeTab));
      setUserForm(null);
      setSelectedUserId("");
      setUserMessage("");
      setError(result.message || "拒绝用户已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "强制删除拒绝用户失败");
    } finally {
      setForceDeletingRejectedUserId("");
    }
  }

function startCreateCustomer() {
    setActiveTab("customers");
    setDetailRow(null);
    setCustomerMessage("");
    setCustomerForm(emptyCustomerForm());
  }

function startCreateSupplier() {
    setActiveTab("suppliers");
    setDetailRow(null);
    setSupplierMessage("");
    setSupplierPanelMode("edit");
    setSupplierForm(emptySupplierForm());
  }

function startCreateBusinessEntity() {
    setActiveTab("businessEntities");
    setDetailRow(null);
    setBusinessEntityMessage("");
    setBusinessEntityForm(emptyBusinessEntityForm());
  }

function startEditBusinessEntity(entity: BusinessEntityRow) {
    setActiveTab("businessEntities");
    setDetailRow(null);
    setBusinessEntityMessage("");
    setBusinessEntityForm(businessEntityFormFromRow(entity));
  }

function cancelBusinessEntityEdit() {
    setBusinessEntityForm(null);
    setBusinessEntityMessage("");
  }

function startCreateUser() {
    setActiveTab("users");
    setDetailRow(null);
    setUserMessage("");
    setSelectedUserId("new");
    setUserForm(emptyUserForm());
    void ensureActiveSuppliers();
    void ensurePermissionConfig();
  }

function startEditCustomer(customer: CustomerRow) {
    setActiveTab("customers");
    setDetailRow(customer);
    setCustomerMessage("");
    setCustomerForm(customerFormFromRow(customer));
  }

function startViewSupplier(supplier: SupplierRow) {
    setActiveTab("suppliers");
    setDetailRow(null);
    setSupplierMessage("");
    setSupplierPanelMode("edit");
    setSupplierForm(supplierFormFromRow(supplier));
  }

function closeSupplierPanel() {
    setSupplierForm(null);
    setSupplierPanelMode("view");
    setSupplierMessage("");
  }

function cancelSupplierEdit() {
    if (!supplierForm?.id) {
      closeSupplierPanel();
      return;
    }
    const currentSupplier = suppliers.find((supplier) => supplier.id === supplierForm.id);
    if (currentSupplier) setSupplierForm(supplierFormFromRow(currentSupplier));
    setSupplierPanelMode("view");
    setSupplierMessage("");
  }

function startEditUser(user: UserRow) {
    setActiveTab("users");
    setDetailRow(null);
    setUserMessage("");
    setSelectedUserId(user.id);
    setUserForm(userFormFromRow(user));
    void ensureActiveSuppliers();
    void ensurePermissionConfig();
  }

function updateFilter(tab: SettingsTabKey, key: string, value: string) {
    setFilters((current) => {
      if (tab === "customers") return { ...current, customers: { ...current.customers, [key]: value } };
      if (tab === "suppliers") return { ...current, suppliers: { ...current.suppliers, [key]: value } };
      if (tab === "users") return { ...current, users: { ...current.users, [key]: value } };
      if (tab === "apiPerformance") return { ...current, apiPerformance: { ...current.apiPerformance, [key]: value } };
      return { ...current, auditLogs: { ...current.auditLogs, [key]: value } };
    });
  }

  return {
    loadTab,
    selectTab,
    submitSearch,
    resetSearch,
    refreshCurrent,
    refreshExchangeRatesManually,
    deleteRecord,
    forceDeleteRejectedUser,
    startCreateCustomer,
    startCreateBusinessEntity,
    startEditBusinessEntity,
    cancelBusinessEntityEdit,
    startCreateSupplier,
    startCreateUser,
    startEditCustomer,
    startViewSupplier,
    closeSupplierPanel,
    cancelSupplierEdit,
    startEditUser,
    updateFilter,
  };
}
