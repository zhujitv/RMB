import type { FormEvent } from "react";
import { PermissionSelectItem, UiCheckbox } from "../../components";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import {
  CURRENCIES,
  CUSTOMER_COMMISSION_STATUSES,
  SHIPPING_DOCUMENT_TYPE_OPTIONS,
  type ShippingDocumentConfig,
  type ShippingDocumentConfigKey
} from "./constants";
import { fuzzyIncludes, salespersonOptionLabel } from "./helpers";
import styles from "./settings-styles";
import type { CustomerForm, SalespersonOption } from "./types";

export function CustomerEditPanel({
  form,
  salespeople,
  saving,
  message,
  modal = false,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: CustomerForm;
  salespeople: SalespersonOption[];
  saving: boolean;
  message: string;
  modal?: boolean;
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
    <form className={modal ? styles.supplierSettingsModalForm : styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={modal ? styles.supplierSettingsModalBody : undefined}>
        {!modal ? (
          <div className={styles.quickCreateHeader}>
            <div>
              <strong>{form.id ? "编辑客户资料" : "新建客户资料"}</strong>
              <span>客户名称保存时会统一转为大写；业务列表优先显示客户简称，正式单证继续使用客户全称。</span>
            </div>
          </div>
        ) : null}

        {message ? <div className={styles.inlineError}>{message}</div> : null}

        <div className={modal ? styles.supplierSettingsModalFieldGrid : styles.reportFilterGrid}>
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
          <div className={modal ? styles.supplierSettingsModalFieldGrid : styles.reportFilterGrid}>
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

      </div>
      <div className={modal ? styles.supplierSettingsModalFooter : styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存客户"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}
