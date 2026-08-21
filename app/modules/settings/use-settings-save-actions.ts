import type { Dispatch, SetStateAction } from "react";
import type { CompanyProfileSettings } from "../../types";
import type {
  BusinessEntityForm,
  BusinessEntityRow,
  CommissionFormulaForm,
  CommissionFormulaSettings,
  CompanyProfileForm,
  CrmEmailIntegrationForm,
  CrmEmailIntegrationSettings,
  CustomerForm,
  ExchangeRateForm,
  ExchangeRateSettings,
  NotificationTemplateForm,
  NotificationTemplateSettings,
  OcrIntegrationForm,
  OcrIntegrationSettings,
  Pagination,
  SettingsFilters,
  SettingsTabKey,
  ShipsgoIntegrationForm,
  ShipsgoIntegrationSettings,
  SmsIntegrationForm,
  SmsIntegrationSettings,
  SupplierForm,
  SupplierRow,
  UserForm,
} from "./types";
import { useSettingsEntitySaveActions } from "./use-settings-entity-save-actions";
import { useSettingsSystemSaveActions } from "./use-settings-system-save-actions";

type Setter<T> = Dispatch<SetStateAction<T>>;

export type SettingsSaveActionsContext = {
  activePagination: Pagination;
  activeSuppliers: SupplierRow[];
  businessEntityForm: BusinessEntityForm | null;
  commissionFormulaForm: CommissionFormulaForm | null;
  companyProfileForm: CompanyProfileForm | null;
  customerForm: CustomerForm | null;
  exchangeForm: ExchangeRateForm | null;
  filters: SettingsFilters;
  loadTab: (...args: any[]) => Promise<void>;
  markLoaded: (tab: SettingsTabKey) => void;
  notificationTemplateForm: NotificationTemplateForm | null;
  notificationTemplateSettings: NotificationTemplateSettings | null;
  ocrIntegrationForm: OcrIntegrationForm | null;
  smsIntegrationForm: SmsIntegrationForm | null;
  crmEmailIntegrationForm: CrmEmailIntegrationForm | null;
  onCompanyProfileSaved?: (settings: CompanyProfileSettings) => void;
  selectedNotificationTemplateType: string;
  setBusinessEntities: Setter<BusinessEntityRow[]>;
  setBusinessEntityForm: Setter<BusinessEntityForm | null>;
  setBusinessEntityMessage: Setter<string>;
  setBusinessEntitySaving: Setter<boolean>;
  setCommissionFormulaForm: Setter<CommissionFormulaForm | null>;
  setCommissionFormulaMessage: Setter<string>;
  setCommissionFormulaSaving: Setter<boolean>;
  setCommissionFormulaSettings: Setter<CommissionFormulaSettings | null>;
  setCompanyProfileForm: Setter<CompanyProfileForm | null>;
  setCompanyProfileMessage: Setter<string>;
  setCompanyProfileSaving: Setter<boolean>;
  setCompanyProfileSettings: Setter<CompanyProfileSettings | null>;
  setCustomerForm: Setter<CustomerForm | null>;
  setCustomerMessage: Setter<string>;
  setCustomerSaving: Setter<boolean>;
  setExchangeForm: Setter<ExchangeRateForm | null>;
  setExchangeMessage: Setter<string>;
  setExchangeSaving: Setter<boolean>;
  setExchangeSettings: Setter<ExchangeRateSettings | null>;
  setNotificationTemplateForm: Setter<NotificationTemplateForm | null>;
  setNotificationTemplateMessage: Setter<string>;
  setNotificationTemplateSaving: Setter<boolean>;
  setNotificationTemplateSettings: Setter<NotificationTemplateSettings | null>;
  setOcrIntegrationForm: Setter<OcrIntegrationForm | null>;
  setOcrIntegrationMessage: Setter<string>;
  setOcrIntegrationSaving: Setter<boolean>;
  setOcrIntegrationSettings: Setter<OcrIntegrationSettings | null>;
  setSmsIntegrationForm: Setter<SmsIntegrationForm | null>;
  setSmsIntegrationMessage: Setter<string>;
  setSmsIntegrationSaving: Setter<boolean>;
  setSmsIntegrationSettings: Setter<SmsIntegrationSettings | null>;
  setCrmEmailIntegrationForm: Setter<CrmEmailIntegrationForm | null>;
  setCrmEmailIntegrationMessage: Setter<string>;
  setCrmEmailIntegrationSaving: Setter<boolean>;
  setCrmEmailIntegrationSettings: Setter<CrmEmailIntegrationSettings | null>;
  setSelectedNotificationTemplateType: Setter<string>;
  setSelectedUserId: Setter<string>;
  setShipsgoIntegrationForm: Setter<ShipsgoIntegrationForm | null>;
  setShipsgoIntegrationMessage: Setter<string>;
  setShipsgoIntegrationSaving: Setter<boolean>;
  setShipsgoIntegrationSettings: Setter<ShipsgoIntegrationSettings | null>;
  setSupplierForm: Setter<SupplierForm | null>;
  setSupplierMessage: Setter<string>;
  setSupplierPanelMode: Setter<"view" | "edit">;
  setSupplierSaving: Setter<boolean>;
  setSuppliers: Setter<SupplierRow[]>;
  setUserForm: Setter<UserForm | null>;
  setUserMessage: Setter<string>;
  setUserSaving: Setter<boolean>;
  shipsgoIntegrationForm: ShipsgoIntegrationForm | null;
  supplierForm: SupplierForm | null;
  suppliers: SupplierRow[];
  userForm: UserForm | null;
  fetchNotificationTemplateSettings: () => Promise<NotificationTemplateSettings>;
};


export function useSettingsSaveActions(context: SettingsSaveActionsContext) {
  return {
    ...useSettingsEntitySaveActions(context),
    ...useSettingsSystemSaveActions(context),
  };
}
