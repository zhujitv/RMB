"use client";

import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, PaginationBar, PdfPreviewButton, useConfirmationDialog } from "../components";
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
  canDelete?: boolean;
  documents?: SupplierDocument[];
  createdAt?: string;
  updatedAt?: string;
};

type SupplierDocumentsResponse = {
  requests?: SupplierDocumentTask[];
  pagination?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
  summary?: {
    pendingCount?: number;
  };
};

type SupplierUploadResponse = {
  request?: SupplierDocumentTask;
  message?: string;
};

type SupplierDocumentDeleteResponse = {
  id?: string;
  message?: string;
};

const DOCUMENT_LABELS: Record<string, string> = {
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同",
  SUPPLIER_INVOICE: "工厂增值税发票",
};
const SUPPLIER_DOCUMENT_PAGE_SIZE_OPTIONS = [10, 20, 50];

export function SupplierDocumentsModule({ currentUser }: { currentUser: User }) {
  const [rows, setRows] = useState<SupplierDocumentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [progressByKey, setProgressByKey] = useState<Record<string, number>>({});
  const [expandedTaskId, setExpandedTaskId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingCount, setPendingCount] = useState(0);
  const [deletingTaskId, setDeletingTaskId] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();

  useEffect(() => {
    void loadRows(1, pageSize);
  }, []);

  async function loadRows(nextPage = page, nextPageSize = pageSize) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(nextPageSize) });
      const data = await apiJson<SupplierDocumentsResponse>(`/api/supplier-document-requests?${params.toString()}`);
      setRows(data.requests || []);
      const pagination = data.pagination || {};
      setPage(Number(pagination.page || nextPage));
      setPageSize(Number(pagination.pageSize || nextPageSize));
      setTotal(Number(pagination.total || data.requests?.length || 0));
      setTotalPages(Math.max(1, Number(pagination.totalPages || 1)));
      setPendingCount(Number(data.summary?.pendingCount || 0));
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
      setNotice(data.message || "上传成功");
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

  async function deleteTask(task: SupplierDocumentTask) {
    setNotice("");
    setError("");
    if (!isAdmin) {
      setError("只有管理员可以删除资料回传任务。");
      return;
    }
    if (!task.canDelete) {
      setError("该任务已开始回传资料，无法删除。");
      return;
    }
    const result = await requestConfirmation({
      title: "删除资料回传任务",
      message: "确定删除该资料回传任务吗？删除后无法恢复。",
      confirmLabel: "删除",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!result.confirmed) return;
    try {
      setDeletingTaskId(task.id);
      const data = await apiJson<SupplierDocumentDeleteResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}`,
        { method: "DELETE" },
      );
      setExpandedTaskId((current) => (current === task.id ? "" : current));
      setNotice(data.message || "已删除资料回传任务。");
      const nextTotal = Math.max(0, total - 1);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextTotal / Math.max(pageSize, 1))));
      await loadRows(nextPage, pageSize);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除资料回传任务失败");
    } finally {
      setDeletingTaskId("");
    }
  }

  const isAdmin = currentUser.role === "管理员";
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) void loadRows(totalPages, pageSize);
  }, [page, totalPages]);

  return (
    <section className={`${styles.moduleCard} ${styles.supplierDocumentsPage}`}>
      <header className={styles.supplierDocumentsHeader}>
        <div>
          <h1>{isAdmin ? "供应商资料回传" : "产品供应商资料回传"}</h1>
        </div>
        <button className={styles.secondaryButton} type="button" onClick={() => loadRows(page, pageSize)} disabled={loading}>
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
          <strong>{total}</strong>
        </div>
      </div>

      {notice ? <div className={styles.inlineSuccess}>{notice}</div> : null}
      {error ? <div className={styles.inlineError}>{error}</div> : null}

      {loading ? (
        <div className={styles.emptyState}>正在加载产品供应商资料回传任务...</div>
      ) : rows.length ? (
        <>
          <div className={styles.supplierDocumentsListToolbar}>
            <span>当前显示 {rows.length} / {total} 条</span>
            <span>本页面仅支持 PDF 文件</span>
            <label>
              每页
              <select
                value={pageSize}
                onChange={(event) => {
                  const nextPageSize = Number(event.target.value);
                  setPageSize(nextPageSize);
                  setExpandedTaskId("");
                  void loadRows(1, nextPageSize);
                }}
              >
                {SUPPLIER_DOCUMENT_PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size} 条</option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.supplierDocumentsTaskList}>
            {rows.map((task) => (
              <SupplierDocumentTaskCard
                key={task.id}
                task={task}
                uploadingKey={uploadingKey}
                progressByKey={progressByKey}
                isExpanded={expandedTaskId === task.id}
                isAdmin={isAdmin}
                deleting={deletingTaskId === task.id}
                onToggle={() => setExpandedTaskId((current) => (current === task.id ? "" : task.id))}
                onOpen={() => setExpandedTaskId(task.id)}
                onUpload={uploadDocument}
                onDelete={deleteTask}
              />
            ))}
          </div>
          <PaginationBar
            total={total}
            page={safePage}
            totalPages={totalPages}
            loading={loading}
            onPage={(nextPage) => {
              setExpandedTaskId("");
              void loadRows(nextPage, pageSize);
            }}
          />
        </>
      ) : (
        <div className={styles.emptyState}>暂无需要回传的产品供应商资料。</div>
      )}
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={cancelConfirmation}
          onConfirm={confirmConfirmation}
          onInputChange={updateConfirmationInput}
        />
      ) : null}
    </section>
  );
}

function SupplierDocumentTaskCard({
  task,
  uploadingKey,
  progressByKey,
  isExpanded,
  isAdmin,
  deleting,
  onToggle,
  onOpen,
  onUpload,
  onDelete,
}: {
  task: SupplierDocumentTask;
  uploadingKey: string;
  progressByKey: Record<string, number>;
  isExpanded: boolean;
  isAdmin: boolean;
  deleting: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onUpload: (task: SupplierDocumentTask, documentType: string, file: File | null) => void;
  onDelete: (task: SupplierDocumentTask) => void;
}) {
  const requiredTypes = task.requiredDocumentTypes || [];
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
            <button className={styles.dangerButton} type="button" onClick={() => onDelete(task)} disabled={deleting}>
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
              <small>通知人</small>
              <b>{task.requestedByName || "-"}</b>
            </span>
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
                  <div className={styles.supplierDocumentUploadBody}>
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
                  </div>
                  <div className={styles.supplierDocumentUploadControls}>
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
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
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
