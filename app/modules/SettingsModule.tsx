"use client";

import type { SettingsModuleProps } from "./settings/types";
import { SettingsModuleView } from "./settings/module-view";
import { useSettingsController } from "./settings/use-settings-controller";
import { SETTINGS_TABS } from "./settings/constants";
import { useWorkspaceTabBusy, useWorkspaceTabDirty, useWorkspaceTabPresentation } from "../workspace/workspace-tab-context";
import {
  commissionFormulaFormFromSettings,
  companyProfileFormFromSettings,
  exchangeFormFromSettings,
  notificationTemplateFormFromSettings,
  ocrIntegrationFormFromSettings,
  shipsgoIntegrationFormFromSettings,
} from "./settings/settings-config-helpers";
import {
  businessEntityFormFromRow,
  customerFormFromRow,
  emptyBusinessEntityForm,
  emptyCustomerForm,
  emptySupplierForm,
  emptyUserForm,
  supplierFormFromRow,
  userFormFromRow,
} from "./settings/settings-form-helpers";
import { useOcrValidationRulesDraft } from "./settings/ocr-integration-settings-card";

function sameForm(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function SettingsModule(props: SettingsModuleProps = {}) {
  const settings = useSettingsController(props);
  const ocrValidationRulesDraft = useOcrValidationRulesDraft(settings.activeTab === "ocrIntegration");
  const activeTabLabel = SETTINGS_TABS.find((tab) => tab.key === settings.activeTab)?.label || "系统设置";
  const activeCustomer = settings.customers.find((row) => row.id === settings.customerForm?.id);
  const activeSupplier = settings.suppliers.find((row) => row.id === settings.supplierForm?.id);
  const activeBusinessEntity = settings.businessEntities.find((row) => row.id === settings.businessEntityForm?.id);
  const activeUser = settings.users.find((row) => row.id === settings.userForm?.id);
  const settingsFormDirty = Boolean(
    (settings.companyProfileForm && !sameForm(settings.companyProfileForm, companyProfileFormFromSettings(settings.companyProfileSettings)))
    || (settings.exchangeForm && !sameForm(settings.exchangeForm, exchangeFormFromSettings(settings.exchangeSettings)))
    || (settings.commissionFormulaForm && !sameForm(settings.commissionFormulaForm, commissionFormulaFormFromSettings(settings.commissionFormulaSettings)))
    || (settings.notificationTemplateForm && !sameForm(settings.notificationTemplateForm, notificationTemplateFormFromSettings(settings.notificationTemplateSettings, settings.selectedNotificationTemplateType)))
    || (settings.ocrIntegrationForm && !sameForm(settings.ocrIntegrationForm, ocrIntegrationFormFromSettings(settings.ocrIntegrationSettings)))
    || (settings.shipsgoIntegrationForm && !sameForm(settings.shipsgoIntegrationForm, shipsgoIntegrationFormFromSettings(settings.shipsgoIntegrationSettings)))
    || (settings.customerForm && !sameForm(settings.customerForm, activeCustomer ? customerFormFromRow(activeCustomer) : emptyCustomerForm()))
    || (settings.supplierForm && !sameForm(settings.supplierForm, activeSupplier ? supplierFormFromRow(activeSupplier) : emptySupplierForm()))
    || (settings.businessEntityForm && !sameForm(settings.businessEntityForm, activeBusinessEntity ? businessEntityFormFromRow(activeBusinessEntity) : emptyBusinessEntityForm()))
    || (settings.userForm && !sameForm(settings.userForm, activeUser ? userFormFromRow(activeUser) : emptyUserForm()))
  );
  const settingsBusy = settings.customerSaving
    || settings.supplierSaving
    || settings.businessEntitySaving
    || settings.userSaving
    || settings.companyProfileSaving
    || settings.exchangeSaving
    || settings.commissionFormulaSaving
    || settings.notificationTemplateSaving
    || settings.ocrIntegrationSaving
    || settings.shipsgoIntegrationSaving
    || settings.exchangeRefreshing
    || Boolean(settings.forceDeletingRejectedUserId);
  const activeEntityEditorDirty = settings.activeTab === "customers"
    ? Boolean(settings.customerForm && !sameForm(settings.customerForm, activeCustomer ? customerFormFromRow(activeCustomer) : emptyCustomerForm()))
    : settings.activeTab === "suppliers"
      ? Boolean(settings.supplierForm && !sameForm(settings.supplierForm, activeSupplier ? supplierFormFromRow(activeSupplier) : emptySupplierForm()))
      : settings.activeTab === "businessEntities"
        ? Boolean(settings.businessEntityForm && !sameForm(settings.businessEntityForm, activeBusinessEntity ? businessEntityFormFromRow(activeBusinessEntity) : emptyBusinessEntityForm()))
        : settings.activeTab === "users"
          ? Boolean(settings.userForm && !sameForm(settings.userForm, activeUser ? userFormFromRow(activeUser) : emptyUserForm()))
          : false;
  const activeSettingsFormDirty = activeEntityEditorDirty
    || (settings.activeTab === "companyProfile" && Boolean(settings.companyProfileForm && !sameForm(settings.companyProfileForm, companyProfileFormFromSettings(settings.companyProfileSettings))))
    || (settings.activeTab === "exchangeRates" && Boolean(settings.exchangeForm && !sameForm(settings.exchangeForm, exchangeFormFromSettings(settings.exchangeSettings))))
    || (settings.activeTab === "commissionFormula" && Boolean(settings.commissionFormulaForm && !sameForm(settings.commissionFormulaForm, commissionFormulaFormFromSettings(settings.commissionFormulaSettings))))
    || (settings.activeTab === "notificationTemplates" && Boolean(settings.notificationTemplateForm && !sameForm(settings.notificationTemplateForm, notificationTemplateFormFromSettings(settings.notificationTemplateSettings, settings.selectedNotificationTemplateType))))
    || (settings.activeTab === "ocrIntegration" && Boolean(settings.ocrIntegrationForm && !sameForm(settings.ocrIntegrationForm, ocrIntegrationFormFromSettings(settings.ocrIntegrationSettings))))
    || (settings.activeTab === "shipsgoIntegration" && Boolean(settings.shipsgoIntegrationForm && !sameForm(settings.shipsgoIntegrationForm, shipsgoIntegrationFormFromSettings(settings.shipsgoIntegrationSettings))));
  const editorKey = settings.activeTab === "customers" && settings.customerForm
    ? `customer:${settings.customerForm.id || "new"}`
    : settings.activeTab === "suppliers" && settings.supplierForm
      ? `supplier:${settings.supplierForm.id || "new"}`
      : settings.activeTab === "businessEntities" && settings.businessEntityForm
        ? `entity:${settings.businessEntityForm.id || "new"}`
        : settings.activeTab === "users" && settings.userForm
          ? `user:${settings.userForm.id || "new"}`
          : "base";
  useWorkspaceTabDirty(settingsFormDirty);
  useWorkspaceTabBusy(settingsBusy);

  useWorkspaceTabPresentation({
    title: settings.activeTab === "home" ? "系统设置" : `设置 · ${activeTabLabel}`,
    view: settings.activeTab === "home" ? "list" : "edit",
    contextKey: `settings:${settings.activeTab}:${editorKey}`,
  });

  function confirmDiscardCurrentSettings() {
    if (settingsBusy) {
      window.alert("当前设置正在保存，请完成后再继续。");
      return false;
    }
    if (activeSettingsFormDirty && !window.confirm("当前设置内容尚未保存，确定放弃吗？")) return false;
    return true;
  }

  return (
    <SettingsModuleView
      {...settings}
      ocrValidationRulesDraft={ocrValidationRulesDraft}
      confirmDiscardCurrentSettings={confirmDiscardCurrentSettings}
    />
  );
}
