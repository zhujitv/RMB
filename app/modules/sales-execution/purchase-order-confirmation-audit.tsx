"use client";

import { useState, type ChangeEvent } from "react";
import { formatCurrencyAmount, formatCurrencyUnitPrice, formatDate, formatDateTime } from "../../formatters";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import styles from "./purchase-order-actions.module.css";
import {
  CONFIRMATION_EVIDENCE_ACCEPT,
  uploadConfirmationEvidence,
  validateConfirmationEvidenceFile,
  type ConfirmationEvidenceKind,
} from "./confirmation-evidence-upload";
import {
  factoryConfirmationChannelLabel,
  factoryConfirmationSourceLabel,
  factoryResponseActionLabel,
} from "./offline-confirmation-values";
import type { FactoryPurchaseOrder, FactoryPurchaseOrderConfirmationEvent } from "./types";

function eventId(event: FactoryPurchaseOrderConfirmationEvent, order: FactoryPurchaseOrder) {
  if (event.eventId) return event.eventId;
  if (event.kind === "PRODUCTION_COMPLETION" || event.action === "PRODUCTION_COMPLETED") return order.id;
  return event.key.startsWith("supplier-response:") ? event.key.slice("supplier-response:".length) : "";
}

export function PurchaseOrderConfirmationAudit({
  executionId,
  order,
  canManage,
  onChanged,
}: {
  executionId: string;
  order: FactoryPurchaseOrder;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [uploadingKey, setUploadingKey] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useWorkspaceTabBusy(Boolean(uploadingKey));
  const historyEvents: FactoryPurchaseOrderConfirmationEvent[] = (order.supplierResponseHistory || []).map((response, index) => ({
    key: `supplier-response:${response.id || response.sequence || index}`,
    eventId: response.id,
    kind: "SUPPLIER_RESPONSE",
    action: response.action,
    deliveryDate: response.deliveryDate,
    priceChanges: response.priceChanges,
    source: response.source,
    channel: response.channel,
    supplierContact: response.supplierContact,
    occurredAt: response.supplierRespondedAt || response.respondedAt,
    recordedAt: response.recordedAt,
    recordedBy: response.recordedBy,
    remark: response.remark,
    evidenceNote: response.evidenceNote || (typeof response.evidence === "string" ? response.evidence : ""),
    evidence: typeof response.evidence === "object" ? response.evidence : null,
  }));
  const completionEvent: FactoryPurchaseOrderConfirmationEvent[] = order.productionCompletedAt ? [{
    key: `production-completion:${order.id}`,
    eventId: order.id,
    kind: "PRODUCTION_COMPLETION",
    action: "PRODUCTION_COMPLETED",
    source: order.productionCompletionSource,
    channel: order.productionCompletionChannel,
    supplierContact: order.productionCompletionContact,
    occurredAt: order.productionCompletedAt,
    recordedAt: order.productionCompletionRecordedAt || order.productionCompletedAt,
    recordedBy: order.productionCompletedBy,
    remark: order.productionCompletionRemark,
    evidenceNote: order.productionCompletionEvidenceNote || (typeof order.productionCompletionEvidence === "string" ? order.productionCompletionEvidence : ""),
    evidence: typeof order.productionCompletionEvidence === "object" ? order.productionCompletionEvidence : null,
  }] : [];
  const events = order.confirmationEvents?.length ? order.confirmationEvents : [...historyEvents, ...completionEvent];

  async function upload(event: FactoryPurchaseOrderConfirmationEvent, file: File, input: HTMLInputElement) {
    const validationError = validateConfirmationEvidenceFile(file);
    if (validationError) {
      setError(validationError);
      input.value = "";
      return;
    }
    const targetId = eventId(event, order);
    if (!targetId || uploadingKey) return;
    const kind: ConfirmationEvidenceKind = event.kind === "SUPPLIER_RESPONSE" ? "SUPPLIER_RESPONSE" : "PRODUCTION_COMPLETION";
    setUploadingKey(event.key);
    setError("");
    setStatus("");
    try {
      await uploadConfirmationEvidence({ executionId, purchaseOrderId: order.id, eventKind: kind, eventId: targetId, file });
      setStatus("确认凭证已上传");
      try {
        await onChanged();
      } catch {
        setStatus("确认凭证已上传，但详情刷新失败，请重新打开执行单查看");
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "确认凭证上传失败，请重试");
    } finally {
      input.value = "";
      setUploadingKey("");
    }
  }

  function selectFile(event: FactoryPurchaseOrderConfirmationEvent, change: ChangeEvent<HTMLInputElement>) {
    const file = change.target.files?.[0];
    if (file) void upload(event, file, change.target);
  }

  if (!events.length) return null;
  const currency = String(order.purchaseCurrency || order.currency || "CNY");
  return (
    <section className={styles.confirmationAuditList} aria-label="工厂确认记录">
      <strong className={styles.confirmationAuditTitle}>工厂确认记录</strong>
      {events.map((event) => {
        const completion = event.kind === "PRODUCTION_COMPLETION" || event.action === "PRODUCTION_COMPLETED";
        const note = event.evidenceNote || (typeof event.evidence === "string" ? event.evidence : "");
        const evidence = typeof event.evidence === "object" ? event.evidence : null;
        const fileName = evidence?.originalFileName || evidence?.fileName || "";
        const uploadable = canManage && event.source === "INTERNAL_OFFLINE" && Boolean(eventId(event, order));
        return <div className={styles.confirmationAudit} key={event.key}>
          <strong>{completion ? "生产完成确认" : factoryResponseActionLabel(event.action)}</strong>
          <span>来源：{factoryConfirmationSourceLabel(event.source)} · 渠道：{factoryConfirmationChannelLabel(event.channel)}</span>
          <span>工厂联系人：{event.supplierContact || "-"} · {completion ? "实际完工" : "实际回复"}：{formatDateTime(event.occurredAt)}</span>
          <span>系统登记：{formatDateTime(event.recordedAt)}{event.recordedBy?.name ? ` · ${event.recordedBy.name}` : ""}</span>
          {event.deliveryDate ? <span>本次回复交期：{formatDate(event.deliveryDate)}</span> : null}
          {event.priceChanges?.length ? <span>本次确认价格：{event.priceChanges.map((price) => formatCurrencyUnitPrice(currency, price.unitPrice)).join("、")}</span> : null}
          {event.remark ? <span>{completion ? "完工说明" : "回复说明"}：{event.remark}</span> : null}
          {note ? <span>依据说明：{note}</span> : null}
          {fileName ? <span>确认凭证：{fileName}</span> : null}
          <div className={styles.confirmationEvidenceActions}>
            {evidence?.previewUrl ? <a href={evidence.previewUrl} target="_blank" rel="noreferrer">查看</a> : null}
            {evidence?.downloadUrl ? <a href={evidence.downloadUrl}>下载</a> : null}
            {uploadable ? <label className={styles.confirmationEvidenceUpload} data-disabled={Boolean(uploadingKey)}>
              <input type="file" accept={CONFIRMATION_EVIDENCE_ACCEPT} disabled={Boolean(uploadingKey)} aria-label={`${fileName ? "替换" : "补传"}确认凭证`} onChange={(change) => selectFile(event, change)} />
              {uploadingKey === event.key ? "上传中..." : fileName ? "替换凭证" : "补传凭证"}
            </label> : null}
          </div>
        </div>;
      })}
      {status ? <div className={styles.success} role="status">{status}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
    </section>
  );
}
