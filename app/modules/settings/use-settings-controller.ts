import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../../api";
import { useSettingsSaveActions } from "./use-settings-save-actions";
import { useSettingsControllerActions } from "./use-settings-controller-actions";
import { useSettingsLoadActions } from "./use-settings-load-actions";
import type { CompanyProfileSettings } from "../../types";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../../../lib/password-policy";
import {
  API_PERFORMANCE_PAGE_SIZE,
  AUDIT_PAGE_SIZE,
  DEFAULT_OCR_INTEGRATION_FORM,
  DEFAULT_SHIPSGO_INTEGRATION_FORM,
  FACTORY_SUPPLIER_ACCOUNT_ROLES,
  PAGE_SIZE,
} from "./constants";
import {
  appendFilterParams,
  businessEntityFormFromRow,
  columnsFor,
  commissionFormulaFormFromSettings,
  companyProfileFormFromSettings,
  customerFormFromRow,
  emptyBusinessEntityForm,
  emptyCustomerForm,
  emptyFiltersForTab,
  emptyPagination,
  emptySupplierForm,
  emptyUserForm,
  exchangeFormFromSettings,
  filtersForTab,
  isSupplierAccountRole,
  kebabTab,
  notificationTemplateFormFromSettings,
  notificationTemplateRows,
  ocrIntegrationFormFromSettings,
  resetFilters,
  rowsFor,
  shipsgoIntegrationFormFromSettings,
  supplierFormFromRow,
  supplierMatchesUserRole,
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
  FiltersFor,
  NotificationTemplateForm,
  NotificationTemplateSettings,
  OcrIntegrationForm,
  OcrIntegrationSettings,
  Pagination,
  PermissionConfig,
  SalespersonOption,
  SettingsFilters,
  SettingsModuleProps,
  SettingsTabKey,
  ShipsgoIntegrationForm,
  ShipsgoIntegrationSettings,
  SupplierForm,
  SupplierRow,
  UserForm,
  UserRow,
} from "./types";

