import {
  CommissionFormulaSettingsCard,
  BusinessEntitySettingsCard,
  CompanyProfileSettingsCard,
  ExchangeSettingsCard,
  NotificationTemplateSettingsCard,
  OcrIntegrationSettingsCard,
  FreightowerIntegrationSettingsCard,
} from "./settings-cards";
import {
  commissionFormulaFormFromSettings,
  companyProfileFormFromSettings,
  exchangeFormFromSettings,
  notificationTemplateFormFromSettings,
  ocrIntegrationFormFromSettings,
  shipsgoIntegrationFormFromSettings,
} from "./helpers";
import { SettingsHomeGrid } from "./settings-home-grid";
import { SettingsTableContent } from "./module-edit-panels";
import type { useSettingsController } from "./use-settings-controller";
import type { OcrValidationRulesDraft } from "./ocr-integration-settings-card";
import { WechatOfficialSettingsCard } from "./wechat-official-settings-card";

type SettingsController = ReturnType<typeof useSettingsController> & {
  ocrValidationRulesDraft: OcrValidationRulesDraft;
  confirmDiscardCurrentSettings: () => boolean;
  setWechatSettingsDirty: (dirty: boolean) => void;
  setWechatSettingsBusy: (busy: boolean) => void;
};

export function SettingsModuleTabContent({ settings }: { settings: SettingsController }) {
  const {
    activeTab,
    businessEntities,
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
    loadedTabs,
    loading,
    businessEntityForm,
    businessEntitySaving,
    businessEntityMessage,
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
    ocrValidationRulesDraft,
    confirmDiscardCurrentSettings,
    shipsgoIntegrationSaving,
    shipsgoIntegrationMessage,
    selectTab,
    startCreateBusinessEntity,
    startEditBusinessEntity,
    cancelBusinessEntityEdit,
    saveBusinessEntityForm,
    saveCompanyProfileSettings,
    saveExchangeSettings,
    refreshExchangeRatesManually,
    saveCommissionFormulaSettings,
    saveNotificationTemplateSettings,
    selectNotificationTemplate,
    saveOcrIntegrationSettings,
    saveShipsgoIntegrationSettings,
    setBusinessEntityForm,
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
    setWechatSettingsDirty,
    setWechatSettingsBusy,
  } = settings;

  if (activeTab === "home") return <SettingsHomeGrid onSelect={selectTab} />;
  if (activeTab === "companyProfile") {
    return (
      <CompanyProfileSettingsCard
        settings={companyProfileSettings}
        form={companyProfileForm}
        loading={loading && !companyProfileSettings}
        saving={companyProfileSaving}
        message={companyProfileMessage}
        onChange={setCompanyProfileForm}
        onReset={() => {
          setCompanyProfileForm(companyProfileFormFromSettings(companyProfileSettings));
          setCompanyProfileMessage("");
        }}
        onSubmit={saveCompanyProfileSettings}
      />
    );
  }
  if (activeTab === "businessEntities") {
    return (
      <BusinessEntitySettingsCard
        entities={businessEntities}
        form={businessEntityForm}
        loading={loading && !loadedTabs.has("businessEntities")}
        saving={businessEntitySaving}
        message={businessEntityMessage}
        onChange={setBusinessEntityForm}
        onCreate={() => {
          if (confirmDiscardCurrentSettings()) startCreateBusinessEntity();
        }}
        onEdit={(entity) => {
          if (confirmDiscardCurrentSettings()) startEditBusinessEntity(entity);
        }}
        onCancel={() => {
          if (confirmDiscardCurrentSettings()) cancelBusinessEntityEdit();
        }}
        onSubmit={saveBusinessEntityForm}
      />
    );
  }
  if (activeTab === "exchangeRates") {
    return (
      <ExchangeSettingsCard
        settings={exchangeSettings}
        form={exchangeForm}
        loading={loading && !exchangeSettings}
        saving={exchangeSaving}
        message={exchangeMessage}
        refreshing={exchangeRefreshing}
        onChange={setExchangeForm}
        onReset={() => {
          setExchangeForm(exchangeFormFromSettings(exchangeSettings));
          setExchangeMessage("");
        }}
        onRefresh={refreshExchangeRatesManually}
        onSubmit={saveExchangeSettings}
      />
    );
  }
  if (activeTab === "commissionFormula") {
    return (
      <CommissionFormulaSettingsCard
        settings={commissionFormulaSettings}
        form={commissionFormulaForm}
        loading={loading && !commissionFormulaSettings}
        saving={commissionFormulaSaving}
        message={commissionFormulaMessage}
        onChange={setCommissionFormulaForm}
        onReset={() => {
          setCommissionFormulaForm(commissionFormulaFormFromSettings(commissionFormulaSettings));
          setCommissionFormulaMessage("");
        }}
        onSubmit={saveCommissionFormulaSettings}
      />
    );
  }
  if (activeTab === "notificationTemplates") {
    return (
      <NotificationTemplateSettingsCard
        settings={notificationTemplateSettings}
        form={notificationTemplateForm}
        selectedType={selectedNotificationTemplateType}
        loading={loading && !notificationTemplateSettings}
        saving={notificationTemplateSaving}
        message={notificationTemplateMessage}
        onChange={setNotificationTemplateForm}
        onSelectType={(templateType) => {
          if (confirmDiscardCurrentSettings()) selectNotificationTemplate(templateType);
        }}
        onReset={() => {
          setNotificationTemplateForm(notificationTemplateFormFromSettings(notificationTemplateSettings, selectedNotificationTemplateType));
          setNotificationTemplateMessage("");
        }}
        onSubmit={saveNotificationTemplateSettings}
      />
    );
  }
  if (activeTab === "ocrIntegration") {
    return (
      <OcrIntegrationSettingsCard
        settings={ocrIntegrationSettings}
        form={ocrIntegrationForm}
        loading={loading && !ocrIntegrationSettings}
        saving={ocrIntegrationSaving}
        message={ocrIntegrationMessage}
        onChange={setOcrIntegrationForm}
        onReset={() => {
          setOcrIntegrationForm(ocrIntegrationFormFromSettings(ocrIntegrationSettings));
          setOcrIntegrationMessage("");
        }}
        onSubmit={saveOcrIntegrationSettings}
        validationRulesDraft={ocrValidationRulesDraft}
      />
    );
  }
  if (activeTab === "shipsgoIntegration") {
    return (
      <>
        <FreightowerIntegrationSettingsCard
          settings={shipsgoIntegrationSettings}
          form={shipsgoIntegrationForm}
          loading={loading && !shipsgoIntegrationSettings}
          saving={shipsgoIntegrationSaving}
          message={shipsgoIntegrationMessage}
          onChange={setShipsgoIntegrationForm}
          onReset={() => {
            setShipsgoIntegrationForm(shipsgoIntegrationFormFromSettings(shipsgoIntegrationSettings));
            setShipsgoIntegrationMessage("");
          }}
          onSubmit={saveShipsgoIntegrationSettings}
        />
        <WechatOfficialSettingsCard
          onDirtyChange={setWechatSettingsDirty}
          onBusyChange={setWechatSettingsBusy}
        />
      </>
    );
  }
  return <SettingsTableContent settings={settings} />;
}
