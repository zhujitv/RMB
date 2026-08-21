"use client";

import { useEffect, useState } from "react";
import { useConfirmationDialog } from "../components";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";
import { useWorkspaceTabBusy, useWorkspaceTabPresentation, useWorkspaceTabReactivation } from "../workspace/workspace-tab-context";
import { SupplierDocumentsModuleView } from "./supplier-documents/module-view";
import { useSupplierDocumentRequestActions } from "./supplier-documents/use-supplier-document-request-actions";
import { useSupplierDocumentsData } from "./supplier-documents/use-supplier-documents-data";

export function SupplierDocumentsModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialRequestId = "",
  initialOpenToken = 0,
  onRefreshTodos,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialRequestId?: string;
  initialOpenToken?: number;
  onRefreshTodos?: () => void | Promise<void>;
}) {
  const {
    rows, setRows, loading, error, setError, loadError, notice, setNotice,
    expandedTaskId, setExpandedTaskId, page, setPage, pageSize, setPageSize,
    total, setTotal, totalPages, pendingCount, setPendingCount, statsTotalCount,
    statsLoading, statsError, submittedKeyword, loadRows, loadStats, loadTaskDetail,
    openTask, toggleTask,
  } = useSupplierDocumentsData();
  const [uploadingKey, setUploadingKey] = useState("");
  const [progressByKey, setProgressByKey] = useState<Record<string, number>>({});
  const [deletingTaskId, setDeletingTaskId] = useState("");
  const [resendingTaskId, setResendingTaskId] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  useWorkspaceTabBusy(Boolean(uploadingKey || deletingTaskId || resendingTaskId));
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();

  const isAdmin = currentUser.role === "管理员";
  const canWrite = canWritePermission(currentUser, permissions, "supplierDocuments", ["产品供应商", "产品供应商账号", "工厂供应商账号"]);
  const {
    uploadDocument,
    deleteTask,
    resendNotice,
    handleRequestCreated,
  } = useSupplierDocumentRequestActions({
    isAdmin,
    canWrite,
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

  const expandedTask = rows.find((row) => row.id === expandedTaskId);
  useWorkspaceTabPresentation({
    title: createDialogOpen
      ? "供应商资料 · 新建任务"
      : expandedTaskId
        ? `供应商资料 · ${expandedTask?.purchaseOrderNo || expandedTask?.orderNo || expandedTask?.supplierName || "任务详情"}`
        : "供应商资料",
    view: createDialogOpen ? "edit" : expandedTaskId ? "detail" : "list",
    contextKey: createDialogOpen
      ? "supplier-documents:create"
      : expandedTaskId
        ? `supplier-documents:${expandedTaskId}`
        : "list:supplier-documents",
    ensureListTab: Boolean(createDialogOpen || expandedTaskId),
  });
  useWorkspaceTabReactivation(() => {
    void loadRows(page, pageSize, submittedKeyword);
    void loadStats(submittedKeyword);
    if (expandedTaskId) void loadTaskDetail(expandedTaskId, { force: true, silent: true });
  });

  async function refreshTaskAfterReview(taskId: string) {
    await loadTaskDetail(taskId, { force: true, silent: true });
    void loadRows(page, pageSize, submittedKeyword, { silent: true });
    void loadStats(submittedKeyword, { silent: true });
    void onRefreshTodos?.();
  }

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
      canWrite={canWrite}
      safePage={safePage}
      confirmation={confirmation}
      onCreateRequest={() => { if (canWrite && isAdmin) setCreateDialogOpen(true); }}
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
      onRefreshTask={refreshTaskAfterReview}
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
