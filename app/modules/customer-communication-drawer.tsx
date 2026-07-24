import type { FormEvent } from "react";
import { DetailField, DismissibleLayer } from "../components";
import { formatDateTime } from "../formatters";
import { preventEnterFormSubmit } from "../formGuards";
import styles from "../WorkspaceShell.module.css";
import type { CommunicationDetail, CommunicationRecord, MailForm } from "./customer-communication-types";

const LANGUAGE_OPTIONS = [
  { value: "EN", label: "英文" },
  { value: "ZH", label: "中文" },
  { value: "RU", label: "俄文" },
];

export function CustomerCommunicationDrawer({
  detail,
  loading,
  error,
  form,
  canSend,
  sending,
  missingLabels,
  onClose,
  onSubmit,
  onFormChange,
  onLanguageChange,
}: {
  detail: CommunicationDetail | null;
  loading: boolean;
  error: string;
  form: MailForm | null;
  canSend: boolean;
  sending: boolean;
  missingLabels: string[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFormChange: (form: MailForm) => void;
  onLanguageChange: (language: string) => void;
}) {
  const customer = detail?.customer || {};
  const files = detail?.availableFiles || [];
  const records = detail?.records || [];
  function setField<K extends keyof MailForm>(key: K, value: MailForm[K]) {
    if (!form) return;
    onFormChange({ ...form, [key]: value });
  }
  return (
    <DismissibleLayer
      ariaLabel="客户沟通详情"
      overlayClassName={styles.drawerOverlay}
      surfaceClassName={styles.taxRefundDrawer}
      dismissible
      dismissConfirmMessage={sending ? "邮件正在发送，确定关闭吗？" : ""}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <>
          <header className={styles.taxRefundDrawerHeader}>
            <div className={styles.taxRefundDrawerTitle}>
              <span>客户沟通详情</span>
              <strong>{detail?.order?.orderNo || "-"}</strong>
              <small>{customer.shortName || detail?.order?.customerShortName || "-"}</small>
            </div>
            <div className={styles.taxRefundDrawerActions}>
              <button className={styles.ghostButton} type="button" onClick={requestClose} disabled={sending}>关闭</button>
            </div>
          </header>

          <div className={styles.taxRefundDrawerBody}>
            {loading ? <div className={styles.emptyState}>正在加载客户沟通详情...</div> : null}
            {error ? <div className={styles.inlineError}>{error}</div> : null}
            {!loading && detail ? (
              <div className={styles.documentGroupGrid}>
                <section className={styles.documentGroupCard}>
                  <strong>客户资料</strong>
                  <div className={styles.detailGrid}>
                    <DetailField label="客户全称" value={customer.fullName || "-"} wide />
                    <DetailField label="客户简称" value={customer.shortName || "-"} />
                    <DetailField label="默认收件邮箱" value={(customer.defaultToEmails || []).join(", ") || "-"} wide />
                    <DetailField label="默认抄送邮箱" value={(customer.defaultCcEmails || []).join(", ") || "-"} wide />
                    <DetailField label="语言偏好" value={languageLabel(customer.languagePreference)} />
                  </div>
                </section>

                <section className={styles.documentGroupCard}>
                  <strong>可发送文件</strong>
                  <div className={styles.shippingDocsList}>
                    {files.map((file) => (
                      <span key={file.key} className={file.exists ? styles.shippingDocReady : styles.shippingDocMissing}>
                        {file.exists ? "✓" : "!"} {file.label}{file.requiredForClearance ? " · 必需" : ""}
                      </span>
                    ))}
                  </div>
                  {missingLabels.length ? <div className={styles.inlineError}>缺失文件：{missingLabels.join("、")}</div> : null}
                </section>

                <section className={styles.documentGroupCard}>
                  <strong>邮件发送</strong>
                  {form ? (
                    <form className={styles.shippingDocsForm} onKeyDown={preventEnterFormSubmit} onSubmit={onSubmit} inert={sending} aria-busy={sending}>
                      <div className={styles.shippingDocsFormGrid}>
                        <label>
                          邮件语言
                          <select value={form.emailLanguage} onChange={(event) => onLanguageChange(event.target.value)}>
                            {LANGUAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                          </select>
                        </label>
                        <label>
                          收件人
                          <textarea value={form.recipientEmails} onChange={(event) => setField("recipientEmails", event.target.value)} rows={3} required />
                        </label>
                        <label>
                          抄送
                          <textarea value={form.ccEmails} onChange={(event) => setField("ccEmails", event.target.value)} rows={3} />
                        </label>
                        <label className={styles.shippingDocsWideField}>
                          邮件标题
                          <input value={form.emailSubject} onChange={(event) => setField("emailSubject", event.target.value)} required />
                        </label>
                        <label className={styles.shippingDocsWideField}>
                          邮件正文
                          <textarea value={form.emailBody} onChange={(event) => setField("emailBody", event.target.value)} rows={8} required />
                        </label>
                      </div>
                      <div className={styles.documentGroupCard}>
                        <strong>附件勾选</strong>
                        <div className={styles.shippingDocsList}>
                          {(detail.draft?.documents || []).map((item) => (
                            <label key={item.typeKey || item.label} className={item.exists ? styles.shippingDocReady : styles.shippingDocMissing}>
                              <input type="checkbox" checked={Boolean(item.exists)} disabled readOnly />
                              {item.label || item.emailLabel || "-"}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className={styles.modalFooter}>
                        <button className={styles.secondaryButton} type="button" disabled={sending} onClick={() => {
                          window.alert(`${form.emailSubject}\n\n${form.emailBody}`);
                        }}>预览</button>
                        <button className={styles.primaryButtonCompact} type="submit" disabled={sending || !canSend}>
                          {sending ? "发送中..." : "手动发送"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className={styles.emptyState}>暂无可发送邮件草稿</div>
                  )}
                </section>

                <section className={styles.documentGroupCard}>
                  <strong>发送记录</strong>
                  <div className={styles.tableWrap}>
                    <table className={styles.dataTable}>
                      <thead>
                        <tr>
                          <th>发送时间</th>
                          <th>发送人</th>
                          <th>收件人</th>
                          <th>抄送</th>
                          <th>邮件类型</th>
                          <th>附件清单</th>
                          <th>发送方式</th>
                          <th>系统发送</th>
                          <th>发送状态</th>
                          <th>失败原因</th>
                          <th>备注</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.length ? records.map((record) => (
                          <tr key={record.id}>
                            <td>{formatDateTime(record.sentAt || record.createdAt)}</td>
                            <td>{record.sentByName || "-"}</td>
                            <td>{(record.recipientEmails || []).join(", ") || "-"}</td>
                            <td>{(record.ccEmails || []).join(", ") || "-"}</td>
                            <td>{record.emailTypeLabel || "-"}</td>
                            <td>{attachmentText(record)}</td>
                            <td>{record.deliveryMethod || sendModeText(record.sendMode) || "-"}</td>
                            <td>{record.isSystemSent === false ? "否" : "是"}</td>
                            <td>{record.sendStatusLabel || record.sendStatus || "-"}</td>
                            <td>{record.errorMessage || "-"}</td>
                            <td>{record.manualRemark || "-"}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={11}><div className={styles.emptyState}>暂无发送记录</div></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </>
      )}
    </DismissibleLayer>
  );
}

function languageLabel(value = "") {
  if (value === "ZH") return "中文";
  if (value === "RU") return "俄文";
  return "英文";
}

function sendModeText(value = "") {
  if (value === "manual_mark") return "手动标记";
  if (value === "manual") return "系统手动发送";
  if (value === "auto") return "系统自动发送";
  return value;
}

function attachmentText(record: CommunicationRecord) {
  const attachments = record.attachments || [];
  if (attachments.length) {
    return attachments.map((item) => item.fileName || item.originalFilename || item.documentTypeLabel || "-").join("、");
  }
  return (record.documentTypes || []).join("、") || "-";
}
