"use client";

import { ConfirmationDialog, PaginationBar, type ConfirmationDialogState } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { CostDocumentsDrawer, PaymentVoucherPreviewModal } from "./documents-drawer";
import { CostDetailDrawer, CostInvoiceGroupDrawer, CostOrderSummaryDrawer } from "./detail-drawers";
import { CostFormDrawer } from "./cost-form-drawer";
import {
  CostDetailTableHead,
  CostInvoiceGroupRows,
  CostInvoiceGroupTableHead,
  CostOrderSummaryRows,
  CostOrderTableHead,
  CostTableRows,
  costViewColSpan,
  costViewLabel,
} from "./cost-table";
import { CostFilterPanel } from "./cost-filter-panel";
import type { CostFilters, CostFormDrawerState, CostInvoiceGroupRow, CostOrderSummary, CostRow, CostView } from "./model";

type CostDocument = NonNullable<CostRow["documents"]>[number];

type CostsModuleViewProps = {
  rows: CostRow[];
  orderRows: CostOrderSummary[];
  invoiceGroupRows: CostInvoiceGroupRow[];
  activeRows: Array<CostRow | CostOrderSummary | CostInvoiceGroupRow>;
  filters: CostFilters;
  archiveScope: string;
  costView: CostView;
  loading: boolean;
  error: string;
  notice: string;
  total: number;
  page: number;
  totalPages: number;
  deletingId: string;
  selectedCostIds: string[];
  selectedVoidableCount: number;
  detailCost: CostRow | null;
  detailOrderSummary: CostOrderSummary | null;
  detailInvoiceGroup: CostInvoiceGroupRow | null;
  costFormDrawer: CostFormDrawerState | null;
  documentCost: CostRow | null;
  documentLoading: boolean;
  documentError: string;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  canWriteDocuments: boolean;
  canManageCostType: boolean;
  canManageFactoryPayments: boolean;
  costTypeSavingId: string;
  paymentSavingId: string;
  voucherUploadingKey: string;
  voucherPreviewCost: CostRow | null;
  confirmation: ConfirmationDialogState | null;
  onCreateCost: () => void;
  onRefresh: () => void;
  onChangeView: (view: CostView) => void;
  onChangeArchiveScope: (scope: string) => void;
  onSetFilter: <K extends keyof CostFilters>(key: K, value: CostFilters[K]) => void;
  onSubmitSearch: () => void;
  onResetSearch: () => void;
  onPage: (page: number) => void;
  onSetDetailCost: (cost: CostRow | null) => void;
  onSetOrderDetail: (order: CostOrderSummary | null) => void;
  onSetInvoiceGroupDetail: (group: CostInvoiceGroupRow | null) => void;
  onEditCost: (cost: CostRow, options?: { returnToDetail?: boolean }) => void;
  onCopyCost: (cost: CostRow) => void;
  onVoidCost: (cost: CostRow) => void;
  onDeleteCost: (cost: CostRow) => void;
  onRestoreCost: (cost: CostRow) => void;
  onToggleCostSelection: (costId: string, selected: boolean) => void;
  onToggleAllVisibleCosts: (selected: boolean) => void;
  onBatchVoid: () => void;
  onOpenDocuments: (costId: string) => void;
  onOpenInvoiceGroupDocuments: (group: CostInvoiceGroupRow) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  onCloseCostForm: () => void;
  onCostFormSaved: (saved: CostRow | CostRow[] | null | undefined) => Promise<void>;
  onCloseDocuments: () => void;
  onUploadDocument: (cost: CostRow, documentType: string, file: File | null) => void;
  onUpdateCostType: (cost: CostRow, costType: string, reason: string) => void;
  onUpdatePayment: (cost: CostRow, paid: boolean, paidAt?: string) => void;
  onUploadPaymentVoucher: (cost: CostRow, file: File | null) => void;
  onDeleteDocument: (cost: CostRow, document: CostDocument) => void;
  onCloseVoucherPreview: () => void;
  onCancelConfirmation: () => void;
  onConfirmConfirmation: () => void;
  onUpdateConfirmationInput: (value: string) => void;
};

