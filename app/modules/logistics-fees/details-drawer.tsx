import { useEffect, useState } from "react";
import { DetailField, SideDetailDrawer, UiTabs } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import { LogisticsExpenseBillActions } from "./details-actions";
import { LogisticsExpenseDetailsTable } from "./details-table";
import { customerDisplayName, customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import {
  logisticsCostTypeDefaultCurrency,
  logisticsCostTypeLabel,
} from "../../../lib/platform/logistics-cost-types";
import {
  type LogisticsExpense,
  type LogisticsExpenseBatchSavePayload,
  type LogisticsExpenseBatchSaveResult,
  type LogisticsExpenseDraft,
  type LogisticsExpenseMutationResult,
} from "./model";
import { LogisticsInvoiceGroupsPanel } from "./invoice-groups-panel";
import {
  createTemporaryLogisticsExpenseRow,
  defaultLogisticsExpenseDetailTab,
  formatOriginalCurrencyAccounting,
  logisticsCurrencySummaryPlainText,
  LogisticsCurrencyAmountList,
  logisticsExpenseBillAuditStatus,
  logisticsExpenseBillAuditStatusFromRow,
  logisticsExpenseBillCanApprove,
  logisticsExpenseBillCanSubmit,
  logisticsExpenseBillInvoiceStatusFromRow,
  logisticsExpenseBillIsEditable,
  logisticsExpenseBillItems,
  logisticsExpenseBillPaymentStatusFromRow,
  logisticsExpenseCurrencySummaryFromDrafts,
  logisticsExpenseCurrencySummaryFromItems,
  logisticsExpenseDeleteBlockReason,
  logisticsExpenseDetailInvoiceStatus,
  logisticsExpenseDraftChanged,
  logisticsExpenseDraftCreatePayload,
  logisticsExpenseDraftFromItem,
  logisticsExpenseDraftPayload,
  logisticsExpenseDraftSignature,
  logisticsExpenseDraftsFromItems,
  logisticsExpenseDraftValidationMessage,
  logisticsExpenseContainerSummary,
  logisticsInvoiceGroupsForBill,
  StatusPill,
  validLogisticsExpenseDraft,
} from "./shared";

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
  onSaveDetails: (
    payload: LogisticsExpenseBatchSavePayload,
  ) => Promise<LogisticsExpenseBatchSaveResult | null>;
  onValidationError: (message: string) => void;
  onInvoiceUploaded: (result: LogisticsExpenseMutationResult) => void;
}) {
  const items = expense.items?.length ? expense.items : [expense];
  const billAuditStatus = logisticsExpenseBillAuditStatus(items);
  const auditStatus = billAuditStatus;
  const invoiceStatus = logisticsExpenseBillInvoiceStatusFromRow(expense);
  const paymentStatus = logisticsExpenseBillPaymentStatusFromRow(expense);
  const canEditBillDetails =
    canEditAmount && logisticsExpenseBillIsEditable(billAuditStatus);
  const supplierNames = expense.supplierNames?.length
    ? expense.supplierNames
    : [...new Set(items.map((item) => item.supplierName).filter(Boolean))];
  const rejectReasons = [
    ...new Set(items.map((item) => item.rejectReason || "").filter(Boolean)),
  ];
  const containerSummary = logisticsExpenseContainerSummary(expense, items);
  const canReviewBill = canReview && logisticsExpenseBillCanApprove(expense);
  const itemsSignature = items.map(logisticsExpenseDraftSignature).join("|");
  const defaultTab = defaultLogisticsExpenseDetailTab({
    auditStatus,
    invoiceStatus,
    paymentStatus,
  });
  const [drafts, setDrafts] = useState<Record<string, LogisticsExpenseDraft>>(
    () => logisticsExpenseDraftsFromItems(items),
  );
  const [newExpenseRows, setNewExpenseRows] = useState<LogisticsExpense[]>([]);
  const [deletedExpenseIds, setDeletedExpenseIds] = useState<string[]>([]);
  const [billSaved, setBillSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(defaultTab);
  useEffect(() => {
    setDrafts(logisticsExpenseDraftsFromItems(items));
    setNewExpenseRows([]);
    setDeletedExpenseIds([]);
  }, [itemsSignature]);
  useEffect(() => {
    setActiveTab(defaultTab);
  }, [expense.id, defaultTab]);
  const persistedEditingRows = items.filter(
    (item) => !deletedExpenseIds.includes(item.id),
  );
  const editingExpenseRows = [...persistedEditingRows, ...newExpenseRows];
  const changedItems = persistedEditingRows.filter((item) =>
    logisticsExpenseDraftChanged(item, drafts[item.id]),
  );
  const hasDirtyChanges = changedItems.length > 0;
  const hasPendingCreates = newExpenseRows.length > 0;
  const hasPendingDeletes = deletedExpenseIds.length > 0;
  const hasPendingChanges =
    hasDirtyChanges || hasPendingCreates || hasPendingDeletes;
  const billCurrencySummary = hasPendingChanges
    ? logisticsExpenseCurrencySummaryFromDrafts(editingExpenseRows, drafts)
    : logisticsExpenseCurrencySummaryFromItems(items);
  const canSubmitThisBill =
    canSubmitDraft && logisticsExpenseBillCanSubmit(expense);
  const shouldShowSubmitBill =
    canSubmitDraft && logisticsExpenseBillIsEditable(billAuditStatus);
  const invoiceGroups = expense.invoiceGroups?.length
    ? expense.invoiceGroups
    : logisticsInvoiceGroupsForBill(editingExpenseRows);
  const hasInvoiceNoticeFailure =
    invoiceGroups.some(
      (group) => group.failed || group.status === "通知失败",
    ) ||
    items.some(
      (item) =>
        logisticsExpenseDetailInvoiceStatus(item) === "通知失败" ||
        Boolean(item.invoiceNotificationError),
    );

  function updateDraft(id: string, field: keyof LogisticsExpenseDraft, value: string) {
    setBillSaved(false);
    setDrafts((current) => {
      const currentDraft =
        current[id] ||
        logisticsExpenseDraftFromItem(
          items.find((item) => item.id === id) || ({ id } as LogisticsExpense),
        );
      let nextDraft: LogisticsExpenseDraft;
      if (field === "costType") {
        const recommendedCurrency = logisticsCostTypeDefaultCurrency(value);
        nextDraft = {
          ...currentDraft,
          costType: value,
          currency: currentDraft.currencyTouched
            ? currentDraft.currency
            : recommendedCurrency,
        };
      } else if (field === "currency") {
        nextDraft = {
          ...currentDraft,
          currency: value,
          currencyTouched: true,
        };
      } else {
        nextDraft = {
          ...currentDraft,
          [field]: value,
        };
      }
      return {
        ...current,
        [id]: nextDraft,
      };
    });
  }

  function addExpenseDetailRow() {
    if (!canEditBillDetails) {
      onValidationError(`账单${billAuditStatus}，不能新增费用明细`);
      return;
    }
    const temporaryRow = createTemporaryLogisticsExpenseRow(
      expense,
      items,
      newExpenseRows.length,
    );
    setNewExpenseRows((current) => [...current, temporaryRow]);
    setDrafts((current) => ({
      ...current,
      [temporaryRow.id]: logisticsExpenseDraftFromItem(temporaryRow),
    }));
    setBillSaved(false);
  }

  function stageDeleteExpenseDetail(row: LogisticsExpense) {
    if (row.isTemporary) {
      setNewExpenseRows((current) =>
        current.filter((item) => item.id !== row.id),
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setBillSaved(false);
      return;
    }
    if (!canEditBillDetails) {
      onValidationError(`账单${billAuditStatus}，不能删除费用明细`);
      return;
    }
    const blockReason = logisticsExpenseDeleteBlockReason(row);
    if (blockReason) {
      onValidationError(blockReason);
      return;
    }
    setDeletedExpenseIds((current) =>
      current.includes(row.id) ? current : [...current, row.id],
    );
    setBillSaved(false);
  }

  async function handleSaveBillDetails() {
    if (!canEditBillDetails) {
      onValidationError(`账单${billAuditStatus}，不能修改费用明细`);
      return;
    }
    const invalidIndex = editingExpenseRows.findIndex((item) => {
      const draft = drafts[item.id];
      return (
        (item.isTemporary || logisticsExpenseDraftChanged(item, draft)) &&
        !validLogisticsExpenseDraft(draft, item.isTemporary)
      );
    });
    if (invalidIndex >= 0) {
      const item = editingExpenseRows[invalidIndex];
      const validationMessage = logisticsExpenseDraftValidationMessage(
        item,
        drafts[item.id],
        invalidIndex,
      );
      onValidationError(validationMessage);
      return;
    }
    const payload: LogisticsExpenseBatchSavePayload = {
      groupKey: expense.id,
      orderId: expense.orderId,
      updates: changedItems.map((item) =>
        logisticsExpenseDraftPayload(item, drafts[item.id]),
      ),
      creates: newExpenseRows.map((item) =>
        logisticsExpenseDraftCreatePayload(item, drafts[item.id]),
      ),
      deletes: deletedExpenseIds,
    };
    const saved = await onSaveDetails(payload);
    if (saved) {
      setNewExpenseRows([]);
      setDeletedExpenseIds([]);
      setBillSaved(true);
    }
  }













  const drawerSubtitle = [
    `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`,
    `柜型：${containerSummary.shortText}`,
    `账单合计：${logisticsCurrencySummaryPlainText(billCurrencySummary)}`,
  ].join(" · ");

  return (
    <SideDetailDrawer
      ariaLabel="物流费用账单详情"
      kicker="物流费用账单"
      title={`${expense.orderNo || "-"} · ${customerDisplayName(expense)}`}
      subtitle={drawerSubtitle}
      onClose={onClose}
      surfaceClassName={styles.logisticsExpenseDrawer}
      actions={
        <LogisticsExpenseBillActions
          expense={expense}
          busyId={busyId}
          saving={saving}
          billAuditStatus={billAuditStatus}
          billSaved={billSaved}
          canEditBillDetails={canEditBillDetails}
          canMarkPaid={canMarkPaid}
          canReview={canReview}
          canReviewBill={canReviewBill}
          canSubmitThisBill={canSubmitThisBill}
          canWithdraw={canWithdraw}
          hasInvoiceNoticeFailure={hasInvoiceNoticeFailure}
          hasPendingChanges={hasPendingChanges}
          shouldShowSubmitBill={shouldShowSubmitBill}
          onAddLine={addExpenseDetailRow}
          onApprove={onApprove}
          onMarkPaid={onMarkPaid}
          onReject={onReject}
          onResendInvoiceNotice={onResendInvoiceNotice}
          onSave={handleSaveBillDetails}
          onSubmitDraft={onSubmitDraft}
          onWithdraw={onWithdraw}
        />
      }
    >
      {hasInvoiceNoticeFailure ? (
        <div className={styles.logisticsBillInvoiceNoticeError}>
          <strong>开票通知发送失败</strong>
          <span>
            {invoiceGroups
              .map((group) => group.invoiceNotificationError || "")
              .find(Boolean) ||
              "请检查供应商绑定账号邮箱或供应商联系邮箱后重新发送。"}
          </span>
        </div>
      ) : null}
      {auditStatus.includes("驳回") && rejectReasons.length ? (
        <div className={styles.logisticsBillRejectNotice}>
          <strong>驳回原因</strong>
          <span>{rejectReasons.join("；")}</span>
        </div>
      ) : null}
      <UiTabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { key: "basic", label: "基础信息" },
          { key: "details", label: "费用明细" },
          { key: "invoice", label: "发票管理" },
          { key: "audit", label: "操作记录" },
        ]}
      />
      {activeTab === "basic" ? (
        <div className={styles.logisticsDrawerSection}>
          <div className={styles.detailGrid}>
            <DetailField
              label="客户全称"
              value={customerLegalName(expense)}
              wide
            />
            <DetailField label="订单号" value={expense.orderNo || "-"} />
            <DetailField
              label="提单号"
              value={expense.blNo || expense.billOfLadingNo || "-"}
            />
            <DetailField
              label="船名航次"
              value={expense.order?.vesselVoyage || expense.vesselVoyage || "-"}
            />
            <DetailField
              label="费用明细"
              value={`${editingExpenseRows.length} 项`}
            />
            <DetailField
              label="供应商"
              value={supplierNames.join(" / ") || "-"}
              hidden={!canShowSupplier || !supplierNames.length}
              wide
            />
            <div className={`${styles.detailField} ${styles.detailFieldWide}`}>
              <span>账单合计</span>
              <LogisticsCurrencyAmountList summary={billCurrencySummary} />
            </div>
          </div>
        </div>
      ) : null}
      {activeTab === "details" ? (
        <div className={styles.logisticsDrawerSection}>
          <div className={styles.logisticsDrawerSectionHeader}>
            <div>
              <strong>费用明细</strong>
              <span>{editingExpenseRows.length} 项</span>
              <LogisticsCurrencyAmountList
                summary={billCurrencySummary}
                compact
              />
            </div>
          </div>
          <LogisticsExpenseDetailsTable
            items={editingExpenseRows}
            drafts={drafts}
            busyId={busyId}
            deletingId={deletingId}
            billAuditStatus={billAuditStatus}
            canEditAmount={canEditBillDetails}
            canDeleteExpense={canDeleteExpense}
            onDraftChange={updateDraft}
            onStageDelete={stageDeleteExpenseDetail}
          />
        </div>
      ) : null}
      {activeTab === "invoice" ? (
        <div className={styles.logisticsDrawerSection}>
          <LogisticsInvoiceGroupsPanel
            expense={expense}
            items={editingExpenseRows}
            groups={invoiceGroups}
            canUploadInvoice={canUploadInvoice}
            onUploaded={onInvoiceUploaded}
          />
        </div>
      ) : null}
      {activeTab === "audit" ? (
        <div className={styles.detailGrid}>
          <DetailField label="审核状态" value={auditStatus} />
          <DetailField label="发票状态" value={invoiceStatus} />
          <DetailField label="付款状态" value={paymentStatus} />
          <DetailField
            label="付款时间"
            value={formatDate(expense.paymentDate)}
          />
          <DetailField
            label="提交时间"
            value={formatDateTime(expense.submittedAt)}
          />
          <DetailField label="审核人" value={expense.reviewedBy?.name || "-"} />
          <DetailField
            label="审核时间"
            value={formatDateTime(expense.reviewedAt)}
          />
          <DetailField
            label="创建人"
            value={items[0]?.createdBy?.name || "-"}
          />
          <DetailField
            label="创建时间"
            value={formatDateTime(items[0]?.createdAt)}
          />
          <DetailField
            label="更新人"
            value={items[0]?.updatedBy?.name || "-"}
          />
          <DetailField
            label="更新时间"
            value={formatDateTime(items[0]?.updatedAt)}
          />
          <DetailField
            label="驳回原因"
            value={rejectReasons.join("；") || "-"}
            wide
            hidden={!rejectReasons.length}
          />
        </div>
      ) : null}
    </SideDetailDrawer>
  );
}
