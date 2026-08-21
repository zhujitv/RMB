import { useEffect } from "react";
import { useSettingsSaveActions } from "./use-settings-save-actions";
import { useSettingsControllerActions } from "./use-settings-controller-actions";
import { useSettingsLoadActions } from "./use-settings-load-actions";
import { filtersForTab } from "./helpers";
import type { SettingsModuleProps, SettingsTabKey } from "./types";
import { useSettingsState } from "./use-settings-state";

const SETTINGS_TAB_KEYS = new Set<SettingsTabKey>([
  "home",
  "companyProfile",
  "businessEntities",
  "customers",
  "customerProducts",
  "suppliers",
  "users",
  "ocrIntegration",
  "shipsgoIntegration",
  "smsIntegration",
  "crmEmailIntegration",
  "exchangeRates",
  "commissionFormula",
  "notificationTemplates",
  "auditLogs",
]);

function isSettingsTabKey(value: unknown): value is SettingsTabKey {
  return typeof value === "string" && SETTINGS_TAB_KEYS.has(value as SettingsTabKey);
}

export function useSettingsController({ currentUser = null, initialTab, initialTabToken = 0, onCompanyProfileSaved }: SettingsModuleProps = {}) {
  const state = useSettingsState();

  const {
    loadTab,
    fetchNotificationTemplateSettings,
    markLoaded,
    ensureActiveSuppliers,
    ensurePermissionConfig,
  } = useSettingsLoadActions({
    activePagination: state.activePagination,
    activeSuppliers: state.activeSuppliers,
    activeTab: state.activeTab,
    filters: state.filters,
    permissionConfig: state.permissionConfig,
    selectedNotificationTemplateType: state.selectedNotificationTemplateType,
    setActiveSuppliers: state.setActiveSuppliers,
    setBusinessEntities: state.setBusinessEntities,
    setCommissionFormulaForm: state.setCommissionFormulaForm,
    setCommissionFormulaSettings: state.setCommissionFormulaSettings,
    setCompanyProfileForm: state.setCompanyProfileForm,
    setCompanyProfileSettings: state.setCompanyProfileSettings,
    setCustomers: state.setCustomers,
    setDetailRow: state.setDetailRow,
    setError: state.setError,
    setExchangeForm: state.setExchangeForm,
    setExchangeSettings: state.setExchangeSettings,
    setLoadedTabs: state.setLoadedTabs,
    setLoading: state.setLoading,
    setLogs: state.setLogs,
    setNotificationTemplateForm: state.setNotificationTemplateForm,
    setNotificationTemplateSettings: state.setNotificationTemplateSettings,
    setOcrIntegrationForm: state.setOcrIntegrationForm,
    setOcrIntegrationSettings: state.setOcrIntegrationSettings,
    setPagination: state.setPagination,
    setPermissionConfig: state.setPermissionConfig,
    setSalespeople: state.setSalespeople,
    setSelectedNotificationTemplateType: state.setSelectedNotificationTemplateType,
    setShipsgoIntegrationForm: state.setShipsgoIntegrationForm,
    setShipsgoIntegrationSettings: state.setShipsgoIntegrationSettings,
    setSmsIntegrationForm: state.setSmsIntegrationForm,
    setSmsIntegrationSettings: state.setSmsIntegrationSettings,
    setCrmEmailIntegrationForm: state.setCrmEmailIntegrationForm,
    setCrmEmailIntegrationSettings: state.setCrmEmailIntegrationSettings,
    setSuppliers: state.setSuppliers,
    setUsers: state.setUsers,
  });

  const controllerActions = useSettingsControllerActions({
    activePagination: state.activePagination,
    activeTab: state.activeTab,
    exchangeForm: state.exchangeForm,
    exchangeSettings: state.exchangeSettings,
    filters: state.filters,
    loadTab,
    ensureActiveSuppliers,
    ensurePermissionConfig,
    supplierForm: state.supplierForm,
    suppliers: state.suppliers,
    setActiveTab: state.setActiveTab,
    setBusinessEntityForm: state.setBusinessEntityForm,
    setBusinessEntityMessage: state.setBusinessEntityMessage,
    setCommissionFormulaForm: state.setCommissionFormulaForm,
    setCommissionFormulaMessage: state.setCommissionFormulaMessage,
    setCommissionFormulaSettings: state.setCommissionFormulaSettings,
    setCompanyProfileForm: state.setCompanyProfileForm,
    setCompanyProfileMessage: state.setCompanyProfileMessage,
    setCompanyProfileSettings: state.setCompanyProfileSettings,
    setCustomerForm: state.setCustomerForm,
    setCustomerMessage: state.setCustomerMessage,
    setDetailRow: state.setDetailRow,
    setError: state.setError,
    setExchangeForm: state.setExchangeForm,
    setExchangeMessage: state.setExchangeMessage,
    setExchangeRefreshing: state.setExchangeRefreshing,
    setExchangeSettings: state.setExchangeSettings,
    setFilters: state.setFilters,
    setForceDeletingRejectedUserId: state.setForceDeletingRejectedUserId,
    setNotificationTemplateForm: state.setNotificationTemplateForm,
    setNotificationTemplateMessage: state.setNotificationTemplateMessage,
    setNotificationTemplateSettings: state.setNotificationTemplateSettings,
    setOcrIntegrationMessage: state.setOcrIntegrationMessage,
    setSelectedNotificationTemplateType: state.setSelectedNotificationTemplateType,
    setSelectedUserId: state.setSelectedUserId,
    setShipsgoIntegrationMessage: state.setShipsgoIntegrationMessage,
    setSmsIntegrationMessage: state.setSmsIntegrationMessage,
    setCrmEmailIntegrationMessage: state.setCrmEmailIntegrationMessage,
    setSupplierForm: state.setSupplierForm,
    setSupplierMessage: state.setSupplierMessage,
    setSupplierPanelMode: state.setSupplierPanelMode,
    setSuppliers: state.setSuppliers,
    setUserForm: state.setUserForm,
    setUserMessage: state.setUserMessage,
  });

  const saveActions = useSettingsSaveActions({
    activePagination: state.activePagination,
    activeSuppliers: state.activeSuppliers,
    businessEntityForm: state.businessEntityForm,
    commissionFormulaForm: state.commissionFormulaForm,
    companyProfileForm: state.companyProfileForm,
    customerForm: state.customerForm,
    exchangeForm: state.exchangeForm,
    filters: state.filters,
    loadTab,
    markLoaded,
    notificationTemplateForm: state.notificationTemplateForm,
    notificationTemplateSettings: state.notificationTemplateSettings,
    ocrIntegrationForm: state.ocrIntegrationForm,
    smsIntegrationForm: state.smsIntegrationForm,
    crmEmailIntegrationForm: state.crmEmailIntegrationForm,
    onCompanyProfileSaved,
    selectedNotificationTemplateType: state.selectedNotificationTemplateType,
    setBusinessEntities: state.setBusinessEntities,
    setBusinessEntityForm: state.setBusinessEntityForm,
    setBusinessEntityMessage: state.setBusinessEntityMessage,
    setBusinessEntitySaving: state.setBusinessEntitySaving,
    setCommissionFormulaForm: state.setCommissionFormulaForm,
    setCommissionFormulaMessage: state.setCommissionFormulaMessage,
    setCommissionFormulaSaving: state.setCommissionFormulaSaving,
    setCommissionFormulaSettings: state.setCommissionFormulaSettings,
    setCompanyProfileForm: state.setCompanyProfileForm,
    setCompanyProfileMessage: state.setCompanyProfileMessage,
    setCompanyProfileSaving: state.setCompanyProfileSaving,
    setCompanyProfileSettings: state.setCompanyProfileSettings,
    setCustomerForm: state.setCustomerForm,
    setCustomerMessage: state.setCustomerMessage,
    setCustomerSaving: state.setCustomerSaving,
    setExchangeForm: state.setExchangeForm,
    setExchangeMessage: state.setExchangeMessage,
    setExchangeSaving: state.setExchangeSaving,
    setExchangeSettings: state.setExchangeSettings,
    setNotificationTemplateForm: state.setNotificationTemplateForm,
    setNotificationTemplateMessage: state.setNotificationTemplateMessage,
    setNotificationTemplateSaving: state.setNotificationTemplateSaving,
    setNotificationTemplateSettings: state.setNotificationTemplateSettings,
    setOcrIntegrationForm: state.setOcrIntegrationForm,
    setOcrIntegrationMessage: state.setOcrIntegrationMessage,
    setOcrIntegrationSaving: state.setOcrIntegrationSaving,
    setOcrIntegrationSettings: state.setOcrIntegrationSettings,
    setSmsIntegrationForm: state.setSmsIntegrationForm,
    setSmsIntegrationMessage: state.setSmsIntegrationMessage,
    setSmsIntegrationSaving: state.setSmsIntegrationSaving,
    setSmsIntegrationSettings: state.setSmsIntegrationSettings,
    setCrmEmailIntegrationForm: state.setCrmEmailIntegrationForm,
    setCrmEmailIntegrationMessage: state.setCrmEmailIntegrationMessage,
    setCrmEmailIntegrationSaving: state.setCrmEmailIntegrationSaving,
    setCrmEmailIntegrationSettings: state.setCrmEmailIntegrationSettings,
    setSelectedNotificationTemplateType: state.setSelectedNotificationTemplateType,
    setSelectedUserId: state.setSelectedUserId,
    setShipsgoIntegrationForm: state.setShipsgoIntegrationForm,
    setShipsgoIntegrationMessage: state.setShipsgoIntegrationMessage,
    setShipsgoIntegrationSaving: state.setShipsgoIntegrationSaving,
    setShipsgoIntegrationSettings: state.setShipsgoIntegrationSettings,
    setSupplierForm: state.setSupplierForm,
    setSupplierMessage: state.setSupplierMessage,
    setSupplierPanelMode: state.setSupplierPanelMode,
    setSupplierSaving: state.setSupplierSaving,
    setSuppliers: state.setSuppliers,
    setUserForm: state.setUserForm,
    setUserMessage: state.setUserMessage,
    setUserSaving: state.setUserSaving,
    shipsgoIntegrationForm: state.shipsgoIntegrationForm,
    supplierForm: state.supplierForm,
    suppliers: state.suppliers,
    userForm: state.userForm,
    fetchNotificationTemplateSettings,
  });

  useEffect(() => {
    if (!isSettingsTabKey(initialTab)) return;
    controllerActions.selectTab(initialTab);
  }, [initialTab, initialTabToken]);

  useEffect(() => {
    if (!state.loadedTabs.has(state.activeTab)) {
      void loadTab(state.activeTab, 1, filtersForTab(state.filters, state.activeTab));
    }
  }, [state.activeTab]);

  useEffect(() => {
    if (state.activeTab !== "users" || !state.selectedUserId || !state.userForm) return;
    state.userEditPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [state.activeTab, state.selectedUserId, state.userForm?.id]);

  return {
    ...state,
    canForceDeleteRejectedUsers: currentUser?.role === "管理员",
    ...controllerActions,
    ...saveActions,
  };
}
