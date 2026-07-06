import { type FormEvent, useEffect, useState } from "react";
import { apiJson } from "../../api";
import { PermissionSelectItem, UiSwitch } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import type { CompanyProfileSettings } from "../../types";
import { BooleanSelect } from "./common-controls";
import {
  COMMISSION_FORMULA_DEDUCTIONS,
  COMMISSION_FORMULA_PRESETS,
  COMMISSION_FORMULA_SOURCES,
  EXCHANGE_RATE_SOURCES,
  EXCHANGE_RATE_TYPES,
  NOTIFICATION_RECIPIENT_EMAIL_OPTIONS,
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
  LogisticsInvoiceValidationRules,
  ShipsgoIntegrationForm,
  ShipsgoIntegrationSettings,
} from "./types";

export function OcrIntegrationSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: OcrIntegrationSettings | null;
  form: OcrIntegrationForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: OcrIntegrationForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [validationRules, setValidationRules] = useState<LogisticsInvoiceValidationRules | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesMessage, setRulesMessage] = useState("");

  useEffect(() => {
    let alive = true;
    setRulesLoading(true);
    setRulesMessage("");
    apiJson<{ rules?: LogisticsInvoiceValidationRules }>("/api/settings/logistics-invoice-validation-rules")
      .then((result) => {
        if (!alive) return;
        setValidationRules(result.rules || {});
      })
      .catch((error) => {
        if (!alive) return;
        setRulesMessage(error instanceof Error ? error.message : "物流费用发票校验规则加载失败");
      })
      .finally(() => {
        if (alive) setRulesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载 OCR 设置</div>;
  const currentForm = form || ocrIntegrationFormFromSettings(settings);
  const hasCredential = Boolean(
    currentForm.appCodeConfigured ||
    currentForm.appCode ||
    currentForm.accessKeyIdConfigured ||
    currentForm.accessKeyId,
  );
  const statusTone = currentForm.enabled ? (hasCredential ? "success" : "warning") : "muted";
  const statusLabel = currentForm.enabled ? (hasCredential ? "已启用" : "待填写密钥") : "已关闭";

  function setField<K extends keyof OcrIntegrationForm>(key: K, value: OcrIntegrationForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function toggleFeature(key: typeof OCR_FEATURE_OPTIONS[number]["key"]) {
    setField(key, !currentForm[key]);
  }

  function updateRuleKeywords(key: string, value: string) {
    setValidationRules((current) => {
      const rules = current || {};
      const existing = rules[key] || { label: key, keywords: [] };
      return {
        ...rules,
        [key]: {
          ...existing,
          keywords: value
            .split(/[\n,，;；]+/)
            .map((item) => item.trim())
            .filter(Boolean),
        },
      };
    });
  }

  async function saveValidationRules() {
    if (!validationRules) return;
    setRulesSaving(true);
    setRulesMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; rules?: LogisticsInvoiceValidationRules }>(
        "/api/settings/logistics-invoice-validation-rules",
        {
          method: "PATCH",
          body: JSON.stringify({ rules: validationRules }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "物流费用发票校验规则保存失败");
      setValidationRules(result.rules || validationRules);
      setRulesMessage(result.message || "物流费用发票校验规则已保存");
    } catch (error) {
      setRulesMessage(error instanceof Error ? error.message : "物流费用发票校验规则保存失败");
    } finally {
      setRulesSaving(false);
    }
  }

  return (
    <SettingsPage
      title="OCR识别"
      description="统一管理 OCR 服务配置、密钥和启用范围。"
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

      <SettingsCard title="基础配置" icon="OCR">
        <div className={styles.settingsFieldGrid}>
          <SettingsSwitch
            label="启用 OCR 服务"
            tooltip="关闭后 OCR 能力不会执行。"
            checked={currentForm.enabled}
            onChange={(value) => setField("enabled", value)}
          />
          <SettingsField label="服务商">
            <select value={currentForm.provider} onChange={(event) => setField("provider", event.target.value)}>
              <option value="ALIYUN">阿里云 OCR</option>
            </select>
          </SettingsField>
          <SettingsField label="API Base URL">
            <input
              value={currentForm.apiBaseUrl}
              onChange={(event) => setField("apiBaseUrl", event.target.value)}
              placeholder="https://ocr-api.cn-hangzhou.aliyuncs.com"
            />
          </SettingsField>
          <SettingsField label="请求超时">
            <input
              value={currentForm.timeoutMs}
              onChange={(event) => setField("timeoutMs", event.target.value)}
              inputMode="numeric"
              min={3000}
              type="number"
            />
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard title="API 密钥" icon="AK">
        <div className={styles.settingsFieldGrid}>
          <SettingsField label="AppCode">
            <SecretField
              value={currentForm.appCode}
              onChange={(value) => setField("appCode", value)}
              placeholder={currentForm.appCodeConfigured ? "已配置，留空则保持不变" : "可选：旧版 AppCode"}
            />
          </SettingsField>
          <SettingsField label="AccessKey ID">
            <SecretField
              value={currentForm.accessKeyId}
              onChange={(value) => setField("accessKeyId", value)}
              placeholder={currentForm.accessKeyIdConfigured ? "已配置，留空则保持不变" : "可选：AccessKey ID"}
            />
          </SettingsField>
          <SettingsField label="AccessKey Secret">
            <SecretField
              value={currentForm.accessKeySecret}
              onChange={(value) => setField("accessKeySecret", value)}
              placeholder={currentForm.accessKeySecretConfigured ? "已配置，留空则保持不变" : "可选：AccessKey Secret"}
            />
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard title="启用范围" icon="能">
        <div className={styles.commissionDeductionGrid}>
          {OCR_FEATURE_OPTIONS.map((item) => (
            <PermissionSelectItem
              key={item.key}
              label={item.label}
              description={item.description}
              checked={Boolean(currentForm[item.key])}
              onChange={() => toggleFeature(item.key)}
            />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="物流费用发票校验规则" icon="规">
        {rulesMessage ? (
          <div className={rulesMessage.includes("失败") || rulesMessage.includes("无权限") || rulesMessage.includes("错误") ? styles.inlineError : styles.emptyState}>
            {rulesMessage}
          </div>
        ) : null}
        {rulesLoading ? (
          <div className={styles.emptyState}>规则加载中...</div>
        ) : (
          <div className={styles.settingsFieldGrid}>
            {Object.entries(validationRules || {}).map(([key, rule]) => (
              <label className={styles.notificationTemplateField} key={key}>
                {rule.label}
                <textarea
                  value={(rule.keywords || []).join("\n")}
                  onChange={(event) => updateRuleKeywords(key, event.target.value)}
                  placeholder="每行一个可匹配品名"
                  rows={4}
                />
              </label>
            ))}
          </div>
        )}
        <div className={styles.inlineActionGroup}>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={rulesSaving || rulesLoading || !validationRules}
            onClick={() => void saveValidationRules()}
          >
            {rulesSaving ? "保存中..." : "保存校验规则"}
          </button>
        </div>
      </SettingsCard>

      <div className={styles.emptyState}>增值税发票及采购合同结构化识别需要 AccessKey ID / AccessKey Secret。报关单 OCR 已停用，不再提供相关配置。</div>
    </SettingsPage>
  );
}
