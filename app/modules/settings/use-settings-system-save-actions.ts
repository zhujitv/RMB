import type { FormEvent } from "react";
import { apiJson } from "../../api";
import type { CompanyProfileSettings } from "../../types";
import { DEFAULT_OCR_INTEGRATION_FORM } from "./constants";
import {
  commissionFormulaFormFromSettings,
  companyProfileFormFromSettings,
  exchangeFormFromSettings,
  notificationTemplateFormFromSettings,
  ocrIntegrationFormFromSettings,
  shipsgoIntegrationFormFromSettings,
  smsIntegrationEnableValidationMessage,
  smsIntegrationFormFromSettings,
} from "./helpers";
import type {
  CommissionFormulaSettings,
  ExchangeRateSettings,
  NotificationTemplateSettings,
  OcrIntegrationSettings,
  ShipsgoIntegrationSettings,
  SmsIntegrationSettings,
} from "./types";
import type { SettingsSaveActionsContext } from "./use-settings-save-actions";

export function useSettingsSystemSaveActions(context: SettingsSaveActionsContext) {
  const {
    commissionFormulaForm,
    companyProfileForm,
    exchangeForm,
    fetchNotificationTemplateSettings,
    markLoaded,
    notificationTemplateForm,
    notificationTemplateSettings,
    ocrIntegrationForm,
    smsIntegrationForm,
    onCompanyProfileSaved,
    selectedNotificationTemplateType,
    setCommissionFormulaForm,
    setCommissionFormulaMessage,
    setCommissionFormulaSaving,
    setCommissionFormulaSettings,
    setCompanyProfileForm,
    setCompanyProfileMessage,
    setCompanyProfileSaving,
    setCompanyProfileSettings,
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
    setSmsIntegrationForm,
    setSmsIntegrationMessage,
    setSmsIntegrationSaving,
    setSmsIntegrationSettings,
    setSelectedNotificationTemplateType,
    setShipsgoIntegrationForm,
    setShipsgoIntegrationMessage,
    setShipsgoIntegrationSaving,
    setShipsgoIntegrationSettings,
    shipsgoIntegrationForm,
  } = context;

async function saveCompanyProfileSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyProfileForm) return;
    if (!companyProfileForm.brandName.trim()) {
      setCompanyProfileMessage("请填写品牌名称");
      return;
    }
    if (!companyProfileForm.systemName.trim()) {
      setCompanyProfileMessage("请填写系统名称");
      return;
    }
    if (!companyProfileForm.companyNameZh.trim()) {
      setCompanyProfileMessage("请填写公司中文名称");
      return;
    }
    setCompanyProfileSaving(true);
    setCompanyProfileMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: CompanyProfileSettings; message?: string }>(
        "/api/settings/company-profile",
        {
          method: "PATCH",
          body: JSON.stringify(companyProfileForm),
        },
      );
      if (result.success !== true) throw new Error(result.message || "公司资料保存失败");
      const nextSettings = result.settings || companyProfileForm;
      setCompanyProfileSettings(nextSettings);
      setCompanyProfileForm(companyProfileFormFromSettings(nextSettings));
      onCompanyProfileSaved?.(nextSettings);
      markLoaded("companyProfile");
      setCompanyProfileMessage(result.message || "公司资料已保存");
    } catch (saveError) {
      setCompanyProfileMessage(saveError instanceof Error ? saveError.message : "公司资料保存失败");
    } finally {
      setCompanyProfileSaving(false);
    }
  }

async function saveExchangeSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!exchangeForm) return;
    setExchangeSaving(true);
    setExchangeMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: ExchangeRateSettings; message?: string }>(
        "/api/exchange-rates/settings",
        {
          method: "PATCH",
          body: JSON.stringify(exchangeForm),
        },
      );
      if (result.success !== true) throw new Error(result.message || "汇率设置保存失败");
      const nextSettings = result.settings || exchangeForm;
      setExchangeSettings(nextSettings);
      setExchangeForm(exchangeFormFromSettings(nextSettings));
      markLoaded("exchangeRates");
      setExchangeMessage(result.message || "汇率设置已保存");
    } catch (saveError) {
      setExchangeMessage(saveError instanceof Error ? saveError.message : "汇率设置保存失败");
    } finally {
      setExchangeSaving(false);
    }
  }

async function saveCommissionFormulaSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!commissionFormulaForm) return;
    setCommissionFormulaSaving(true);
    setCommissionFormulaMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: CommissionFormulaSettings; message?: string }>(
        "/api/commission-formula/settings",
        {
          method: "PATCH",
          body: JSON.stringify(commissionFormulaForm),
        },
      );
      if (result.success !== true) throw new Error(result.message || "提成公式设置保存失败");
      const nextSettings = result.settings || commissionFormulaForm;
      setCommissionFormulaSettings(nextSettings);
      setCommissionFormulaForm(commissionFormulaFormFromSettings(nextSettings));
      markLoaded("commissionFormula");
      setCommissionFormulaMessage(result.message || "提成公式设置已保存");
    } catch (saveError) {
      setCommissionFormulaMessage(saveError instanceof Error ? saveError.message : "提成公式设置保存失败");
    } finally {
      setCommissionFormulaSaving(false);
    }
  }

