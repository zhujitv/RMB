"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { DismissibleLayer } from "../../components";
import { formatCurrencyAmount } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import summary from "./quotation-dialog-summary.module.css";
import styles from "./quotations.module.css";
import {
  currentQuotationVersion,
  quotationBusinessEntityName,
  quotationCustomerLegalName,
  quotationNumber,
  quotationTotal,
  type QuotationDetailResponse,
  type QuotationDelivery,
  type QuotationRow,
} from "./types";

type EmailDraft = {
  recipientEmails?: string[];
  ccEmails?: string[];
  subject?: string;
  body?: string;
  versionNumber?: number;
  attachmentFileName?: string;
  templateEnabled?: boolean;
  deliveries?: QuotationDelivery[];
};

type DraftResponse = { success?: boolean; draft?: EmailDraft; message?: string };
type SendResponse = { success?: boolean; delivery?: QuotationDelivery; message?: string };

function requestKey() {
  return globalThis.crypto?.randomUUID?.() || `send-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function QuotationEmailDialog({
  quotation,
  onClose,
  onSaved,
}: {
  quotation: QuotationRow;
  onClose: () => void;
  onSaved: (quotation: QuotationRow, message: string) => void;
}) {
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [recipients, setRecipients] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sendKey, setSendKey] = useState(requestKey);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const sendingRef = useRef(false);
  const version = currentQuotationVersion(quotation);
  const currency = version?.currency || "CNY";
  useWorkspaceTabBusy(sending);

  useEffect(() => {
    let active = true;
    void apiJson<DraftResponse>(`/api/quotations/${encodeURIComponent(quotation.id)}/email`)
      .then((result) => {
        if (!active) return;
        if (!result.draft) throw new Error(result.message || "邮件草稿数据缺失，请刷新后重试");
        setDraft(result.draft);
        setRecipients((result.draft.recipientEmails || []).join(", "));
        setCc((result.draft.ccEmails || []).join(", "));
        setSubject(result.draft.subject || "");
        setBody(result.draft.body || "");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "读取邮件草稿失败");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [quotation.id]);

  const dirty = useMemo(() => Boolean(draft) && (
    recipients !== (draft?.recipientEmails || []).join(", ")
    || cc !== (draft?.ccEmails || []).join(", ")
    || subject !== (draft?.subject || "")
    || body !== (draft?.body || "")
  ), [body, cc, draft, recipients, subject]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      const result = await apiJson<SendResponse>(`/api/quotations/${encodeURIComponent(quotation.id)}/email`, {
        method: "POST",
        body: JSON.stringify({
          versionNumber: draft.versionNumber,
          recipientEmails: recipients,
          ccEmails: cc,
          subject,
          body,
          requestKey: sendKey,
        }),
      });
      if (result.success !== true) throw new Error(result.message || "报价邮件发送失败");
      const refreshed = await apiJson<QuotationDetailResponse>(`/api/quotations/${encodeURIComponent(quotation.id)}`);
      const saved = refreshed.quotation || refreshed.data;
      if (!saved) throw new Error("邮件已发送，但报价状态刷新失败，请手动刷新列表");
      setSendKey(requestKey());
      onSaved(saved, result.message || "报价邮件已发送");
      onClose();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "报价邮件发送失败");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <DismissibleLayer
      ariaLabel="发送客户报价邮件"
      overlayClassName={shell.modalOverlay}
      surfaceClassName={`${shell.modalCard} ${styles.emailDialog}`}
      onClose={onClose}
      dismissible={!sending}
      dismissConfirmMessage={dirty ? "邮件内容尚未发送，确定关闭吗？" : ""}
    >
      {({ requestClose }) => (
        <form className={`${shell.workspaceModalForm} ${styles.emailForm}`} onSubmit={submit} inert={sending} aria-busy={sending}>
          <div className={shell.modalHeader}>
            <div><h2>发送客户报价</h2><p>系统将附上当前版本的英文形式发票 PDF。</p></div>
            <button className={shell.secondaryButton} type="button" onClick={requestClose}>关闭</button>
          </div>
          <dl className={summary.summary} aria-label="待发送报价摘要">
            <div><dt>报价号</dt><dd title={quotationNumber(quotation)}>{quotationNumber(quotation) || "-"}</dd></div>
            <div><dt>版本</dt><dd>V{draft?.versionNumber || version?.versionNumber || quotation.currentVersionNumber || 1}</dd></div>
            <div><dt>客户</dt><dd title={quotationCustomerLegalName(quotation)}>{quotationCustomerLegalName(quotation)}</dd></div>
            <div><dt>报价金额</dt><dd>{formatCurrencyAmount(currency, quotationTotal(quotation))}</dd></div>
            <div><dt>业务主体</dt><dd title={quotationBusinessEntityName(quotation)}>{quotationBusinessEntityName(quotation)}</dd></div>
            <div><dt>附件</dt><dd title={draft?.attachmentFileName || "Proforma Invoice.pdf"}>{draft?.attachmentFileName || "Proforma Invoice.pdf"}</dd></div>
          </dl>
          {loading ? <div className={shell.emptyState} role="status" aria-live="polite">正在准备邮件...</div> : null}
          {error ? <div className={shell.inlineError} role="alert" aria-live="assertive">{error}</div> : null}
          {draft && draft.templateEnabled === false ? <div className={shell.inlineError} role="alert" aria-live="assertive">报价邮件模板已停用，请先在通知设置中启用。</div> : null}
          {draft ? <div className={styles.emailFields}>
            <label>收件邮箱<input value={recipients} required onChange={(event) => { setRecipients(event.target.value); setSendKey(requestKey()); }} placeholder="customer@example.com" /></label>
            <label>抄送邮箱<input value={cc} onChange={(event) => { setCc(event.target.value); setSendKey(requestKey()); }} placeholder="多个邮箱用逗号分隔" /></label>
            <label>邮件标题<input value={subject} required maxLength={220} onChange={(event) => { setSubject(event.target.value); setSendKey(requestKey()); }} /></label>
            <label>邮件正文<textarea value={body} required rows={12} maxLength={16000} onChange={(event) => { setBody(event.target.value); setSendKey(requestKey()); }} /></label>
            <div className={styles.attachmentChip}>附件：{draft.attachmentFileName || "Proforma Invoice.pdf"}</div>
          </div> : null}
          <div className={shell.modalFooter}>
            <button className={shell.secondaryButton} type="button" onClick={requestClose} disabled={sending}>取消</button>
            <button className={shell.primaryButtonCompact} type="submit" disabled={loading || sending || !draft || draft.templateEnabled === false}>{sending ? "发送中..." : "发送邮件"}</button>
          </div>
        </form>
      )}
    </DismissibleLayer>
  );
}
