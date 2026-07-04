"use client";

import { PdfPreviewButton, fileDownloadUrl } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { PDF_UPLOAD_ACCEPT, PDF_UPLOAD_MAX_SIZE_LABEL } from "../../utils";
import type { SupplierDocument, SupplierDocumentOcrTask, SupplierDocumentTask, SupplierFactoryCostSlot } from "./types";
import {
  DOCUMENT_LABELS,
  factoryCostSlotSummary,
  latestDocumentByType,
  supplierDocumentFileName,
  supplierDocumentFileWarning,
  supplierDocumentSendStatusLabel,
  supplierDocumentStatusClass,
  supplierOcrActionKey,
  supplierOcrRequiresManualReview,
  supplierUploadKey,
  uniqueRequiredDocumentTypes,
} from "./helpers";

export function SupplierDocumentTaskCard({
  task,
  uploadingKey,
  progressByKey,
  ocrBusyKey,
  isExpanded,
  isAdmin,
  canManageOcr,
  deleting,
  resending,
  onToggle,
  onOpen,
  onUpload,
  onDelete,
  onResendNotice,
  onRerunOcr,
  onConfirmOcr,
  onRejectOcr,
}: {
  task: SupplierDocumentTask;
  uploadingKey: string;
  progressByKey: Record<string, number>;
  ocrBusyKey: string;
  isExpanded: boolean;
  isAdmin: boolean;
  canManageOcr: boolean;
  deleting: boolean;
  resending: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onUpload: (task: SupplierDocumentTask, documentType: string, file: File | null, costId?: string) => void;
  onDelete: (task: SupplierDocumentTask) => void;
  onResendNotice: (task: SupplierDocumentTask) => void;
  onRerunOcr: (task: SupplierDocumentTask, document: SupplierDocument) => void;
  onConfirmOcr: (task: SupplierDocumentTask, document: SupplierDocument) => void;
  onRejectOcr: (task: SupplierDocumentTask, document: SupplierDocument) => void;
}) {
  const requiredTypes = task.requiredDocumentTypes || [];
  const factoryCostSlots = task.factoryCostSlots || [];
  const defaultUploadCostId = factoryCostSlots.length === 1 ? factoryCostSlots[0]?.id || "" : "";
  const taskStatus = task.status || "待上传";
  const requirementText = (task.requiredDocumentLabels || []).join("、") || "-";
  return (
    <article className={styles.supplierDocumentTaskCard}>
      <div className={styles.supplierDocumentTaskRow}>
        <span className={styles.supplierDocumentTaskOrder} aria-label="订单号" title={task.orderNo || "-"}>
          {task.orderNo || "-"}
        </span>
        <span className={styles.supplierDocumentTaskSupplier} title={task.supplierName || "-"}>
          {task.supplierName || "-"}
        </span>
        <span className={`${styles.statusPill} ${supplierDocumentStatusClass(taskStatus)}`}>{taskStatus}</span>
        <span className={styles.supplierDocumentTaskDate}>{formatDate(task.dueDate) || "-"}</span>
        <span className={styles.supplierDocumentTaskRequirement} title={requirementText}>{requirementText}</span>
        <span className={styles.supplierDocumentTaskActions}>
          <button className={styles.secondaryButton} type="button" onClick={onToggle}>
            {isExpanded ? "收起" : "展开"}
          </button>
          <button className={styles.primaryButtonCompact} type="button" onClick={onOpen}>
            上传资料
          </button>
          {isAdmin && task.canDelete ? (
            <button className={styles.supplierDocumentDeleteButton} type="button" onClick={() => onDelete(task)} disabled={deleting}>
              {deleting ? "删除中..." : "删除"}
            </button>
          ) : null}
        </span>
      </div>
      {isExpanded ? (
        <div className={styles.supplierDocumentTaskDetail}>
          <div className={styles.supplierDocumentTaskMeta}>
            <span>
              <small>通知时间</small>
              <b>{formatDateTime(task.sentAt || task.createdAt) || "-"}</b>
            </span>
            <span>
              <small>发送状态</small>
              <b>{supplierDocumentSendStatusLabel(task.sendStatus)}</b>
            </span>
            <span>
              <small>通知人</small>
              <b>{task.requestedByName || "-"}</b>
            </span>
            {task.sendError ? (
              <span title={task.sendError}>
                <small>发送记录</small>
                <b>{task.sendError}</b>
              </span>
            ) : null}
            {task.message ? (
              <span title={task.message}>
                <small>备注</small>
                <b>{task.message}</b>
              </span>
            ) : null}
          </div>
          {task.hasTemplate ? (
            <a className={styles.supplierDocumentTemplateButton} href={`/api/supplier-document-requests/${encodeURIComponent(task.id)}/template`}>
              下载合同样本（{task.templateFileName || `${task.orderNo || "合同样本"}.xlsx`}）
            </a>
          ) : null}
          {isAdmin ? (
            <div className={styles.supplierDocumentNoticeActions}>
              <button className={styles.secondaryButton} type="button" onClick={() => onResendNotice(task)} disabled={resending}>
                {resending ? "发送中..." : "重新发送邮件"}
              </button>
            </div>
          ) : null}
          <div className={styles.supplierDocumentUploadGrid}>
            {uniqueRequiredDocumentTypes(requiredTypes).map((documentType) => {
                const document = latestDocumentByType(task.documents || [], documentType);
                const uploadCostId = document?.costId || defaultUploadCostId;
                const key = supplierUploadKey(task.id, documentType, uploadCostId);
                const uploading = uploadingKey === key;
                const uploadStatus = uploading ? "上传中" : document ? "已上传" : "未上传";
                const fileName = document ? supplierDocumentFileName(document) : "";
                const fileWarning = document ? supplierDocumentFileWarning(document) : "";
                return (
                  <div className={styles.supplierDocumentUploadCard} key={documentType}>
                    <div className={styles.supplierDocumentUploadHeader}>
                      <strong>{DOCUMENT_LABELS[documentType] || documentType}</strong>
                      <span className={`${styles.statusPill} ${supplierDocumentStatusClass(uploadStatus)}`}>{uploadStatus}</span>
                    </div>
                    {factoryCostSlots.length ? <span className={styles.supplierDocumentUploadHint}>{factoryCostSlotSummary(factoryCostSlots)}</span> : null}
                    <div className={styles.supplierDocumentUploadBody}>
                      {document ? (
                        <div className={styles.fileUploadFile}>
                          <div className={styles.fileUploadFileName} title={fileName}>
                            {fileName}
                          </div>
                          <div className={styles.fileUploadMeta}>
                            <span>上传人：{document.uploadedByName || "-"}</span>
                            <span>上传时间：{formatDateTime(document.uploadedAt)}</span>
                          </div>
                          {fileWarning ? <div className={styles.inlineError}>{fileWarning}</div> : null}
                          <div className={styles.fileUploadActions}>
                            <span className={styles.fileUploadActionLabel}>操作：</span>
                            <PdfPreviewButton documentId={document.id} fileName={document.fileName || ""} />
                            <a className={styles.fileActionButton} href={fileDownloadUrl("order-document", document.id)}>下载</a>
                          </div>
                          <SupplierDocumentOcrPanel
                            task={task}
                            document={document}
                            canManageOcr={canManageOcr}
                            busyKey={ocrBusyKey}
                            onRerun={onRerunOcr}
                            onConfirm={onConfirmOcr}
                            onReject={onRejectOcr}
                          />
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.supplierDocumentUploadControls}>
                      <label className={styles.supplierDocumentUploadButton}>
                        {uploading ? "上传中..." : document ? "重新上传 PDF 文件" : "选择 PDF 文件"}
                        <input
                          type="file"
                          accept={PDF_UPLOAD_ACCEPT}
                          disabled={uploading}
                          hidden
                          onChange={(event) => {
                            onUpload(task, documentType, event.target.files?.[0] || null, uploadCostId);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <span className={styles.supplierDocumentUploadHint}>仅支持 PDF，单个文件最大 {PDF_UPLOAD_MAX_SIZE_LABEL}，选择后自动上传。</span>
                      {uploading ? <UploadProgressInline progress={progressByKey[key] || 0} /> : null}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function SupplierDocumentOcrPanel({
  task,
  document,
  canManageOcr,
  busyKey,
  onRerun,
  onConfirm,
  onReject,
}: {
  task: SupplierDocumentTask;
  document: SupplierDocument;
  canManageOcr: boolean;
  busyKey: string;
  onRerun: (task: SupplierDocumentTask, document: SupplierDocument) => void;
  onConfirm: (task: SupplierDocumentTask, document: SupplierDocument) => void;
  onReject: (task: SupplierDocumentTask, document: SupplierDocument) => void;
}) {
  const ocrTask = document.ocrTask;
  if (!ocrTask) {
    return (
      <div className={styles.supplierDocumentOcrPanel}>
        <div className={styles.supplierDocumentOcrHeader}>
          <strong>OCR 校验结果</strong>
          <span className={`${styles.statusPill} ${styles.statusMuted}`}>未识别</span>
        </div>
        <p className={styles.supplierDocumentUploadHint}>该文件暂未生成 OCR 校验结果。</p>
        {canManageOcr ? (
          <div className={styles.supplierDocumentOcrActions}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => onRerun(task, document)}
              disabled={busyKey === supplierOcrActionKey(task.id, document.id, "rerun")}
            >
              {busyKey === supplierOcrActionKey(task.id, document.id, "rerun") ? "识别中..." : "重新识别"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }
  const fields = ocrTask.fields || [];
  const issues = ocrTask.issues || [];
  const status = ocrTask.status || "待人工确认";
  const requiresManualReview = supplierOcrRequiresManualReview(ocrTask);
  return (
    <div className={styles.supplierDocumentOcrPanel}>
      <div className={styles.supplierDocumentOcrHeader}>
        <strong>OCR 校验结果</strong>
        <span className={`${styles.statusPill} ${supplierDocumentStatusClass(status)}`}>{status}</span>
      </div>
      <div className={styles.supplierDocumentOcrMeta}>
        <span>文件类型：{DOCUMENT_LABELS[document.documentType || ""] || document.documentType || "-"}</span>
        <span>更新时间：{formatDateTime(ocrTask.updatedAt)}</span>
      </div>
      {ocrTask.errorMessage ? <div className={styles.inlineError}>{ocrTask.errorMessage}</div> : null}
      {ocrTask.rejectReason ? <div className={styles.inlineError}>驳回原因：{ocrTask.rejectReason}</div> : null}
      {fields.length ? (
        <div className={styles.supplierDocumentOcrFields}>
          {fields.map((field) => (
            <span key={`${ocrTask.id}-${field.key}`}>
              <small>{field.label || field.key}</small>
              <b>{field.value || "-"}</b>
            </span>
          ))}
        </div>
      ) : null}
      <div className={styles.supplierDocumentOcrIssues}>
        <strong>校验结果</strong>
        {issues.length ? (
          issues.map((issue, index) => (
            <span key={`${issue.message}-${index}`} data-level={issue.level || "manual"}>
              {issue.message}
            </span>
          ))
        ) : (
          <span data-level="success">未发现异常</span>
        )}
      </div>
      {canManageOcr && ocrTask.rawText ? (
        <details className={styles.supplierDocumentOcrRawText}>
          <summary>查看 OCR 原始文本</summary>
          <pre>{ocrTask.rawText}</pre>
        </details>
      ) : null}
      {canManageOcr ? (
        <div className={styles.supplierDocumentOcrActions}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => onRerun(task, document)}
            disabled={busyKey === supplierOcrActionKey(task.id, document.id, "rerun")}
          >
            {busyKey === supplierOcrActionKey(task.id, document.id, "rerun") ? "识别中..." : "重新识别"}
          </button>
          {requiresManualReview ? (
            <>
              <button
                className={styles.primaryButtonCompact}
                type="button"
                onClick={() => onConfirm(task, document)}
                disabled={busyKey === supplierOcrActionKey(task.id, document.id, "confirm")}
              >
                {busyKey === supplierOcrActionKey(task.id, document.id, "confirm") ? "确认中..." : "人工确认通过"}
              </button>
              <button
                className={styles.dangerButton}
                type="button"
                onClick={() => onReject(task, document)}
                disabled={busyKey === supplierOcrActionKey(task.id, document.id, "reject")}
              >
                {busyKey === supplierOcrActionKey(task.id, document.id, "reject") ? "驳回中..." : "驳回重传"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UploadProgressInline({ progress }: { progress: number }) {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress || 0)));
  return (
    <span className={styles.invoiceUploadStatus} data-status="uploading">
      <span className={styles.invoiceUploadProgressBar}>
        <span style={{ width: `${safeProgress}%` }} />
      </span>
      <span>状态：上传中 {safeProgress}%</span>
    </span>
  );
}
