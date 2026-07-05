"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, PaginationBar, useConfirmationDialog } from "../components";
import { CreateSupplierDocumentRequestDialog, type CreateSupplierDocumentRequestResult } from "./supplier-documents/create-request-dialog";
import { SupplierDocumentTaskCard } from "./supplier-documents/task-card";
import type { SupplierDocument, SupplierDocumentOcrResponse, SupplierDocumentOcrTask, SupplierDocumentTask, SupplierDocumentsResponse, SupplierUploadResponse, SupplierDocumentDeleteResponse, SupplierDocumentNoticeResponse } from "./supplier-documents/types";
import {
  SUPPLIER_DOCUMENT_PAGE_SIZE_OPTIONS,
  apiErrorMessage,
  canManageSupplierDocumentOcr,
  supplierOcrActionKey,
  supplierUploadKey,
} from "./supplier-documents/helpers";
import styles from "../WorkspaceShell.module.css";
import type { User } from "../types";
import { uploadFormDataWithProgress, validatePdfUploadFile } from "../utils";

export function SupplierDocumentsModule({
  currentUser,
  initialKeyword = "",
  initialRequestId = "",
  initialOpenToken = 0,
  onRefreshTodos,
}: {
  currentUser: User;
  initialKeyword?: string;
  initialRequestId?: string;
  initialOpenToken?: number;
  onRefreshTodos?: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<SupplierDocumentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [progressByKey, setProgressByKey] = useState<Record<string, number>>({});
  const [expandedTaskId, setExpandedTaskId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingCount, setPendingCount] = useState(0);
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [deletingTaskId, setDeletingTaskId] = useState("");
  const [resendingTaskId, setResendingTaskId] = useState("");
  const [ocrBusyKey, setOcrBusyKey] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const loadRowsDataRequestRef = useRef(0);
  const loadRowsVisibleRequestRef = useRef(0);
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

  async function loadRows(nextPage = page, nextPageSize = pageSize, nextKeyword = "", options: { silent?: boolean } = {}) {
    const dataRequestId = ++loadRowsDataRequestRef.current;
    const visibleRequestId = options.silent
      ? loadRowsVisibleRequestRef.current
      : ++loadRowsVisibleRequestRef.current;
    if (!options.silent) {
      setLoading(true);
      setError("");
      setLoadError("");
      setSubmittedKeyword(nextKeyword);
    }
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(nextPageSize) });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const data = await apiJson<SupplierDocumentsResponse>(`/api/supplier-document-requests?${params.toString()}`);
      if (dataRequestId !== loadRowsDataRequestRef.current) return [];
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
      const message = loadError instanceof Error ? loadError.message : "读取资料回传任务失败";
      if (!options.silent && visibleRequestId === loadRowsVisibleRequestRef.current) {
        setError(message);
        setLoadError(message);
      }
      return [];
    } finally {
      if (!options.silent && visibleRequestId === loadRowsVisibleRequestRef.current) setLoading(false);
    }
  }

  function normalizedSearchText(value: unknown) {
    return String(value || "").trim().toLowerCase();
  }

  function requestMatchesSubmittedKeyword(request: SupplierDocumentTask) {
    const keyword = normalizedSearchText(submittedKeyword);
    if (!keyword) return true;
    const haystack = [
      request.orderNo,
      currentUser.role === "产品供应商" ? "" : request.supplierName,
    ].map(normalizedSearchText).join(" ");
    return haystack.includes(keyword);
  }

  function mergeRequestRow(request: SupplierDocumentTask | null | undefined) {
    if (!request?.id) return false;
    const shouldShow = requestMatchesSubmittedKeyword(request);
    setRows((current) => {
      const exists = current.some((row) => row.id === request.id);
      if (exists) return shouldShow ? current.map((row) => row.id === request.id ? request : row) : current.filter((row) => row.id !== request.id);
      return shouldShow && page === 1 ? [request, ...current].slice(0, pageSize) : current;
    });
    return shouldShow;
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
      setError("该任务对应订单已提交退税或已归档，不能删除资料回传任务。");
      return;
    }
    const result = await requestConfirmation({
      title: "删除资料回传任务",
      message: `确认删除资料回传任务 ${task.orderNo || "-"}？此操作将删除该任务及已上传资料，删除后不可恢复。`,
      details: task.hasTaxRefundDocuments ? ["该任务已关联退税资料，删除后退税完整度将重新计算。"] : undefined,
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
      setRows((current) => current.filter((row) => row.id !== task.id));
      setExpandedTaskId((current) => (current === task.id ? "" : current));
      setTotal((current) => Math.max(0, current - 1));
      if (task.status !== "已完成") setPendingCount((current) => Math.max(0, current - 1));
      setNotice("资料回传任务已删除");
      const nextTotal = Math.max(0, total - 1);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextTotal / Math.max(pageSize, 1))));
      void loadRows(nextPage, pageSize, submittedKeyword, { silent: true });
      void onRefreshTodos?.();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除资料回传任务失败");
    } finally {
      setDeletingTaskId("");
    }
  }

  async function resendNotice(task: SupplierDocumentTask) {
    if (!isAdmin) {
      setError("只有管理员可以重新发送资料回传催办。");
      return;
    }
    setResendingTaskId(task.id);
    setError("");
    setNotice("");
    try {
      const data = await apiJson<SupplierDocumentNoticeResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(task.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "resendNotice" }),
        },
      );
      if (data.request?.id) {
        setRows((current) => current.map((row) => (row.id === data.request?.id ? data.request : row)));
      }
      setNotice(data.message || "催办邮件已重新发送");
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "重新发送资料回传催办失败");
    } finally {
      setResendingTaskId("");
    }
  }

  async function handleRequestCreated(result: CreateSupplierDocumentRequestResult) {
    const createdId = result.request?.id || "";
    setCreateDialogOpen(false);
    setNotice(result.message || "已发起资料回传通知");
    setError("");
    const shouldShowCreatedRequest = result.request?.id ? mergeRequestRow(result.request) : false;
    if (shouldShowCreatedRequest) {
      setTotal((current) => current + 1);
      if (page !== 1) setPage(1);
    }
    void loadRows(1, pageSize, submittedKeyword, { silent: true });
    if (createdId) setExpandedTaskId(createdId);
    void onRefreshTodos?.();
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
      const taskStatus = data.ocrTask?.status || "";
      if (taskStatus.includes("失败")) {
        setError(data.ocrTask?.errorMessage || data.message || "OCR识别失败，需人工核对");
      } else {
        setNotice(data.message || "已重新识别");
        void loadRows(page, pageSize, submittedKeyword, { silent: true });
      }
    } catch (ocrError) {
      setError(apiErrorMessage(ocrError, "重新识别失败"));
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
      void loadRows(page, pageSize, submittedKeyword, { silent: true });
    } catch (ocrError) {
      setError(apiErrorMessage(ocrError, "人工确认失败"));
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
      void loadRows(page, pageSize, submittedKeyword, { silent: true });
    } catch (ocrError) {
      setError(apiErrorMessage(ocrError, "驳回失败"));
    } finally {
      setOcrBusyKey("");
    }
  }

  const isAdmin = currentUser.role === "管理员";
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) void loadRows(totalPages, pageSize, submittedKeyword);
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
        <div className={styles.supplierDocumentHeaderActions}>
          {isAdmin ? (
            <button className={styles.primaryButtonCompact} type="button" onClick={() => setCreateDialogOpen(true)}>
              发起资料回传通知
            </button>
          ) : null}
          <button className={styles.secondaryButton} type="button" onClick={() => loadRows(page, pageSize, submittedKeyword)} disabled={loading}>
            {loading ? "刷新中..." : "刷新任务"}
          </button>
        </div>
      </header>

      {!loadError ? (
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
      ) : null}

      {notice ? <div className={styles.inlineSuccess}>{notice}</div> : null}
      {loadError ? (
        <div className={styles.inlineError}>
          <strong>读取失败：</strong>
          <span>{loadError}</span>
          <button className={styles.secondaryButton} type="button" onClick={() => loadRows(page, pageSize, submittedKeyword)} disabled={loading}>
            {loading ? "重试中..." : "重试"}
          </button>
        </div>
      ) : error ? <div className={styles.inlineError}>{error}</div> : null}

      {loading ? (
        <div className={styles.emptyState}>正在加载产品供应商资料回传任务...</div>
      ) : loadError ? (
        null
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
                  void loadRows(1, nextPageSize, submittedKeyword);
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
                resending={resendingTaskId === task.id}
                onToggle={() => setExpandedTaskId((current) => (current === task.id ? "" : task.id))}
                onOpen={() => setExpandedTaskId(task.id)}
                onUpload={uploadDocument}
                onDelete={deleteTask}
                onResendNotice={resendNotice}
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
              void loadRows(nextPage, pageSize, submittedKeyword);
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
      {createDialogOpen ? (
        <CreateSupplierDocumentRequestDialog
          onClose={() => setCreateDialogOpen(false)}
          onCreated={handleRequestCreated}
        />
      ) : null}
    </section>
  );
}