async function saveNotificationTemplateSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!notificationTemplateForm) return;
    setNotificationTemplateSaving(true);
    setNotificationTemplateMessage("");
    try {
      const payload = { ...notificationTemplateForm };
      const result = await apiJson<{ success?: boolean; settings?: NotificationTemplateSettings; message?: string }>(
        "/api/settings/notification-templates",
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      );
      if (result.success !== true) throw new Error(result.message || "通知模板保存失败");
      const nextSettings = await fetchNotificationTemplateSettings();
      const nextType = notificationTemplateForm.type || selectedNotificationTemplateType;
      setNotificationTemplateSettings(nextSettings);
      setSelectedNotificationTemplateType(nextType);
      setNotificationTemplateForm(notificationTemplateFormFromSettings(nextSettings, nextType));
      markLoaded("notificationTemplates");
      setNotificationTemplateMessage(result.message || "通知模板已保存");
    } catch (saveError) {
      setNotificationTemplateMessage(saveError instanceof Error ? saveError.message : "通知模板保存失败");
    } finally {
      setNotificationTemplateSaving(false);
    }
  }

function selectNotificationTemplate(type: string) {
    setSelectedNotificationTemplateType(type);
    setNotificationTemplateForm(notificationTemplateFormFromSettings(notificationTemplateSettings, type));
    setNotificationTemplateMessage("");
  }

  async function saveShipsgoIntegrationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shipsgoIntegrationForm) return;
    setShipsgoIntegrationSaving(true);
    setShipsgoIntegrationMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: ShipsgoIntegrationSettings; message?: string }>(
        "/api/settings/freightower",
        {
          method: "PATCH",
          body: JSON.stringify(shipsgoIntegrationForm),
        },
      );
      if (result.success !== true) throw new Error(result.message || "物流接口设置保存失败");
      const nextSettings = result.settings || shipsgoIntegrationForm;
      setShipsgoIntegrationSettings(nextSettings);
      setShipsgoIntegrationForm(shipsgoIntegrationFormFromSettings(nextSettings));
      markLoaded("shipsgoIntegration");
      setShipsgoIntegrationMessage(result.message || "物流接口设置已保存");
    } catch (saveError) {
      setShipsgoIntegrationMessage(saveError instanceof Error ? saveError.message : "物流接口设置保存失败");
    } finally {
      setShipsgoIntegrationSaving(false);
    }
  }

async function saveSmsIntegrationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!smsIntegrationForm) return;
    const validationMessage = smsIntegrationEnableValidationMessage(smsIntegrationForm);
    if (validationMessage) {
      setSmsIntegrationMessage(validationMessage);
      return;
    }
    setSmsIntegrationSaving(true);
    setSmsIntegrationMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: SmsIntegrationSettings; message?: string }>(
        "/api/settings/sms",
        {
          method: "PATCH",
          body: JSON.stringify(smsIntegrationForm),
        },
      );
      if (result.success !== true) throw new Error(result.message || "短信通知设置保存失败");
      const nextSettings = result.settings || smsIntegrationForm;
      setSmsIntegrationSettings(nextSettings);
      setSmsIntegrationForm(smsIntegrationFormFromSettings(nextSettings));
      markLoaded("smsIntegration");
      setSmsIntegrationMessage(result.message || "短信通知设置已保存");
    } catch (saveError) {
      setSmsIntegrationMessage(saveError instanceof Error ? saveError.message : "短信通知设置保存失败");
    } finally {
      setSmsIntegrationSaving(false);
    }
  }

async function saveOcrIntegrationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ocrIntegrationForm) return;
    setOcrIntegrationSaving(true);
    setOcrIntegrationMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: OcrIntegrationSettings; message?: string }>(
        "/api/settings/ocr",
        {
          method: "PATCH",
          body: JSON.stringify({
            ...ocrIntegrationForm,
            timeoutMs: Number(ocrIntegrationForm.timeoutMs || DEFAULT_OCR_INTEGRATION_FORM.timeoutMs),
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "OCR设置保存失败");
      const nextSettings = result.settings || ocrIntegrationForm;
      setOcrIntegrationSettings(nextSettings);
      setOcrIntegrationForm(ocrIntegrationFormFromSettings(nextSettings));
      markLoaded("ocrIntegration");
      setOcrIntegrationMessage(result.message || "OCR设置已保存");
    } catch (saveError) {
      setOcrIntegrationMessage(saveError instanceof Error ? saveError.message : "OCR设置保存失败");
    } finally {
      setOcrIntegrationSaving(false);
    }
  }

  return {
    saveCompanyProfileSettings,
    saveExchangeSettings,
    saveCommissionFormulaSettings,
    saveNotificationTemplateSettings,
    selectNotificationTemplate,
    saveOcrIntegrationSettings,
    saveShipsgoIntegrationSettings,
    saveSmsIntegrationSettings,
  };
}
