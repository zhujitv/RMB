import { DetailField, SideDetailDrawer, UiTabs } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import { customerDisplayName, customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { LogisticsExpenseBillActions } from "./details-actions";
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
  onSubmitDraft,
  onSaveDetails,
  onValidationError,
  onInvoiceUploaded,
  canReview,
  canWithdraw,
  canEditAmount,
  canUploadInvoice,
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
  canMarkPaid: boolean;
  canSubmitDraft: boolean;
  canDeleteExpense: boolean;
  canShowSupplier: boolean;
  onApprove: (expense: LogisticsExpense) => void;
  onReject: (expense: LogisticsExpense) => void;
  onWithdraw: (expense: LogisticsExpense) => void;
  onResendInvoiceNotice: (expense: LogisticsExpense) => void;
  onMarkPaid: (expense: LogisticsExpense) => void;
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
          canMarkPaid={canMarkPaid}
          canReview={canReview}
          canReviewBill={drawer.canReviewBill}
          canSubmitThisBill={drawer.canSubmitThisBill}
          canWithdraw={canWithdraw}
          hasInvoiceNoticeFailure={drawer.hasInvoiceNoticeFailure}
          hasPendingChanges={drawer.hasPendingChanges}
          shouldShowSubmitBill={drawer.shouldShowSubmitBill}
          onAddLine={drawer.addExpenseDetailRow}
          onApprove={onApprove}
          onMarkPaid={onMarkPaid}
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
        invoiceGroups={drawer.invoiceGroups}
        rejectReasons={drawer.rejectReasons}
        hasInvoiceNoticeFailure={drawer.hasInvoiceNoticeFailure}
      />
      <UiTabs
        value={drawer.activeTab}
        onChange={drawer.setActiveTab}
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
        <div className={styles.logisticsDrawerSection}>
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
            canUploadInvoice={canUploadInvoice}
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

function LogisticsExpenseDrawerNotices({
  auditStatus,
  invoiceGroups,
  rejectReasons,
  hasInvoiceNoticeFailure,
}: {
  auditStatus: string;
  invoiceGroups: LogisticsExpense["invoiceGroups"];
  rejectReasons: string[];
  hasInvoiceNoticeFailure: boolean;
}) {
  return (
    <>
      {hasInvoiceNoticeFailure ? (
        <div className={styles.logisticsBillInvoiceNoticeError}>
          <strong>开票通知发送失败</strong>
          <span>{invoiceGroups?.map((group) => group.invoiceNotificationError || "").find(Boolean) || "请检查供应商绑定账号邮箱或供应商联系邮箱后重新发送。"}</span>
        </div>
      ) : null}
      {auditStatus.includes("驳回") && rejectReasons.length ? (
        <div className={styles.logisticsBillRejectNotice}>
          <strong>驳回原因</strong>
          <span>{rejectReasons.join("；")}</span>
        </div>
      ) : null}
    </>
  );
}

function LogisticsExpenseBasicTab({
  expense,
  editingCount,
  supplierNames,
  canShowSupplier,
  billCurrencySummary,
}: {
  expense: LogisticsExpense;
  editingCount: number;
  supplierNames: string[];
  canShowSupplier: boolean;
  billCurrencySummary: Parameters<typeof LogisticsCurrencyAmountList>[0]["summary"];
}) {
  return (
    <div className={styles.logisticsDrawerSection}>
      <div className={styles.detailGrid}>
        <DetailField label="客户全称" value={customerLegalName(expense)} wide />
        <DetailField label="订单号" value={expense.orderNo || "-"} />
        <DetailField label="提单号" value={expense.blNo || expense.billOfLadingNo || "-"} />
        <DetailField label="船名航次" value={expense.order?.vesselVoyage || expense.vesselVoyage || "-"} />
        <DetailField label="费用明细" value={`${editingCount} 项`} />
        <DetailField label="供应商" value={supplierNames.join(" / ") || "-"} hidden={!canShowSupplier || !supplierNames.length} wide />
        <div className={`${styles.detailField} ${styles.detailFieldWide}`}>
          <span>账单合计</span>
          <LogisticsCurrencyAmountList summary={billCurrencySummary} />
        </div>
      </div>
    </div>
  );
}

function LogisticsExpenseAuditTab({
  expense,
  items,
  auditStatus,
  invoiceStatus,
  paymentStatus,
  rejectReasons,
}: {
  expense: LogisticsExpense;
  items: LogisticsExpense[];
  auditStatus: string;
  invoiceStatus: string;
  paymentStatus: string;
  rejectReasons: string[];
}) {
  return (
    <div className={styles.detailGrid}>
      <DetailField label="审核状态" value={auditStatus} />
      <DetailField label="发票状态" value={invoiceStatus} />
      <DetailField label="付款状态" value={paymentStatus} />
      <DetailField label="付款时间" value={formatDate(expense.paymentDate)} />
      <DetailField label="提交时间" value={formatDateTime(expense.submittedAt)} />
      <DetailField label="审核人" value={expense.reviewedBy?.name || "-"} />
      <DetailField label="审核时间" value={formatDateTime(expense.reviewedAt)} />
      <DetailField label="创建人" value={items[0]?.createdBy?.name || "-"} />
      <DetailField label="创建时间" value={formatDateTime(items[0]?.createdAt)} />
      <DetailField label="更新人" value={items[0]?.updatedBy?.name || "-"} />
      <DetailField label="更新时间" value={formatDateTime(items[0]?.updatedAt)} />
      <DetailField label="驳回原因" value={rejectReasons.join("；") || "-"} wide hidden={!rejectReasons.length} />
    </div>
  );
}
