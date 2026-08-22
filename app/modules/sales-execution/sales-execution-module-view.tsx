import { ConfirmationDialog, type ConfirmationDialogState } from "../../components";
import shell from "../../WorkspaceShell.module.css";
import { ExecutionDetailDrawer } from "./execution-detail-drawer";
import { ExecutionFormContainer } from "./execution-form-container";
import { ExecutionList } from "./execution-list";
import { QuotationConversionPanel, type QuotationConversionDraft } from "./quotation-conversion-panel";
import styles from "./sales-execution.module.css";
import type { SalesExecutionRow } from "./types";

export function SalesExecutionModuleView({
  rows,
  keyword,
  status,
  page,
  total,
  totalPages,
  loading,
  error,
  notice,
  conversionDraft,
  converting,
  createOpen,
  editExecution,
  detailExecution,
  detailLoading,
  detailError,
  dispatching,
  dispatchError,
  shippingStarting,
  shippingError,
  retryingPurchaseOrderId,
  dispatchEmailRetryError,
  confirmation,
  shippingConfirmation,
  voiding,
  voidError,
  voidConfirmation,
  deleting,
  deleteError,
  deleteConfirmation,
  canWrite,
  canDelete,
  canEnterShipping,
  canOpenReceivableOrder,
  canRecordFactoryPayment,
  canAddFactoryAdjustment,
  canReviewFactoryPriceCorrection,
  onKeyword,
  onStatus,
  onSearch,
  onReset,
  onRefresh,
  onToggleCreate,
  onConversionChange,
  onConversionSubmit,
  onConversionCancel,
  onCancelForm,
  onSaved,
  onPage,
  onOpen,
  onEdit,
  onDispatch,
  onEnterShipping,
  onVoid,
  onDelete,
  onOpenReceivableOrder,
  onRetryDispatchEmail,
  onFactoryExecutionChanged,
  onCloseDetail,
  onCancelConfirmation,
  onConfirmConfirmation,
  onCancelShippingConfirmation,
  onConfirmShippingConfirmation,
  onCancelVoidConfirmation,
  onConfirmVoidConfirmation,
  onUpdateVoidConfirmationInput,
  onCancelDeleteConfirmation,
  onConfirmDeleteConfirmation,
  onUpdateDeleteConfirmationInput,
}: {
  rows: SalesExecutionRow[];
  keyword: string;
  status: string;
  page: number;
  total: number;
  totalPages: number;
  loading: boolean;
  error: string;
  notice: string;
  conversionDraft: QuotationConversionDraft | null;
  converting: boolean;
  createOpen: boolean;
  editExecution: SalesExecutionRow | null;
  detailExecution: SalesExecutionRow | null;
  detailLoading: boolean;
  detailError: string;
  dispatching: boolean;
  dispatchError: string;
  shippingStarting: boolean;
  shippingError: string;
  retryingPurchaseOrderId: string;
  dispatchEmailRetryError: string;
  confirmation: ConfirmationDialogState | null;
  shippingConfirmation: ConfirmationDialogState | null;
  voiding: boolean;
  voidError: string;
  voidConfirmation: ConfirmationDialogState | null;
  deleting: boolean;
  deleteError: string;
  deleteConfirmation: ConfirmationDialogState | null;
  canWrite: boolean;
  canDelete: boolean;
  canEnterShipping: boolean;
  canOpenReceivableOrder: boolean;
  canRecordFactoryPayment: boolean;
  canAddFactoryAdjustment: boolean;
  canReviewFactoryPriceCorrection: boolean;
  onKeyword: (value: string) => void;
  onStatus: (value: string) => void;
  onSearch: () => void;
  onReset: () => void;
  onRefresh: () => void;
  onToggleCreate: () => void;
  onConversionChange: (draft: QuotationConversionDraft) => void;
  onConversionSubmit: (draft: QuotationConversionDraft) => void;
  onConversionCancel: () => void;
  onCancelForm: () => void;
  onSaved: (execution: SalesExecutionRow, message: string) => void;
  onPage: (page: number) => void;
  onOpen: (execution: SalesExecutionRow) => void;
  onEdit: () => void;
  onDispatch: () => void;
  onEnterShipping: () => void;
  onVoid: () => void;
  onDelete: () => void;
  onOpenReceivableOrder: (orderNo: string) => void;
  onRetryDispatchEmail: (purchaseOrderId: string) => void;
  onFactoryExecutionChanged: () => void | Promise<void>;
  onCloseDetail: () => void;
  onCancelConfirmation: () => void;
  onConfirmConfirmation: () => void;
  onCancelShippingConfirmation: () => void;
  onConfirmShippingConfirmation: () => void;
  onCancelVoidConfirmation: () => void;
  onConfirmVoidConfirmation: () => void;
  onUpdateVoidConfirmationInput: (value: string) => void;
  onCancelDeleteConfirmation: () => void;
  onConfirmDeleteConfirmation: () => void;
  onUpdateDeleteConfirmationInput: (value: string) => void;
}) {
  return (
    <section className={shell.moduleCard}>
      <div className={shell.moduleHeader}>
        <div>
          <h2>销售执行</h2>
          <p className={styles.moduleIntro}>已接受报价可转入；老客户也可跳过报价直接创建。草稿完成后可正式下发工厂并跟踪供应商响应。</p>
        </div>
        <div className={styles.toolbarActions}>
          {canWrite ? <button className={shell.primaryButtonCompact} type="button" onClick={onToggleCreate}>{createOpen ? "收起新建" : "直接新建"}</button> : null}
          <button className={shell.secondaryButton} type="button" disabled={loading} onClick={onRefresh}>{loading ? "刷新中..." : "刷新"}</button>
        </div>
      </div>

      {canWrite && conversionDraft ? (
        <QuotationConversionPanel
          draft={conversionDraft}
          saving={converting}
          error={error}
          onChange={onConversionChange}
          onSubmit={onConversionSubmit}
          onCancel={onConversionCancel}
        />
      ) : null}
      {canWrite && (createOpen || editExecution) ? <ExecutionFormContainer initialExecution={editExecution} onCancel={onCancelForm} onSaved={onSaved} /> : null}

      <div className={shell.listToolbar}>
        <input aria-label="搜索销售执行" value={keyword} placeholder="搜索客户订单号 / 客户 / 报价号" onChange={(event) => onKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSearch(); }} />
        <select aria-label="销售执行状态" value={status} disabled={loading} onChange={(event) => onStatus(event.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="DISPATCHED">已下发</option><option value="VOIDED">已作废</option></select>
        <button className={shell.primaryButtonCompact} type="button" disabled={loading} onClick={onSearch}>查询</button>
        <button className={shell.secondaryButton} type="button" disabled={loading} onClick={onReset}>重置</button>
      </div>

      {error && !conversionDraft ? <div className={shell.inlineError} role="alert">{error}</div> : null}
      {notice ? <div className={shell.infoStrip} role="status">{notice}</div> : null}
      <ExecutionList rows={rows} loading={loading} page={page} total={total} totalPages={totalPages} onPage={onPage} onOpen={onOpen} />

      {detailExecution ? <ExecutionDetailDrawer execution={detailExecution} loading={detailLoading} error={detailError} canEdit={canWrite && detailExecution.status === "DRAFT" && !detailLoading && !detailError} canDispatch={canWrite && detailExecution.status === "DRAFT" && !detailLoading && !detailError} canVoid={canWrite && ["DRAFT", "DISPATCHED"].includes(String(detailExecution.status || "")) && !detailExecution.receivableOrder && !detailExecution.shippingStartedAt && !detailLoading && !detailError} canDelete={canDelete && detailExecution.status === "VOIDED" && !detailLoading && !detailError} canRetryDispatchEmail={canWrite && detailExecution.status === "DISPATCHED" && !detailExecution.receivableOrder && !detailLoading && !detailError} canStartProduction={canWrite && detailExecution.status === "DISPATCHED"} canRecordFactoryPayment={canRecordFactoryPayment} canAddFactoryAdjustment={canAddFactoryAdjustment} canReviewFactoryPriceCorrection={canReviewFactoryPriceCorrection} canEnterShipping={canEnterShipping && !detailLoading && !detailError} canOpenReceivableOrder={canOpenReceivableOrder} dispatching={dispatching} shippingStarting={shippingStarting} voiding={voiding} deleting={deleting} dispatchError={dispatchError} shippingError={shippingError} voidError={voidError} deleteError={deleteError} retryingPurchaseOrderId={retryingPurchaseOrderId} dispatchEmailRetryError={dispatchEmailRetryError} onEdit={onEdit} onDispatch={onDispatch} onEnterShipping={onEnterShipping} onVoid={onVoid} onDelete={onDelete} onOpenReceivableOrder={onOpenReceivableOrder} onRetryDispatchEmail={onRetryDispatchEmail} onFactoryExecutionChanged={onFactoryExecutionChanged} onClose={onCloseDetail} /> : null}
      {confirmation ? <ConfirmationDialog state={confirmation} onCancel={onCancelConfirmation} onConfirm={onConfirmConfirmation} /> : null}
      {shippingConfirmation ? <ConfirmationDialog state={shippingConfirmation} onCancel={onCancelShippingConfirmation} onConfirm={onConfirmShippingConfirmation} /> : null}
      {voidConfirmation ? <ConfirmationDialog state={voidConfirmation} onCancel={onCancelVoidConfirmation} onConfirm={onConfirmVoidConfirmation} onInputChange={onUpdateVoidConfirmationInput} /> : null}
      {deleteConfirmation ? <ConfirmationDialog state={deleteConfirmation} onCancel={onCancelDeleteConfirmation} onConfirm={onConfirmDeleteConfirmation} onInputChange={onUpdateDeleteConfirmationInput} /> : null}
    </section>
  );
}
