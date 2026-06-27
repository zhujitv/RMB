"use client";

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { PdfPreviewButton } from "../components";
import { formatDate, formatDateTime } from "../formatters";
import styles from "../WorkspaceShell.module.css";
import type { User } from "../types";
import { PDF_UPLOAD_ACCEPT, PDF_UPLOAD_MAX_SIZE_LABEL, uploadFormDataWithProgress, validatePdfUploadFile } from "../utils";

type SupplierDocument = {
  id: string;
  documentType?: string;
  fileName?: string;
  uploadedByName?: string;
  uploadedAt?: string;
};

type SupplierDocumentTask = {
  id: string;
  orderNo?: string;
  supplierName?: string;
  requestedByName?: string;
  requiredDocumentTypes?: string[];
  requiredDocumentLabels?: string[];
  status?: string;
  dueDate?: string;
  message?: string;
  templateFileName?: string;
  hasTemplate?: boolean;
  sendStatus?: string;
  sendError?: string;
  sentAt?: string;
  documents?: SupplierDocument[];
  createdAt?: string;
  updatedAt?: string;
};

type SupplierDocumentsResponse = {
  requests?: SupplierDocumentTask[];
};

type SupplierUploadResponse = {
  request?: SupplierDocumentTask;
  message?: string;
};

const DOCUMENT_LABELS: Record<string, string> = {
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同",
  SUPPLIER_INVOICE: "工厂增值税发票",
};

