import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { formatDate, formatDateTime } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import type { CustomerInsight } from "./quotation-crm-insights";
import styles from "./quotation-crm-workspace.module.css";

type FollowUp = {
  id: string;
  method?: string | null;
  note: string;
  nextFollowUpAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  createdByName?: string | null;
};
type FollowUpResponse = { data?: { rows?: FollowUp[] }; rows?: FollowUp[]; followUp?: FollowUp; message?: string };
type FollowUpForm = { method: string; note: string; nextFollowUpAt: string };

const EMPTY_FORM: FollowUpForm = { method: "微信", note: "", nextFollowUpAt: "" };
const METHODS = ["微信", "电话", "邮件", "WhatsApp", "客户平台", "其它"];

function isOverdue(value?: string | null) {
  if (!value) return false;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

export function QuotationCustomerFollowUps({ customer, canWriteQuotations }: { customer: CustomerInsight; canWriteQuotations: boolean }) {
  const [rows, setRows] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(Boolean(customer.customerId));
  const [error, setError] = useState("");
  const [form, setForm] = useState<FollowUpForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const nextPending = useMemo(() => rows.find((row) => !row.completedAt && row.nextFollowUpAt), [rows]);

  useEffect(() => {
    let cancelled = false;
    if (!customer.customerId) {
      setRows([]);
      setLoading(false);
      setError("");
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ customerId: customer.customerId });
    void apiJson<FollowUpResponse>(`/api/customer-follow-ups?${params}`).then((result) => {
      if (cancelled) return;
      setRows(Array.isArray(result.data?.rows) ? result.data.rows : Array.isArray(result.rows) ? result.rows : []);
      setLoading(false);
    }).catch((loadError) => {
      if (!cancelled) {
        setRows([]);
        setLoading(false);
        setError(loadError instanceof Error ? loadError.message : "读取跟进记录失败");
      }
    });
    return () => { cancelled = true; };
  }, [customer.customerId, reloadToken]);

  function setField<K extends keyof FollowUpForm>(key: K, value: FollowUpForm[K]) {
    setForm((old) => ({ ...old, [key]: value }));
  }

  async function saveFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer.customerId) return;
    setSaving(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const result = await apiJson<FollowUpResponse>("/api/customer-follow-ups", {
        method: "POST",
        body: JSON.stringify({ ...form, customerId: customer.customerId }),
      });
      setForm(EMPTY_FORM);
      setMessageIsError(false);
      setMessage(result.message || "跟进记录已保存");
      setReloadToken((value) => value + 1);
    } catch (saveError) {
      setMessageIsError(true);
      setMessage(saveError instanceof Error ? saveError.message : "跟进记录保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function completeFollowUp(id: string) {
    setSaving(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const result = await apiJson<FollowUpResponse>(`/api/customer-follow-ups/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: true }),
      });
      setMessageIsError(false);
      setMessage(result.message || "跟进已完成");
      setReloadToken((value) => value + 1);
    } catch (completeError) {
      setMessageIsError(true);
      setMessage(completeError instanceof Error ? completeError.message : "更新跟进状态失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.crmPanel}>
      <div className={styles.crmPanelHeader}>
        <div><span className={styles.crmEyebrow}>跟进记录</span><h3>记录沟通与下次提醒</h3></div>
        <small>{nextPending ? `下次跟进：${formatDate(nextPending.nextFollowUpAt)}` : "暂无待提醒"}</small>
      </div>
      {nextPending ? <div className={isOverdue(nextPending.nextFollowUpAt) ? styles.reminderOverdue : styles.reminderBox}>下次跟进：{formatDate(nextPending.nextFollowUpAt)} · {nextPending.method || "未标记方式"} · {nextPending.note}</div> : null}
      {!customer.customerId ? <div className={styles.crmEmpty}>该客户来自历史报价快照，缺少客户 ID，暂时无法记录跟进。</div> : null}
      {customer.customerId && canWriteQuotations ? (
        <form className={styles.followUpForm} onSubmit={saveFollowUp}>
          <label>跟进方式<select value={form.method} onChange={(event) => setField("method", event.target.value)}>{METHODS.map((method) => <option value={method} key={method}>{method}</option>)}</select></label>
          <label>下次跟进日期<input type="date" value={form.nextFollowUpAt} onChange={(event) => setField("nextFollowUpAt", event.target.value)} /></label>
          <label className={styles.productRemark}>跟进内容<textarea required rows={3} maxLength={2000} value={form.note} onChange={(event) => setField("note", event.target.value)} /></label>
          <div className={styles.productFormActions}><button className={shell.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存跟进记录"}</button></div>
        </form>
      ) : null}
      {message ? <div className={messageIsError ? shell.inlineError : styles.inlineSuccess} role="status">{message}</div> : null}
      {loading ? <div className={styles.crmEmpty}>跟进记录读取中...</div> : null}
      {error ? <div className={shell.inlineError} role="alert">{error}</div> : null}
      {!loading && !error && !rows.length ? <div className={styles.crmEmpty}>暂无跟进记录，可记录电话、微信、邮件等客户沟通。</div> : null}
      {!loading && !error && rows.length ? <FollowUpList rows={rows} saving={saving} canWrite={canWriteQuotations} onComplete={(id) => void completeFollowUp(id)} /> : null}
    </section>
  );
}

function FollowUpList({ rows, saving, canWrite, onComplete }: { rows: FollowUp[]; saving: boolean; canWrite: boolean; onComplete: (id: string) => void }) {
  return (
    <div className={styles.followUpList}>
      {rows.map((row) => (
        <article className={row.completedAt ? styles.followUpDone : styles.followUpItem} key={row.id}>
          <div><strong>{row.method || "跟进"}</strong><small>{formatDateTime(row.createdAt)} · {row.createdByName || "系统用户"}</small></div>
          <p>{row.note}</p>
          <div className={styles.followUpMeta}><span>下次：{formatDate(row.nextFollowUpAt)}</span><span>{row.completedAt ? `已完成：${formatDateTime(row.completedAt)}` : "待跟进"}</span></div>
          {canWrite && !row.completedAt ? <button className={shell.rowDetailButton} type="button" disabled={saving} onClick={() => onComplete(row.id)}>完成</button> : null}
        </article>
      ))}
    </div>
  );
}
