"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { apiJson } from "../../api";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import styles from "./purchase-order-actions.module.css";
import type { FactoryPurchaseOrder } from "./types";

const ACCEPT = ".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_BYTES = 10 * 1024 * 1024;

function formatFileSize(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File) {
  const lowerName = file.name.toLowerCase();
  const supportedName = lowerName.endsWith(".pdf") || lowerName.endsWith(".xlsx");
  const supportedType = !file.type || [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ].includes(file.type);
  if (!supportedName || !supportedType) return "仅支持安全 PDF 或不含宏、外链的 XLSX 文件";
  if (!file.size) return "附件不能为空";
  if (file.size > MAX_BYTES) return "附件大小不能超过 10MB";
  return "";
}

export function PurchaseOrderDispatchAttachment({
  executionId,
  order,
  onChanged,
  onBusyChange,
}: {
  executionId: string;
  order: FactoryPurchaseOrder;
  onChanged: () => void | Promise<void>;
  onBusyChange?: (purchaseOrderId: string, busy: boolean) => void;
}) {
  const attachment = order.dispatchAttachment;
  const editable = order.status === "DRAFT";
  const [confirmedSafe, setConfirmedSafe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useWorkspaceTabBusy(busy);
  const endpoint = `/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/dispatch-attachment`;
  const shownName = attachment?.originalFileName || attachment?.fileName || "";

  useEffect(() => () => onBusyChange?.(order.id, false), [onBusyChange, order.id]);

  function updateBusy(nextBusy: boolean) {
    setBusy(nextBusy);
    onBusyChange?.(order.id, nextBusy);
  }

  async function refreshAfterChange(successMessage: string) {
    setStatus(successMessage);
    try {
      await onChanged();
    } catch {
      setStatus(`${successMessage}，但详情刷新失败，请重新打开执行单查看`);
    }
  }

  async function upload(change: ChangeEvent<HTMLInputElement>) {
    const file = change.target.files?.[0];
    if (!file || busy) return;
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      change.target.value = "";
      return;
    }
    if (!confirmedSafe) {
      setError("请先勾选确认：附件不含客户资料、销售价格或利润");
      change.target.value = "";
      return;
    }
    updateBusy(true);
    setError("");
    setStatus("");
    const body = new FormData();
    body.set("file", file);
    body.set("confirmedSupplierSafe", "true");
    try {
      await apiJson(endpoint, { method: "POST", body, timeoutMs: 60_000 });
      await refreshAfterChange(attachment ? "采购明细附件已替换" : "采购明细附件已上传，正式下发邮件会自动附带");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "采购明细附件上传失败");
    } finally {
      change.target.value = "";
      updateBusy(false);
    }
  }

  async function remove() {
    if (!attachment || busy || !window.confirm("确认删除这份采购明细附件吗？")) return;
    updateBusy(true);
    setError("");
    setStatus("");
    try {
      await apiJson(endpoint, { method: "DELETE" });
      await refreshAfterChange("采购明细附件已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "采购明细附件删除失败");
    } finally {
      updateBusy(false);
    }
  }

  return (
    <section className={styles.dispatchAttachment} aria-label="原始采购明细附件">
      <div className={styles.dispatchAttachmentHeading}>
        <div>
          <strong>原始采购明细附件（可选）</strong>
          <small>支持安全 PDF、XLSX（可含普通公式，不含宏/外链），最大 10MB；正式下发时自动附在供应商通知邮件中。</small>
        </div>
        {attachment ? <span>已保存</span> : <span data-empty="true">未上传</span>}
      </div>
      {attachment ? (
        <div className={styles.dispatchAttachmentFile}>
          <div>
            <strong>{shownName}</strong>
            <small>{formatFileSize(attachment.fileSize)}{attachment.uploadedBy?.name ? ` · ${attachment.uploadedBy.name}` : ""}</small>
          </div>
          <div className={styles.dispatchAttachmentActions}>
            {attachment.downloadUrl ? <a href={attachment.downloadUrl}>下载</a> : null}
            {editable ? <button type="button" disabled={busy} onClick={() => void remove()}>删除</button> : null}
          </div>
        </div>
      ) : null}
      {editable ? (
        <div className={styles.dispatchAttachmentControls}>
          <label className={styles.dispatchAttachmentConfirmation}>
            <input type="checkbox" checked={confirmedSafe} disabled={busy} onChange={(event) => setConfirmedSafe(event.target.checked)} />
            我确认附件仅含供应商可见采购信息，不含客户资料、销售价格或利润
          </label>
          <label className={styles.dispatchAttachmentUpload} data-disabled={busy}>
            <input type="file" accept={ACCEPT} disabled={busy} aria-label={attachment ? "替换原始采购明细附件" : "上传原始采购明细附件"} onChange={(event) => void upload(event)} />
            {busy ? "处理中..." : attachment ? "替换附件" : "上传附件"}
          </label>
        </div>
      ) : attachment ? <small className={styles.dispatchAttachmentLocked}>采购单已正式下发，附件已锁定，邮件重试仍使用本次下发的文件。</small> : null}
      {status ? <div className={styles.success} role="status">{status}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
    </section>
  );
}