export function CostsModuleView(props: CostsModuleViewProps) {
  const {
    rows,
    orderRows,
    invoiceGroupRows,
    activeRows,
    filters,
    archiveScope,
    costView,
    loading,
    error,
    notice,
    total,
    page,
    totalPages,
    deletingId,
    selectedCostIds,
    selectedVoidableCount,
    detailCost,
    detailOrderSummary,
    detailInvoiceGroup,
    costFormDrawer,
    documentCost,
    documentLoading,
    documentError,
    uploadingKey,
    uploadProgressByKey,
    deletingDocumentId,
    canWriteDocuments,
    canManageCostType,
    canManageFactoryPayments,
    costTypeSavingId,
    paymentSavingId,
    voucherUploadingKey,
    voucherPreviewCost,
    confirmation,
  } = props;

  return (
    <div className={styles.costPage}>
      <section className={`${styles.moduleCard} ${styles.costContent}`}>
        <div className={styles.moduleHeader}>
          <div>
            <h2>成本管理</h2>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.primaryButtonCompact} type="button" onClick={props.onCreateCost}>
              登记成本
            </button>
            <button className={styles.secondaryButton} type="button" disabled={loading} onClick={props.onRefresh}>
              {loading ? "刷新中..." : "刷新"}
            </button>
            {costView === "details" ? (
              <button className={styles.secondaryButton} type="button" disabled={!selectedVoidableCount || deletingId === "__batch_void__"} onClick={props.onBatchVoid}>
                {deletingId === "__batch_void__" ? "作废中..." : `批量作废${selectedVoidableCount ? ` (${selectedVoidableCount})` : ""}`}
              </button>
            ) : null}
          </div>
        </div>

        <CostFilterPanel
          costView={costView}
          filters={filters}
          archiveScope={archiveScope}
          loading={loading}
          onChangeView={props.onChangeView}
          onChangeArchiveScope={props.onChangeArchiveScope}
          onSetFilter={props.onSetFilter}
          onSubmit={props.onSubmitSearch}
          onReset={props.onResetSearch}
        />

        {error ? <div className={styles.inlineError}>{error}</div> : null}
        {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

        <div className={`${styles.tableWrap} ${styles.costTableWrap}`}>
          <table className={styles.dataTable}>
            {costView === "orders" ? <CostOrderTableHead /> : costView === "invoiceGroups" || costView === "invoiceExceptions" ? <CostInvoiceGroupTableHead showException={costView === "invoiceExceptions"} /> : (
              <CostDetailTableHead
                allSelected={rows.length > 0 && rows.every((cost) => selectedCostIds.includes(cost.id))}
                onToggleAll={props.onToggleAllVisibleCosts}
              />
            )}
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={costViewColSpan(costView)}><div className={styles.emptyState}>数据加载中...</div></td>
                </tr>
              ) : activeRows.length ? (costView === "orders"
                ? orderRows.map((order) => (
                  <CostOrderSummaryRows key={order.id} order={order} onViewDetail={() => props.onSetOrderDetail(order)} />
                ))
                : costView === "invoiceGroups" || costView === "invoiceExceptions"
                  ? invoiceGroupRows.map((group) => (
                    <CostInvoiceGroupRows
                      key={group.id}
                      group={group}
                      showException={costView === "invoiceExceptions"}
                      onViewDetail={() => props.onSetInvoiceGroupDetail(group)}
                      onOpenDocuments={() => props.onOpenInvoiceGroupDocuments(group)}
                      onOpenPaymentVoucher={props.onOpenPaymentVoucher}
                    />
                  ))
                  : rows.map((cost) => (
                    <CostTableRows
                      key={cost.id}
                      cost={cost}
                      selected={selectedCostIds.includes(cost.id)}
                      onViewDetail={() => props.onSetDetailCost(cost)}
                      deleting={deletingId === cost.id}
                      onSelect={(selected) => props.onToggleCostSelection(cost.id, selected)}
                      onEdit={() => props.onEditCost(cost)}
                      onCopy={() => props.onCopyCost(cost)}
                      onVoid={() => props.onVoidCost(cost)}
                      onDelete={() => props.onDeleteCost(cost)}
                      onRestore={() => props.onRestoreCost(cost)}
                      onOpenDocuments={() => props.onOpenDocuments(cost.id)}
                      onOpenPaymentVoucher={props.onOpenPaymentVoucher}
                    />
                  ))
              ) : (
                <tr>
                  <td colSpan={costViewColSpan(costView)}><div className={styles.emptyState}>未找到匹配的{costViewLabel(costView)}</div></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={props.onPage} />
        {detailCost ? (
          <CostDetailDrawer
            cost={detailCost}
            deleting={deletingId === detailCost.id}
            onOpenDocuments={() => props.onOpenDocuments(detailCost.id)}
            onOpenPaymentVoucher={props.onOpenPaymentVoucher}
            onEdit={() => props.onEditCost(detailCost, { returnToDetail: true })}
            onCopy={() => props.onCopyCost(detailCost)}
            onVoid={() => props.onVoidCost(detailCost)}
            onDelete={() => props.onDeleteCost(detailCost)}
            onRestore={() => props.onRestoreCost(detailCost)}
            onClose={() => props.onSetDetailCost(null)}
          />
        ) : null}
        {costFormDrawer ? (
          <CostFormDrawer
            drawer={costFormDrawer}
            canManageFactoryPayments={canManageFactoryPayments}
            onCancel={props.onCloseCostForm}
            onSaved={props.onCostFormSaved}
          />
        ) : null}
        {detailOrderSummary ? (
          <CostOrderSummaryDrawer
            order={detailOrderSummary}
            onOpenDocuments={(costId) => props.onOpenDocuments(costId)}
            onOpenPaymentVoucher={props.onOpenPaymentVoucher}
            deletingId={deletingId}
            onVoid={props.onVoidCost}
            onDelete={props.onDeleteCost}
            onRestore={props.onRestoreCost}
            onClose={() => props.onSetOrderDetail(null)}
          />
        ) : null}
        {detailInvoiceGroup ? (
          <CostInvoiceGroupDrawer
            group={detailInvoiceGroup}
            onOpenDocuments={(costId) => props.onOpenDocuments(costId)}
            onOpenPaymentVoucher={props.onOpenPaymentVoucher}
            onClose={() => props.onSetInvoiceGroupDetail(null)}
          />
        ) : null}

        {documentCost ? (
          <CostDocumentsDrawer
            cost={documentCost}
            loading={documentLoading}
            error={documentError}
            uploadingKey={uploadingKey}
            uploadProgressByKey={uploadProgressByKey}
            deletingDocumentId={deletingDocumentId}
            canWriteDocuments={canWriteDocuments}
            canManageCostType={canManageCostType}
            canManageFactoryPayments={canManageFactoryPayments}
            costTypeSaving={costTypeSavingId === documentCost.id}
            paymentSavingId={paymentSavingId}
            voucherUploadingKey={voucherUploadingKey}
            onClose={props.onCloseDocuments}
            onUpload={props.onUploadDocument}
            onUpdateCostType={props.onUpdateCostType}
            onUpdatePayment={props.onUpdatePayment}
            onUploadPaymentVoucher={props.onUploadPaymentVoucher}
            onOpenPaymentVoucher={props.onOpenPaymentVoucher}
            onEditCost={() => props.onEditCost(documentCost)}
            onCopyCost={() => props.onCopyCost(documentCost)}
            onVoidCost={() => props.onVoidCost(documentCost)}
            onDeleteCost={() => props.onDeleteCost(documentCost)}
            onRestoreCost={() => props.onRestoreCost(documentCost)}
            onDelete={props.onDeleteDocument}
          />
        ) : null}
        {voucherPreviewCost ? (
          <PaymentVoucherPreviewModal cost={voucherPreviewCost} onClose={props.onCloseVoucherPreview} />
        ) : null}
        {confirmation ? (
          <ConfirmationDialog
            state={confirmation}
            onCancel={props.onCancelConfirmation}
            onConfirm={props.onConfirmConfirmation}
            onInputChange={props.onUpdateConfirmationInput}
          />
        ) : null}
      </section>
    </div>
  );
}
