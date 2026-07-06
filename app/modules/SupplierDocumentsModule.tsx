"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson } from "../api";
import { useConfirmationDialog } from "../components";
import { SupplierDocumentsModuleView } from "./supplier-documents/module-view";
import type { SupplierDocumentTask, SupplierDocumentsResponse } from "./supplier-documents/types";
import { useSupplierDocumentOcrActions } from "./supplier-documents/use-supplier-document-ocr-actions";
import { useSupplierDocumentRequestActions } from "./supplier-documents/use-supplier-document-request-actions";
import type { User } from "../types";

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

  function hasProcessingOcrTask(items: SupplierDocumentTask[]) {
    return items.some((task) => (task.documents || []).some((document) => document.ocrTask?.status === "OCR识别中"));
  }

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

  const { rerunOcr, confirmOcr, rejectOcr } = useSupplierDocumentOcrActions({
    page,
    pageSize,
    submittedKeyword,
    requestConfirmation,
    loadRows,
    setRows,
    setOcrBusyKey,
    setError,
    setNotice,
  });

  const isAdmin = currentUser.role === "管理员";
  const {
    uploadDocument,
    deleteTask,
    resendNotice,
    handleRequestCreated,
  } = useSupplierDocumentRequestActions({
    isAdmin,
    currentUserRole: currentUser.role,
    page,
    pageSize,
    total,
    submittedKeyword,
    requestConfirmation,
    loadRows,
    onRefreshTodos,
    setRows,
    setNotice,
    setError,
    setUploadingKey,
    setProgressByKey,
    setExpandedTaskId,
    setTotal,
    setPendingCount,
    setDeletingTaskId,
    setResendingTaskId,
    setOcrBusyKey,
    setCreateDialogOpen,
    setPage,
  });
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) void loadRows(totalPages, pageSize, submittedKeyword);
  }, [page, totalPages]);

  useEffect(() => {
    if (!hasProcessingOcrTask(rows)) return undefined;
    const timer = window.setInterval(() => {
      void loadRows(page, pageSize, submittedKeyword, { silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [rows, page, pageSize, submittedKeyword]);

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
    <SupplierDocumentsModuleView
      currentUser={currentUser}
      rows={rows}
      loading={loading}
      error={error}
      loadError={loadError}
      notice={notice}
      uploadingKey={uploadingKey}
      progressByKey={progressByKey}
      expandedTaskId={expandedTaskId}
      page={page}
      pageSize={pageSize}
      total={total}
      totalPages={totalPages}
      pendingCount={pendingCount}
      submittedKeyword={submittedKeyword}
      deletingTaskId={deletingTaskId}
      resendingTaskId={resendingTaskId}
      ocrBusyKey={ocrBusyKey}
      createDialogOpen={createDialogOpen}
      isAdmin={isAdmin}
      safePage={safePage}
      confirmation={confirmation}
      onCreateRequest={() => setCreateDialogOpen(true)}
      onCloseCreateDialog={() => setCreateDialogOpen(false)}
      onRequestCreated={handleRequestCreated}
      onRefresh={() => void loadRows(page, pageSize, submittedKeyword)}
      onRetry={() => void loadRows(page, pageSize, submittedKeyword)}
      onSetPageSize={(nextPageSize) => {
        setPageSize(nextPageSize);
        setExpandedTaskId("");
        void loadRows(1, nextPageSize, submittedKeyword);
      }}
      onToggleTask={(taskId) => setExpandedTaskId((current) => (current === taskId ? "" : taskId))}
      onOpenTask={setExpandedTaskId}
      onUpload={uploadDocument}
      onDeleteTask={(task) => void deleteTask(task)}
      onResendNotice={(task) => void resendNotice(task)}
      onRerunOcr={(task, document) => void rerunOcr(task, document)}
      onConfirmOcr={(task, document) => void confirmOcr(task, document)}
      onRejectOcr={(task, document) => void rejectOcr(task, document)}
      onPage={(nextPage) => {
        setExpandedTaskId("");
        void loadRows(nextPage, pageSize, submittedKeyword);
      }}
      onCancelConfirmation={cancelConfirmation}
      onConfirmConfirmation={confirmConfirmation}
      onUpdateConfirmationInput={updateConfirmationInput}
    />
  );
}
