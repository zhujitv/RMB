import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy, useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import type { CustomerInsight } from "./quotation-crm-insights";
import styles from "./quotation-crm-workspace.module.css";
import opportunityStyles from "./quotation-customer-opportunities.module.css";

type Stage = "LEAD" | "QUALIFIED" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";
type Opportunity = { id: string; name: string; stage: Stage; amount?: string | number | null; currency: string; probability: number; expectedCloseDate?: string | null; nextAction?: string | null; lostReason?: string | null; remark?: string | null; owner?: { name?: string } | null; updatedAt?: string };
type Draft = Omit<Opportunity, "id" | "owner" | "updatedAt">;
const STAGES: Array<{ value: Stage; label: string; probability: number }> = [
  { value: "LEAD", label: "线索", probability: 10 }, { value: "QUALIFIED", label: "已确认需求", probability: 30 },
  { value: "PROPOSAL", label: "方案/报价", probability: 50 }, { value: "NEGOTIATION", label: "商务谈判", probability: 75 },
  { value: "WON", label: "已赢单", probability: 100 }, { value: "LOST", label: "已丢单", probability: 0 },
];
const EMPTY: Draft = { name: "", stage: "LEAD", amount: "", currency: "USD", probability: 10, expectedCloseDate: "", nextAction: "", lostReason: "", remark: "" };
const label = (stage: Stage) => STAGES.find((item) => item.value === stage)?.label || stage;
const day = (value?: string | null) => value ? String(value).slice(0, 10) : "";

function toDraft(row?: Opportunity): Draft {
  return row ? { name: row.name, stage: row.stage, amount: row.amount ?? "", currency: row.currency || "USD", probability: row.probability, expectedCloseDate: day(row.expectedCloseDate), nextAction: row.nextAction || "", lostReason: row.lostReason || "", remark: row.remark || "" } : { ...EMPTY };
}

