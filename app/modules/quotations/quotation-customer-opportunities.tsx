import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { formatCurrencyAmount, formatDate } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy, useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import type { CustomerInsight } from "./quotation-crm-insights";
import { QuotationOpportunityDetail } from "./quotation-opportunity-detail";
import { QuotationOpportunityForm } from "./quotation-opportunity-form";
import { ATTENTION_LABEL, emptyOpportunityDraft, opportunityToDraft, stageLabel, type Opportunity, type OpportunityContact, type OpportunityDraft } from "./quotation-opportunity-types";
import styles from "./quotation-crm-workspace.module.css";
import opportunityStyles from "./quotation-customer-opportunities.module.css";

type Response = { opportunities?: Opportunity[]; contacts?: OpportunityContact[] };

export function QuotationCustomerOpportunities({ customer, canWrite }: { customer: CustomerInsight; canWrite: boolean }) {
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [contacts, setContacts] = useState<OpportunityContact[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<OpportunityDraft>(emptyOpportunityDraft());
  const [baseline, setBaseline] = useState<OpportunityDraft>(emptyOpportunityDraft());
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const loadSequence = useRef(0);
  const dirty = Boolean(editingId) && JSON.stringify(form) !== JSON.stringify(baseline);
  const selected = rows.find((row) => row.id === selectedId) || rows[0];
  const active = useMemo(() => rows.filter((row) => row.attention !== "CLOSED"), [rows]);
  const urgent = useMemo(() => active.filter((row) => row.attention === "OVERDUE" || row.attention === "TODAY" || row.attention === "UNPLANNED"), [active]);
  const pipeline = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of active) totals.set(row.currency || "CNY", (totals.get(row.currency || "CNY") || 0) + Number(row.amount || 0) * row.probability / 100);
    return [...totals.entries()].map(([currency, amount]) => formatCurrencyAmount(currency, amount)).join(" · ") || "-";
  }, [active]);
  useWorkspaceTabBusy(loading || saving); useWorkspaceTabDirty(dirty);

  async function load() {
    const sequence = ++loadSequence.current;
    if (!customer.customerId) { setRows([]); setContacts([]); return; }
    setLoading(true); setError("");
    try {
      const result = await apiJson<Response>(`/api/customers/${encodeURIComponent(customer.customerId)}/opportunities`);
      if (sequence !== loadSequence.current) return;
      setRows(result.opportunities || []); setContacts(result.contacts || []);
      setSelectedId((current) => (result.opportunities || []).some((row) => row.id === current) ? current : result.opportunities?.[0]?.id || "");
    } catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : "客户采购项目读取失败"); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }
  useEffect(() => { setRows([]); setContacts([]); setSelectedId(""); setEditingId(""); void load(); }, [customer.customerId]);
  function edit(row?: Opportunity) { const value = opportunityToDraft(row); setEditingId(row?.id || "new"); setForm(value); setBaseline(value); setError(""); setNotice(""); }
  function close() { setEditingId(""); setForm(emptyOpportunityDraft()); setBaseline(emptyOpportunityDraft()); }

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const exists = editingId !== "new";
      const result = await apiJson<{ opportunity?: Opportunity; message?: string }>(`/api/customers/${encodeURIComponent(customer.customerId)}/opportunities${exists ? `/${encodeURIComponent(editingId)}` : ""}`, { method: exists ? "PATCH" : "POST", body: JSON.stringify(form) });
      close(); setNotice(result.message || "客户采购项目已保存"); if (result.opportunity?.id) setSelectedId(result.opportunity.id); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "客户采购项目保存失败"); }
    finally { setSaving(false); }
  }
  async function remove(row: Opportunity) {
    if (!window.confirm(`确认移除采购项目“${row.name}”吗？历史审计记录仍会保留。`)) return;
    setSaving(true); setError("");
    try { await apiJson(`/api/customers/${encodeURIComponent(customer.customerId)}/opportunities/${encodeURIComponent(row.id)}`, { method: "DELETE" }); setNotice("客户采购项目已移除"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "客户采购项目移除失败"); }
    finally { setSaving(false); }
  }

  return <section className={`${styles.crmPanel} ${styles.fullWidthPanel}`}>
    <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>采购项目总控</span><h3>商机与今日行动</h3></div><div className={opportunityStyles.actions}><small>{active.length} 个进行中 · 加权金额 {pipeline}</small>{canWrite ? <button className={shell.primaryButtonCompact} type="button" disabled={saving} onClick={() => edit()}>新建采购项目</button> : null}</div></div>
    <div className={opportunityStyles.summary}>
      <article><span>今日要处理</span><strong>{urgent.filter((row) => row.attention === "TODAY").length}</strong></article>
      <article><span>已逾期</span><strong>{urgent.filter((row) => row.attention === "OVERDUE").length}</strong></article>
      <article><span>未安排下一步</span><strong>{urgent.filter((row) => row.attention === "UNPLANNED").length}</strong></article>
      <article><span>进行中项目</span><strong>{active.length}</strong></article>
    </div>
    {editingId ? <QuotationOpportunityForm form={form} contacts={contacts} quotations={customer.quotations} saving={saving} dirty={dirty} onChange={setForm} onCancel={close} onSubmit={submit} /> : null}
    <div className={opportunityStyles.workspace}>
      <aside className={opportunityStyles.queue} aria-label="商机行动队列">
        <header><strong>行动队列</strong><small>逾期与今日优先</small></header>
        {rows.length ? rows.map((row) => <button className={row.id === selected?.id ? opportunityStyles.selectedCard : opportunityStyles.queueCard} type="button" key={row.id} onClick={() => setSelectedId(row.id)}>
          <span className={opportunityStyles.cardTop}><strong>{row.name}</strong><em data-attention={row.attention}>{ATTENTION_LABEL[row.attention]}</em></span>
          <span>{stageLabel(row.stage)} · {row.probability}% · {formatCurrencyAmount(row.currency || "CNY", Number(row.amount || 0))}</span>
          <small>{row.nextAction || (row.attention === "CLOSED" ? "项目已结束" : "需要安排下一步")} · {formatDate(row.nextActionDueAt)}</small>
        </button>) : <div className={styles.crmEmpty}>{loading ? "读取中..." : "暂无采购项目。新建后即可按行动截止时间推进。"}</div>}
      </aside>
      {selected && customer.customerId ? <QuotationOpportunityDetail customerId={customer.customerId} opportunity={selected} canWrite={canWrite} saving={saving} onEdit={() => edit(selected)} onRemove={() => void remove(selected)} onReload={load} /> : <div className={opportunityStyles.emptyDetail}>选择一个项目查看联系人、报价和跟进轨迹。</div>}
    </div>
    {notice ? <div className={styles.inlineSuccess} role="status">{notice}</div> : null}{error ? <div className={shell.inlineError} role="alert">{error}</div> : null}
  </section>;
}
