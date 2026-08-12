"use client";

import { useState, type FormEvent } from "react";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import styles from "./sales-execution.module.css";

export type QuotationConversionDraft = {
  quotationId: string;
  expectedVersionNumber: number;
  customerOrderNo: string;
  requestedDeliveryDate: string;
};

export function QuotationConversionPanel({
  draft,
  saving,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: QuotationConversionDraft;
  saving: boolean;
  error: string;
  onChange: (draft: QuotationConversionDraft) => void;
  onCancel: () => void;
  onSubmit: (draft: QuotationConversionDraft) => void;
}) {
  const [message, setMessage] = useState("");
  useWorkspaceTabDirty(Boolean(draft.customerOrderNo.trim() || draft.requestedDeliveryDate));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.customerOrderNo.trim()) {
      setMessage("请填写客户订单号");
      return;
    }
    if (!draft.requestedDeliveryDate) {
      setMessage("请选择客户要求交货日期");
      return;
    }
    setMessage("");
    onSubmit({ ...draft, customerOrderNo: draft.customerOrderNo.trim() });
  }

  return (
    <form className={styles.formPanel} onSubmit={submit} inert={saving} aria-busy={saving}>
      <div className={styles.formHeader}>
        <div className={styles.formTitle}>
          <strong>报价转入销售执行</strong>
          <small>报价已确认。请先补齐两项关键凭证，再生成销售执行草稿。</small>
        </div>
        <span className={`${styles.sourcePill} ${styles.sourceQuote}`}>报价转入</span>
      </div>
      {message || error ? <div className={shell.inlineError} role="alert">{message || error}</div> : null}
      <div className={styles.formGrid}>
        <label className={styles.wideField}>
          客户订单号
          <input required autoFocus maxLength={100} value={draft.customerOrderNo} disabled={saving} onChange={(event) => onChange({ ...draft, customerOrderNo: event.target.value })} />
          <span className={styles.fieldHint}>将作为后续下单、采购和交付流程的重要凭证。</span>
        </label>
        <label className={styles.wideField}>
          客户要求交货日期
          <input type="date" required value={draft.requestedDeliveryDate} disabled={saving} onChange={(event) => onChange({ ...draft, requestedDeliveryDate: event.target.value })} />
          <span className={styles.fieldHint}>保留为客户原始要求；供应商拒绝该日期并建议新日期时，不覆盖此记录。</span>
        </label>
      </div>
      <div className={styles.formActions}>
        <button className={shell.secondaryButton} type="button" disabled={saving} onClick={onCancel}>取消</button>
        <button className={shell.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "生成中..." : "生成销售执行草稿"}</button>
      </div>
    </form>
  );
}
