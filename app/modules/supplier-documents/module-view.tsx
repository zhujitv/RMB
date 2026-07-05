"use client";

import { ConfirmationDialog, PaginationBar, type ConfirmationDialogState } from "../../components";
import type { User } from "../../types";
import styles from "../../WorkspaceShell.module.css";
import { CreateSupplierDocumentRequestDialog, type CreateSupplierDocumentRequestResult } from "./create-request-dialog";
import { SupplierDocumentTaskCard } from "./task-card";
import type { SupplierDocument, SupplierDocumentTask } from "./types";
import { SUPPLIER_DOCUMENT_PAGE_SIZE_OPTIONS, canManageSupplierDocumentOcr } from "./helpers";

type SupplierDocumentsModuleViewProps = {
  currentUser: User;
  rows: SupplierDocumentTask[];
  loading: boolean;
  error: string;
  loadError: string;
  notice: string;
  uploadingKey: string;
  progressByKey: Record<string, number>;
  expandedTaskId: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  pendingCount: number;
  submittedKeyword: string;
  deletingTaskId: string;
  resendingTaskId: string;
  ocrBusyKey: string;
  createDialogOpen: boolean;
  isAdmin: boolean;
  safePage: number;
  confirmation: ConfirmationDialogState | null;
  onCreateRequest: () => void;
  onCloseCreateDialog: () => void;
  onRequestCreated: (result: CreateSupplierDocumentRequestResult) => void;
  onRefresh: () => void;
  onRetry: () => void;
  onSetPageSize: (pageSize: number) => void;
  onToggleTask: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  onUpload: (task: SupplierDocumentTask, documentType: string, file: File | null, costId?: string) => void;
  onDeleteTask: (task: SupplierDocumentTask) => void;
  onResendNotice: (task: SupplierDocumentTask) => void;
  onRerunOcr: (task: SupplierDocumentTask, document: SupplierDocument) => void;
  onConfirmOcr: (task: SupplierDocumentTask, document: SupplierDocument) => void;
  onRejectOcr: (task: SupplierDocumentTask, document: SupplierDocument) => void;
  onPage: (page: number) => void;
  onCancelConfirmation: () => void;
  onConfirmConfirmation: () => void;
  onUpdateConfirmationInput: (value: string) => void;
};

export function SupplierDocumentsModuleView({
  currentUser,
  rows,
  loading,
  error,
  loadError,
  notice,
  uploadingKey,
  progressByKey,
  expandedTaskId,
  pageSize,
  total,
  totalPages,
  pendingCount,
  deletingTaskId,
  resendingTaskId,
  ocrBusyKey,
  createDialogOpen,
  isAdmin,
  safePage,
  confirmation,
  ...actions
}: SupplierDocumentsModuleViewProps) {
  return (
    <section className={`${styles.moduleCard} ${styles.supplierDocumentsPage}`}>
      <header className={styles.supplierDocumentsHeader}>
        <div>
          <h1>{isAdmin ? "供应商资料回传" : "产品供应商资料回传"}</h1>
        </div>
        <div className={styles.supplierDocumentHeaderActions}>
          {isAdmin ? (
            <button className={styles.primaryButtonCompact} type="button" onClick={actions.onCreateRequest}>
              发起资料回传通知
            </button>
          ) : null}
          <button className={styles.secondaryButton} type="button" onClick={actions.onRefresh} disabled={loading}>
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
          <button className={styles.secondaryButton} type="button" onClick={actions.onRetry} disabled={loading}>
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
                onChange={(event) => actions.onSetPageSize(Number(event.target.value))}
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
                onToggle={() => actions.onToggleTask(task.id)}
                onOpen={() => actions.onOpenTask(task.id)}
                onUpload={actions.onUpload}
                onDelete={actions.onDeleteTask}
                onResendNotice={actions.onResendNotice}
                onRerunOcr={actions.onRerunOcr}
                onConfirmOcr={actions.onConfirmOcr}
                onRejectOcr={actions.onRejectOcr}
              />
            ))}
          </div>
          <PaginationBar total={total} page={safePage} totalPages={totalPages} loading={loading} onPage={actions.onPage} />
        </>
      ) : (
        <div className={styles.emptyState}>暂无需要回传的产品供应商资料。</div>
      )}
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={actions.onCancelConfirmation}
          onConfirm={actions.onConfirmConfirmation}
          onInputChange={actions.onUpdateConfirmationInput}
        />
      ) : null}
      {createDialogOpen ? (
        <CreateSupplierDocumentRequestDialog
          onClose={actions.onCloseCreateDialog}
          onCreated={actions.onRequestCreated}
        />
      ) : null}
    </section>
  );
}
