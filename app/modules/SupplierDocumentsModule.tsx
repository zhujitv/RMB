"use client";

import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, PaginationBar, PdfPreviewButton, fileDownloadUrl, useConfirmationDialog } from "../components";
import { formatDate, formatDateTime } from "../formatters";
import styles from "../WorkspaceShell.module.css";
import type { User } from "../types";
import { PDF_UPLOAD_ACCEPT, PDF_UPLOAD_MAX_SIZE_LABEL, uploadFormDataWithProgress, validatePdfUploadFile } from "../utils";

type SupplierDocument = {
  id: string;
  costId?: string;
  documentType?: string;
  fileName?: string;
  displayFileName?: string;
  downloadFileName?: string;
  uploadStatus?: string;
  uploadStatusLabel?: string;
  uploadedByName?: string;
  uploadedAt?: string;
  ocrTask?: SupplierDocumentOcrTask | null;
};

type SupplierDocumentOcrIssue = {
  level?: string;
  message?: string;
  field?: string;
};

type SupplierDocumentOcrField = {
  key?: string;
  label?: string;
  value?: string;
};

type SupplierDocumentOcrTask = {
  id?: string;
  status?: string;
  validationStatus?: string;
  errorMessage?: string;
  rejectReason?: string;
  fields?: SupplierDocumentOcrField[];
  issues?: SupplierDocumentOcrIssue[];
  expectedAmount?: number | null;
  supplierName?: string;
  businessEntityName?: string;
  updatedAt?: string;
};

type SupplierFactoryCostSlot = {
  id: string;
  label?: string;
  costType?: string;
  amount?: number;
  amountCny?: number;
  currency?: string;
};

type SupplierDocumentUploadSlot = SupplierFactoryCostSlot & {
  isUploadedFallbackSlot?: boolean;
};

