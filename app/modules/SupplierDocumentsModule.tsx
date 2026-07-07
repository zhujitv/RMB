"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson } from "../api";
import { useConfirmationDialog } from "../components";
import { SupplierDocumentsModuleView } from "./supplier-documents/module-view";
import type {
  SupplierDocumentDetailResponse,
  SupplierDocumentTask,
  SupplierDocumentsResponse,
  SupplierDocumentsStatsResponse,
} from "./supplier-documents/types";
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
  const [statsTotalCount, setStatsTotalCount] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [deletingTaskId, setDeletingTaskId] = useState("");
  const [resendingTaskId, setResendingTaskId] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const loadRowsDataRequestRef = useRef(0);
  const loadRowsVisibleRequestRef = useRef(0);
  const loadStatsRequestRef = useRef(0);
  const loadDetailRequestRef = useRef<Record<string, number>>({});
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();

  useEffect(() => {
    void loadRows(1, pageSize);
    void loadStats("");
  }, []);

  function mergeTaskDetail(listRow: SupplierDocumentTask, detail: SupplierDocumentTask) {
    return {
      ...listRow,
      ...detail,
      purchaseOrderNo: detail.purchaseOrderNo || detail.orderNo || listRow.purchaseOrderNo || listRow.orderNo || "",
      detailLoaded: true,
      detailLoading: false,
      detailError: "",
    };
  }

  function mergeListRowWithCachedDetail(listRow: SupplierDocumentTask, cached: SupplierDocumentTask | undefined) {
    if (!cached?.detailLoaded) return listRow;
    return {
      ...cached,
      ...listRow,
      orderNo: cached.orderNo,
      purchaseOrderNo: listRow.purchaseOrderNo || cached.purchaseOrderNo || cached.orderNo || "",
      documents: cached.documents,
      factoryCostSlots: cached.factoryCostSlots,
      requestedByName: cached.requestedByName,
      message: cached.message,
      templateFileName: cached.templateFileName,
      hasTemplate: cached.hasTemplate,
      sendStatus: cached.sendStatus,
      sendError: cached.sendError,
      sentAt: cached.sentAt,
      canDelete: cached.canDelete,
      hasTaxRefundDocuments: cached.hasTaxRefundDocuments,
      taxRefundDocumentCount: cached.taxRefundDocumentCount,
      detailLoaded: true,
      detailLoading: false,
      detailError: "",
    };
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
      setRows((current) => nextRows.map((row) => mergeListRowWithCachedDetail(row, current.find((item) => item.id === row.id))));
      const pagination = data.pagination || {};
      setPage(Number(pagination.page || nextPage));
      setPageSize(Number(pagination.pageSize || nextPageSize));
      setTotal(Number(pagination.total || data.requests?.length || 0));
      setTotalPages(Math.max(1, Number(pagination.totalPages || 1)));
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

  async function loadStats(nextKeyword = submittedKeyword, options: { silent?: boolean } = {}) {
    const requestId = ++loadStatsRequestRef.current;
    if (!options.silent) setStatsLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const data = await apiJson<SupplierDocumentsStatsResponse>(
        `/api/supplier-document-requests/stats${params.toString() ? `?${params.toString()}` : ""}`,
      );
      if (requestId !== loadStatsRequestRef.current) return;
      setPendingCount(Number(data.stats?.pendingCount || 0));
      setStatsTotalCount(Number(data.stats?.totalCount || 0));
      setStatsError("");
    } catch {
      if (requestId !== loadStatsRequestRef.current) return;
      setStatsError("资料回传统计加载失败，请点击刷新任务重试。");
    } finally {
      if (!options.silent && requestId === loadStatsRequestRef.current) setStatsLoading(false);
    }
  }

  async function loadTaskDetail(taskId: string, options: { force?: boolean; silent?: boolean } = {}) {
    const cached = rows.find((row) => row.id === taskId);
    if (cached?.detailLoaded && !options.force) return cached;
    const requestId = (loadDetailRequestRef.current[taskId] || 0) + 1;
    loadDetailRequestRef.current[taskId] = requestId;
    setRows((current) => current.map((row) => (
      row.id === taskId
        ? { ...row, detailLoading: true, detailError: "" }
        : row
    )));
    try {
      const data = await apiJson<SupplierDocumentDetailResponse>(`/api/supplier-document-requests/${encodeURIComponent(taskId)}`);
      if (loadDetailRequestRef.current[taskId] !== requestId) return null;
      const detail = data.request || data.data;
      if (!detail?.id) throw new Error(data.message || "资料回传任务详情为空");
      setRows((current) => current.map((row) => (row.id === taskId ? mergeTaskDetail(row, detail) : row)));
      return detail;
    } catch (detailError) {
      const message = detailError instanceof Error ? detailError.message : "读取资料回传任务详情失败";
      if (loadDetailRequestRef.current[taskId] === requestId) {
        setRows((current) => current.map((row) => (
          row.id === taskId
            ? { ...row, detailLoading: false, detailError: message }
            : row
        )));
        if (!options.silent) setError(message);
      }
      return null;
    }
  }

  function openTask(taskId: string) {
    setExpandedTaskId(taskId);
    void loadTaskDetail(taskId);
  }

  function toggleTask(taskId: string) {
    setExpandedTaskId((current) => {
      const next = current === taskId ? "" : taskId;
      if (next) void loadTaskDetail(next);
      return next;
    });
  }

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
    loadTaskDetail,
    loadStats,
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
    setCreateDialogOpen,
    setPage,
  });
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) void loadRows(totalPages, pageSize, submittedKeyword);
  }, [page, totalPages]);

  useEffect(() => {
    if (!expandedTaskId) return;
    const expandedTask = rows.find((row) => row.id === expandedTaskId);
    if (expandedTask && !expandedTask.detailLoaded && !expandedTask.detailLoading) {
      void loadTaskDetail(expandedTaskId);
    }
  }, [expandedTaskId, rows]);

  useEffect(() => {
    if (!initialOpenToken) return;
    const keyword = initialKeyword.trim();
    void loadRows(1, pageSize, keyword).then((nextRows) => {
      const focused = initialRequestId
        ? nextRows.find((row) => row.id === initialRequestId)
        : nextRows[0];
      if (focused?.id) openTask(focused.id);
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
      statsTotalCount={statsTotalCount}
      statsLoading={statsLoading}
      statsError={statsError}
      submittedKeyword={submittedKeyword}
      deletingTaskId={deletingTaskId}
      resendingTaskId={resendingTaskId}
      createDialogOpen={createDialogOpen}
      isAdmin={isAdmin}
      safePage={safePage}
      confirmation={confirmation}
      onCreateRequest={() => setCreateDialogOpen(true)}
      onCloseCreateDialog={() => setCreateDialogOpen(false)}
      onRequestCreated={handleRequestCreated}
      onRefresh={() => {
        void loadRows(page, pageSize, submittedKeyword);
        void loadStats(submittedKeyword);
        if (expandedTaskId) void loadTaskDetail(expandedTaskId, { force: true });
      }}
      onRetry={() => {
        void loadRows(page, pageSize, submittedKeyword);
        void loadStats(submittedKeyword);
        if (expandedTaskId) void loadTaskDetail(expandedTaskId, { force: true });
      }}
      onSetPageSize={(nextPageSize) => {
        setPageSize(nextPageSize);
        setExpandedTaskId("");
        void loadRows(1, nextPageSize, submittedKeyword);
        void loadStats(submittedKeyword);
      }}
      onToggleTask={toggleTask}
      onOpenTask={openTask}
      onUpload={uploadDocument}
      onDeleteTask={(task) => void deleteTask(task)}
      onResendNotice={(task) => void resendNotice(task)}
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
