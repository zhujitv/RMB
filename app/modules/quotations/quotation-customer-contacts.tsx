import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy, useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import type { CustomerInsight } from "./quotation-crm-insights";
import contactStyles from "./quotation-customer-contacts.module.css";
import styles from "./quotation-crm-workspace.module.css";

export type CustomerContactFields = { contactPerson: string; contactPhone: string; contactEmail: string };
type Contact = { id: string; name: string; title?: string; department?: string; phone?: string; email?: string; wechat?: string; preferredMethod?: string; isPrimary: boolean; remark?: string };
type ContactDraft = Omit<Contact, "id">;
const EMPTY: ContactDraft = { name: "", title: "", department: "", phone: "", email: "", wechat: "", preferredMethod: "", isPrimary: false, remark: "" };

function legacyContact(customer: CustomerInsight): Contact | null {
  const name = customer.contactPerson === "-" ? "" : customer.contactPerson;
  const phone = customer.contactPhone === "-" ? "" : customer.contactPhone;
  const email = customer.contactEmail === "-" ? "" : customer.contactEmail;
  return name || phone || email ? { id: "legacy", name: name || "主要联系人", phone, email, isPrimary: true } : null;
}

function draft(row?: Contact | null): ContactDraft {
  return row ? { name: row.name, title: row.title || "", department: row.department || "", phone: row.phone || "", email: row.email || "", wechat: row.wechat || "", preferredMethod: row.preferredMethod || "", isPrimary: row.isPrimary, remark: row.remark || "" } : { ...EMPTY };
}

