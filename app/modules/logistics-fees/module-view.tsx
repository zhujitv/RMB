"use client";

import type { Dispatch, SetStateAction } from "react";
import { ConfirmationDialog, PaginationBar, type ConfirmationDialogState } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { LogisticsExpenseBillTable } from "./bill-table";
import { LogisticsExpenseRows } from "./details-drawer";
import { LogisticsFeesCreateForm } from "./module-create-form";
import { LogisticsFeesModuleHeader } from "./module-header";
import { LogisticsFeesStatementPanel } from "./statement-panel";
import {
  AUDIT_FILTERS,
  BILL_STATUS_FILTERS,
  COST_TYPE_OPTIONS,
  type LogisticsExpense,
  type LogisticsExpenseBatchSavePayload,
  type LogisticsExpenseBatchSaveResult,
  type LogisticsExpenseMutationResult,
  type LogisticsStatementRow,
} from "./model";
import { logisticsExpenseShipmentBillIds } from "./shared";

type LogisticsFeesModuleViewProps = {
  embedded: boolean;
  title: string;
  sectionId: string;
  rows: LogisticsExpense[];
  total: number;
  page: number;
  totalPages: number;
  keyword: string;
  status: string;
  costType: string;
  billStatus: string;
  businessScope: string;
  readOnlyArchive: boolean;
  expandedId: string;
  loading: boolean;
  error: string;
  notice: string;
  createOpen: boolean;
  selectedBillIds: string[];
  canCreateExpense: boolean;
  canReviewExpense: boolean;
  canConfirmInvoice: boolean;
  isLogisticsSupplier: boolean;
  reviewableRows: LogisticsExpense[];
  selectedReviewableRows: LogisticsExpense[];
  allReviewableSelected: boolean;
  activeExpense: LogisticsExpense | null;
  currentUserRole: string;
  currentUserSupplierId: string;
  statementMonth: string;
  statementRows: LogisticsStatementRow[];
  statementLoading: boolean;
  busyId: string;
  deletingId: string;
  savingBillId: string;
  confirmation: ConfirmationDialogState | null;
  onToggleCreate: () => void;
  onRefresh: () => void;
  onCancelCreate: () => void;
  onCreateSaved: (message?: string) => void;
  setStatementMonth: Dispatch<SetStateAction<string>>;
  loadStatement: (month?: string) => void | Promise<void>;
  exportStatementCsv: () => void;
  onKeywordChange: (value: string) => void;
  onSubmitSearch: () => void;
  onStatusChange: (value: string) => void;
  onCostTypeChange: (value: string) => void;
  onBillStatusChange: (value: string) => void;
  onBusinessScopeChange: (value: string) => void;
  onResetSearch: () => void;
  onReviewSelectedBills: () => void;
  onToggleAllReviewableBills: (checked: boolean) => void;
  onOpenExpense: (expense: LogisticsExpense) => void;
  onSelectBill: (expense: LogisticsExpense, checked: boolean) => void;
  onPage: (page: number) => void;
  onCloseExpense: () => void;
  onApprove: (item: LogisticsExpense) => void;
  onReject: (item: LogisticsExpense) => void;
  onWithdraw: (item: LogisticsExpense) => void;
  onResendInvoiceNotice: (item: LogisticsExpense) => void;
  onMarkPaid: (item: LogisticsExpense) => void;
  onReversePayment: (item: LogisticsExpense) => void;
  onSubmitDraft: (item: LogisticsExpense) => void;
  onVoidBill: (item: LogisticsExpense) => void;
  onSaveDetails: (payload: LogisticsExpenseBatchSavePayload) => Promise<LogisticsExpenseBatchSaveResult | null>;
  onValidationError: (message: string) => void;
  onInvoiceUploaded: (result: LogisticsExpenseMutationResult) => void;
  onCancelConfirmation: () => void;
  onConfirmConfirmation: () => void;
  onUpdateConfirmationInput: (value: string) => void;
  onUpdateConfirmationSecondaryInput: (value: string) => void;
};

