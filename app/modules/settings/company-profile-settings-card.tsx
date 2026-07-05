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

export function CompanyProfileSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: CompanyProfileSettings | null;
  form: CompanyProfileForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: CompanyProfileForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载公司资料</div>;
  const currentForm = form || companyProfileFormFromSettings(settings);

  function setField<K extends keyof CompanyProfileForm>(key: K, value: CompanyProfileForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>公司资料 / 系统品牌配置</strong>
        </div>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <label>
          品牌名称
          <input value={currentForm.brandName} onChange={(event) => setField("brandName", event.target.value)} required />
        </label>
        <label>
          系统名称
          <input value={currentForm.systemName} onChange={(event) => setField("systemName", event.target.value)} required />
        </label>
        <label>
          公司中文名称
          <input value={currentForm.companyNameZh} onChange={(event) => setField("companyNameZh", event.target.value)} required />
        </label>
        <label>
          公司英文名称
          <input value={currentForm.companyNameEn} onChange={(event) => setField("companyNameEn", event.target.value)} />
        </label>
        <label>
          公司简称
          <input value={currentForm.shortName} onChange={(event) => setField("shortName", event.target.value)} />
        </label>
        <label>
          官网地址
          <input value={currentForm.website} onChange={(event) => setField("website", event.target.value)} placeholder="https://www.example.com" />
        </label>
        <label>
          联系邮箱
          <input value={currentForm.contactEmail} onChange={(event) => setField("contactEmail", event.target.value)} type="email" />
        </label>
        <label>
          联系电话
          <input value={currentForm.contactPhone} onChange={(event) => setField("contactPhone", event.target.value)} />
        </label>
        <label>
          Logo 地址
          <input value={currentForm.logoUrl} onChange={(event) => setField("logoUrl", event.target.value)} placeholder="可为空，支持 http/https 图片地址" />
        </label>
        <label>
          页脚版权文案
          <input value={currentForm.footerText} onChange={(event) => setField("footerText", event.target.value)} />
        </label>
        <label>
          公司地址
          <textarea value={currentForm.address} onChange={(event) => setField("address", event.target.value)} rows={3} />
        </label>
      </div>

      <div className={styles.emptyState}>
        当前品牌预览：{currentForm.brandName || "-"} · {currentForm.systemName || "-"} · {currentForm.companyNameZh || "-"}
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存公司资料"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>
    </form>
  );
}
