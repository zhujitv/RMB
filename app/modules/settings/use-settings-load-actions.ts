import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import type { CompanyProfileSettings } from "../../types";
import { AUDIT_PAGE_SIZE, PAGE_SIZE } from "./constants";
import {
  appendFilterParams,
  commissionFormulaFormFromSettings,
  companyProfileFormFromSettings,
  emptyPagination,
  exchangeFormFromSettings,
  filtersForTab,
  kebabTab,
  notificationTemplateFormFromSettings,
  notificationTemplateRows,
  ocrIntegrationFormFromSettings,
  shipsgoIntegrationFormFromSettings,
} from "./helpers";
import type {
  AuditLogRow,
  BusinessEntityRow,
  CommissionFormulaForm,
  CommissionFormulaSettings,
  CompanyProfileForm,
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
  SupplierRow,
  UserRow,
} from "./types";

type Setter<T> = Dispatch<SetStateAction<T>>;

type SettingsLoadActionsContext = {
  activePagination: Pagination;
  activeSuppliers: SupplierRow[];
  activeTab: SettingsTabKey;
  filters: SettingsFilters;
  permissionConfig: PermissionConfig | null;
  selectedNotificationTemplateType: string;
  setActiveSuppliers: Setter<SupplierRow[]>;
  setBusinessEntities: Setter<BusinessEntityRow[]>;
  setCommissionFormulaForm: Setter<CommissionFormulaForm | null>;
  setCommissionFormulaSettings: Setter<CommissionFormulaSettings | null>;
  setCompanyProfileForm: Setter<CompanyProfileForm | null>;
  setCompanyProfileSettings: Setter<CompanyProfileSettings | null>;
  setCustomers: Setter<CustomerRow[]>;
  setDetailRow: Setter<CustomerRow | SupplierRow | UserRow | AuditLogRow | null>;
  setError: Setter<string>;
  setExchangeForm: Setter<ExchangeRateForm | null>;
  setExchangeSettings: Setter<ExchangeRateSettings | null>;
  setLoadedTabs: Setter<Set<SettingsTabKey>>;
  setLoading: Setter<boolean>;
  setLogs: Setter<AuditLogRow[]>;
  setNotificationTemplateForm: Setter<NotificationTemplateForm | null>;
  setNotificationTemplateSettings: Setter<NotificationTemplateSettings | null>;
  setOcrIntegrationForm: Setter<OcrIntegrationForm | null>;
  setOcrIntegrationSettings: Setter<OcrIntegrationSettings | null>;
  setPagination: Setter<Record<SettingsTabKey, Pagination>>;
  setPermissionConfig: Setter<PermissionConfig | null>;
  setSalespeople: Setter<SalespersonOption[]>;
  setSelectedNotificationTemplateType: Setter<string>;
  setShipsgoIntegrationForm: Setter<ShipsgoIntegrationForm | null>;
  setShipsgoIntegrationSettings: Setter<ShipsgoIntegrationSettings | null>;
  setSuppliers: Setter<SupplierRow[]>;
  setUsers: Setter<UserRow[]>;
};

