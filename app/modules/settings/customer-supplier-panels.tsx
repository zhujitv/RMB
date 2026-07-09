import type { FormEvent } from "react";
import { PermissionSelectItem, UiCheckbox } from "../../components";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import styles from "../../WorkspaceShell.module.css";
import { LOGISTICS_COST_TYPE_OPTIONS } from "../../../lib/platform/logistics-cost-types";
import { BooleanSelect } from "./common-controls";
import {
  CURRENCIES,
  CUSTOMER_COMMISSION_STATUSES,
  LOGISTICS_SUPPLIER_TYPES,
  PRODUCT_SUPPLIER_TYPES,
  type ShippingDocumentConfig,
  type ShippingDocumentConfigKey,
  SHIPPING_DOCUMENT_TYPE_OPTIONS,
  SUPPLIER_LOGISTICS_COST_TYPE_UI_META,
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
} from "./constants";
import { fuzzyIncludes, salespersonOptionLabel, supplierTypeLabel } from "./helpers";
import type { CustomerForm, SalespersonOption, SupplierForm } from "./types";

export function CustomerEditPanel({
  form,
  salespeople,
  saving,
  message,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: CustomerForm;
  salespeople: SalespersonOption[];
  saving: boolean;
  message: string;
  onChange: (form: CustomerForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  function setField<K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) {
    onChange({ ...form, [key]: value });
  }

  const selectedSalesperson = salespeople.find((user) => user.id === form.salespersonUserId) || null;

  async function searchSalespeople(keyword: string) {
    return salespeople.filter((user) => fuzzyIncludes([
      user.name,
      user.role,
    ], keyword)).slice(0, 10);
  }

  const docConfig: ShippingDocumentConfig = SHIPPING_DOCUMENT_TYPE_OPTIONS.reduce((config, option) => {
    config[option.key] = form.autoSendDocumentTypes.includes(option.value);
    return config;
  }, {} as ShippingDocumentConfig);

  function toggleShippingDocumentType(key: ShippingDocumentConfigKey) {
    const nextConfig: ShippingDocumentConfig = {
      ...docConfig,
      [key]: !docConfig[key],
    };
    setField(
      "autoSendDocumentTypes",
      SHIPPING_DOCUMENT_TYPE_OPTIONS
        .filter((option) => nextConfig[option.key])
        .map((option) => option.value),
    );
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{form.id ? "编辑客户资料" : "新建客户资料"}</strong>
          <span>客户名称保存时会统一转为大写；业务列表优先显示客户简称，正式单证继续使用客户全称。</span>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          客户全称
          <input value={form.name} onChange={(event) => setField("name", event.target.value)} required />
        </label>
        <label>
          客户简称
          <input value={form.shortName} onChange={(event) => setField("shortName", event.target.value)} placeholder="允许为空" />
        </label>
        <label>
          国家 / 地区
          <input value={form.country} onChange={(event) => setField("country", event.target.value)} />
        </label>
        <label>
          默认币种
          <select value={form.defaultCurrency} onChange={(event) => setField("defaultCurrency", event.target.value)}>
            {CURRENCIES.map((currency) => <option key={currency || "empty"} value={currency}>{currency || "请选择币种"}</option>)}
          </select>
        </label>
        <label>
          负责业务员
          <SearchAutocomplete
            value={selectedSalesperson}
            cacheKey="settings-customer-salespeople"
            emptyLabel="未找到匹配业务员"
            placeholder="搜索业务员姓名 / 角色"
            getLabel={salespersonOptionLabel}
            getDescription={(user) => user.role || ""}
            search={searchSalespeople}
            onSelect={(user) => setField("salespersonUserId", user.id)}
          />
          {selectedSalesperson ? (
            <button className={styles.secondaryButton} type="button" onClick={() => setField("salespersonUserId", "")}>
              清除负责业务员
            </button>
          ) : (
            <span className={styles.mutedText}>未选择时表示不指定负责业务员。</span>
          )}
        </label>
        <label>
          提成比例 %
          <input value={form.commissionRate} onChange={(event) => setField("commissionRate", event.target.value)} inputMode="decimal" />
        </label>
        <label>
          提成状态
          <select value={form.commissionStatus} onChange={(event) => setField("commissionStatus", event.target.value)}>
            {CUSTOMER_COMMISSION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          联系人
          <input value={form.contactPerson} onChange={(event) => setField("contactPerson", event.target.value)} />
        </label>
        <label>
          联系邮箱
          <input value={form.contactEmail} onChange={(event) => setField("contactEmail", event.target.value)} type="email" />
        </label>
        <label>
          联系电话
          <input value={form.contactPhone} onChange={(event) => setField("contactPhone", event.target.value)} />
        </label>
        <label>
          备注
          <input value={form.remark} onChange={(event) => setField("remark", event.target.value)} />
        </label>
      </div>

      <section className={styles.customerShippingPanel}>
        <div className={styles.customerShippingHeader}>
          <strong>清关资料自动通知</strong>
        </div>
        <UiCheckbox
          variant="inline"
          label="启用报关单确认后的自动发送"
          checked={form.enableAutoShippingDocsNotification}
          onChange={(event) => setField("enableAutoShippingDocsNotification", event.currentTarget.checked)}
        />
        <div className={styles.reportFilterGrid}>
          <label>
            清关资料接收邮箱
            <textarea
              value={form.shippingDocsEmails}
              onChange={(event) => setField("shippingDocsEmails", event.target.value)}
              rows={3}
              placeholder="多个邮箱可用逗号、分号或换行分隔；为空则使用客户主邮箱"
            />
          </label>
          <label>
            抄送邮箱
            <textarea
              value={form.shippingDocsCcEmails}
              onChange={(event) => setField("shippingDocsCcEmails", event.target.value)}
              rows={3}
              placeholder="可为空，多个邮箱可用逗号、分号或换行分隔"
            />
          </label>
          <label>
            清关邮件语言
            <select value={form.clearanceEmailLanguage} onChange={(event) => setField("clearanceEmailLanguage", event.target.value)}>
              <option value="EN">English</option>
              <option value="RU">Русский</option>
            </select>
          </label>
        </div>
        <div className={styles.documentGroupCard}>
          <strong>自动发送资料</strong>
          <div className={styles.commissionDeductionGrid}>
            {SHIPPING_DOCUMENT_TYPE_OPTIONS.map((option) => (
              <PermissionSelectItem
                key={option.value}
                label={option.label}
                checked={docConfig[option.key]}
                onChange={() => toggleShippingDocumentType(option.key)}
              />
            ))}
          </div>
        </div>
      </section>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存客户"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}

export function SupplierEditPanel({
  form,
  readOnly,
  saving,
  message,
  modal = false,
  onChange,
  onSubmit,
  onEdit,
  onDelete,
  onClose,
  onCancel,
}: {
  form: SupplierForm;
  readOnly: boolean;
  saving: boolean;
  message: string;
  modal?: boolean;
  onChange: (form: SupplierForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEdit: () => void;
  onDelete: () => void | undefined;
  onClose: () => void;
  onCancel: () => void;
}) {
  function setField<K extends keyof SupplierForm>(key: K, value: SupplierForm[K]) {
    onChange({ ...form, [key]: value });
  }

  function toggleCostType(costType: string) {
    const exists = form.allowedLogisticsCostTypes.includes(costType);
    setField(
      "allowedLogisticsCostTypes",
      exists
        ? form.allowedLogisticsCostTypes.filter((item) => item !== costType)
        : [...form.allowedLogisticsCostTypes, costType],
    );
  }

  const logisticsCapable = LOGISTICS_SUPPLIER_TYPES.includes(form.supplierType);
  const factoryDocumentCapable = PRODUCT_SUPPLIER_TYPES.includes(form.supplierType);
  const isCreate = !form.id;
  const controlsDisabled = readOnly || saving;
  const formClassName = modal
    ? styles.supplierSettingsModalForm
    : `${styles.quickCreatePanel} ${styles.userEditPanel}`;
  const bodyClassName = modal ? styles.supplierSettingsModalBody : undefined;
  const actionsClassName = modal ? styles.supplierSettingsModalFooter : styles.detailActions;
  const fieldGridClassName = modal ? styles.supplierSettingsModalFieldGrid : styles.reportFilterGrid;
  const costGridClassName = modal ? styles.supplierSettingsModalCostGrid : styles.supplierLogisticsCostGrid;

  return (
    <form className={formClassName} onSubmit={(event) => {
      if (readOnly) {
        event.preventDefault();
        return;
      }
      onSubmit(event);
    }}>
      {!modal ? (
        <section className={styles.userEditTitle}>
          <div>
            <strong>{isCreate ? "新建供应商资料" : readOnly ? "供应商资料" : "编辑供应商资料"}</strong>
          </div>
        </section>
      ) : null}

      <div className={bodyClassName}>
        {message ? <div className={styles.inlineError}>{message}</div> : null}

      <section className={styles.userEditSection}>
        <div className={styles.userEditSectionHeader}>
          <div>
            <strong>基础信息</strong>
          </div>
        </div>
        <div className={fieldGridClassName}>
        <label>
          供应商名称
          <input value={form.supplierName} onChange={(event) => setField("supplierName", event.target.value)} required disabled={controlsDisabled} />
        </label>
        <label>
          供应商类型
          <select value={form.supplierType} onChange={(event) => {
            const supplierType = event.target.value;
            onChange({
              ...form,
              supplierType,
            });
          }} disabled={controlsDisabled}>
            {SUPPLIER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          状态
          <select value={form.status} onChange={(event) => setField("status", event.target.value)} disabled={controlsDisabled}>
            {SUPPLIER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          国家 / 地区
          <input value={form.country} onChange={(event) => setField("country", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          联系人
          <input value={form.contactPerson} onChange={(event) => setField("contactPerson", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          电话
          <input value={form.phone} onChange={(event) => setField("phone", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          邮箱
          <input value={form.email} onChange={(event) => setField("email", event.target.value)} type="email" disabled={controlsDisabled} />
        </label>
        <label>
          地址
          <input value={form.address} onChange={(event) => setField("address", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          开票名称
          <input value={form.invoiceTitle} onChange={(event) => setField("invoiceTitle", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          税号
          <input value={form.taxNumber} onChange={(event) => setField("taxNumber", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          银行名称
          <input value={form.bankName} onChange={(event) => setField("bankName", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          银行账号
          <input value={form.bankAccount} onChange={(event) => setField("bankAccount", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          备注
          <input value={form.remark} onChange={(event) => setField("remark", event.target.value)} disabled={controlsDisabled} />
        </label>
        </div>
      </section>

      {factoryDocumentCapable ? (
        <section className={styles.userEditSection}>
          <div className={styles.userEditSectionHeader}>
            <div>
              <strong>产品供应商权限</strong>
            </div>
          </div>
          <div className={fieldGridClassName}>
            <BooleanSelect
              label="允许供应商资料回传"
              value={form.allowFactoryDocumentUpload}
              disabled={controlsDisabled}
              onChange={(value) => setField("allowFactoryDocumentUpload", value)}
            />
          </div>
        </section>
      ) : null}

      {logisticsCapable ? (
        <section className={styles.userEditSection}>
          <div className={styles.userEditSectionHeader}>
            <div>
              <strong>物流供应商权限</strong>
            </div>
          </div>
          <div className={fieldGridClassName}>
            <BooleanSelect
              label="允许录入物流信息"
              value={form.allowDomesticLogisticsEntry}
              disabled={controlsDisabled}
              onChange={(value) => setField("allowDomesticLogisticsEntry", value)}
            />
            <BooleanSelect
              label="允许物流费用录入"
              value={form.allowLogisticsExpenseEntry}
              disabled={controlsDisabled}
              onChange={(value) => setField("allowLogisticsExpenseEntry", value)}
            />
            <BooleanSelect
              label="允许物流发票上传"
              value={form.allowLogisticsInvoiceUpload}
              disabled={controlsDisabled}
              onChange={(value) => setField("allowLogisticsInvoiceUpload", value)}
            />
            <BooleanSelect
              label="默认物流供应商"
              value={form.isDefaultLogisticsSupplier}
              disabled={controlsDisabled}
              onChange={(value) => setField("isDefaultLogisticsSupplier", value)}
            />
          </div>
          <div className={styles.documentGroupCard}>
            <strong>允许录入的物流费用类型</strong>
            <div className={costGridClassName}>
              {LOGISTICS_COST_TYPE_OPTIONS.map(({ value: costType, label }) => {
                const meta = SUPPLIER_LOGISTICS_COST_TYPE_UI_META[costType];
                return (
                  <PermissionSelectItem
                    key={costType}
                    label={meta?.label || label}
                    description={meta?.description || "允许供应商在物流费用模块录入该费用。"}
                    checked={form.allowedLogisticsCostTypes.includes(costType)}
                    disabled={controlsDisabled || !form.allowLogisticsExpenseEntry}
                    onChange={() => toggleCostType(costType)}
                  />
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
      </div>

      <div className={actionsClassName}>
        {readOnly ? (
          <>
            <button className={styles.primaryButtonCompact} type="button" onClick={onEdit} disabled={saving}>编辑供应商</button>
            <button className={styles.dangerButton} type="button" onClick={onDelete} disabled={saving}>删除供应商</button>
            <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={saving}>关闭</button>
          </>
        ) : (
          <>
            {modal && form.id ? (
              <button
                className={`${styles.dangerButton} ${styles.supplierSettingsDeleteButton}`}
                type="button"
                onClick={onDelete}
                disabled={saving}
              >
                删除供应商
              </button>
            ) : null}
            <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存供应商"}</button>
            <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
          </>
        )}
      </div>
    </form>
  );
}
