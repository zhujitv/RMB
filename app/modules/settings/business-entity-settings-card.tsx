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

export function BusinessEntitySettingsCard({
  entities,
  form,
  loading,
  saving,
  message,
  onChange,
  onCreate,
  onEdit,
  onCancel,
  onSubmit,
}: {
  entities: BusinessEntityRow[];
  form: BusinessEntityForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: BusinessEntityForm) => void;
  onCreate: () => void;
  onEdit: (entity: BusinessEntityRow) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const currentForm = form || null;

  function setField<K extends keyof BusinessEntityForm>(key: K, value: BusinessEntityForm[K]) {
    if (!currentForm) return;
    onChange({ ...currentForm, [key]: value });
  }

  function restoreCurrentForm() {
    if (!currentForm) return;
    const row = entities.find((entity) => entity.id === currentForm.id);
    onChange(row ? businessEntityFormFromRow(row) : {
      id: "",
      name: "",
      shortName: "",
      isDefault: false,
      status: "启用",
      sortOrder: "0",
      remark: "",
    });
  }

  return (
    <div className={styles.quickCreatePanel}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>业务主体配置</strong>
        </div>
        <button className={styles.primaryButtonCompact} type="button" onClick={onCreate} disabled={saving}>
          新增业务主体
        </button>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>公司全称</th>
              <th>公司简称</th>
              <th>默认</th>
              <th>状态</th>
              <th>排序</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : entities.length ? entities.map((entity) => (
              <tr key={entity.id}>
                <td title={entity.name || ""}>{entity.name || "-"}</td>
                <td>{entity.shortName || "-"}</td>
                <td>{entity.isDefault ? "默认" : "-"}</td>
                <td>{entity.status || "启用"}</td>
                <td>{entity.sortOrder ?? 0}</td>
                <td title={entity.remark || ""}>{entity.remark || "-"}</td>
                <td>
                  <button
                    className={styles.rowDetailButton}
                    type="button"
                    onClick={() => onEdit(entity)}
                  >
                    编辑
                  </button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>暂无业务主体</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {currentForm ? (
        <form className={styles.documentGroupCard} onSubmit={onSubmit}>
          <strong>{currentForm.id ? "编辑业务主体" : "新增业务主体"}</strong>
          <div className={styles.reportFilterGrid}>
            <label>
              公司全称
              <input
                value={currentForm.name}
                onChange={(event) => setField("name", event.target.value)}
                required
              />
            </label>
            <label>
              公司简称
              <input value={currentForm.shortName} onChange={(event) => setField("shortName", event.target.value)} />
            </label>
            <label>
              状态
              <select
                value={currentForm.status}
                onChange={(event) => setField("status", event.target.value)}
                disabled={currentForm.isDefault}
              >
                <option value="启用">启用</option>
                <option value="停用">停用</option>
              </select>
            </label>
            <label>
              排序
              <input
                type="number"
                value={currentForm.sortOrder}
                onChange={(event) => setField("sortOrder", event.target.value)}
              />
            </label>
            <UiSwitch
              label="设为默认业务主体"
              description="新建订单默认使用该业务主体；已有订单不会自动变更。"
              checked={currentForm.isDefault}
              onChange={(value) => onChange({
                ...currentForm,
                isDefault: value,
                status: value ? "启用" : currentForm.status,
              })}
            />
            <label>
              备注
              <textarea value={currentForm.remark} onChange={(event) => setField("remark", event.target.value)} rows={3} />
            </label>
          </div>
          <div className={styles.emptyState}>
            业务主体用于订单标记、筛选、报表和导出抬头，不改变权限隔离和业务流程。
          </div>
          <div className={styles.detailActions}>
            <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存业务主体"}</button>
            <button className={styles.secondaryButton} type="button" onClick={restoreCurrentForm} disabled={saving}>恢复当前值</button>
            <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
