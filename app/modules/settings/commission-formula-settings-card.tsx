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

export function CommissionFormulaSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: CommissionFormulaSettings | null;
  form: CommissionFormulaForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: CommissionFormulaForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载提成公式设置</div>;
  const currentForm = form || commissionFormulaFormFromSettings(settings);
  const formulaText = commissionFormulaPreview(currentForm);

  function setField<K extends keyof CommissionFormulaForm>(key: K, value: CommissionFormulaForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function applyPreset(mode: string) {
    const preset = COMMISSION_FORMULA_PRESETS.find((item) => item.value === mode) || COMMISSION_FORMULA_PRESETS[0];
    onChange({
      ...currentForm,
      mode: preset.value,
      label: preset.label,
      source: preset.source,
      deductions: [...preset.deductions],
    });
  }

  function toggleDeduction(value: string) {
    const exists = currentForm.deductions.includes(value);
    const deductions = exists
      ? currentForm.deductions.filter((item) => item !== value)
      : [...currentForm.deductions, value];
    onChange({ ...currentForm, mode: "CUSTOM", label: currentForm.label || "自定义公式", deductions });
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>提成公式</strong>
        </div>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <label>
          公式模板
          <select value={currentForm.mode} onChange={(event) => applyPreset(event.target.value)}>
            {COMMISSION_FORMULA_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          </select>
        </label>
        <label>
          公式名称
          <input value={currentForm.label} onChange={(event) => setField("label", event.target.value)} />
        </label>
        <label>
          收入来源
          <select
            value={currentForm.source}
            onChange={(event) => onChange({ ...currentForm, mode: "CUSTOM", source: event.target.value })}
          >
            {COMMISSION_FORMULA_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
          </select>
        </label>
        <UiSwitch
          label="提成基数负数归零"
          description="开启后，扣减后的负数基数按 0 处理。"
          checked={currentForm.floorAtZero}
          onChange={(value) => setField("floorAtZero", value)}
        />
      </div>

      <div className={styles.documentGroupCard}>
        <strong>扣减项</strong>
        <div className={styles.commissionDeductionGrid}>
          {COMMISSION_FORMULA_DEDUCTIONS.map((item) => (
            <PermissionSelectItem
              key={item.value}
              label={item.label}
              description={item.description}
              checked={currentForm.deductions.includes(item.value)}
              onChange={() => toggleDeduction(item.value)}
            />
          ))}
        </div>
      </div>

      <div className={styles.emptyState}>当前公式：提成基数 = {formulaText}</div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存提成公式"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>
    </form>
  );
}
