"use client";

import { PdfPreviewButton, fileDownloadUrl } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { PDF_UPLOAD_ACCEPT, PDF_UPLOAD_MAX_SIZE_LABEL } from "../../utils";
import type { SupplierDocumentTask, SupplierFactoryCostSlot } from "./types";
import {
  DOCUMENT_LABELS,
  factoryCostSlotSummary,
  latestDocumentByType,
  supplierDocumentFileName,
  supplierDocumentFileWarning,
  supplierDocumentSendStatusLabel,
  supplierDocumentStatusClass,
  supplierUploadKey,
  uniqueRequiredDocumentTypes,
} from "./helpers";
import { getBusinessEntityRowClass } from "../business-entity-row-style";
import { TaxContractReviewPanel } from "./tax-contract-review-panel";

export function SupplierDocumentTaskCard({
  task,
  uploadingKey,
  progressByKey,
  isExpanded,
  isAdmin,
  canWrite,
  deleting,
  resending,
  onToggle,
  onOpen,
  onUpload,
  onDelete,
  onResendNotice,
}: {
  task: SupplierDocumentTask;
  uploadingKey: string;
  progressByKey: Record<string, number>;
  isExpanded: boolean;
  isAdmin: boolean;
  canWrite: boolean;
  deleting: boolean;
  resending: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onUpload: (task: SupplierDocumentTask, documentType: string, file: File | null, costId?: string) => void;
  onDelete: (task: SupplierDocumentTask) => void;
  onResendNotice: (task: SupplierDocumentTask) => void;
}) {
  const requiredTypes = task.requiredDocumentTypes || [];
  const factoryCostSlots = task.factoryCostSlots || [];
  const defaultUploadCostId = factoryCostSlots.length === 1 ? factoryCostSlots[0]?.id || "" : "";
  const taskStatus = task.status || "待上传";
  const displayOrderNo = task.purchaseOrderNo || task.orderNo || "";
  const requiredLabels = task.requiredDocumentLabels?.length
    ? task.requiredDocumentLabels
    : requiredTypes.map((type) => DOCUMENT_LABELS[type] || type);
  const requirementText = requiredLabels.join("、") || "-";
  return (
    <article className={getBusinessEntityRowClass(task, styles, styles.supplierDocumentTaskCard)}>
      <div className={styles.supplierDocumentTaskRow}>
        <span className={styles.supplierDocumentTaskOrder} aria-label="订单号" title={displayOrderNo || "-"}>
          {displayOrderNo || "-"}
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
            {canWrite ? "上传资料" : "查看资料"}
          </button>
          {isAdmin && canWrite && task.canDelete ? (
            <button className={styles.supplierDocumentDeleteButton} type="button" onClick={() => onDelete(task)} disabled={deleting}>
              {deleting ? "删除中..." : "删除"}
            </button>
          ) : null}
        </span>
      </div>
      {isExpanded ? (
        <div className={styles.supplierDocumentTaskDetail}>
          <div className={styles.supplierDocumentTaskDetailMobileHeader}>
            <div className={styles.supplierDocumentTaskDetailMobileTitle}>
              <strong>{displayOrderNo || "资料回传"}</strong>
              <span>{task.supplierName || requirementText}</span>
            </div>
            <button className={styles.secondaryButton} type="button" onClick={onToggle}>
              关闭
            </button>
          </div>
          {task.detailLoading || (!task.detailLoaded && !task.documents) ? (
            <div className={styles.emptyState}>正在加载当前任务资料...</div>
          ) : task.detailError ? (
            <div className={styles.inlineError}>
              <span>{task.detailError}</span>
              <button className={styles.secondaryButton} type="button" onClick={onOpen}>
                重试
              </button>
            </div>
          ) : (
            <>
              <TaxContractReviewPanel task={task} isAdmin={isAdmin} canWrite={canWrite} onRefresh={onOpen} />
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
                  下载合同样本（{task.templateFileName || `${displayOrderNo || "合同样本"}.xlsx`}）
                </a>
              ) : null}
              {isAdmin && canWrite && task.sendStatus !== "manual_upload" ? (
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
                            </div>
                          ) : null}
                        </div>
                        {canWrite && task.contractStatus !== "PENDING_REVIEW" ? <div className={styles.supplierDocumentUploadControls}>
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
                        </div> : null}
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      ) : null}
    </article>
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
