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
  NOTIFICATION_RECIPIENT_EMAIL_OPTIONS,
  CUSTOMS_DECLARATION_MODE_OPTIONS,
  OCR_FEATURE_OPTIONS,
  SHIPSGO_FEATURE_OPTIONS,
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
  const hasApiKey = Boolean(currentForm.apiKeyConfigured || currentForm.apiKey);
  const statusTone = currentForm.enabled ? (hasApiKey ? "success" : "warning") : "muted";
  const statusLabel = currentForm.enabled ? (hasApiKey ? "已启用" : "待填写 API Key") : "已关闭";

  function setField<K extends keyof ShipsgoIntegrationForm>(key: K, value: ShipsgoIntegrationForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function toggleFeature(key: typeof SHIPSGO_FEATURE_OPTIONS[number]["key"]) {
    setField(key, !currentForm[key]);
  }

  return (
    <SettingsPage
      title="物流接口"
      description="管理大掌櫃海运跟踪接口、同步策略和前台功能开关。"
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
            label="启用大掌櫃"
            tooltip="关闭后物流信息页面不显示大掌櫃相关入口。"
            checked={currentForm.enabled}
            onChange={(value) => setField("enabled", value)}
          />
          <SettingsField label="API Base URL">
            <input
              value={currentForm.apiBaseUrl}
              onChange={(event) => setField("apiBaseUrl", event.target.value)}
              placeholder="https://api.shipsgo.com"
            />
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
      </SettingsCard>

      <SettingsCard title="API 密钥" icon="Key">
        <div className={styles.settingsFieldGrid}>
          <SettingsField label="API Key">
            <SecretField
              value={currentForm.apiKey}
              onChange={(value) => setField("apiKey", value)}
              placeholder={currentForm.apiKeyConfigured ? "已配置，留空则保持不变" : "请输入大掌櫃 API Key"}
            />
          </SettingsField>
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
