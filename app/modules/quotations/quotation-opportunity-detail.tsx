import { useEffect, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { formatCurrencyAmount, formatDate } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import { quotationNumber } from "./types";
import { ACTIVITY_LABEL, OPPORTUNITY_STAGES, stageLabel, type Opportunity, type OpportunityActivityType } from "./quotation-opportunity-types";
import styles from "./quotation-customer-opportunities.module.css";

type Props = { customerId: string; opportunity: Opportunity; canWrite: boolean; saving: boolean; onEdit: () => void; onRemove: () => void; onReload: () => Promise<void> };
const TYPES = Object.entries(ACTIVITY_LABEL) as Array<[OpportunityActivityType, string]>;
function localDateTimeInput() {
  const now = new Date(); const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function QuotationOpportunityDetail({ customerId, opportunity, canWrite, saving, onEdit, onRemove, onReload }: Props) {
  const [activity, setActivity] = useState({ type: "FOLLOW_UP" as OpportunityActivityType, subject: "", note: "", outcome: "", contactId: "", occurredAt: localDateTimeInput() });
  const [activitySaving, setActivitySaving] = useState(false);
  const [error, setError] = useState("");
  const events = [
    ...opportunity.activities.map((row) => ({ id: `activity-${row.id}`, at: row.occurredAt, title: `${ACTIVITY_LABEL[row.type]} · ${row.subject}`, detail: [row.contact?.name, row.outcome, row.note].filter(Boolean).join(" · "), by: row.createdBy?.name })),
    ...opportunity.stageHistory.map((row) => ({ id: `stage-${row.id}`, at: row.changedAt, title: `阶段变更为“${stageLabel(row.toStage)}”`, detail: row.fromStage ? `从“${stageLabel(row.fromStage)}”推进` : "创建采购项目", by: row.changedBy?.name })),
  ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  useEffect(() => { setActivity({ type: "FOLLOW_UP", subject: "", note: "", outcome: "", contactId: "", occurredAt: localDateTimeInput() }); setError(""); }, [opportunity.id]);

  async function submitActivity(event: FormEvent) {
    event.preventDefault(); setActivitySaving(true); setError("");
    try {
      await apiJson(`/api/customers/${encodeURIComponent(customerId)}/opportunities/${encodeURIComponent(opportunity.id)}/activities`, { method: "POST", body: JSON.stringify({ ...activity, occurredAt: new Date(activity.occurredAt).toISOString() }) });
      setActivity((current) => ({ ...current, subject: "", note: "", outcome: "", occurredAt: localDateTimeInput() }));
      await onReload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "跟进记录保存失败"); }
    finally { setActivitySaving(false); }
  }

  return (
    <section className={styles.detail} aria-label={`${opportunity.name}详情`}>
      <header className={styles.detailHeader}>
        <div><span>{stageLabel(opportunity.stage)} · {opportunity.probability}%</span><h4>{opportunity.name}</h4><small>负责人：{opportunity.owner?.name || "当前业务员"}</small></div>
        {canWrite ? <div className={styles.actions}><button type="button" disabled={saving} onClick={onEdit}>编辑</button><button type="button" disabled={saving} onClick={onRemove}>移除</button></div> : null}
      </header>
      <div className={styles.keyFacts}>
        <span>项目金额<strong>{formatCurrencyAmount(opportunity.currency || "CNY", Number(opportunity.amount || 0))}</strong></span>
        <span>预计成交<strong>{formatDate(opportunity.expectedCloseDate)}</strong></span>
        <span>下一步<strong>{opportunity.nextAction || "已结束"}</strong></span>
        <span>截止日期<strong>{formatDate(opportunity.nextActionDueAt)}</strong></span>
      </div>
      {opportunity.remark ? <p className={styles.requirement}>{opportunity.remark}</p> : null}
      <div className={styles.linkSummary}>
        <div><strong>关键联系人</strong>{opportunity.contactLinks.length ? opportunity.contactLinks.map((link) => <span key={link.id}>{link.contact.name}{link.isPrimary ? "（主联系人）" : ""}{link.role ? ` · ${link.role}` : link.contact.title ? ` · ${link.contact.title}` : ""}</span>) : <span>尚未关联</span>}</div>
        <div><strong>关联报价</strong>{opportunity.quotations.length ? opportunity.quotations.map((quote) => <span key={quote.id}>{quotationNumber(quote)} · {quote.status}</span>) : <span>尚未关联</span>}</div>
      </div>
      {canWrite ? <form className={styles.activityForm} onSubmit={submitActivity}>
        <strong>记录一次客户跟进</strong>
        <div className={styles.activityGrid}>
          <label>方式<select value={activity.type} onChange={(event) => setActivity({ ...activity, type: event.target.value as OpportunityActivityType })}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>联系人<select value={activity.contactId} onChange={(event) => setActivity({ ...activity, contactId: event.target.value })}><option value="">未指定</option>{opportunity.contactLinks.map((link) => <option key={link.contact.id} value={link.contact.id}>{link.contact.name}</option>)}</select></label>
          <label>发生时间<input type="datetime-local" value={activity.occurredAt} onChange={(event) => setActivity({ ...activity, occurredAt: event.target.value })} /></label>
          <label className={styles.wide}>主题<input required maxLength={200} value={activity.subject} placeholder="例如：确认试单价格" onChange={(event) => setActivity({ ...activity, subject: event.target.value })} /></label>
          <label className={styles.wide}>结果<input maxLength={1000} value={activity.outcome} placeholder="客户确认 / 待内部评估 / 需要重报" onChange={(event) => setActivity({ ...activity, outcome: event.target.value })} /></label>
          <label className={styles.full}>详细记录<textarea rows={2} maxLength={2000} value={activity.note} onChange={(event) => setActivity({ ...activity, note: event.target.value })} /></label>
        </div>
        <div className={styles.actions}><button className={shell.primaryButtonCompact} disabled={activitySaving} type="submit">{activitySaving ? "保存中..." : "保存跟进"}</button></div>
        {error ? <div className={shell.inlineError} role="alert">{error}</div> : null}
      </form> : null}
      <div className={styles.timeline}><h4>项目轨迹</h4>{events.length ? events.map((event) => <article key={event.id}><time>{formatDate(event.at)}</time><div><strong>{event.title}</strong>{event.detail ? <p>{event.detail}</p> : null}<small>{event.by ? `记录人：${event.by}` : "系统记录"}</small></div></article>) : <p>暂无跟进记录。</p>}</div>
      <div className={styles.stageGuide}><strong>阶段门槛</strong>{OPPORTUNITY_STAGES.map((stage) => <span key={stage.value}>{stage.label} {stage.probability}%</span>)}</div>
    </section>
  );
}