export function LogisticsFeesModuleView(props: LogisticsFeesModuleViewProps) {
  const {
    embedded,
    title,
    sectionId,
    rows,
    total,
    page,
    totalPages,
    keyword,
    status,
    costType,
    billStatus,
    businessScope,
    readOnlyArchive,
    expandedId,
    loading,
    error,
    notice,
    createOpen,
    selectedBillIds,
    canCreateExpense,
    canReviewExpense,
    canConfirmInvoice,
    isLogisticsSupplier,
    reviewableRows,
    selectedReviewableRows,
    allReviewableSelected,
    activeExpense,
    currentUserRole,
    currentUserSupplierId,
    statementMonth,
    statementRows,
    statementLoading,
    busyId,
    deletingId,
    savingBillId,
    confirmation,
  } = props;

  return (
    <section
      id={sectionId || undefined}
      className={`${embedded ? styles.subModuleCard : styles.moduleCard} ${styles.logisticsTypographyScope}`}
    >
      <LogisticsFeesModuleHeader
        title={title}
        canCreateExpense={canCreateExpense}
        createOpen={createOpen}
        loading={loading}
        onToggleCreate={props.onToggleCreate}
        onRefresh={props.onRefresh}
      />

      <LogisticsFeesCreateForm
        open={createOpen}
        currentUserRole={currentUserRole}
        currentUserSupplierId={currentUserSupplierId}
        onCancel={props.onCancelCreate}
        onSaved={props.onCreateSaved}
      />

      <LogisticsFeesStatementPanel
        statementMonth={statementMonth}
        setStatementMonth={props.setStatementMonth}
        statementRows={statementRows}
        statementLoading={statementLoading}
        loadStatement={props.loadStatement}
        exportStatementCsv={props.exportStatementCsv}
      />

      <div className={styles.listToolbar}>
        <select aria-label="业务范围" value={businessScope} onChange={(event) => props.onBusinessScopeChange(event.target.value)} disabled={loading}>
          <option value="current">当前业务</option>
          <option value="archive">已归档业务</option>
        </select>
        <input
          value={keyword}
          onChange={(event) => props.onKeywordChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onSubmitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 提单号 / 供应商"
        />
        <select value={status} onChange={(event) => props.onStatusChange(event.target.value)}>
          {AUDIT_FILTERS.map((option) => (
            <option key={option.value || "all"} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select value={costType} onChange={(event) => props.onCostTypeChange(event.target.value)}>
          <option value="">全部费用类型</option>
          {COST_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select value={billStatus} onChange={(event) => props.onBillStatusChange(event.target.value)}>
          {BILL_STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={props.onSubmitSearch} disabled={loading}>
          查询
        </button>
        <button className={styles.secondaryButton} type="button" onClick={props.onResetSearch} disabled={loading}>
          重置
        </button>
        {canReviewExpense && !readOnlyArchive ? (
          <button
            className={styles.billSaveButton}
            type="button"
            disabled={!selectedReviewableRows.length || busyId === "__batch_review__"}
            onClick={props.onReviewSelectedBills}
          >
            {busyId === "__batch_review__"
              ? "审核中..."
              : `合并审核 / 批量审核${selectedReviewableRows.length ? `（${selectedReviewableRows.length}）` : ""}`}
          </button>
        ) : null}
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}
      {readOnlyArchive ? <div className={styles.infoStrip}>已归档业务仅供查看，费用、发票和付款记录均已保留。</div> : null}

      <LogisticsExpenseBillTable
        rows={rows}
        loading={loading}
        canReviewExpense={canReviewExpense && !readOnlyArchive}
        hasReviewableRows={Boolean(reviewableRows.length)}
        allReviewableSelected={allReviewableSelected}
        selectedBillIds={selectedBillIds}
        expandedId={expandedId}
        onToggleAllReviewableBills={props.onToggleAllReviewableBills}
        onOpen={props.onOpenExpense}
        onSelectBill={props.onSelectBill}
        onVoidBill={canReviewExpense && !readOnlyArchive ? props.onVoidBill : undefined}
      />

      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={props.onPage} />
      {activeExpense ? (
        <LogisticsExpenseRows
          key={activeExpense.id}
          expense={activeExpense}
          busyId={busyId}
          deletingId={deletingId}
          saving={savingBillId === activeExpense.id}
          onClose={props.onCloseExpense}
          canReview={canReviewExpense && !readOnlyArchive}
          canWithdraw={isLogisticsSupplier && !readOnlyArchive}
          canEditAmount={isLogisticsSupplier}
          canUploadInvoice={Boolean(!readOnlyArchive && (
            canConfirmInvoice
            || canReviewExpense
            || isLogisticsSupplier && (
              activeExpense.supplierAllowLogisticsInvoiceUpload
              || activeExpense.items?.some((item) => item.supplierAllowLogisticsInvoiceUpload)
            )
          ))}
          canConfirmInvoice={canConfirmInvoice && !readOnlyArchive}
          canManageInvoiceRecognition={!readOnlyArchive && (canConfirmInvoice || canReviewExpense)}
          canMarkPaid={canConfirmInvoice && !readOnlyArchive}
          canSubmitDraft={canCreateExpense && !readOnlyArchive}
          canDeleteExpense={canCreateExpense && !readOnlyArchive}
          canShowSupplier={currentUserRole === "管理员" || currentUserRole === "财务"}
          onApprove={(item) => props.onApprove(item)}
          onReject={props.onReject}
          onWithdraw={props.onWithdraw}
          onResendInvoiceNotice={props.onResendInvoiceNotice}
          onMarkPaid={props.onMarkPaid}
          onReversePayment={props.onReversePayment}
          onSubmitDraft={props.onSubmitDraft}
          onSaveDetails={props.onSaveDetails}
          onValidationError={props.onValidationError}
          onInvoiceUploaded={props.onInvoiceUploaded}
        />
      ) : null}
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={props.onCancelConfirmation}
          onConfirm={props.onConfirmConfirmation}
          onInputChange={props.onUpdateConfirmationInput}
          onSecondaryInputChange={props.onUpdateConfirmationSecondaryInput}
        />
      ) : null}
    </section>
  );
}
