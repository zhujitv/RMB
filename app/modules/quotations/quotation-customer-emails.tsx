import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { apiJson } from "../../api";
import { formatDateTime } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import type { CustomerInsight } from "./quotation-crm-insights";
import styles from "./quotation-crm-workspace.module.css";

type CrmEmailSettings = {
  enabled?: boolean;
  mailDomain?: string;
  outboundEnabled?: boolean;
  inboundEnabled?: boolean;
};
type CrmEmailAccount = {
  id: string;
  englishName: string;
  emailAddress: string;
  status: string;
};
type CrmEmailAttachment = {
  id: string;
  fileName: string;
  originalFileName?: string;
  fileSize?: number;
  downloadUrl?: string;
};
type CrmEmailMessage = {
  id: string;
  direction: string;
  status: string;
  fromName?: string;
  fromEmail?: string;
  toEmails?: string[];
  ccEmails?: string[];
  subject: string;
  bodyText: string;
  lastError?: string;
  sentAt?: string | null;
  receivedAt?: string | null;
  createdAt?: string | null;
  createdByName?: string;
  attachments?: CrmEmailAttachment[];
};
type AccountResponse = {
  settings?: CrmEmailSettings;
  account?: CrmEmailAccount | null;
  suggestedEnglishName?: string;
  message?: string;
};
type MessagesResponse = { rows?: CrmEmailMessage[]; data?: { rows?: CrmEmailMessage[] }; message?: string };

const EMPTY_FORM = { toEmails: "", ccEmails: "", subject: "", bodyText: "" };

function formatFileSize(value?: number) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusText(status = "") {
  if (status === "SENT") return "已发送";
  if (status === "RECEIVED") return "已接收";
  if (status === "QUEUED") return "已归档";
  if (status === "FAILED") return "发送失败";
  return status || "已保存";
}

