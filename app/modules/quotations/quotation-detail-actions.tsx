"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import { QuotationDocumentPreviewDialog } from "./quotation-document-preview-dialog";
import { QuotationEmailDialog } from "./quotation-email-dialog";
import { quotationValidityState } from "./quotation-expiry";
import { QuotationManualConfirmationDialog } from "./quotation-manual-confirmation-dialog";
import styles from "./quotations.module.css";
import type { QuotationRow } from "./types";

type DocumentResponse = { success?: boolean; message?: string };

export function QuotationDetailActions({
  quotation,
  versionNumber,
  canWrite,
  canSendCustomerEmail,
  ready,
  onSaved,
}: {
  quotation: QuotationRow;
  versionNumber: number;
  canWrite: boolean;
  canSendCustomerEmail: boolean;
  ready: boolean;
  onSaved: (quotation: QuotationRow, message: string) => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [manualConfirmationOpen, setManualConfirmationOpen] = useState(false);
  const documentBusyRef = useRef(false);
  useWorkspaceTabBusy(Boolean(busy));
  const currentVersionNumber = Number(quotation.currentVersionNumber || 1);
  const isCurrent = versionNumber === currentVersionNumber;
  const expired = quotationValidityState(quotation).expired;
  const sendAllowed = ready && !expired && canWrite && canSendCustomerEmail && isCurrent && ["DRAFT", "SENT"].includes(String(quotation.status));
  const manualConfirmationAllowed = ready && !expired && canWrite && isCurrent && ["DRAFT", "SENT"].includes(String(quotation.status));

  function documentUrl(download = false) {
    const params = new URLSearchParams({ versionNumber: String(versionNumber) });
    if (download) params.set("download", "1");
    return `/api/quotations/${encodeURIComponent(quotation.id)}/document?${params}`;
  }

  async function ensureDocument() {
    if (!ready) throw new Error("报价详情尚未完整加载");
    if (!canWrite) return;
    const result = await apiJson<DocumentResponse>(`/api/quotations/${encodeURIComponent(quotation.id)}/document`, {
      method: "POST",
      body: JSON.stringify({ versionNumber }),
    });
    if (result.success !== true) throw new Error(result.message || "形式发票生成失败");
  }

  async function previewDocument() {
    if (documentBusyRef.current) return;
    documentBusyRef.current = true;
    setBusy("preview");
    setError("");
    try {
      await ensureDocument();
      setPreviewUrl(documentUrl());
    } catch (documentError) {
      setError(documentError instanceof Error ? documentError.message : "形式发票预览失败");
    } finally {
      documentBusyRef.current = false;
      setBusy("");
    }
  }

  async function downloadDocument() {
    if (documentBusyRef.current) return;
    documentBusyRef.current = true;
    setBusy("download");
    setError("");
    try {
      await ensureDocument();
      const anchor = window.document.createElement("a");
      anchor.href = documentUrl(true);
      anchor.download = "";
      anchor.click();
    } catch (documentError) {
      setError(documentError instanceof Error ? documentError.message : "形式发票下载失败");
    } finally {
      documentBusyRef.current = false;
      setBusy("");
    }
  }

  return <>
    <div className={styles.detailActions}>
      <button className={shell.secondaryButton} type="button" disabled={!ready || Boolean(busy)} onClick={() => void previewDocument()}>
        {busy === "preview" ? "生成中..." : "预览 PI"}
      </button>
      <button className={shell.secondaryButton} type="button" disabled={!ready || Boolean(busy)} onClick={() => void downloadDocument()}>
        {busy === "download" ? "生成中..." : "下载 PDF"}
      </button>
      {sendAllowed ? <button className={shell.primaryButtonCompact} type="button" disabled={Boolean(busy)} onClick={() => setEmailOpen(true)}>发送客户</button> : null}
      {manualConfirmationAllowed ? <button className={shell.primaryButtonCompact} type="button" disabled={Boolean(busy)} onClick={() => setManualConfirmationOpen(true)}>手动确认</button> : null}
      {error ? <small className={styles.actionError} role="alert" aria-live="assertive">{error}</small> : null}
    </div>
    {previewUrl ? <QuotationDocumentPreviewDialog url={previewUrl} onClose={() => setPreviewUrl("")} /> : null}
    {emailOpen ? <QuotationEmailDialog quotation={quotation} onClose={() => setEmailOpen(false)} onSaved={onSaved} /> : null}
    {manualConfirmationOpen ? (
      <QuotationManualConfirmationDialog
        quotation={quotation}
        expectedVersionNumber={currentVersionNumber}
        onClose={() => setManualConfirmationOpen(false)}
        onSaved={onSaved}
      />
    ) : null}
  </>;
}