type SupplierDocumentTask = {
  id: string;
  orderNo?: string;
  supplierName?: string;
  requestedByName?: string;
  requiredDocumentTypes?: string[];
  requiredDocumentLabels?: string[];
  factoryCostSlots?: SupplierFactoryCostSlot[];
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

type SupplierDocumentOcrResponse = {
  success?: boolean;
  ocrTask?: SupplierDocumentOcrTask | null;
  message?: string;
};

const DOCUMENT_LABELS: Record<string, string> = {
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同",
  SUPPLIER_INVOICE: "工厂增值税发票",
};
const SUPPLIER_DOCUMENT_PAGE_SIZE_OPTIONS = [10, 20, 50];
const UNMATCHED_SUPPLIER_DOCUMENT_SLOT_ID = "__uploaded_supplier_documents__";

export function SupplierDocumentsModule({
  currentUser,
  initialKeyword = "",
  initialRequestId = "",
  initialOpenToken = 0,
}: {
  currentUser: User;
  initialKeyword?: string;
  initialRequestId?: string;
  initialOpenToken?: number;
}) {
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
  const [ocrBusyKey, setOcrBusyKey] = useState("");
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

  async function loadRows(nextPage = page, nextPageSize = pageSize, nextKeyword = "") {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(nextPageSize) });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const data = await apiJson<SupplierDocumentsResponse>(`/api/supplier-document-requests?${params.toString()}`);
      const nextRows = data.requests || [];
      setRows(nextRows);
      const pagination = data.pagination || {};
      setPage(Number(pagination.page || nextPage));
      setPageSize(Number(pagination.pageSize || nextPageSize));
      setTotal(Number(pagination.total || data.requests?.length || 0));
      setTotalPages(Math.max(1, Number(pagination.totalPages || 1)));
      setPendingCount(Number(data.summary?.pendingCount || 0));
      return nextRows;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取资料回传任务失败");
      return [];
    } finally {
      setLoading(false);
    }
  }

  async function uploadDocument(task: SupplierDocumentTask, documentType: string, file: File | null, costId = "") {
    const uploadKey = supplierUploadKey(task.id, documentType, costId);
    setNotice("");
    setError("");
    try {
      const validationError = validatePdfUploadFile(file);
      if (validationError) throw new Error(validationError);
      setUploadingKey(uploadKey);
      setProgressByKey((current) => ({ ...current, [uploadKey]: 0 }));
      const formData = new FormData();
      formData.append("documentType", documentType);
      if (costId) formData.append("costId", costId);
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

  function updateDocumentOcrTask(taskId: string, documentId: string, ocrTask: SupplierDocumentOcrTask | null | undefined) {
    if (!ocrTask) return;
    setRows((current) => current.map((row) => {
      if (row.id !== taskId) return row;
      return {
        ...row,
        documents: (row.documents || []).map((document) => (
          document.id === documentId ? { ...document, ocrTask } : document
        )),
      };
    }));
  }

  async function rerunOcr(task: SupplierDocumentTask, document: SupplierDocument) {
    const busyKey = supplierOcrActionKey(task.id, document.id, "rerun");
    setOcrBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const data = await apiJson<SupplierDocumentOcrResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}/documents/${encodeURIComponent(document.id)}/ocr`,
        { method: "POST" },
      );
      updateDocumentOcrTask(task.id, document.id, data.ocrTask);
      setNotice(data.message || "已重新识别");
    } catch (ocrError) {
      setError(ocrError instanceof Error ? ocrError.message : "重新识别失败");
    } finally {
      setOcrBusyKey("");
    }
  }

  async function confirmOcr(task: SupplierDocumentTask, document: SupplierDocument) {
    const busyKey = supplierOcrActionKey(task.id, document.id, "confirm");
    setOcrBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const data = await apiJson<SupplierDocumentOcrResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}/documents/${encodeURIComponent(document.id)}/ocr/confirm`,
        { method: "POST" },
      );
      updateDocumentOcrTask(task.id, document.id, data.ocrTask);
      setNotice(data.message || "已人工确认通过");
      void loadRows(page, pageSize);
    } catch (ocrError) {
      setError(ocrError instanceof Error ? ocrError.message : "人工确认失败");
    } finally {
      setOcrBusyKey("");
    }
  }

  async function rejectOcr(task: SupplierDocumentTask, document: SupplierDocument) {
    const result = await requestConfirmation({
      title: "驳回重传",
      message: "请填写供应商可见的驳回原因。",
      requireInput: true,
      inputLabel: "驳回原因",
      inputPlaceholder: "例如：发票销售方与供应商不一致，请重新上传。",
      inputRequiredMessage: "请填写驳回原因。",
      confirmLabel: "确认驳回",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!result.confirmed) return;
    const busyKey = supplierOcrActionKey(task.id, document.id, "reject");
    setOcrBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const data = await apiJson<SupplierDocumentOcrResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}/documents/${encodeURIComponent(document.id)}/ocr/reject`,
        {
          method: "POST",
          body: JSON.stringify({ reason: result.inputValue || "" }),
        },
      );
      updateDocumentOcrTask(task.id, document.id, data.ocrTask);
      setNotice(data.message || "已驳回重传");
      void loadRows(page, pageSize);
    } catch (ocrError) {
      setError(ocrError instanceof Error ? ocrError.message : "驳回失败");
    } finally {
      setOcrBusyKey("");
    }
  }

  const isAdmin = currentUser.role === "管理员";
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) void loadRows(totalPages, pageSize);
  }, [page, totalPages]);

  useEffect(() => {
    if (!initialOpenToken) return;
    const keyword = initialKeyword.trim();
    void loadRows(1, pageSize, keyword).then((nextRows) => {
      const focused = initialRequestId
        ? nextRows.find((row) => row.id === initialRequestId)
        : nextRows[0];
      if (focused?.id) setExpandedTaskId(focused.id);
    });
  }, [initialOpenToken]);

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
                ocrBusyKey={ocrBusyKey}
                isExpanded={expandedTaskId === task.id}
                isAdmin={isAdmin}
                canManageOcr={canManageSupplierDocumentOcr(currentUser.role)}
                deleting={deletingTaskId === task.id}
                onToggle={() => setExpandedTaskId((current) => (current === task.id ? "" : task.id))}
                onOpen={() => setExpandedTaskId(task.id)}
                onUpload={uploadDocument}
                onDelete={deleteTask}
                onRerunOcr={rerunOcr}
                onConfirmOcr={confirmOcr}
                onRejectOcr={rejectOcr}
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
  ocrBusyKey,
  isExpanded,
  isAdmin,
  canManageOcr,
  deleting,
  onToggle,
  onOpen,
  onUpload,
  onDelete,
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
  onToggle: () => void;
  onOpen: () => void;
  onUpload: (task: SupplierDocumentTask, documentType: string, file: File | null, costId?: string) => void;
  onDelete: (task: SupplierDocumentTask) => void;
  onRerunOcr: (task: SupplierDocumentTask, document: SupplierDocument) => void;
  onConfirmOcr: (task: SupplierDocumentTask, document: SupplierDocument) => void;
  onRejectOcr: (task: SupplierDocumentTask, document: SupplierDocument) => void;
}) {
  const requiredTypes = task.requiredDocumentTypes || [];
  const factoryCostSlots = task.factoryCostSlots || [];
  const uploadSlots = supplierDocumentUploadSlots(task);
  const knownFactoryCostSlotIds = new Set(factoryCostSlots.map((slot) => slot.id).filter(Boolean));
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
            {uploadSlots.flatMap((slot) => (
              requiredTypes.map((documentType) => {
                const document = latestDocumentByType(task.documents || [], documentType, slot, knownFactoryCostSlotIds);
                const uploadCostId = slot.isUploadedFallbackSlot ? "" : slot.id;
                const key = supplierUploadKey(task.id, documentType, uploadCostId);
                const uploading = uploadingKey === key;
                const uploadStatus = uploading ? "上传中" : document ? "已上传" : "未上传";
                const fileName = document ? supplierDocumentFileName(document) : "";
                const fileWarning = document ? supplierDocumentFileWarning(document) : "";
                return (
                  <div className={styles.supplierDocumentUploadCard} key={`${slot.id || "task"}-${documentType}`}>
                    <div className={styles.supplierDocumentUploadHeader}>
                      <strong>{[slot.label, DOCUMENT_LABELS[documentType] || documentType].filter(Boolean).join(" / ")}</strong>
                      <span className={`${styles.statusPill} ${supplierDocumentStatusClass(uploadStatus)}`}>{uploadStatus}</span>
                    </div>
                    {slot.id && !slot.isUploadedFallbackSlot ? <span className={styles.supplierDocumentUploadHint}>{[slot.costType, formatFactoryCostSlotAmount(slot)].filter(Boolean).join(" · ")}</span> : null}
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
              })
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function supplierDocumentUploadSlots(task: SupplierDocumentTask): SupplierDocumentUploadSlot[] {
  const slots = task.factoryCostSlots || [];
  if (!slots.length) return [{ id: "", label: "" }];
  const knownSlotIds = new Set(slots.map((slot) => slot.id).filter(Boolean));
  const hasUploadedDocumentOutsideCurrentSlots = (task.documents || []).some((document) => (
    Boolean(document.documentType) && (!document.costId || !knownSlotIds.has(document.costId))
  ));
  if (!hasUploadedDocumentOutsideCurrentSlots) return slots;
  return [
    ...slots,
    {
      id: UNMATCHED_SUPPLIER_DOCUMENT_SLOT_ID,
      label: "已上传资料",
      isUploadedFallbackSlot: true,
    },
  ];
}

function latestDocumentByType(
  documents: SupplierDocument[],
  documentType: string,
  slot: SupplierDocumentUploadSlot,
  knownSlotIds = new Set<string>(),
) {
  const matches = documents
    .filter((document) => document.documentType === documentType)
    .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());
  if (slot.isUploadedFallbackSlot) {
    return matches.find((document) => !document.costId || !knownSlotIds.has(document.costId)) || null;
  }
  if (slot.id) {
    return matches.find((document) => document.costId === slot.id) || null;
  }
  return matches.find((document) => !document.costId) || matches[0] || null;
}

function supplierDocumentFileName(document: SupplierDocument) {
  return document.displayFileName || document.fileName || document.downloadFileName || "文件记录存在";
}

function supplierDocumentFileWarning(document: SupplierDocument) {
  if (document.uploadStatus && document.uploadStatus !== "SUCCESS") return "文件记录存在，但文件无法访问";
  if (!document.fileName && !document.displayFileName && !document.downloadFileName) return "文件记录存在，但文件名缺失";
  return "";
}

function supplierUploadKey(taskId: string, documentType: string, costId = "") {
  return [taskId, documentType, costId].join(":");
}

function supplierOcrActionKey(taskId: string, documentId: string, action: string) {
  return [taskId, documentId, action].join(":");
}

function canManageSupplierDocumentOcr(role = "") {
  return ["管理员", "财务", "业务员", "采购"].includes(role);
}

function formatFactoryCostSlotAmount(slot: SupplierFactoryCostSlot) {
  const amountCny = Number(slot.amountCny || 0);
  const amount = Number(slot.amount || 0);
  if (amountCny > 0) return `CNY ${amountCny.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  if (amount > 0) return `${slot.currency || "CNY"} ${amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  return "";
}

function supplierDocumentStatusClass(status: string) {
  if (status === "已完成" || status === "已上传" || status === "OCR识别成功，校验通过") return styles.statusSuccess;
  if (status === "部分上传" || status === "上传中" || status === "OCR识别中" || status === "待人工确认") return styles.statusWarning;
  if (status === "OCR识别成功，存在异常" || status === "OCR识别失败，需人工核对") return styles.statusDanger;
  if (status === "已关闭") return styles.statusMuted;
  return styles.statusMuted;
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
