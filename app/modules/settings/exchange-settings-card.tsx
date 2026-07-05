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

export function ExchangeSettingsCard({
  settings,
  form,
  loading,
  saving,
  refreshing,
  message,
  onChange,
  onReset,
  onRefresh,
  onSubmit,
}: {
  settings: ExchangeRateSettings | null;
  form: ExchangeRateForm | null;
  loading: boolean;
  saving: boolean;
  refreshing: boolean;
  message: string;
  onChange: (form: ExchangeRateForm) => void;
  onReset: () => void;
  onRefresh: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载汇率设置</div>;
  const currentForm = form || exchangeFormFromSettings(settings);
  function setField<K extends keyof ExchangeRateForm>(key: K, value: ExchangeRateForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>汇率设置</strong>
        </div>
        <button className={styles.secondaryButton} type="button" onClick={onRefresh} disabled={refreshing || saving}>
          {refreshing ? "刷新中..." : "手动刷新今日汇率"}
        </button>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <label>
          汇率来源
          <select value={currentForm.source} onChange={(event) => setField("source", event.target.value)}>
            {EXCHANGE_RATE_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
        <label>
          汇率类型
          <select value={currentForm.rateType} onChange={(event) => setField("rateType", event.target.value)}>
            {EXCHANGE_RATE_TYPES.map((rateType) => <option key={rateType} value={rateType}>{rateType}</option>)}
          </select>
        </label>
        <BooleanSelect
          label="自动更新汇率"
          value={currentForm.autoUpdate}
          onChange={(value) => setField("autoUpdate", value)}
        />
        <BooleanSelect
          label="允许手动汇率"
          value={currentForm.allowManualEdit}
          onChange={(value) => setField("allowManualEdit", value)}
        />
        <BooleanSelect
          label="允许订单选择多个物流供应商"
          value={currentForm.allowMultipleOrderLogisticsSuppliers}
          onChange={(value) => setField("allowMultipleOrderLogisticsSuppliers", value)}
        />
        <BooleanSelect
          label="管理员可忽略退税完整度"
          value={currentForm.allowAdminIncompleteTaxSubmit}
          onChange={(value) => setField("allowAdminIncompleteTaxSubmit", value)}
        />
        <label>
          付款凭证提醒启用日期
          <input
            type="date"
            value={currentForm.paymentVoucherReminderStartDate}
            onChange={(event) => setField("paymentVoucherReminderStartDate", event.target.value)}
          />
        </label>
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存汇率设置"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>
    </form>
  );
}
