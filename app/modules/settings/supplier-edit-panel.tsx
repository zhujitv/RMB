import type { FormEvent } from "react";
import { LOGISTICS_COST_TYPE_OPTIONS } from "../../../lib/platform/logistics-cost-types";
import { PermissionSelectItem } from "../../components";
import { BooleanSelect } from "./common-controls";
import {
  LOGISTICS_SUPPLIER_TYPES,
  PRODUCT_SUPPLIER_TYPES,
  SUPPLIER_LOGISTICS_COST_TYPE_UI_META,
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES
} from "./constants";
import styles from "./settings-styles";
import type { SupplierForm } from "./types";

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
