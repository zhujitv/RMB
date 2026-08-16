import { useMemo, useRef, useState } from "react";
import type { CompanyProfileSettings } from "../../types";
import { AUDIT_PAGE_SIZE, PAGE_SIZE } from "./constants";
import { columnsFor, emptyPagination, rowsFor } from "./helpers";
import type {
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
  SmsIntegrationForm,
  SmsIntegrationSettings,
  SupplierForm,
  SupplierRow,
  UserForm,
  UserRow,
} from "./types";

export function useSettingsState() {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>("home");
  const [filters, setFilters] = useState<SettingsFilters>({
    customers: { keyword: "" },
    suppliers: { keyword: "", type: "", status: "" },
    users: { keyword: "", role: "", status: "" },
    auditLogs: { keyword: "", action: "" },
  });
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [businessEntities, setBusinessEntities] = useState<BusinessEntityRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
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
  const [smsIntegrationSettings, setSmsIntegrationSettings] = useState<SmsIntegrationSettings | null>(null);
  const [smsIntegrationForm, setSmsIntegrationForm] = useState<SmsIntegrationForm | null>(null);
  const [permissionConfig, setPermissionConfig] = useState<PermissionConfig | null>(null);
  const [salespeople, setSalespeople] = useState<SalespersonOption[]>([]);
  const [pagination, setPagination] = useState<Record<SettingsTabKey, Pagination>>({
    home: emptyPagination(PAGE_SIZE),
    companyProfile: emptyPagination(PAGE_SIZE),
    businessEntities: emptyPagination(PAGE_SIZE),
    customers: emptyPagination(PAGE_SIZE),
    customerProducts: emptyPagination(PAGE_SIZE),
    suppliers: emptyPagination(PAGE_SIZE),
    users: emptyPagination(PAGE_SIZE),
    ocrIntegration: emptyPagination(PAGE_SIZE),
    exchangeRates: emptyPagination(PAGE_SIZE),
    commissionFormula: emptyPagination(PAGE_SIZE),
    notificationTemplates: emptyPagination(PAGE_SIZE),
    shipsgoIntegration: emptyPagination(PAGE_SIZE),
    smsIntegration: emptyPagination(PAGE_SIZE),
    auditLogs: emptyPagination(AUDIT_PAGE_SIZE),
  });
  const [loadedTabs, setLoadedTabs] = useState<Set<SettingsTabKey>>(new Set());
  const [detailRow, setDetailRow] = useState<CustomerRow | SupplierRow | UserRow | AuditLogRow | null>(null);
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
  const [forceDeletingRejectedUserId, setForceDeletingRejectedUserId] = useState("");
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
  const [smsIntegrationSaving, setSmsIntegrationSaving] = useState(false);
  const [smsIntegrationMessage, setSmsIntegrationMessage] = useState("");
  const [activeSuppliers, setActiveSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const userEditPanelRef = useRef<HTMLDivElement | null>(null);
  const activePagination = pagination[activeTab] || emptyPagination(PAGE_SIZE);
  const listColumns = useMemo(() => columnsFor(activeTab), [activeTab]);
  const currentRows = useMemo(() => rowsFor(activeTab, { customers, suppliers, users, logs }), [activeTab, customers, suppliers, users, logs]);
  const activeFilter = activeTab === "customers" || activeTab === "customerProducts"
    ? filters.customers
    : activeTab === "suppliers"
      ? filters.suppliers
      : activeTab === "users"
        ? filters.users
        : filters.auditLogs;

  return {
    activeTab,
    setActiveTab,
    filters,
    setFilters,
    customers,
    setCustomers,
    businessEntities,
    setBusinessEntities,
    suppliers,
    setSuppliers,
    users,
    setUsers,
    logs,
    setLogs,
    companyProfileSettings,
    setCompanyProfileSettings,
    companyProfileForm,
    setCompanyProfileForm,
    exchangeSettings,
    setExchangeSettings,
    exchangeForm,
    setExchangeForm,
    commissionFormulaSettings,
    setCommissionFormulaSettings,
    commissionFormulaForm,
    setCommissionFormulaForm,
    notificationTemplateSettings,
    setNotificationTemplateSettings,
    notificationTemplateForm,
    setNotificationTemplateForm,
    selectedNotificationTemplateType,
    setSelectedNotificationTemplateType,
    ocrIntegrationSettings,
    setOcrIntegrationSettings,
    ocrIntegrationForm,
    setOcrIntegrationForm,
    shipsgoIntegrationSettings,
    setShipsgoIntegrationSettings,
    shipsgoIntegrationForm,
    setShipsgoIntegrationForm,
    smsIntegrationSettings,
    setSmsIntegrationSettings,
    smsIntegrationForm,
    setSmsIntegrationForm,
    permissionConfig,
    setPermissionConfig,
    salespeople,
    setSalespeople,
    pagination,
    setPagination,
    loadedTabs,
    setLoadedTabs,
    detailRow,
    setDetailRow,
    customerForm,
    setCustomerForm,
    customerSaving,
    setCustomerSaving,
    customerMessage,
    setCustomerMessage,
    businessEntityForm,
    setBusinessEntityForm,
    businessEntitySaving,
    setBusinessEntitySaving,
    businessEntityMessage,
    setBusinessEntityMessage,
    supplierForm,
    setSupplierForm,
    supplierPanelMode,
    setSupplierPanelMode,
    supplierSaving,
    setSupplierSaving,
    supplierMessage,
    setSupplierMessage,
    userForm,
    setUserForm,
    selectedUserId,
    setSelectedUserId,
    userSaving,
    setUserSaving,
    userMessage,
    setUserMessage,
    forceDeletingRejectedUserId,
    setForceDeletingRejectedUserId,
    companyProfileSaving,
    setCompanyProfileSaving,
    companyProfileMessage,
    setCompanyProfileMessage,
    exchangeSaving,
    setExchangeSaving,
    exchangeRefreshing,
    setExchangeRefreshing,
    exchangeMessage,
    setExchangeMessage,
    commissionFormulaSaving,
    setCommissionFormulaSaving,
    commissionFormulaMessage,
    setCommissionFormulaMessage,
    notificationTemplateSaving,
    setNotificationTemplateSaving,
    notificationTemplateMessage,
    setNotificationTemplateMessage,
    ocrIntegrationSaving,
    setOcrIntegrationSaving,
    ocrIntegrationMessage,
    setOcrIntegrationMessage,
    shipsgoIntegrationSaving,
    setShipsgoIntegrationSaving,
    shipsgoIntegrationMessage,
    setShipsgoIntegrationMessage,
    smsIntegrationSaving,
    setSmsIntegrationSaving,
    smsIntegrationMessage,
    setSmsIntegrationMessage,
    activeSuppliers,
    setActiveSuppliers,
    loading,
    setLoading,
    error,
    setError,
    activePagination,
    listColumns,
    currentRows,
    activeFilter,
    userEditPanelRef,
  };
}