export function useSettingsController({ onCompanyProfileSaved }: SettingsModuleProps = {}) {

  const [activeTab, setActiveTab] = useState<SettingsTabKey>("home");
  const [filters, setFilters] = useState<SettingsFilters>({
    customers: { keyword: "" },
    suppliers: { keyword: "", type: "", status: "" },
    users: { keyword: "", role: "", status: "" },
    auditLogs: { keyword: "", action: "" },
    apiPerformance: { keyword: "", source: "", minDurationMs: "", windowHours: "24" },
  });

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [businessEntities, setBusinessEntities] = useState<BusinessEntityRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [apiPerformance, setApiPerformance] = useState<ApiPerformanceRow[]>([]);
  const [companyProfileSettings, setCompanyProfileSettings] = useState<CompanyProfileSettings | null>(null);
  const [companyProfileForm, setCompanyProfileForm] = useState<CompanyProfileForm | null>(null);
  const [exchangeSettings, setExchangeSettings] = useState<ExchangeRateSettings | null>(null);
  const [exchangeForm, setExchangeForm] = useState<ExchangeRateForm | null>(null);
  const [commissionFormulaSettings, setCommissionFormulaSettings] = useState<CommissionFormulaSettings | null>(null);
  const [commissionFormulaForm, setCommissionFormulaForm] = useState<CommissionFormulaForm | null>(null);
  const [notificationTemplateSettings, setNotificationTemplateSettings] = useState<NotificationTemplateSettings | null>(null);
  const [notificationTemplateForm, setNotificationTemplateForm] = useState<NotificationTemplateForm | null>(null);
  const [selectedNotificationTemplateType, setSelectedNotificationTemplateType] = useState("");
  const [ocrIntegrationSettings, setOcrIntegrationSettings] = useState<OcrIntegrationSettings | null>(null);
  const [ocrIntegrationForm, setOcrIntegrationForm] = useState<OcrIntegrationForm | null>(null);
  const [shipsgoIntegrationSettings, setShipsgoIntegrationSettings] = useState<ShipsgoIntegrationSettings | null>(null);
  const [shipsgoIntegrationForm, setShipsgoIntegrationForm] = useState<ShipsgoIntegrationForm | null>(null);
  const [permissionConfig, setPermissionConfig] = useState<PermissionConfig | null>(null);
  const [salespeople, setSalespeople] = useState<SalespersonOption[]>([]);

  const [pagination, setPagination] = useState<Record<SettingsTabKey, Pagination>>({
    home: emptyPagination(PAGE_SIZE),
    companyProfile: emptyPagination(PAGE_SIZE),
    businessEntities: emptyPagination(PAGE_SIZE),
    customers: emptyPagination(PAGE_SIZE),
    suppliers: emptyPagination(PAGE_SIZE),
    users: emptyPagination(PAGE_SIZE),
    ocrIntegration: emptyPagination(PAGE_SIZE),
    exchangeRates: emptyPagination(PAGE_SIZE),
    commissionFormula: emptyPagination(PAGE_SIZE),
    notificationTemplates: emptyPagination(PAGE_SIZE),
    shipsgoIntegration: emptyPagination(PAGE_SIZE),
    auditLogs: emptyPagination(AUDIT_PAGE_SIZE),
    apiPerformance: emptyPagination(API_PERFORMANCE_PAGE_SIZE),
  });
  const [loadedTabs, setLoadedTabs] = useState<Set<SettingsTabKey>>(new Set());
  const [detailRow, setDetailRow] = useState<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow | null>(null);
  const [customerForm, setCustomerForm] = useState<CustomerForm | null>(null);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [customerMessage, setCustomerMessage] = useState("");
  const [businessEntityForm, setBusinessEntityForm] = useState<BusinessEntityForm | null>(null);
  const [businessEntitySaving, setBusinessEntitySaving] = useState(false);
  const [businessEntityMessage, setBusinessEntityMessage] = useState("");
  const [supplierForm, setSupplierForm] = useState<SupplierForm | null>(null);
  const [supplierPanelMode, setSupplierPanelMode] = useState<"view" | "edit">("view");
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierMessage, setSupplierMessage] = useState("");
  const [userForm, setUserForm] = useState<UserForm | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [userSaving, setUserSaving] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const [companyProfileSaving, setCompanyProfileSaving] = useState(false);
  const [companyProfileMessage, setCompanyProfileMessage] = useState("");
  const [exchangeSaving, setExchangeSaving] = useState(false);
  const [exchangeRefreshing, setExchangeRefreshing] = useState(false);
  const [exchangeMessage, setExchangeMessage] = useState("");
  const [commissionFormulaSaving, setCommissionFormulaSaving] = useState(false);
  const [commissionFormulaMessage, setCommissionFormulaMessage] = useState("");
  const [notificationTemplateSaving, setNotificationTemplateSaving] = useState(false);
  const [notificationTemplateMessage, setNotificationTemplateMessage] = useState("");
  const [ocrIntegrationSaving, setOcrIntegrationSaving] = useState(false);
  const [ocrIntegrationMessage, setOcrIntegrationMessage] = useState("");
  const [shipsgoIntegrationSaving, setShipsgoIntegrationSaving] = useState(false);
  const [shipsgoIntegrationMessage, setShipsgoIntegrationMessage] = useState("");
  const [activeSuppliers, setActiveSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activePagination = pagination[activeTab] || emptyPagination(PAGE_SIZE);
  const listColumns = useMemo(() => columnsFor(activeTab), [activeTab]);
  const currentRows = useMemo(() => rowsFor(activeTab, { customers, suppliers, users, logs, apiPerformance }), [activeTab, customers, suppliers, users, logs, apiPerformance]);
  const activeFilter = activeTab === "customers"
    ? filters.customers
    : activeTab === "suppliers"
      ? filters.suppliers
      : activeTab === "users"
        ? filters.users
        : activeTab === "apiPerformance"
          ? filters.apiPerformance
          : filters.auditLogs;
  const userEditPanelRef = useRef<HTMLDivElement | null>(null);

  const {
    loadTab,
    fetchNotificationTemplateSettings,
    markLoaded,
    ensureActiveSuppliers,
    ensurePermissionConfig,
  } = useSettingsLoadActions({
    activePagination,
    activeSuppliers,
    activeTab,
    filters,
    permissionConfig,
    selectedNotificationTemplateType,
    setActiveSuppliers,
    setApiPerformance,
    setBusinessEntities,
    setCommissionFormulaForm,
    setCommissionFormulaSettings,
    setCompanyProfileForm,
    setCompanyProfileSettings,
    setCustomers,
    setDetailRow,
    setError,
    setExchangeForm,
    setExchangeSettings,
    setLoadedTabs,
    setLoading,
    setLogs,
    setNotificationTemplateForm,
    setNotificationTemplateSettings,
    setOcrIntegrationForm,
    setOcrIntegrationSettings,
    setPagination,
    setPermissionConfig,
    setSalespeople,
    setSelectedNotificationTemplateType,
    setShipsgoIntegrationForm,
    setShipsgoIntegrationSettings,
    setSuppliers,
    setUsers,
  });

  const {
    selectTab,
    submitSearch,
    resetSearch,
    refreshCurrent,
    refreshExchangeRatesManually,
    deleteRecord,
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
  } = useSettingsControllerActions({
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
  });

  const {
    saveCustomerForm,
    saveBusinessEntityForm,
    saveSupplierForm,
    saveUserForm,
    saveCompanyProfileSettings,
    saveExchangeSettings,
    saveCommissionFormulaSettings,
    saveNotificationTemplateSettings,
    selectNotificationTemplate,
    testNotificationTemplate,
    saveOcrIntegrationSettings,
    saveShipsgoIntegrationSettings,
  } = useSettingsSaveActions({
    activePagination,
    activeSuppliers,
    businessEntityForm,
    commissionFormulaForm,
    companyProfileForm,
    customerForm,
    exchangeForm,
    filters,
    loadTab,
    markLoaded,
    notificationTemplateForm,
    notificationTemplateSettings,
    ocrIntegrationForm,
    onCompanyProfileSaved,
    selectedNotificationTemplateType,
    setBusinessEntities,
    setBusinessEntityForm,
    setBusinessEntityMessage,
    setBusinessEntitySaving,
    setCommissionFormulaForm,
    setCommissionFormulaMessage,
    setCommissionFormulaSaving,
    setCommissionFormulaSettings,
    setCompanyProfileForm,
    setCompanyProfileMessage,
    setCompanyProfileSaving,
    setCompanyProfileSettings,
    setCustomerForm,
    setCustomerMessage,
    setCustomerSaving,
    setExchangeForm,
    setExchangeMessage,
    setExchangeSaving,
    setExchangeSettings,
    setNotificationTemplateForm,
    setNotificationTemplateMessage,
    setNotificationTemplateSaving,
    setNotificationTemplateSettings,
    setOcrIntegrationForm,
    setOcrIntegrationMessage,
    setOcrIntegrationSaving,
    setOcrIntegrationSettings,
    setSelectedNotificationTemplateType,
    setSelectedUserId,
    setShipsgoIntegrationForm,
    setShipsgoIntegrationMessage,
    setShipsgoIntegrationSaving,
    setShipsgoIntegrationSettings,
    setSupplierForm,
    setSupplierMessage,
    setSupplierPanelMode,
    setSupplierSaving,
    setSuppliers,
    setUserForm,
    setUserMessage,
    setUserSaving,
    shipsgoIntegrationForm,
    supplierForm,
    suppliers,
    userForm,
    fetchNotificationTemplateSettings,
  });

  useEffect(() => {
    if (!loadedTabs.has(activeTab)) {
      void loadTab(activeTab, 1, filtersForTab(filters, activeTab));
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "users" || !selectedUserId || !userForm) return;
    userEditPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeTab, selectedUserId, userForm?.id]);

  return {
    activeTab,
    filters,
    customers,
    businessEntities,
    suppliers,
    users,
    logs,
    apiPerformance,
    companyProfileSettings,
    companyProfileForm,
    exchangeSettings,
    exchangeForm,
    commissionFormulaSettings,
    commissionFormulaForm,
    notificationTemplateSettings,
    notificationTemplateForm,
    selectedNotificationTemplateType,
    ocrIntegrationSettings,
    ocrIntegrationForm,
    shipsgoIntegrationSettings,
    shipsgoIntegrationForm,
    permissionConfig,
    salespeople,
    pagination,
    loadedTabs,
    detailRow,
    customerForm,
    customerSaving,
    customerMessage,
    businessEntityForm,
    businessEntitySaving,
    businessEntityMessage,
    supplierForm,
    supplierPanelMode,
    supplierSaving,
    supplierMessage,
    userForm,
    selectedUserId,
    userSaving,
    userMessage,
    companyProfileSaving,
    companyProfileMessage,
    exchangeSaving,
    exchangeRefreshing,
    exchangeMessage,
    commissionFormulaSaving,
    commissionFormulaMessage,
    notificationTemplateSaving,
    notificationTemplateMessage,
    ocrIntegrationSaving,
    ocrIntegrationMessage,
    shipsgoIntegrationSaving,
    shipsgoIntegrationMessage,
    activeSuppliers,
    loading,
    error,
    activePagination,
    listColumns,
    currentRows,
    activeFilter,
    userEditPanelRef,
    loadTab,
    selectTab,
    submitSearch,
    resetSearch,
    refreshCurrent,
    refreshExchangeRatesManually,
    deleteRecord,
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
    saveCustomerForm,
    saveBusinessEntityForm,
    saveSupplierForm,
    saveUserForm,
    saveCompanyProfileSettings,
    saveExchangeSettings,
    saveCommissionFormulaSettings,
    saveNotificationTemplateSettings,
    selectNotificationTemplate,
    testNotificationTemplate,
    saveOcrIntegrationSettings,
    saveShipsgoIntegrationSettings,
    updateFilter,
    setDetailRow,
    setCustomerForm,
    setCustomerMessage,
    setBusinessEntityForm,
    setBusinessEntityMessage,
    setSupplierForm,
    setSupplierPanelMode,
    setSupplierMessage,
    setUserForm,
    setSelectedUserId,
    setUserMessage,
    setCompanyProfileForm,
    setCompanyProfileMessage,
    setExchangeForm,
    setExchangeMessage,
    setCommissionFormulaForm,
    setCommissionFormulaMessage,
    setNotificationTemplateForm,
    setNotificationTemplateMessage,
    setOcrIntegrationForm,
    setOcrIntegrationMessage,
    setShipsgoIntegrationForm,
    setShipsgoIntegrationMessage,
  };
}
