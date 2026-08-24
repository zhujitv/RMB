import type { FormEvent } from "react";
import shell from "../../WorkspaceShell.module.css";
import { quotationNumber, type QuotationRow } from "./types";
import { CONTACT_ROLE_OPTIONS, LOST_REASON_OPTIONS, OPPORTUNITY_STAGES, type OpportunityContact, type OpportunityDraft, type OpportunityStage } from "./quotation-opportunity-types";
import styles from "./quotation-customer-opportunities.module.css";

type Props = {
  form: OpportunityDraft; contacts: OpportunityContact[]; quotations: QuotationRow[]; saving: boolean; dirty: boolean;
  onChange: (form: OpportunityDraft) => void; onCancel: () => void; onSubmit: (event: FormEvent) => void;
};

export function QuotationOpportunityForm({ form, contacts, quotations, saving, dirty, onChange, onCancel, onSubmit }: Props) {
  function field<K extends keyof OpportunityDraft>(key: K, value: OpportunityDraft[K]) { onChange({ ...form, [key]: value }); }
  function toggle(list: string[], id: string) { return list.includes(id) ? list.filter((value) => value !== id) : [...list, id]; }
  function changeStage(stage: OpportunityStage) { onChange({ ...form, stage, lostReasonCode: stage === "LOST" ? form.lostReasonCode : "", lostReason: stage === "LOST" ? form.lostReason : "" }); }
  const terminal = form.stage === "WON" || form.stage === "LOST";

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <div className={styles.formHeading}><div><strong>采购项目资料</strong><small>金额取关联报价的最新版本，成交概率按阶段自动计算。</small></div></div>
      <div className={styles.grid}>
        <label>采购项目名称<input required disabled={saving} value={form.name} maxLength={200} onChange={(event) => field("name", event.target.value)} /></label>
        <label>当前阶段<select disabled={saving} value={form.stage} onChange={(event) => changeStage(event.target.value as OpportunityStage)}>{OPPORTUNITY_STAGES.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.probability}%</option>)}</select></label>
        <label>预计成交日期<input disabled={saving} type="date" value={form.expectedCloseDate} onChange={(event) => field("expectedCloseDate", event.target.value)} /></label>
        {!terminal ? <><label className={styles.wide}>下一步动作<input required disabled={saving} value={form.nextAction} maxLength={500} placeholder="例如：确认 5 吨试单价格与包装要求" onChange={(event) => field("nextAction", event.target.value)} /></label><label>行动截止日期<input required disabled={saving} type="date" value={form.nextActionDueAt} onChange={(event) => field("nextActionDueAt", event.target.value)} /></label></> : null}
        {form.stage === "LOST" ? <><label>丢单原因<select required disabled={saving} value={form.lostReasonCode} onChange={(event) => field("lostReasonCode", event.target.value)}><option value="">请选择</option>{LOST_REASON_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className={styles.wide}>补充说明<input disabled={saving} value={form.lostReason} maxLength={500} onChange={(event) => field("lostReason", event.target.value)} /></label></> : null}
        <label className={styles.full}>客户需求 / 产品 / 数量 / 交期<textarea disabled={saving} value={form.remark} maxLength={2000} rows={3} placeholder="记录采购产品、规格、预估数量、目标价格、期望交期及关键障碍" onChange={(event) => field("remark", event.target.value)} /></label>
      </div>
      <fieldset className={styles.linkPicker}><legend>采购联系人</legend>{contacts.length ? <div className={styles.choiceGrid}>{contacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={form.contactIds.includes(contact.id)} onChange={() => { const contactIds = toggle(form.contactIds, contact.id); const contactRoles = { ...form.contactRoles }; if (!contactIds.includes(contact.id)) delete contactRoles[contact.id]; onChange({ ...form, contactIds, contactRoles, primaryContactId: contactIds.includes(form.primaryContactId) ? form.primaryContactId : contactIds[0] || "" }); }} /><span><strong>{contact.name}</strong><small>{contact.title || contact.department || contact.phone || "未维护职务"}</small></span></label>)}</div> : <p>请先在上方“客户联系人”中新增联系人。</p>}{form.contactIds.length ? <div className={styles.contactRoles}><label className={styles.primarySelect}>主联系人<select value={form.primaryContactId} onChange={(event) => field("primaryContactId", event.target.value)}>{form.contactIds.map((id) => <option key={id} value={id}>{contacts.find((contact) => contact.id === id)?.name || id}</option>)}</select></label>{form.contactIds.map((id) => <label className={styles.primarySelect} key={id}>{contacts.find((contact) => contact.id === id)?.name || id}的角色<select value={form.contactRoles[id] || ""} onChange={(event) => field("contactRoles", { ...form.contactRoles, [id]: event.target.value })}><option value="">未指定</option>{CONTACT_ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>)}</div> : null}</fieldset>
      <fieldset className={styles.linkPicker}><legend>关联报价</legend>{quotations.filter((quote) => quote.status !== "VOIDED").length ? <div className={styles.choiceGrid}>{quotations.filter((quote) => quote.status !== "VOIDED").map((quote) => <label key={quote.id}><input type="checkbox" checked={form.quotationIds.includes(quote.id)} onChange={() => field("quotationIds", toggle(form.quotationIds, quote.id))} /><span><strong>{quotationNumber(quote) || "未编号报价"}</strong><small>{quote.status || "DRAFT"}</small></span></label>)}</div> : <p>当前客户还没有可关联的报价。</p>}</fieldset>
      <div className={styles.actions}><button className={shell.secondaryButton} type="button" disabled={saving} onClick={onCancel}>取消</button><button className={shell.primaryButtonCompact} disabled={saving || !dirty} type="submit">{saving ? "保存中..." : "保存采购项目"}</button></div>
    </form>
  );
}