export function QuotationCustomerEmails({ customer, canWriteQuotations }: { customer: CustomerInsight; canWriteQuotations: boolean }) {
  const [settings, setSettings] = useState<CrmEmailSettings | null>(null);
  const [account, setAccount] = useState<CrmEmailAccount | null>(null);
  const [englishName, setEnglishName] = useState("");
  const [rows, setRows] = useState<CrmEmailMessage[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(Boolean(customer.customerId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const defaultRecipient = useMemo(() => {
    const email = customer.contactEmail === "-" ? "" : customer.contactEmail;
    return email || "";
  }, [customer.contactEmail]);

  useEffect(() => {
    setForm((current) => ({ ...current, toEmails: current.toEmails || defaultRecipient }));
  }, [defaultRecipient]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!customer.customerId) {
        setLoading(false);
        setRows([]);
        return;
      }
      setLoading(true);
      setMessage("");
      setMessageIsError(false);
      try {
        const [accountResult, messagesResult] = await Promise.all([
          apiJson<AccountResponse>("/api/me/crm-email-account"),
          apiJson<MessagesResponse>(`/api/customer-email-messages?${new URLSearchParams({ customerId: customer.customerId })}`),
        ]);
        if (cancelled) return;
        setSettings(accountResult.settings || null);
        setAccount(accountResult.account || null);
        setEnglishName(accountResult.account?.englishName || accountResult.suggestedEnglishName || "");
        setRows(Array.isArray(messagesResult.data?.rows) ? messagesResult.data.rows : Array.isArray(messagesResult.rows) ? messagesResult.rows : []);
      } catch (error) {
        if (cancelled) return;
        setMessageIsError(true);
        setMessage(error instanceof Error ? error.message : "读取客户邮件失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [customer.customerId, reloadToken]);

  function setField(key: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const result = await apiJson<AccountResponse>("/api/me/crm-email-account", {
        method: "POST",
        body: JSON.stringify({ englishName }),
      });
      setAccount(result.account || null);
      setSettings(result.settings || settings);
      setMessage(result.message || "个人系统邮箱已保存");
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "个人系统邮箱保存失败");
    } finally {
      setSaving(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files || []).slice(0, 5));
  }

  async function sendEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer.customerId) return;
    setSaving(true);
    setMessage("");
    setMessageIsError(false);
    try {
      let body: BodyInit;
      if (files.length) {
        const payload = new FormData();
        payload.set("customerId", customer.customerId);
        payload.set("toEmails", form.toEmails);
        payload.set("ccEmails", form.ccEmails);
        payload.set("subject", form.subject);
        payload.set("bodyText", form.bodyText);
        files.forEach((file) => payload.append("attachments", file));
        body = payload;
      } else {
        body = JSON.stringify({ ...form, customerId: customer.customerId });
      }
      const result = await apiJson<MessagesResponse>("/api/customer-email-messages", {
        method: "POST",
        body,
      });
      setForm({ ...EMPTY_FORM, toEmails: defaultRecipient });
      setFiles([]);
      setMessage(result.message || "邮件已保存");
      setReloadToken((value) => value + 1);
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "邮件保存失败");
    } finally {
      setSaving(false);
    }
  }

  const moduleEnabled = settings?.enabled === true;
  const canCompose = Boolean(customer.customerId && canWriteQuotations && moduleEnabled && account);

  return (
    <section className={`${styles.crmPanel} ${styles.fullWidthPanel}`}>
      <div className={styles.crmPanelHeader}>
        <div><span className={styles.crmEyebrow}>邮件往来</span><h3>客户邮件与附件</h3></div>
        <small>{account?.emailAddress || (settings?.mailDomain ? `系统域名：${settings.mailDomain}` : "未创建系统邮箱")}</small>
      </div>

      {!customer.customerId ? <div className={styles.crmEmpty}>该客户来自历史报价快照，缺少客户 ID，暂时无法归档客户邮件。</div> : null}
      {loading ? <div className={styles.crmEmpty}>客户邮件读取中...</div> : null}
      {message ? <div className={messageIsError ? shell.inlineError : styles.inlineSuccess} role="status">{message}</div> : null}
      {settings && !moduleEnabled ? <div className={styles.crmEmpty}>CRM 邮件模块当前关闭。管理员可在“系统设置 / CRM邮件”开启；历史邮件仍会保留。</div> : null}

      {customer.customerId && canWriteQuotations && moduleEnabled && !account ? (
        <form className={styles.emailAccountForm} onSubmit={saveAccount}>
          <label>英文名<input required value={englishName} maxLength={80} placeholder="例如 tony 或 tony.zhang" onChange={(event) => setEnglishName(event.target.value)} /></label>
          <button className={shell.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "创建系统邮箱"}</button>
        </form>
      ) : null}

      {canCompose ? (
        <form className={styles.emailComposeForm} onSubmit={sendEmail}>
          <div className={styles.emailComposeGrid}>
            <label>收件人<input required value={form.toEmails} placeholder="多个邮箱用逗号分隔" onChange={(event) => setField("toEmails", event.target.value)} /></label>
            <label>抄送<input value={form.ccEmails} placeholder="可留空" onChange={(event) => setField("ccEmails", event.target.value)} /></label>
            <label className={styles.productRemark}>主题<input required value={form.subject} maxLength={200} onChange={(event) => setField("subject", event.target.value)} /></label>
            <label className={styles.productRemark}>正文<textarea required rows={5} maxLength={10000} value={form.bodyText} onChange={(event) => setField("bodyText", event.target.value)} /></label>
            <label className={styles.productRemark}>附件<input type="file" multiple onChange={onFileChange} /></label>
          </div>
          {files.length ? <div className={styles.attachmentList}>{files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name} {formatFileSize(file.size)}</span>)}</div> : null}
          <div className={styles.productFormActions}>
            <button className={shell.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : settings?.outboundEnabled ? "发送并归档" : "保存邮件往来"}</button>
            {!settings?.outboundEnabled ? <small className={styles.mutedNote}>外发通道未开启：本次只保存到 CRM 邮件往来。</small> : null}
          </div>
        </form>
      ) : null}

      {!loading && !rows.length ? <div className={styles.crmEmpty}>暂无客户邮件记录。开启模块并创建个人系统邮箱后，可从这里归档邮件和附件。</div> : null}
      {rows.length ? <EmailTimeline rows={rows} /> : null}
    </section>
  );
}

function EmailTimeline({ rows }: { rows: CrmEmailMessage[] }) {
  return (
    <div className={styles.emailTimeline}>
      {rows.map((row) => (
        <article className={styles.emailTimelineItem} key={row.id}>
          <div className={styles.emailTimelineTop}>
            <div>
              <strong>{row.subject || "无主题"}</strong>
              <small>{row.direction === "INBOUND" ? "客户来信" : "对客户发信"} · {statusText(row.status)} · {formatDateTime(row.sentAt || row.receivedAt || row.createdAt)}</small>
            </div>
            <span>{row.createdByName || row.fromName || "系统用户"}</span>
          </div>
          <div className={styles.emailRecipients}>
            <span>发件：{row.fromEmail || "-"}</span>
            <span>收件：{(row.toEmails || []).join("，") || "-"}</span>
          </div>
          <p>{row.bodyText}</p>
          {row.lastError ? <div className={shell.inlineError}>发送提示：{row.lastError}</div> : null}
          {row.attachments?.length ? (
            <div className={styles.attachmentList}>
              {row.attachments.map((attachment) => (
                <a key={attachment.id} href={attachment.downloadUrl || "#"} target="_blank" rel="noreferrer">
                  {attachment.fileName || attachment.originalFileName || "附件"} {formatFileSize(attachment.fileSize)}
                </a>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
