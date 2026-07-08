import { type FormEvent, useRef, useState } from "react";
import { PermissionSelectItem, UiSwitch } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import type { CompanyProfileSettings } from "../../types";
import { uploadFormDataWithProgress, validatePdfUploadFile } from "../../utils";
import { BooleanSelect } from "./common-controls";
import {
  COMMISSION_FORMULA_DEDUCTIONS,
  COMMISSION_FORMULA_PRESETS,
  COMMISSION_FORMULA_SOURCES,
  EXCHANGE_RATE_SOURCES,
	  EXCHANGE_RATE_TYPES,
	  FREIGHTOWER_EXPORT_OPTIONS,
	  FREIGHTOWER_LANG_OPTIONS,
	  NOTIFICATION_RECIPIENT_EMAIL_OPTIONS,
	  OCR_FEATURE_OPTIONS,
	  SHIPSGO_FEATURE_OPTIONS,
	  TRACKING_PROVIDER_OPTIONS,
	} from "./constants";
import {
  businessEntityFormFromRow,
  commissionFormulaFormFromSettings,
  commissionFormulaPreview,
  companyProfileFormFromSettings,
  exchangeFormFromSettings,
  notificationDeliveryLogs,
  notificationTemplateFormFromSettings,
  notificationTemplatePreview,
  notificationTemplateRows,
  ocrIntegrationFormFromSettings,
  shipsgoIntegrationFormFromSettings,
} from "./helpers";
import {
  SecretField,
  SettingsCard,
  SettingsField,
  SettingsPage,
  SettingsSection,
  SettingsStatusTag,
  SettingsSwitch,
} from "./settings-layout";
import type {
  BusinessEntityForm,
  BusinessEntityRow,
  CommissionFormulaForm,
  CommissionFormulaSettings,
  CompanyProfileForm,
  ExchangeRateForm,
  ExchangeRateSettings,
  NotificationTemplateForm,
  NotificationTemplateSettings,
  OcrIntegrationForm,
  OcrIntegrationSettings,
  ShipsgoIntegrationForm,
  ShipsgoIntegrationSettings,
} from "./types";