export function QuotationCustomerOpportunities({ customer, canWrite }: { customer: CustomerInsight; canWrite: boolean }) {
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<Draft>({ ...EMPTY });
  const [baseline, setBaseline] = useState<Draft>({ ...EMPTY });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadSequence = useRef(0);
  const open = Boolean(editingId);
  const dirty = open && JSON.stringify(form) !== JSON.stringify(baseline);
  const active = useMemo(() => rows.filter((row) => !["WON", "LOST"].includes(row.stage)), [rows]);
  const pipeline = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of active) totals.set(row.currency || "CNY", (totals.get(row.currency || "CNY") || 0) + Number(row.amount || 0) * row.probability / 100);
    return [...totals.entries()].map(([currency, amount]) => `${currency} ${amount.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`).join(" · ");
  }, [active]);
  useWorkspaceTabBusy(loading || saving); useWorkspaceTabDirty(dirty);

  async function load() {
    const sequence = ++loadSequence.current;
    if (!customer.customerId) { setRows([]); return; }
    setLoading(true); setError("");
    try { const result = await apiJson<{ opportunities: Opportunity[] }>(`/api/customers/${encodeURIComponent(customer.customerId)}/opportunities`); if (sequence === loadSequence.current) setRows(result.opportunities || []); }
    catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : "销售机会读取失败"); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }
  useEffect(() => { setRows([]); setEditingId(""); setForm({ ...EMPTY }); setBaseline({ ...EMPTY }); void load(); }, [customer.customerId]);
  function edit(row?: Opportunity) { const value = toDraft(row); setEditingId(row?.id || "new"); setForm(value); setBaseline(value); setError(""); setNotice(""); }
  function close() { setEditingId(""); setForm({ ...EMPTY }); setBaseline({ ...EMPTY }); }
  function field(key: keyof Draft, value: string | number) { setForm((old) => ({ ...old, [key]: value })); }
  function stage(value: Stage) { const item = STAGES.find((candidate) => candidate.value === value)!; setForm((old) => ({ ...old, stage: value, probability: item.probability })); }

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!form.name.trim()) return setError("请填写机会名称");
    setSaving(true); setError("");
    try { const exists = editingId !== "new"; const result = await apiJson<{ message?: string }>(`/api/customers/${encodeURIComponent(customer.customerId)}/opportunities${exists ? `/${encodeURIComponent(editingId)}` : ""}`, { method: exists ? "PATCH" : "POST", body: JSON.stringify(form) }); close(); setNotice(result.message || "销售机会已保存"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "销售机会保存失败"); }
    finally { setSaving(false); }
  }
  async function remove(row: Opportunity) {
    if (!window.confirm(`确认移除销售机会“${row.name}”吗？`)) return;
    setSaving(true); setError(""); try { await apiJson(`/api/customers/${encodeURIComponent(customer.customerId)}/opportunities/${encodeURIComponent(row.id)}`, { method: "DELETE" }); setNotice("销售机会已移除"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "销售机会移除失败"); } finally { setSaving(false); }
  }

  return <section className={`${styles.crmPanel} ${styles.fullWidthPanel}`}>
    <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>销售漏斗</span><h3>销售机会</h3></div><div className={styles.productFormActions}><small>{active.length} 个进行中 · 加权金额 {pipeline || "-"}</small>{canWrite ? <button className={shell.primaryButtonCompact} type="button" disabled={saving} onClick={() => edit()}>新增机会</button> : null}</div></div>
    {open ? <form className={opportunityStyles.form} onSubmit={submit}><div className={opportunityStyles.grid}>
      <label>机会名称<input disabled={saving} value={form.name} maxLength={200} onChange={(e) => field("name", e.target.value)} /></label><label>销售阶段<select disabled={saving} value={form.stage} onChange={(e) => stage(e.target.value as Stage)}>{STAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>预计金额<input disabled={saving} type="number" min="0" step="0.01" value={form.amount ?? ""} onChange={(e) => field("amount", e.target.value)} /></label><label>币种<input disabled={saving} value={form.currency} maxLength={10} onChange={(e) => field("currency", e.target.value.toUpperCase())} /></label>
      <label>成交概率 %<input disabled={saving} type="number" min="0" max="100" value={form.probability} onChange={(e) => field("probability", Number(e.target.value))} /></label><label>预计成交日期<input disabled={saving} type="date" value={day(form.expectedCloseDate)} onChange={(e) => field("expectedCloseDate", e.target.value)} /></label>
      <label className={opportunityStyles.wide}>下一步动作<input disabled={saving} value={form.nextAction || ""} maxLength={500} onChange={(e) => field("nextAction", e.target.value)} /></label>{form.stage === "LOST" ? <label className={opportunityStyles.wide}>丢单原因<input disabled={saving} value={form.lostReason || ""} maxLength={500} onChange={(e) => field("lostReason", e.target.value)} /></label> : null}
      <label className={opportunityStyles.wide}>备注<textarea disabled={saving} value={form.remark || ""} maxLength={2000} rows={2} onChange={(e) => field("remark", e.target.value)} /></label>
    </div><div className={styles.productFormActions}><button className={shell.secondaryButton} type="button" disabled={saving} onClick={close}>取消</button><button className={shell.primaryButtonCompact} disabled={saving || !dirty} type="submit">{saving ? "保存中..." : "保存机会"}</button></div></form> : null}
      <div className={opportunityStyles.board}>{STAGES.map((column) => { const items = rows.filter((row) => row.stage === column.value); return <div className={opportunityStyles.column} key={column.value}><header><strong>{column.label}</strong><span>{items.length}</span></header>{items.map((row) => <article key={row.id}><strong>{row.name}</strong><span>{row.currency} {Number(row.amount || 0).toLocaleString("zh-CN")} · {row.probability}%</span><small>{row.nextAction || "未填写下一步"}{day(row.expectedCloseDate) ? ` · ${day(row.expectedCloseDate)}` : ""}</small>{canWrite ? <div className={styles.productFormActions}><button type="button" disabled={saving} onClick={() => edit(row)}>编辑</button><button type="button" disabled={saving} onClick={() => void remove(row)}>移除</button></div> : null}</article>)}</div>; })}</div>
    {!loading && !rows.length ? <div className={styles.crmEmpty}>暂无销售机会。新增后可按线索、报价、谈判、赢单或丢单持续推进。</div> : null}{notice ? <div className={styles.inlineSuccess}>{notice}</div> : null}{error ? <div className={shell.inlineError}>{error}</div> : null}
  </section>;
}
