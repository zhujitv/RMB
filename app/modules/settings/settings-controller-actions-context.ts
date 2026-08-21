import type { Dispatch, SetStateAction } from "react";
import type { CompanyProfileSettings } from "../../types";
import type {
  AuditLogRow,
  BusinessEntityForm,
  CommissionFormulaForm,
  CommissionFormulaSettings,
  CompanyProfileForm,
  CustomerForm,
  CustomerRow,
  ExchangeRateForm,
  ExchangeRateSettings,
  NotificationTemplateForm,
  NotificationTemplateSettings,
  Pagination,
  PermissionConfig,
  SettingsFilters,
  SettingsTabKey,
  SupplierForm,
  SupplierRow,
  UserForm,
  UserRow,
} from "./types";

type Setter<T> = Dispatch<SetStateAction<T>>;

export type SettingsControllerActionsContext = {
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
  setDetailRow: Setter<CustomerRow | SupplierRow | UserRow | AuditLogRow | null>;
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
  setSmsIntegrationMessage: Setter<string>;
  setCrmEmailIntegrationMessage: Setter<string>;
  setSupplierForm: Setter<SupplierForm | null>;
  setSupplierMessage: Setter<string>;
  setSupplierPanelMode: Setter<"view" | "edit">;
  setSuppliers: Setter<SupplierRow[]>;
  setUserForm: Setter<UserForm | null>;
  setUserMessage: Setter<string>;
};
