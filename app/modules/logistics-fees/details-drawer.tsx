import { SideDetailDrawer, UiTabs } from "../../components";
import { customerDisplayName } from "../../utils";
import { useWorkspaceTabBusy, useWorkspaceTabContext, useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import styles from "../../WorkspaceShell.module.css";
import { LogisticsExpenseBillActions } from "./details-actions";
import { LogisticsExpenseAuditTab, LogisticsExpenseBasicTab, LogisticsExpenseDrawerNotices } from "./details-drawer-tabs";
import { LogisticsExpenseDetailsTable } from "./details-table";
import { LogisticsInvoiceGroupsPanel } from "./invoice-groups-panel";
import {
  type LogisticsExpense,
  type LogisticsExpenseBatchSavePayload,
  type LogisticsExpenseBatchSaveResult,
  type LogisticsExpenseMutationResult,
} from "./model";
import { LogisticsCurrencyAmountList } from "./shared";
import { useLogisticsExpenseDrawerState } from "./use-logistics-expense-drawer-state";

export function LogisticsExpenseRows({
  expense,
  busyId,
  deletingId,
  saving,
  onClose,
  onApprove,
  onReject,
  onWithdraw,
  onResendInvoiceNotice,
  onMarkPaid,
  onReversePayment,
  onSubmitDraft,
  onSaveDetails,
  onValidationError,
  onInvoiceUploaded,
  canReview,
  canWithdraw,
  canEditAmount,
  canUploadInvoice,
  canConfirmInvoice,
  canManageInvoiceRecognition,
  canMarkPaid,
  canSubmitDraft,
  canDeleteExpense,
  canShowSupplier,
}: {
  expense: LogisticsExpense;
  busyId: string;
  deletingId: string;
  saving: boolean;
  onClose: () => void;
  canReview: boolean;
  canWithdraw: boolean;
  canEditAmount: boolean;
  canUploadInvoice: boolean;
  canConfirmInvoice: boolean;
  canManageInvoiceRecognition: boolean;
  canMarkPaid: boolean;
  canSubmitDraft: boolean;
  canDeleteExpense: boolean;
  canShowSupplier: boolean;
  onApprove: (expense: LogisticsExpense) => void;
  onReject: (expense: LogisticsExpense) => void;
  onWithdraw: (expense: LogisticsExpense) => void;
  onResendInvoiceNotice: (expense: LogisticsExpense) => void;
  onMarkPaid: (expense: LogisticsExpense) => void;
  onReversePayment: (expense: LogisticsExpense) => void;
  onSubmitDraft: (expense: LogisticsExpense) => void;
  onSaveDetails: (payload: LogisticsExpenseBatchSavePayload) => Promise<LogisticsExpenseBatchSaveResult | null>;
  onValidationError: (message: string) => void;
  onInvoiceUploaded: (result: LogisticsExpenseMutationResult) => void;
}) {
  const drawer = useLogisticsExpenseDrawerState({
    expense,
    canEditAmount,
    canReview,
    canSubmitDraft,
    onValidationError,
    onSaveDetails,
  });
  useWorkspaceTabDirty(drawer.hasPendingChanges);
  useWorkspaceTabBusy(saving || Boolean(busyId || deletingId));
  const workspaceTab = useWorkspaceTabContext();
  const supplierNames = expense.supplierNames?.length
    ? expense.supplierNames
    : [...new Set(drawer.items.map((item) => item.supplierName).filter((name): name is string => Boolean(name)))];

  return (
    <SideDetailDrawer
      ariaLabel="物流费用账单详情"
      kicker="物流费用账单"
      title={`${expense.orderNo || "-"} · ${customerDisplayName(expense)}`}
      subtitle={drawer.drawerSubtitle}
      onClose={onClose}
      surfaceClassName={styles.logisticsExpenseDrawer}
      actions={
        <LogisticsExpenseBillActions
          expense={expense}
          busyId={busyId}
          saving={saving}
          billAuditStatus={drawer.auditStatus}
          billSaved={drawer.billSaved}
          canEditBillDetails={drawer.canEditBillDetails}
          canMarkPaid={canMarkPaid && !drawer.isVoided}
          canReview={canReview}
          canReviewBill={drawer.canReviewBill}
          canSubmitThisBill={drawer.canSubmitThisBill}
          canWithdraw={canWithdraw && !drawer.isVoided}
          hasInvoiceNoticeFailure={drawer.hasInvoiceNoticeFailure}
          hasPendingChanges={drawer.hasPendingChanges}
          shouldShowSubmitBill={drawer.shouldShowSubmitBill}
          onAddLine={drawer.addExpenseDetailRow}
          onApprove={onApprove}
          onMarkPaid={onMarkPaid}
          onReversePayment={onReversePayment}
          onReject={onReject}
          onResendInvoiceNotice={onResendInvoiceNotice}
          onSave={drawer.handleSaveBillDetails}
          onSubmitDraft={onSubmitDraft}
          onWithdraw={onWithdraw}
        />
      }
    >
      <LogisticsExpenseDrawerNotices
        auditStatus={drawer.auditStatus}
        isVoided={drawer.isVoided}
        invoiceGroups={drawer.invoiceGroups}
        rejectReasons={drawer.rejectReasons}
        hasInvoiceNoticeFailure={drawer.hasInvoiceNoticeFailure}
      />
      <UiTabs
        value={drawer.activeTab}
        onChange={(tab) => {
          if (workspaceTab?.busy) {
            window.alert("当前发票操作正在进行，请完成后再切换分段。");
            return;
          }
          drawer.setActiveTab(tab);
        }}
        tabs={[
          { key: "basic", label: "基础信息" },
          { key: "details", label: "费用明细" },
          { key: "invoice", label: "发票管理" },
          { key: "audit", label: "操作记录" },
        ]}
      />
      {drawer.activeTab === "basic" ? (
        <LogisticsExpenseBasicTab
          expense={expense}
          editingCount={drawer.editingExpenseRows.length}
          supplierNames={supplierNames}
          canShowSupplier={canShowSupplier}
          billCurrencySummary={drawer.billCurrencySummary}
        />
      ) : null}
      {drawer.activeTab === "details" ? (
        <div className={styles.logisticsDrawerSection} inert={saving} aria-busy={saving}>
          <div className={styles.logisticsDrawerSectionHeader}>
            <div>
              <strong>费用明细</strong>
              <span>{drawer.editingExpenseRows.length} 项</span>
              <LogisticsCurrencyAmountList summary={drawer.billCurrencySummary} compact />
            </div>
          </div>
          <LogisticsExpenseDetailsTable
            items={drawer.editingExpenseRows}
            drafts={drawer.drafts}
            busyId={busyId}
            deletingId={deletingId}
            billAuditStatus={drawer.auditStatus}
            canEditAmount={drawer.canEditBillDetails}
            canDeleteExpense={canDeleteExpense}
            onDraftChange={drawer.updateDraft}
            onStageDelete={drawer.stageDeleteExpenseDetail}
          />
        </div>
      ) : null}
      {drawer.activeTab === "invoice" ? (
        <div className={styles.logisticsDrawerSection}>
          <LogisticsInvoiceGroupsPanel
            expense={expense}
            items={drawer.editingExpenseRows}
            groups={drawer.invoiceGroups}
            canUploadInvoice={canUploadInvoice && !drawer.isVoided}
            canConfirmInvoice={canConfirmInvoice && !drawer.isVoided}
            canManageInvoiceRecognition={canManageInvoiceRecognition && !drawer.isVoided}
            onUploaded={onInvoiceUploaded}
          />
        </div>
      ) : null}
      {drawer.activeTab === "audit" ? (
        <LogisticsExpenseAuditTab expense={expense} items={drawer.items} auditStatus={drawer.auditStatus} invoiceStatus={drawer.invoiceStatus} paymentStatus={drawer.paymentStatus} rejectReasons={drawer.rejectReasons} />
      ) : null}
    </SideDetailDrawer>
  );
}
