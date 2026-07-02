import type { FormEvent } from "react";
import { DismissibleLayer } from "../../components";
import { preventEnterFormSubmit } from "../../formGuards";
import { formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { customerLegalName } from "../../utils";
import { type CustomsFilePickerState, type ManualShippingDraft, type ManualShippingForm, type TaxDocument, type TaxRefundDetail } from "./model";

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
