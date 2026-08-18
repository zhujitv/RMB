"use client";

import { useState } from "react";
import { apiJson } from "../../api";
import styles from "../../WorkspaceShell.module.css";
import type { SupplierDocumentTask, SupplierTaxContractDraft } from "./types";

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  LEGACY: "历史合同",
  PENDING_REVIEW: "合同草稿待人工审核",
  APPROVED: "合同已确认",
  REJECTED: "合同草稿已驳回",
};

const INVOICE_STATUS_LABELS: Record<string, string> = {
  NOT_UPLOADED: "发票未上传",
  PROCESSING: "发票OCR识别中",
  MISMATCH: "发票与合同不匹配",
  AWAITING_REVIEW: "OCR完整匹配，待人工确认",
  CONFIRMED: "发票已人工确认",
  REJECTED: "发票已驳回",
  FAILED: "发票OCR识别失败",
};

type DraftItem = NonNullable<SupplierTaxContractDraft["items"]>[number];

function ContractDraftEditor({ items, busy, onSave, onDirtyChange }: {
  items: DraftItem[];
  busy: boolean;
  onSave: (items: DraftItem[]) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [rows, setRows] = useState(() => items.map((item) => ({ ...item })));
  const [dirty, setDirty] = useState(false);

  function updateRow(index: number, field: "productName" | "quantity" | "unit", value: string) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    if (!dirty) {
      setDirty(true);
      onDirtyChange(true);
    }
  }

  async function save() {
    try {
      await onSave(rows);
      setDirty(false);
      onDirtyChange(false);
    } catch {
      // The parent renders the server validation message and keeps the draft dirty.
    }
  }

  return (
    <>
      <div className={styles.tableScroll}>
        <table className={styles.compactTable}>
          <thead><tr><th>品名（按报关单）</th><th>数量</th><th>单位</th><th>含税单价</th><th>含税金额</th></tr></thead>
          <tbody>{rows.map((item, index) => (
            <tr key={item.purchaseOrderItemId || `${item.lineNo}-${index}`}>
              <td><input aria-label={`第${item.lineNo || index + 1}行品名`} value={item.productName || ""} maxLength={200} onChange={(event) => updateRow(index, "productName", event.target.value)} /></td>
              <td><input aria-label={`第${item.lineNo || index + 1}行数量`} inputMode="decimal" value={item.quantity || ""} onChange={(event) => updateRow(index, "quantity", event.target.value)} /></td>
              <td><input aria-label={`第${item.lineNo || index + 1}行单位`} value={item.unit || ""} maxLength={40} onChange={(event) => updateRow(index, "unit", event.target.value)} /></td>
              <td>{item.unitPriceWithTax}</td><td>{item.amountWithTax}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className={styles.supplierDocumentNoticeActions}>
        <button className={styles.secondaryButton} type="button" disabled={busy || !dirty} onClick={save}>保存人工修正</button>
        {dirty ? <span>修改尚未保存，保存后才能审核通过。</span> : <span>原始 OCR 快照会保留，修改记录写入系统日志。</span>}
      </div>
    </>
  );
}

export function TaxContractReviewPanel({ task, isAdmin, canWrite, onRefresh }: { task: SupplierDocumentTask; isAdmin: boolean; canWrite: boolean; onRefresh: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [message, setMessage] = useState("");
  const draft = task.contractDraft || task.contractApproved;
  const issues = task.invoiceMatch?.issues || [];
  const hasInvoice = (task.documents || []).some((document) => document.documentType === "SUPPLIER_INVOICE");
  const isTransitionContract = draft?.sourceType === "FACTORY_PURCHASE_TRANSITION_SETTLEMENT";

  async function reviewContract(decision: "APPROVED" | "REJECTED") {
    if (decision === "APPROVED" && draftDirty) {
      setMessage("请先保存人工修正，再审核通过。");
      return;
    }
    const confirmed = decision === "APPROVED"
      ? window.confirm("确认已逐行核查报关品名、数量、单位、实际装柜数量及合同总金额？确认后将生成合同并邮件发送供应商。")
      : window.confirm("确认驳回此合同草稿？");
    if (!confirmed) return;
    setBusy(true);
    try {
      await apiJson(`/api/supplier-document-requests/${encodeURIComponent(task.id)}/contract-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, confirmed: decision === "APPROVED", remark: decision === "REJECTED" ? "人工审核未通过" : "已核查确认" }),
      });
      await onRefresh();
      setBusy(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "合同审核失败");
      setBusy(false);
    }
  }

  async function saveDraft(items: DraftItem[]) {
    setBusy(true);
    setMessage("");
    try {
      await apiJson(`/api/supplier-document-requests/${encodeURIComponent(task.id)}/contract-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "SAVE_DRAFT", expectedRevision: task.contractRevision || 1, items }),
      });
      setMessage("人工修正已保存，请再次核对金额后审核。");
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存合同草稿失败");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function reviewInvoice(decision: "CONFIRMED" | "REJECTED") {
    const reason = decision === "REJECTED" ? window.prompt("请输入驳回原因") || "" : "";
    if (decision === "REJECTED" && !reason.trim()) return;
    if (decision === "CONFIRMED" && !window.confirm("确认已查看发票原件，并同意OCR核验结果？")) return;
    setBusy(true);
    try {
      await apiJson(`/api/supplier-document-requests/${encodeURIComponent(task.id)}/invoice-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      await onRefresh();
      setBusy(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "发票审核失败");
      setBusy(false);
    }
  }

  async function retryInvoiceOcr() {
    if (!window.confirm("确认使用已上传的发票重新执行腾讯云 OCR？")) return;
    setBusy(true);
    setMessage("");
    try {
      await apiJson(`/api/supplier-document-requests/${encodeURIComponent(task.id)}/invoice-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "RETRY_OCR" }),
      });
      setMessage("腾讯云发票 OCR 已重新执行。请核对识别结果。");
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重新执行腾讯云发票 OCR 失败");
    } finally {
      setBusy(false);
    }
  }

  if (!task.contractStatus || task.contractStatus === "LEGACY") return null;
  return (
    <section className={styles.supplierDocumentUploadCard} aria-label="退税合同与发票核验">
      <div className={styles.supplierDocumentUploadHeader}>
        <strong>退税合同 {task.contractNo ? `· ${task.contractNo}` : ""}</strong>
        <span className={styles.statusPill}>{CONTRACT_STATUS_LABELS[task.contractStatus] || task.contractStatus}</span>
      </div>
      {draft ? (
        <div className={styles.supplierDocumentUploadBody}>
          <p>供方：{draft.supplierName || "-"}　需方：{draft.buyerName || "-"}　总金额：{draft.currency || "CNY"} {draft.totalAmountWithTax || "0.00"}</p>
          {isTransitionContract ? <p><b>历史过渡结算：</b>本合同基于已发货报关订单的冻结过渡凭证生成，未补造历史采购和生产记录。</p> : null}
          {isAdmin && canWrite && task.contractStatus === "PENDING_REVIEW" && !isTransitionContract ? (
            <ContractDraftEditor key={`${task.id}-${task.contractRevision || 1}`} items={draft.items || []} busy={busy} onSave={saveDraft} onDirtyChange={setDraftDirty} />
          ) : <div className={styles.tableScroll}>
            <table className={styles.compactTable}>
              <thead><tr><th>品名（按报关单）</th><th>数量</th><th>单位</th><th>含税单价</th><th>含税金额</th></tr></thead>
              <tbody>{(draft.items || []).map((item) => <tr key={`${item.lineNo}-${item.productName}`}><td>{item.productName}</td><td>{item.quantity}</td><td>{item.unit}</td><td>{item.unitPriceWithTax}</td><td>{item.amountWithTax}</td></tr>)}</tbody>
            </table>
          </div>}
          {(draft.warnings || []).map((warning) => <div className={styles.inlineError} key={warning}>{warning}</div>)}
          {(draft.blockingIssues || []).map((issue) => <div className={styles.inlineError} key={issue}>禁止通过：{issue}</div>)}
          {message ? <p>{message}</p> : null}
        </div>
      ) : null}
      {isAdmin && canWrite && task.contractStatus === "PENDING_REVIEW" ? (
        <div className={styles.supplierDocumentNoticeActions}>
          <button className={styles.primaryButtonCompact} type="button" disabled={busy || draftDirty || Boolean(draft?.blockingIssues?.length)} onClick={() => reviewContract("APPROVED")}>人工核查并通过</button>
          <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => reviewContract("REJECTED")}>驳回草稿</button>
        </div>
      ) : null}
      {task.contractStatus === "APPROVED" ? <p><b>腾讯云发票 OCR 状态：</b>{INVOICE_STATUS_LABELS[task.invoiceMatchStatus || "NOT_UPLOADED"] || task.invoiceMatchStatus}</p> : null}
      {issues.map((issue) => <div className={styles.inlineError} key={issue}>{issue}</div>)}
      {isAdmin && canWrite && task.contractStatus === "APPROVED" && hasInvoice
        && !["PROCESSING", "AWAITING_REVIEW", "CONFIRMED"].includes(task.invoiceMatchStatus || "NOT_UPLOADED") ? (
        <div className={styles.supplierDocumentNoticeActions}>
          <button className={styles.secondaryButton} type="button" disabled={busy} onClick={retryInvoiceOcr}>重新执行腾讯云 OCR</button>
        </div>
      ) : null}
      {isAdmin && canWrite && task.invoiceMatchStatus === "AWAITING_REVIEW" ? (
        <div className={styles.supplierDocumentNoticeActions}>
          <button className={styles.primaryButtonCompact} type="button" disabled={busy} onClick={() => reviewInvoice("CONFIRMED")}>查看原件并确认发票</button>
          <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => reviewInvoice("REJECTED")}>驳回发票</button>
        </div>
      ) : null}
    </section>
  );
}