export function ShipsgoIntegrationSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: ShipsgoIntegrationSettings | null;
  form: ShipsgoIntegrationForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: ShipsgoIntegrationForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载物流接口设置</div>;
	  const currentForm = form || shipsgoIntegrationFormFromSettings(settings);
	  const activeProvider = currentForm.activeProvider === "FREIGHTOWER" ? "FREIGHTOWER" : "SHIPSGO";
	  const hasShipsgoApiKey = Boolean(currentForm.apiKeyConfigured || currentForm.apiKey);
	  const hasFreightowerCredentials = Boolean(
	    (currentForm.freightowerClientIdConfigured || currentForm.freightowerClientId)
	      && (currentForm.freightowerSecretConfigured || currentForm.freightowerSecret),
	  );
	  const activeReady = activeProvider === "FREIGHTOWER"
	    ? currentForm.freightowerEnabled && hasFreightowerCredentials
	    : currentForm.shipsgoEnabled && hasShipsgoApiKey;
	  const statusTone = currentForm.enabled ? (activeReady ? "success" : "warning") : "muted";
	  const statusLabel = currentForm.enabled
	    ? (activeReady ? `已启用 ${activeProvider === "FREIGHTOWER" ? "飞驼可视" : "ShipsGo"}` : "待完善当前接口配置")
	    : "已关闭";

  function setField<K extends keyof ShipsgoIntegrationForm>(key: K, value: ShipsgoIntegrationForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function toggleFeature(key: typeof SHIPSGO_FEATURE_OPTIONS[number]["key"]) {
    setField(key, !currentForm[key]);
  }

  return (
	      <SettingsPage
	        title="物流接口"
	        description="管理 ShipsGo 与飞驼可视海运跟踪接口、同步策略和前台功能开关。"
      status={<SettingsStatusTag tone={statusTone}>{statusLabel}</SettingsStatusTag>}
      onSubmit={onSubmit}
      actions={(
        <>
          <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存"}</button>
          <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复</button>
        </>
      )}
    >
      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

	      <SettingsCard title="基础配置" icon="船">
	        <div className={styles.settingsFieldGrid}>
	          <SettingsSwitch
	            label="启用物流跟踪接口"
	            tooltip="关闭后物流信息页面不显示第三方海运跟踪入口。"
	            checked={currentForm.enabled}
	            onChange={(value) => setField("enabled", value)}
	          />
	          <SettingsField label="当前使用接口">
	            <select
	              value={activeProvider}
	              onChange={(event) => setField("activeProvider", event.target.value)}
	            >
	              {TRACKING_PROVIDER_OPTIONS.map((item) => (
	                <option key={item.value} value={item.value}>{item.label}</option>
	              ))}
	            </select>
	          </SettingsField>
	          <SettingsField label="剩余 Credit 预警阈值">
            <input
              value={currentForm.creditWarningThreshold}
              onChange={(event) => setField("creditWarningThreshold", event.target.value)}
              inputMode="numeric"
              min={0}
              type="number"
            />
          </SettingsField>
          <SettingsField label="每日同步时间">
            <input
              value={currentForm.dailySyncTime}
              onChange={(event) => setField("dailySyncTime", event.target.value)}
              type="time"
            />
          </SettingsField>
	        </div>
	        <SettingsSection title="接口选择">
	          <div className={styles.commissionDeductionGrid}>
	            {TRACKING_PROVIDER_OPTIONS.map((item) => (
	              <PermissionSelectItem
	                key={item.value}
	                label={item.label}
	                description={item.description}
	                checked={activeProvider === item.value}
	                onChange={() => setField("activeProvider", item.value)}
	              />
	            ))}
	          </div>
	        </SettingsSection>
	      </SettingsCard>
	
	      <SettingsCard title="ShipsGo 接口" icon="Key">
	        <div className={styles.settingsFieldGrid}>
	          <SettingsSwitch
	            label="启用 ShipsGo"
	            tooltip="关闭后不会使用 ShipsGo 创建新跟踪，但历史记录仍保留。"
	            checked={currentForm.shipsgoEnabled}
	            onChange={(value) => setField("shipsgoEnabled", value)}
	          />
	          <SettingsField label="API Base URL">
	            <input
	              value={currentForm.apiBaseUrl}
	              onChange={(event) => setField("apiBaseUrl", event.target.value)}
	              placeholder="https://api.shipsgo.com"
	            />
	          </SettingsField>
	          <SettingsField label="API Key">
	            <SecretField
	              value={currentForm.apiKey}
              onChange={(value) => setField("apiKey", value)}
              placeholder={currentForm.apiKeyConfigured ? "已配置，留空则保持不变" : "请输入大掌櫃 API Key"}
            />
	          </SettingsField>
	        </div>
	      </SettingsCard>

	      <SettingsCard title="飞驼可视接口" icon="航">
	        <div className={styles.settingsFieldGrid}>
	          <SettingsSwitch
	            label="启用飞驼可视"
	            tooltip="关闭后不会使用飞驼创建新跟踪，推送入口也会拒绝处理。"
	            checked={currentForm.freightowerEnabled}
	            onChange={(value) => setField("freightowerEnabled", value)}
	          />
	          <SettingsField label="API Base URL">
	            <input
	              value={currentForm.freightowerApiBaseUrl}
	              onChange={(event) => setField("freightowerApiBaseUrl", event.target.value)}
	              placeholder="http://openapi.freightower.com"
	            />
	          </SettingsField>
	          <SettingsField label="Client ID">
	            <SecretField
	              value={currentForm.freightowerClientId}
	              onChange={(value) => setField("freightowerClientId", value)}
	              placeholder={currentForm.freightowerClientIdConfigured ? "已配置，留空则保持不变" : "请输入飞驼 Client ID"}
	            />
	          </SettingsField>
	          <SettingsField label="Secret">
	            <SecretField
	              value={currentForm.freightowerSecret}
	              onChange={(value) => setField("freightowerSecret", value)}
	              placeholder={currentForm.freightowerSecretConfigured ? "已配置，留空则保持不变" : "请输入飞驼 Secret"}
	            />
	          </SettingsField>
	          <SettingsField label="地图 Key">
	            <SecretField
	              value={currentForm.freightowerMapKey}
	              onChange={(value) => setField("freightowerMapKey", value)}
	              placeholder={currentForm.freightowerMapKeyConfigured ? "已配置，留空则保持不变" : "可视化地图密钥"}
	            />
	          </SettingsField>
	          <SettingsField label="推送 Access Secret">
	            <SecretField
	              value={currentForm.freightowerWebhookSecret}
	              onChange={(value) => setField("freightowerWebhookSecret", value)}
	              placeholder={currentForm.freightowerWebhookSecretConfigured ? "已配置，留空则保持不变" : "用于飞驼 HmacSHA1 签名校验"}
	            />
	          </SettingsField>
	          <SettingsField label="默认船公司代码">
	            <input
	              value={currentForm.freightowerDefaultCarrierCode}
	              onChange={(event) => setField("freightowerDefaultCarrierCode", event.target.value)}
	              placeholder="AUTO"
	            />
	          </SettingsField>
	          <SettingsField label="默认港区代码">
	            <input
	              value={currentForm.freightowerDefaultPortCode}
	              onChange={(event) => setField("freightowerDefaultPortCode", event.target.value)}
	              placeholder="例如 CNSHA"
	            />
	          </SettingsField>
	          <SettingsField label="进出口标识">
	            <select
	              value={currentForm.freightowerDefaultIsExport}
	              onChange={(event) => setField("freightowerDefaultIsExport", event.target.value)}
	            >
	              {FREIGHTOWER_EXPORT_OPTIONS.map((item) => (
	                <option key={item.value || "none"} value={item.value}>{item.label}</option>
	              ))}
	            </select>
	          </SettingsField>
	          <SettingsField label="地图语言">
	            <select
	              value={currentForm.freightowerDefaultLang}
	              onChange={(event) => setField("freightowerDefaultLang", event.target.value)}
	            >
	              {FREIGHTOWER_LANG_OPTIONS.map((item) => (
	                <option key={item.value} value={item.value}>{item.label}</option>
	              ))}
	            </select>
	          </SettingsField>
	          <SettingsSwitch
	            label="地图隐藏单号 / 箱号"
	            tooltip="开启后飞驼可视地图使用 hiddenReference=1。"
	            checked={currentForm.freightowerHiddenReference}
	            onChange={(value) => setField("freightowerHiddenReference", value)}
	          />
	        </div>
	      </SettingsCard>

	      <SettingsCard title="推送密钥" icon="Key">
	        <div className={styles.settingsFieldGrid}>
	          <SettingsField label="Webhook Secret">
	            <SecretField
	              value={currentForm.webhookSecret}
              onChange={(value) => setField("webhookSecret", value)}
              placeholder={currentForm.webhookSecretConfigured ? "已配置，留空则保持不变" : "用于校验大掌櫃 Webhook"}
            />
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard title="前台功能显示" icon="显">
        <SettingsSection title="启用范围">
          <div className={styles.commissionDeductionGrid}>
            {SHIPSGO_FEATURE_OPTIONS.map((item) => (
              <PermissionSelectItem
                key={item.key}
                label={item.label}
                description={item.description}
                checked={Boolean(currentForm[item.key])}
                onChange={() => toggleFeature(item.key)}
              />
            ))}
          </div>
        </SettingsSection>
      </SettingsCard>

    </SettingsPage>
  );
}
