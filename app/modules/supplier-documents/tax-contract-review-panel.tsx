"use client";

import { useState } from "react";
import { apiJson } from "../../api";
import styles from "../../WorkspaceShell.module.css";
import { ContractDraftEditor } from "./contract-draft-editor";
import { InvoiceOcrEditor } from "./invoice-ocr-editor";
import type { SupplierDocumentTask, SupplierInvoiceData, SupplierTaxContractDraftItem } from "./types";

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
  AWAITING_REVIEW: "发票数据完整匹配，待人工确认",
  CONFIRMED: "发票已人工确认",
  REJECTED: "发票已驳回",
  FAILED: "发票OCR识别失败",
};

export function TaxContractReviewPanel({ task, isAdmin, canWrite, onRefresh }: { task: SupplierDocumentTask; isAdmin: boolean; canWrite: boolean; onRefresh: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [invoiceDirty, setInvoiceDirty] = useState(false);
  const [message, setMessage] = useState("");
  const draft = task.contractDraft || task.contractApproved;
  const issues = task.invoiceMatch?.issues || [];
  const hasInvoice = (task.documents || []).some((document) => document.documentType === "SUPPLIER_INVOICE");
  const isTransitionContract = draft?.sourceType === "FACTORY_PURCHASE_TRANSITION_SETTLEMENT";
  const showContractScanIssues = task.contractStatus !== "APPROVED";
  const canEditInvoice = isAdmin && canWrite && task.contractStatus === "APPROVED" && hasInvoice
    && !["PROCESSING", "CONFIRMED"].includes(task.invoiceMatchStatus || "NOT_UPLOADED");
  const effectiveInvoice = task.invoiceEffective || task.invoiceMatch?.invoice || null;

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
        body: JSON.stringify({
          decision,
          confirmed: decision === "APPROVED",
          expectedRevision: task.contractRevision || 1,
          remark: decision === "REJECTED" ? "人工审核未通过" : "已核查确认",
        }),
      });
      await onRefresh();
      setBusy(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "合同审核失败");
      setBusy(false);
    }
  }

  async function saveDraft(items: SupplierTaxContractDraftItem[]) {
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
    if (decision === "CONFIRMED" && invoiceDirty) {
      setMessage("请先保存发票人工核对结果，再确认发票。");
      return;
    }
    const reason = decision === "REJECTED" ? window.prompt("请输入驳回原因") || "" : "";
    if (decision === "REJECTED" && !reason.trim()) return;
    let overrideReason = "";
    if (decision === "CONFIRMED" && task.invoiceMatchStatus === "MISMATCH") {
      const mismatchSummary = issues.length ? `\n\n当前差异：\n${issues.map((issue) => `- ${issue}`).join("\n")}` : "";
      overrideReason = window.prompt(`系统检测到发票与合同存在差异。请输入人工复核通过说明（至少5个字），系统将保留差异和审核记录。${mismatchSummary}`) || "";
      if (!overrideReason.trim()) return;
      if (overrideReason.trim().length < 5) {
        window.alert("人工复核通过说明至少需要5个字。");
        return;
      }
    }
    if (decision === "CONFIRMED" && !window.confirm("确认已查看发票原件，并以当前人工核对结果通过审核？确认后该资料任务将按完成规则重新计算。")) return;
    setBusy(true);
    try {
      await apiJson(`/api/supplier-document-requests/${encodeURIComponent(task.id)}/invoice-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          reason,
          overrideReason,
          ...(decision === "CONFIRMED" ? {
            expectedOcrTaskId: task.invoiceOcrTaskId || "",
            expectedRevision: task.invoiceReviewRevision || 1,
          } : {}),
        }),
      });
      await onRefresh();
      setBusy(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "发票审核失败");
      setBusy(false);
    }
  }

  async function saveInvoice(invoice: Pick<SupplierInvoiceData, "header" | "items">) {
    setBusy(true);
    setMessage("");
    try {
      await apiJson(`/api/supplier-document-requests/${encodeURIComponent(task.id)}/invoice-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "SAVE_MANUAL",
          expectedOcrTaskId: task.invoiceOcrTaskId || "",
          expectedRevision: task.invoiceReviewRevision || 1,
          invoice,
        }),
      });
      setMessage("发票人工核对结果已保存；请核对系统重新匹配的结果。");
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存发票人工核对结果失败");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function retryInvoiceOcr() {
    if (invoiceDirty) {
      setMessage("发票有尚未保存的人工修改，请先保存或刷新后再重新识别。");
      return;
    }
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

  async function revokeTransitionSettlement() {
    const reason = window.prompt("请输入撤销原因；撤销后当前错误合同草稿和已上传回传资料会作废，原成本恢复为手工成本，可重新创建过渡结算。") || "";
    if (!reason.trim()) return;
    if (reason.trim().length < 5) {
      window.alert("请填写至少5个字的撤销原因。");
      return;
    }
    if (!window.confirm("确认撤销这条已冻结的过渡结算凭证？撤销后需要重新发起资料回传任务。")) return;
    setBusy(true);
    setMessage("");
    try {
      await apiJson(`/api/supplier-document-requests/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "revokeTransitionSettlement", reason }),
      });
      setMessage("过渡结算凭证已撤销，请重新发起资料回传任务。");
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "撤销过渡结算失败");
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
          {isTransitionContract && task.canRevokeTransitionSettlement ? (
            <div className={styles.inlineError}>
              <span>如果本次过渡结算冻结错误，可由管理员撤销后重新创建。</span>
              <button className={styles.secondaryButton} type="button" disabled={busy} onClick={revokeTransitionSettlement}>撤销过渡结算</button>
            </div>
          ) : null}
          {isAdmin && canWrite && task.contractStatus === "PENDING_REVIEW" ? (
            <ContractDraftEditor key={`${task.id}-${task.contractRevision || 1}`} items={draft.items || []} busy={busy} onSave={saveDraft} onDirtyChange={setDraftDirty} />
          ) : <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead><tr><th>品名（按报关单）</th><th>数量</th><th>单位</th><th>含税单价</th><th>含税金额</th></tr></thead>
              <tbody>{(draft.items || []).map((item) => <tr key={`${item.lineNo}-${item.productName}`}><td>{item.productName}</td><td>{item.quantity}</td><td>{item.unit}</td><td>{item.unitPriceWithTax}</td><td>{item.amountWithTax}</td></tr>)}</tbody>
            </table>
          </div>}
          {showContractScanIssues ? (
            <>
              {(draft.warnings || []).map((warning) => <div className={styles.inlineError} key={warning}>{warning}</div>)}
              {(draft.blockingIssues || []).map((issue) => <div className={styles.inlineError} key={issue}>禁止通过：{issue}</div>)}
            </>
          ) : null}
          {message ? <p>{message}</p> : null}
        </div>
      ) : null}
      {isAdmin && canWrite && task.contractStatus === "PENDING_REVIEW" ? (
        <div className={styles.supplierDocumentNoticeActions}>
          <a
            className={styles.secondaryButton}
            href={`/api/supplier-document-requests/${encodeURIComponent(task.id)}/contract-preview`}
            aria-disabled={draftDirty}
            onClick={(event) => {
              if (draftDirty) event.preventDefault();
            }}
          >
            下载合同草稿（Excel）
          </a>
          <button className={styles.primaryButtonCompact} type="button" disabled={busy || draftDirty || Boolean(draft?.blockingIssues?.length)} onClick={() => reviewContract("APPROVED")}>人工核查并通过</button>
          <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => reviewContract("REJECTED")}>驳回草稿</button>
        </div>
      ) : null}
      {task.contractStatus === "APPROVED" ? <p><b>发票识别/人工核对状态：</b>{INVOICE_STATUS_LABELS[task.invoiceMatchStatus || "NOT_UPLOADED"] || task.invoiceMatchStatus}</p> : null}
      {task.invoiceManualEditedAt ? <p>最近人工保存：{task.invoiceManualEditedAt}</p> : null}
      {canEditInvoice ? (
        <InvoiceOcrEditor
          key={`${task.id}-invoice-${task.invoiceReviewRevision || 1}`}
          invoice={effectiveInvoice}
          busy={busy}
          onSave={saveInvoice}
          onDirtyChange={setInvoiceDirty}
        />
      ) : null}
      {issues.map((issue, index) => <div className={styles.inlineError} key={`${issue}-${index}`}>{issue}</div>)}
      {isAdmin && canWrite && task.contractStatus === "APPROVED" && hasInvoice
        && !["PROCESSING", "AWAITING_REVIEW", "CONFIRMED"].includes(task.invoiceMatchStatus || "NOT_UPLOADED") ? (
        <div className={styles.supplierDocumentNoticeActions}>
          <button className={styles.secondaryButton} type="button" disabled={busy} onClick={retryInvoiceOcr}>重新执行腾讯云 OCR</button>
        </div>
      ) : null}
      {isAdmin && canWrite && ["MISMATCH", "AWAITING_REVIEW"].includes(task.invoiceMatchStatus || "NOT_UPLOADED") ? (
        <div className={styles.supplierDocumentNoticeActions}>
          <button className={styles.primaryButtonCompact} type="button" disabled={busy || invoiceDirty} onClick={() => reviewInvoice("CONFIRMED")}>
            {task.invoiceMatchStatus === "MISMATCH" ? "人工审核并通过" : "查看原件并确认发票"}
          </button>
          <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => reviewInvoice("REJECTED")}>驳回发票</button>
        </div>
      ) : null}
    </section>
  );
}