export function SupplierDocumentsModule({ currentUser }: { currentUser: User }) {
  const [rows, setRows] = useState<SupplierDocumentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [progressByKey, setProgressByKey] = useState<Record<string, number>>({});

  useEffect(() => {
    void loadRows();
  }, []);

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const data = await apiJson<SupplierDocumentsResponse>("/api/supplier-document-requests");
      setRows(data.requests || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取资料回传任务失败");
    } finally {
      setLoading(false);
    }
  }

  async function uploadDocument(task: SupplierDocumentTask, documentType: string, file: File | null) {
    const uploadKey = `${task.id}-${documentType}`;
    setNotice("");
    setError("");
    try {
      const validationError = validatePdfUploadFile(file);
      if (validationError) throw new Error(validationError);
      setUploadingKey(uploadKey);
      setProgressByKey((current) => ({ ...current, [uploadKey]: 0 }));
      const formData = new FormData();
      formData.append("documentType", documentType);
      formData.append("file", file as File);
      const data = await uploadFormDataWithProgress<SupplierUploadResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}/documents`,
        formData,
        (progress) => setProgressByKey((current) => ({ ...current, [uploadKey]: progress })),
      );
      if (data.request?.id) {
        setRows((current) => current.map((row) => (row.id === data.request?.id ? data.request : row)));
      }
      setNotice(data.message || "PDF 文件已上传");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "资料上传失败");
    } finally {
      setUploadingKey("");
      setProgressByKey((current) => {
        const next = { ...current };
        delete next[uploadKey];
        return next;
      });
    }
  }

  const pendingCount = useMemo(() => rows.filter((row) => row.status !== "已完成").length, [rows]);
  const isAdmin = currentUser.role === "管理员";

  return (
    <section className={`${styles.moduleCard} ${styles.supplierDocumentsPage}`}>
      <header className={styles.supplierDocumentsHeader}>
        <div>
          <h1>{isAdmin ? "供应商资料回传" : "产品供应商资料回传"}</h1>
        </div>
        <button className={styles.secondaryButton} type="button" onClick={loadRows} disabled={loading}>
          {loading ? "刷新中..." : "刷新任务"}
        </button>
      </header>

      <div className={styles.supplierDocumentsStats}>
        <div className={styles.supplierDocumentsStatCard}>
          <span>{isAdmin ? "查看范围" : "回传账号"}</span>
          <strong>{isAdmin ? "全部资料" : (currentUser.name || "-")}</strong>
        </div>
        <div className={styles.supplierDocumentsStatCard}>
          <span>待回传</span>
          <strong>{pendingCount}</strong>
        </div>
        <div className={styles.supplierDocumentsStatCard}>
          <span>全部任务</span>
          <strong>{rows.length}</strong>
        </div>
      </div>

      {notice ? <div className={styles.inlineSuccess}>{notice}</div> : null}
      {error ? <div className={styles.inlineError}>{error}</div> : null}

      {loading ? (
        <div className={styles.emptyState}>正在加载产品供应商资料回传任务...</div>
      ) : rows.length ? (
        <div className={styles.supplierDocumentsTaskGrid}>
          {rows.map((task) => (
            <SupplierDocumentTaskCard
              key={task.id}
              task={task}
              uploadingKey={uploadingKey}
              progressByKey={progressByKey}
              isAdmin={isAdmin}
              onUpload={uploadDocument}
            />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>暂无需要回传的产品供应商资料。</div>
      )}
    </section>
  );
}

function SupplierDocumentTaskCard({
  task,
  uploadingKey,
  progressByKey,
  isAdmin,
  onUpload,
}: {
  task: SupplierDocumentTask;
  uploadingKey: string;
  progressByKey: Record<string, number>;
  isAdmin: boolean;
  onUpload: (task: SupplierDocumentTask, documentType: string, file: File | null) => void;
}) {
  const requiredTypes = task.requiredDocumentTypes || [];
  const taskStatus = task.status || "待上传";
  return (
    <article className={styles.supplierDocumentTaskCard}>
      <div className={styles.supplierDocumentTaskTopline}>
        <span>
          <small>订单号</small>
          <b>{task.orderNo || "-"}</b>
        </span>
        {isAdmin ? (
          <span>
            <small>供应商</small>
            <b title={task.supplierName || "-"}>{task.supplierName || "-"}</b>
          </span>
        ) : null}
        <span>
          <small>状态</small>
          <b className={`${styles.statusPill} ${supplierDocumentStatusClass(taskStatus)}`}>{taskStatus}</b>
        </span>
        <span>
          <small>截止日期</small>
          <b>{formatDate(task.dueDate) || "-"}</b>
        </span>
        <span>
          <small>通知时间</small>
          <b>{formatDateTime(task.sentAt || task.createdAt) || "-"}</b>
        </span>
        {isAdmin ? (
          <span>
            <small>通知人</small>
            <b>{task.requestedByName || "-"}</b>
          </span>
        ) : null}
        <span className={styles.supplierDocumentRequirement}>
          <small>资料要求</small>
          <b>{(task.requiredDocumentLabels || []).join("、") || "-"}</b>
        </span>
      </div>
      {task.message ? <p className={styles.mutedText}>{task.message}</p> : null}
      {task.hasTemplate ? (
        <a className={styles.supplierDocumentTemplateButton} href={`/api/supplier-document-requests/${encodeURIComponent(task.id)}/template`}>
          下载合同样本（{task.templateFileName || `${task.orderNo || "合同样本"}.xlsx`}）
        </a>
      ) : null}
      <div className={styles.supplierDocumentUploadGrid}>
        {requiredTypes.map((documentType) => {
          const document = latestDocumentByType(task.documents || [], documentType);
          const key = `${task.id}-${documentType}`;
          const uploading = uploadingKey === key;
          const uploadStatus = uploading ? "上传中" : document ? "已上传" : "未上传";
          return (
            <div className={styles.supplierDocumentUploadCard} key={documentType}>
              <div className={styles.supplierDocumentUploadHeader}>
                <strong>{DOCUMENT_LABELS[documentType] || documentType}</strong>
                <span className={`${styles.statusPill} ${supplierDocumentStatusClass(uploadStatus)}`}>{uploadStatus}</span>
              </div>
              {document ? (
                <div className={styles.fileUploadFile}>
                  <div className={styles.fileUploadFileName} title={document.fileName || "-"}>
                    {document.fileName || "-"}
                  </div>
                  <div className={styles.fileUploadMeta}>
                    <span>上传人：{document.uploadedByName || "-"}</span>
                    <span>上传时间：{formatDateTime(document.uploadedAt)}</span>
                  </div>
                  <div className={styles.fileUploadActions}>
                    <span className={styles.fileUploadActionLabel}>操作：</span>
                    <PdfPreviewButton documentId={document.id} fileName={document.fileName || ""} />
                    <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/download`}>下载</a>
                  </div>
                </div>
              ) : null}
              <label className={styles.supplierDocumentUploadButton}>
                {uploading ? "上传中..." : "选择 PDF 文件"}
                <input
                  type="file"
                  accept={PDF_UPLOAD_ACCEPT}
                  disabled={uploading}
                  hidden
                  onChange={(event) => {
                    onUpload(task, documentType, event.target.files?.[0] || null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <span className={styles.supplierDocumentUploadHint}>仅支持 PDF，单个文件最大 {PDF_UPLOAD_MAX_SIZE_LABEL}，选择后自动上传。</span>
              {uploading ? <UploadProgressInline progress={progressByKey[key] || 0} /> : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function latestDocumentByType(documents: SupplierDocument[], documentType: string) {
  return documents
    .filter((document) => document.documentType === documentType)
    .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime())[0] || null;
}

function supplierDocumentStatusClass(status: string) {
  if (status === "已完成" || status === "已上传") return styles.statusSuccess;
  if (status === "部分上传" || status === "上传中") return styles.statusWarning;
  if (status === "已关闭") return styles.statusMuted;
  return styles.statusMuted;
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
