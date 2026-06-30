import type { FormEvent } from "react";
import { CheckboxOptionRow, DismissibleLayer } from "../../components";
import { preventEnterFormSubmit } from "../../formGuards";
import { formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { customerLegalName } from "../../utils";
import { TAX_FACTORY_UPLOAD_TYPES, type CustomsFilePickerState, type ManualShippingDraft, type ManualShippingForm, type SupplierDocumentRequestForm, type TaxDocument, type TaxRefundDetail } from "./model";
import { UploadProgressInline } from "./upload-components";

export function SupplierDocumentRequestDialog({
  form,
  sending,
  submitProgress,
  onClose,
  onChange,
  onSubmit,
}: {
  form: SupplierDocumentRequestForm;
  sending: boolean;
  submitProgress: number;
  onClose: () => void;
  onChange: (form: SupplierDocumentRequestForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const selectedSupplier = form.suppliers.find((supplier) => supplier.id === form.supplierId) || null;
  const toggleDocumentType = (documentType: string) => {
    const exists = form.requiredDocumentTypes.includes(documentType);
    onChange({
      ...form,
      requiredDocumentTypes: exists
        ? form.requiredDocumentTypes.filter((item) => item !== documentType)
        : [...form.requiredDocumentTypes, documentType],
      error: "",
    });
  };
  return (
    <DismissibleLayer
      ariaLabel="通知产品供应商回传资料"
      overlayClassName={styles.modalOverlay}
      surfaceClassName={styles.modalCard}
      dismissible={!sending}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
          <header className={styles.modalHeader}>
            <div>
              <strong>通知产品供应商回传资料</strong>
              <span>供应商端只显示订单号和资料要求，不显示客户简称或客户全称。</span>
            </div>
            <button className={styles.ghostButton} type="button" onClick={requestClose} disabled={sending}>关闭</button>
          </header>
          {form.error ? <div className={styles.inlineError}>{form.error}</div> : null}
          <div className={styles.reportFilterGrid}>
            <label>
              订单号
              <input value={form.order.orderNo || "-"} readOnly />
            </label>
            <label>
              产品供应商
              <select
                value={form.supplierId}
                onChange={(event) => onChange({ ...form, supplierId: event.target.value, error: "" })}
                disabled={form.loadingSuppliers || sending}
                required
              >
                <option value="">{form.loadingSuppliers ? "供应商加载中..." : "请选择产品供应商"}</option>
                {form.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.supplierName || "-"}</option>
                ))}
              </select>
            </label>
            <label>
              供应商邮箱
              <input value={selectedSupplier?.email || "将优先使用供应商绑定账号邮箱"} readOnly />
            </label>
            <label>
              截止日期
              <input
                type="date"
                value={form.dueDate}
                onChange={(event) => onChange({ ...form, dueDate: event.target.value })}
                disabled={sending}
              />
            </label>
            <label>
              Excel 合同样本
              <input
                type="file"
                accept=".xlsx"
                disabled={sending}
                onChange={(event) => onChange({ ...form, templateFile: event.target.files?.[0] || null })}
              />
            </label>
            <label>
              备注
              <input
                value={form.message}
                onChange={(event) => onChange({ ...form, message: event.target.value })}
                placeholder="供应商可见的补充说明"
                disabled={sending}
              />
            </label>
          </div>
          <div className={styles.checkboxPanel}>
            <strong>需要回传的资料</strong>
            <div className={styles.factoryDocumentChoiceGrid}>
              {TAX_FACTORY_UPLOAD_TYPES.map((item) => (
                <CheckboxOptionRow
                  key={item.value}
                  label={item.label}
                  description={item.value === "SUPPLIER_PURCHASE_CONTRACT" ? "盖章扫描后上传 PDF" : "上传增值税发票 PDF"}
                  checked={form.requiredDocumentTypes.includes(item.value)}
                  disabled={sending}
                  onChange={() => toggleDocumentType(item.value)}
                />
              ))}
            </div>
          </div>
          {sending ? <UploadProgressInline progress={submitProgress} /> : null}
          <div className={styles.detailActions}>
            <button className={styles.primaryButtonCompact} type="submit" disabled={sending || form.loadingSuppliers}>
              {sending ? "发送中..." : "发送通知"}
            </button>
            <button className={styles.secondaryButton} type="button" onClick={requestClose} disabled={sending}>取消</button>
          </div>
        </form>
      )}
    </DismissibleLayer>
  );
}