export function useSettingsLoadActions(context: SettingsLoadActionsContext) {
  const {
    activePagination,
    activeSuppliers,
    activeTab,
    filters,
    permissionConfig,
    selectedNotificationTemplateType,
    setActiveSuppliers,
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
  } = context;

async function loadTab(tab = activeTab, page = activePagination.page || 1, nextFilters = filtersForTab(filters, tab)) {
    setLoading(true);
    setError("");
    try {
      if (tab === "home") {
        markLoaded(tab);
        return;
      }
      if (tab === "companyProfile") {
        const result = await apiJson<{ settings: CompanyProfileSettings }>("/api/settings/company-profile");
        const settings = result.settings || {};
        setCompanyProfileSettings(settings);
        setCompanyProfileForm(companyProfileFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "businessEntities") {
        const result = await apiJson<{ entities?: BusinessEntityRow[] }>("/api/settings/business-entities");
        setBusinessEntities(result.entities || []);
        markLoaded(tab);
        return;
      }
      if (tab === "exchangeRates") {
        const result = await apiJson<{ settings: ExchangeRateSettings }>("/api/settings/exchange-rates");
        const settings = result.settings || {};
        setExchangeSettings(settings);
        setExchangeForm(exchangeFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "commissionFormula") {
        const result = await apiJson<{ settings: CommissionFormulaSettings }>("/api/settings/commission-formula");
        const settings = result.settings || {};
        setCommissionFormulaSettings(settings);
        setCommissionFormulaForm(commissionFormulaFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "notificationTemplates") {
        const settings = await fetchNotificationTemplateSettings();
        const templates = notificationTemplateRows(settings);
        const nextType = selectedNotificationTemplateType && templates.some((template) => template.type === selectedNotificationTemplateType)
          ? selectedNotificationTemplateType
          : templates[0]?.type || "";
        setNotificationTemplateSettings(settings);
        setSelectedNotificationTemplateType(nextType);
        setNotificationTemplateForm(notificationTemplateFormFromSettings(settings, nextType));
        markLoaded(tab);
        return;
      }
      if (tab === "ocrIntegration") {
        const ocrResult = await apiJson<{ settings: OcrIntegrationSettings }>("/api/settings/ocr");
        const ocrSettings = ocrResult.settings || {};
        setOcrIntegrationSettings(ocrSettings);
        setOcrIntegrationForm(ocrIntegrationFormFromSettings(ocrSettings));
        markLoaded(tab);
        return;
      }
      if (tab === "shipsgoIntegration") {
        const shipsgoResult = await apiJson<{ settings: ShipsgoIntegrationSettings }>("/api/settings/freightower");
        const settings = shipsgoResult.settings || {};
        setShipsgoIntegrationSettings(settings);
        setShipsgoIntegrationForm(shipsgoIntegrationFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "users") {
        await ensurePermissionConfig();
      }
      const pageSize = tab === "auditLogs" ? AUDIT_PAGE_SIZE : PAGE_SIZE;
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      appendFilterParams(params, tab, nextFilters);
      const result = await apiJson<{
        customers?: CustomerRow[];
        suppliers?: SupplierRow[];
        users?: UserRow[];
        logs?: AuditLogRow[];
        pagination?: Pagination;
      }>(`/api/settings/${kebabTab(tab)}?${params}`);
      if (tab === "customers" || tab === "customerProducts") {
        setCustomers(result.customers || []);
        setSalespeople((result as { salespeople?: SalespersonOption[] }).salespeople || []);
      }
      if (tab === "suppliers") setSuppliers(result.suppliers || []);
      if (tab === "users") setUsers(result.users || []);
      if (tab === "auditLogs") setLogs(result.logs || []);
      setPagination((current) => ({
        ...current,
        [tab]: result.pagination || emptyPagination(pageSize),
      }));
      markLoaded(tab);
      setDetailRow(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取系统设置失败");
    } finally {
      setLoading(false);
    }
  }

async function fetchNotificationTemplateSettings() {
    const result = await apiJson<{ settings: NotificationTemplateSettings }>("/api/settings/notification-templates");
    return result.settings || {};
  }

function markLoaded(tab: SettingsTabKey) {
    setLoadedTabs((current) => new Set(current).add(tab));
  }

async function ensureActiveSuppliers() {
    if (activeSuppliers.length) return;
    try {
      const result = await apiJson<{ suppliers?: SupplierRow[] }>("/api/suppliers/available");
      setActiveSuppliers(result.suppliers || []);
    } catch {
      setActiveSuppliers([]);
    }
  }

async function ensurePermissionConfig() {
    if (permissionConfig) return permissionConfig;
    const result = await apiJson<{ permissions?: PermissionConfig }>("/api/settings/permissions");
    const nextConfig = result.permissions || {};
    setPermissionConfig(nextConfig);
    return nextConfig;
  }

  return {
    loadTab,
    fetchNotificationTemplateSettings,
    markLoaded,
    ensureActiveSuppliers,
    ensurePermissionConfig,
  };
}