export function QuotationCustomerContacts({ customer, canWriteQuotations, onSaved }: { customer: CustomerInsight; canWriteQuotations: boolean; onSaved?: (contact: CustomerContactFields) => void }) {
  const [rows, setRows] = useState<Contact[]>([]);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<ContactDraft>({ ...EMPTY });
  const [baseline, setBaseline] = useState<ContactDraft>({ ...EMPTY });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const loadSequence = useRef(0);
  const formOpen = editingId === "new" || Boolean(editingId);
  const dirty = formOpen && JSON.stringify(form) !== JSON.stringify(baseline);
  const editable = Boolean(customer.customerId && canWriteQuotations);
  const primary = useMemo(() => rows.find((row) => row.isPrimary) || (rows.length ? null : legacyContact(customer)), [rows, customer]);
  useWorkspaceTabBusy(saving);
  useWorkspaceTabDirty(dirty);

  async function load(): Promise<Contact[]> {
    const sequence = ++loadSequence.current;
    if (!customer.customerId) { setRows([]); return []; }
    setLoading(true); setError("");
    try { const result = await apiJson<{ contacts: Contact[] }>(`/api/customers/${encodeURIComponent(customer.customerId)}/contacts`); const contacts = result.contacts || []; if (sequence === loadSequence.current) setRows(contacts); return contacts; }
    catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : "联系人读取失败"); return []; }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }

  useEffect(() => { setRows([]); setEditingId(""); setForm({ ...EMPTY }); setBaseline({ ...EMPTY }); void load(); }, [customer.customerId]);
  function open(row?: Contact) { const value = draft(row); setEditingId(row?.id || "new"); setForm(value); setBaseline(value); setMessage(""); setError(""); }
  function close() { setEditingId(""); setForm({ ...EMPTY }); setBaseline({ ...EMPTY }); }
  function field(key: keyof ContactDraft, value: string | boolean) { setForm((old) => ({ ...old, [key]: value })); }

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!customer.customerId || !form.name.trim()) return setError("请填写联系人姓名");
    setSaving(true); setError(""); setMessage("");
    try {
      const existing = editingId !== "new";
      const previous = existing ? rows.find((row) => row.id === editingId) : null;
      const requestOptions = existing ? { method: "PATCH", body: JSON.stringify(form) } : { method: "POST", body: JSON.stringify(form) };
      const result = await apiJson<{ contact: Contact; message?: string }>(`/api/customers/${encodeURIComponent(customer.customerId)}/contacts${existing ? `/${encodeURIComponent(editingId)}` : ""}`, requestOptions);
      const savedContact = { contactPerson: result.contact.name, contactPhone: result.contact.phone || "", contactEmail: result.contact.email || "" };
      if (result.contact.isPrimary) onSaved?.(savedContact);
      else if (previous?.isPrimary) onSaved?.({ contactPerson: "", contactPhone: "", contactEmail: "" });
      close(); setMessage(result.message || "联系人已保存"); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "联系人保存失败"); }
    finally { setSaving(false); }
  }

  async function remove(row: Contact) {
    if (!customer.customerId || !window.confirm(`确认移除联系人“${row.name}”吗？历史操作记录仍会保留。`)) return;
    setSaving(true); setError("");
    try { await apiJson(`/api/customers/${encodeURIComponent(customer.customerId)}/contacts/${encodeURIComponent(row.id)}`, { method: "DELETE" }); setMessage("联系人已移除"); const contacts = await load(); if (row.isPrimary) { const next = contacts.find((item) => item.isPrimary); onSaved?.(next ? { contactPerson: next.name, contactPhone: next.phone || "", contactEmail: next.email || "" } : { contactPerson: "", contactPhone: "", contactEmail: "" }); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "联系人移除失败"); }
    finally { setSaving(false); }
  }

  return <section className={`${styles.crmPanel} ${styles.fullWidthPanel}`}>
    <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>联系人维护</span><h3>客户联系人</h3></div><div className={styles.productFormActions}><small>{loading ? "读取中..." : `${rows.length || (primary ? 1 : 0)} 位联系人`}</small>{editable ? <button className={shell.primaryButtonCompact} type="button" disabled={saving} onClick={() => open()}>新增联系人</button> : null}</div></div>
    {primary ? <div className={contactStyles.primarySummary}><div><span>主要联系人 · 资料完整度 {[primary.name, primary.phone, primary.email].filter(Boolean).length}/3</span><strong>{primary.name}</strong><small>{[primary.department, primary.title].filter(Boolean).join(" · ") || "未维护部门职务"}</small></div><div className={contactStyles.quickActions}>{primary.phone ? <a aria-label="拨打电话" href={`tel:${primary.phone}`}>{primary.phone}</a> : null}{primary.email ? <a aria-label="发送邮件" href={`mailto:${primary.email}`}>{primary.email}</a> : null}</div></div> : null}
    {formOpen ? <form className={contactStyles.formCard} onSubmit={submit}>
      <div className={contactStyles.formGrid}><label>姓名<input disabled={saving} value={form.name} maxLength={100} onChange={(e) => field("name", e.target.value)} /></label><label>职务<input disabled={saving} value={form.title} maxLength={100} onChange={(e) => field("title", e.target.value)} /></label><label>部门<input disabled={saving} value={form.department} maxLength={100} onChange={(e) => field("department", e.target.value)} /></label><label>电话<input disabled={saving} value={form.phone} maxLength={100} onChange={(e) => field("phone", e.target.value)} /></label><label>邮箱<input disabled={saving} type="email" value={form.email} maxLength={200} onChange={(e) => field("email", e.target.value)} /></label><label>微信<input disabled={saving} value={form.wechat} maxLength={100} onChange={(e) => field("wechat", e.target.value)} /></label><label>首选联系<select disabled={saving} value={form.preferredMethod} onChange={(e) => field("preferredMethod", e.target.value)}><option value="">未指定</option><option>电话</option><option>邮件</option><option>微信</option></select></label><label className={contactStyles.primaryCheck}><input disabled={saving} type="checkbox" checked={form.isPrimary} onChange={(e) => field("isPrimary", e.target.checked)} />设为主要联系人</label></div>
      <label className={contactStyles.remark}>备注<textarea disabled={saving} value={form.remark} maxLength={1000} rows={2} onChange={(e) => field("remark", e.target.value)} /></label>
      <div className={styles.productFormActions}><button className={shell.secondaryButton} type="button" disabled={saving} onClick={close}>撤销修改</button><button className={shell.primaryButtonCompact} disabled={saving || !dirty} type="submit">{saving ? "保存中..." : "保存联系人"}</button></div>
    </form> : null}
    <div className={contactStyles.contactList}>{rows.map((row) => <article className={contactStyles.contactCard} key={row.id}><div><strong>{row.name}{row.isPrimary ? <em>主要</em> : null}</strong><small>{[row.department, row.title].filter(Boolean).join(" · ") || "未维护部门职务"}</small></div><div><span>{row.phone || "无电话"}</span><span>{row.email || row.wechat || "无其他联系方式"}</span></div>{editable ? <div className={styles.productFormActions}><button className={shell.secondaryButton} type="button" disabled={saving} onClick={() => open(row)}>编辑</button><button className={styles.dangerTextButton} type="button" disabled={saving} onClick={() => void remove(row)}>移除</button></div> : null}</article>)}</div>
    {!loading && !rows.length && !primary ? <div className={styles.crmEmpty}>还没有联系人。可新增采购、财务、决策人等多位联系人，并指定一位主要联系人。</div> : null}
    {message ? <div className={styles.inlineSuccess}>{message}</div> : null}{error ? <div className={shell.inlineError}>{error}</div> : null}
  </section>;
}