export function ManualShippingDocumentsDialog({
  order,
  draft,
  form,
  loading,
  sending,
  message,
  onClose,
  onSubmit,
  onChange,
  onLanguageChange,
}: {
  order: TaxRefundDetail;
  draft: ManualShippingDraft | null;
  form: ManualShippingForm | null;
  loading: boolean;
  sending: boolean;
  message: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (form: ManualShippingForm) => void;
  onLanguageChange: (language: string) => void;
}) {
  function setField<K extends keyof ManualShippingForm>(key: K, value: ManualShippingForm[K]) {
    if (!form) return;
    onChange({ ...form, [key]: value });
  }

  const dismissConfirmMessage = sending
    ? "当前内容尚未保存，确定关闭吗？"
    : form ? "当前内容尚未保存，确定关闭吗？" : "";

  return (
    <DismissibleLayer
      ariaLabel="手动发送清关资料"
      overlayClassName={styles.modalOverlay}
      surfaceClassName={styles.shippingDocsDialog}
      dismissible
      dismissConfirmMessage={dismissConfirmMessage}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <>
        <div className={styles.modalHeader}>
          <div>
            <strong>手动发送清关资料</strong>
            <span>{order.orderNo || "-"} · {customerLegalName(order)}</span>
          </div>
          <button className={styles.ghostButton} type="button" onClick={requestClose} disabled={sending}>关闭</button>
        </div>

        {loading ? (
          <div className={styles.emptyState}>正在生成清关资料邮件...</div>
        ) : form && draft ? (
          <form className={styles.shippingDocsForm} onKeyDown={preventEnterFormSubmit} onSubmit={onSubmit}>
            {message ? <div className={styles.inlineError}>{message}</div> : null}
            <div className={styles.documentGroupCard}>
              <strong>将发送的资料清单</strong>
              <div className={styles.shippingDocsList}>
                {(draft.documents || []).map((item) => (
                  <span key={item.typeKey || item.label} className={item.exists ? styles.shippingDocReady : styles.shippingDocMissing}>
                    {item.exists ? "✓" : "!"} {item.label || item.emailLabel || "-"}
                    {item.fileName ? ` · ${item.fileName}` : ""}
                  </span>
                ))}
              </div>
              {(draft.missingLabels || []).length ? (
                <small className={styles.mutedText}>当前资料不完整，缺少：{(draft.missingLabels || []).join("、")}。发送前会再次确认。</small>
              ) : null}
            </div>

            <div className={styles.shippingDocsFormGrid}>
              <label>
                收件邮箱
                <textarea
                  value={form.recipientEmails}
                  onChange={(event) => setField("recipientEmails", event.target.value)}
                  rows={3}
                  required
                />
              </label>
              <label>
                抄送邮箱
                <textarea
                  value={form.ccEmails}
                  onChange={(event) => setField("ccEmails", event.target.value)}
                  rows={3}
                />
              </label>
              <label>
                邮件语言
                <select value={form.emailLanguage} onChange={(event) => onLanguageChange(event.target.value)}>
                  <option value="EN">English</option>
                  <option value="RU">Русский</option>
                </select>
              </label>
              <label className={styles.shippingDocsWideField}>
                邮件标题
                <input value={form.emailSubject} onChange={(event) => setField("emailSubject", event.target.value)} required />
              </label>
              <label className={styles.shippingDocsWideField}>
                邮件正文
                <textarea value={form.emailBody} onChange={(event) => setField("emailBody", event.target.value)} rows={9} required />
              </label>
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.secondaryButton} type="button" onClick={requestClose} disabled={sending}>取消</button>
              <button className={styles.primaryButtonCompact} type="submit" disabled={sending}>
                {sending ? "发送中..." : "发送清关资料"}
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.inlineError}>{message || "清关资料发送信息生成失败"}</div>
        )}
        </>
      )}
    </DismissibleLayer>
  );
}

export function CustomsFilePickerDialog({
  state,
  recognizingDocumentId,
  onClose,
  onSelect,
}: {
  state: NonNullable<CustomsFilePickerState>;
  recognizingDocumentId: string;
  onClose: () => void;
  onSelect: (order: TaxRefundDetail, document: TaxDocument) => void;
}) {
  return (
    <DismissibleLayer
      ariaLabel="选择报关单文件"
      overlayClassName={styles.modalOverlay}
      surfaceClassName={styles.customsFilePickerDialog}
      dismissible
      onClose={onClose}
    >
      {({ requestClose }) => (
        <>
          <div className={styles.modalHeader}>
            <div>
              <strong>选择报关单文件</strong>
              <span>{state.order.orderNo || "-"} · 共 {state.documents.length} 个报关单文件</span>
            </div>
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
          </div>
          <div className={styles.customsFilePickerList}>
            {state.documents.map((document) => (
              <button
                key={document.id}
                className={styles.customsFilePickerItem}
                type="button"
                disabled={recognizingDocumentId === document.id}
                onClick={() => onSelect(state.order, document)}
              >
                <span>{document.fileName || "-"}</span>
                <small>{document.uploadedByName || "-"} · {formatDateTime(document.uploadedAt)}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </DismissibleLayer>
  );
}
