import { useEffect, useState } from "react";
import { DetailField, SideDetailDrawer, UiTabs } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import { preventEnterFormSubmit } from "../../formGuards";
import { customerDisplayName, customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import {
  COST_TYPE_OPTIONS,
  PAY_BUTTON_DISABLED_TOOLTIP,
  type LogisticsExpense,
  type LogisticsExpenseBatchSavePayload,
  type LogisticsExpenseBatchSaveResult,
  type LogisticsExpenseDraft,
  type LogisticsExpenseMutationResult,
} from "./model";
import { LogisticsInvoiceGroupsPanel } from "./invoice-groups-panel";
import {
  compactStatusLabel,
  createTemporaryLogisticsExpenseRow,
  defaultLogisticsExpenseDetailTab,
  editableQuantityText,
  expenseBillingQuantity,
  expenseCostSyncText,
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
  logisticsExpenseDisplayCurrency,
  logisticsExpenseDraftChanged,
  logisticsExpenseDraftCreatePayload,
  logisticsExpenseDraftFromItem,
  logisticsExpenseDraftPayload,
  logisticsExpenseDraftSignature,
  logisticsExpenseDraftsFromItems,
  logisticsExpenseDraftValidationMessage,
  logisticsExpenseEditBlockReason,
  logisticsExpenseContainerSummary,
  logisticsExpenseLineContainerType,
  logisticsExpenseOriginalAmount,
  logisticsExpensePayButtonState,
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

  function updateDraft(
    id: string,
    field: keyof LogisticsExpenseDraft,
    value: string,
  ) {
    setBillSaved(false);
    setDrafts((current) => {
      const currentDraft =
        current[id] ||
        logisticsExpenseDraftFromItem(
          items.find((item) => item.id === id) || ({ id } as LogisticsExpense),
        );
      const nextDraft = {
        ...currentDraft,
        [field]: value,
      };
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

  function renderBillSaveControls() {
    if (!canEditBillDetails) return null;
    return (
      <>
        <span
          className={`${styles.saveStateBadge} ${hasPendingChanges ? styles.saveStateDirty : billSaved ? styles.saveStateSaved : ""}`}
        >
          {hasPendingChanges ? "● 有未保存修改" : billSaved ? "✓ 已保存" : ""}
        </span>
        <button
          className={styles.billAddLineButton}
          type="button"
          disabled={saving}
          onKeyDown={preventEnterFormSubmit}
          onClick={(event) => {
            event.stopPropagation();
            addExpenseDetailRow();
          }}
        >
          + 新增费用明细
        </button>
        <button
          className={styles.billSaveButton}
          type="button"
          disabled={!hasPendingChanges || saving}
          onKeyDown={preventEnterFormSubmit}
          onClick={(event) => {
            event.stopPropagation();
            void handleSaveBillDetails();
          }}
        >
          {saving ? "保存中..." : "保存本账单明细"}
        </button>
      </>
    );
  }

  function renderBillReviewControls() {
    if (!canReviewBill) return null;
    const busy = busyId === expense.id;
    return (
      <>
        <button
          className={styles.billApproveButton}
          type="button"
          disabled={busy || saving}
          title="审核当前提单账单并通知供应商开票"
          onClick={(event) => {
            event.stopPropagation();
            onApprove(expense);
          }}
        >
          {busy ? "处理中..." : "审核通过并通知开票"}
        </button>
        <button
          className={styles.billRejectButton}
          type="button"
          disabled={busy || saving}
          title="驳回当前提单账单并要求供应商修改"
          onClick={(event) => {
            event.stopPropagation();
            onReject(expense);
          }}
        >
          {busy ? "处理中..." : "驳回"}
        </button>
      </>
    );
  }

  function renderBillWithdrawControls() {
    if (!canWithdraw || billAuditStatus !== "待审核") return null;
    const busy = busyId === expense.id;
    return (
      <button
        className={styles.billAddLineButton}
        type="button"
        disabled={busy || saving}
        title="撤回当前账单，账单下所有费用明细同步回草稿"
        onClick={(event) => {
          event.stopPropagation();
          onWithdraw(expense);
        }}
      >
        {busy ? "撤回中..." : "撤回账单"}
      </button>
    );
  }

  function renderInvoiceNoticeControls() {
    if (!canReview || !hasInvoiceNoticeFailure) return null;
    const busy = busyId === expense.id;
    return (
      <button
        className={styles.billAddLineButton}
        type="button"
        disabled={busy || saving}
        title="仅重新发送当前账单开票通知，不重新审核"
        onClick={(event) => {
          event.stopPropagation();
          onResendInvoiceNotice(expense);
        }}
      >
        {busy ? "发送中..." : "重新发送开票通知"}
      </button>
    );
  }

  function renderBillPaymentControls() {
    if (!canMarkPaid) return null;
    const payState = logisticsExpensePayButtonState(expense);
    const busy = busyId === expense.id;
    const disabled = busy || saving || !payState.canMarkPaid;
    return (
      <button
        className={styles.billPayButton}
        type="button"
        disabled={disabled}
        title={
          payState.canMarkPaid
            ? "将当前账单标记为已付款"
            : PAY_BUTTON_DISABLED_TOOLTIP
        }
        onClick={(event) => {
          event.stopPropagation();
          if (!payState.canMarkPaid) return;
          onMarkPaid(expense);
        }}
      >
        {busy ? "更新中..." : payState.alreadyPaid ? "已付款" : "标记已付款"}
      </button>
    );
  }

  function renderBillSubmitControls() {
    if (!shouldShowSubmitBill) return null;
    const disabled =
      !canSubmitThisBill ||
      hasPendingChanges ||
      busyId === expense.id ||
      saving;
    const title = hasPendingChanges
      ? "请先保存本账单明细，再提交审核"
      : canSubmitThisBill
        ? "将当前账单提交给管理员审核"
        : "只有草稿或已驳回的账单可以提交审核";
    return (
      <button
        className={styles.primaryButtonCompact}
        type="button"
        disabled={disabled}
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          onSubmitDraft(expense);
        }}
      >
        {busyId === expense.id ? "提交中..." : "提交审核"}
      </button>
    );
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
        <>
          {renderBillSubmitControls()}
          {renderBillWithdrawControls()}
          {renderBillReviewControls()}
          {renderInvoiceNoticeControls()}
          {renderBillPaymentControls()}
          {renderBillSaveControls()}
        </>
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

function LogisticsExpenseDetailsTable({
  items,
  drafts,
  busyId,
  deletingId,
  billAuditStatus,
  canEditAmount,
  canDeleteExpense,
  onDraftChange,
  onStageDelete,
}: {
  items: LogisticsExpense[];
  drafts: Record<string, LogisticsExpenseDraft>;
  busyId: string;
  deletingId: string;
  billAuditStatus: string;
  canEditAmount: boolean;
  canDeleteExpense: boolean;
  onDraftChange: (
    id: string,
    field: keyof LogisticsExpenseDraft,
    value: string,
  ) => void;
  onStageDelete: (expense: LogisticsExpense) => void;
}) {
  return (
    <div
      className={styles.logisticsDetailTableWrap}
      onKeyDown={preventEnterFormSubmit}
    >
      <table className={styles.logisticsDetailTable}>
        <thead>
          <tr>
            <th>费用类型</th>
            <th>柜型</th>
            <th>数量</th>
            <th className={styles.numericCell}>金额</th>
            <th>备注</th>
            <th>发票状态</th>
            <th>成本同步</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((expense, index) => (
            <LogisticsExpenseDetailLine
              key={expense.id || `${expense.orderId || "expense"}-${index}`}
              expense={expense}
              draft={
                drafts[expense.id] || logisticsExpenseDraftFromItem(expense)
              }
              busy={busyId === expense.id}
              deleting={deletingId === expense.id}
              billAuditStatus={billAuditStatus}
              canEditAmount={canEditAmount}
              canDeleteExpense={canDeleteExpense}
              onDraftChange={onDraftChange}
              onStageDelete={onStageDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogisticsExpenseDetailLine({
  expense,
  draft,
  busy,
  deleting,
  billAuditStatus,
  canEditAmount,
  canDeleteExpense,
  onDraftChange,
  onStageDelete,
}: {
  expense: LogisticsExpense;
  draft: LogisticsExpenseDraft;
  busy: boolean;
  deleting: boolean;
  billAuditStatus: string;
  canEditAmount: boolean;
  canDeleteExpense: boolean;
  onDraftChange: (
    id: string,
    field: keyof LogisticsExpenseDraft,
    value: string,
  ) => void;
  onStageDelete: (expense: LogisticsExpense) => void;
}) {
  const invoiceStatus = logisticsExpenseDetailInvoiceStatus(expense);
  const billEditable = logisticsExpenseBillIsEditable(billAuditStatus);
  const editBlockReason = billEditable
    ? logisticsExpenseEditBlockReason(expense)
    : `账单${billAuditStatus}，不能修改`;
  const canEditThisAmount = canEditAmount && billEditable && !editBlockReason;
  const shouldRenderRemarkInput = canEditThisAmount;
  const originalAmount = logisticsExpenseOriginalAmount(expense);
  const originalCurrency = logisticsExpenseDisplayCurrency(expense, draft);
  const deleteBlockReason = billEditable
    ? logisticsExpenseDeleteBlockReason(expense)
    : `账单${billAuditStatus}，不能删除明细`;
  return (
    <tr>
      <td>
        {expense.isTemporary ? (
          <select
            className={styles.inlineCostTypeSelect}
            value={draft.costType}
            onChange={(event) =>
              onDraftChange(expense.id, "costType", event.target.value)
            }
            aria-label="费用类型"
          >
            {COST_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          logisticsCostTypeLabel(expense.costType || "") || "-"
        )}
      </td>
      <td>{logisticsExpenseLineContainerType(expense)}</td>
      <td>
        {canEditThisAmount ? (
          <input
            className={styles.inlineQuantityInput}
            type="number"
            min="1"
            step="1"
            value={draft.appliedContainerCount}
            onChange={(event) =>
              onDraftChange(
                expense.id,
                "appliedContainerCount",
                event.target.value,
              )
            }
            aria-label="适用数量"
          />
        ) : (
          editableQuantityText(expenseBillingQuantity(expense))
        )}
      </td>
      <td className={styles.numericCell}>
        <div className={styles.inlineAmountEditor}>
          {canEditThisAmount ? (
            <input
              value={draft.unitAmount}
              onChange={(event) =>
                onDraftChange(expense.id, "unitAmount", event.target.value)
              }
              inputMode="decimal"
              aria-label="物流费用单价"
            />
          ) : (
            <strong>
              {formatOriginalCurrencyAccounting(
                originalCurrency,
                originalAmount,
              )}
            </strong>
          )}
          {canEditThisAmount ? <span>{originalCurrency}</span> : null}
        </div>
      </td>
      <td
        className={styles.remarkCell}
        title={draft.remark || expense.remark || ""}
      >
        {shouldRenderRemarkInput ? (
          <div className={styles.inlineRemarkCell}>
            <input
              className={styles.inlineRemarkInput}
              value={draft.remark}
              onChange={(event) =>
                onDraftChange(expense.id, "remark", event.target.value)
              }
              disabled={!canEditThisAmount}
              placeholder="-"
              aria-label="物流费用备注"
            />
            {!canEditThisAmount && editBlockReason ? (
              <span className={styles.inlineEditHint}>{editBlockReason}</span>
            ) : null}
          </div>
        ) : (
          expense.remark || "-"
        )}
      </td>
      <td>
        <StatusPill value={compactStatusLabel(invoiceStatus, "invoice")} />
      </td>
      <td>
        <div className={styles.costSyncCell}>
          <span>{expenseCostSyncText(expense)}</span>
        </div>
      </td>
      <td>
        <div className={styles.compactDetailActions}>
          <button
            className={styles.logisticsLineDeleteButton}
            type="button"
            disabled={
              !canDeleteExpense ||
              busy ||
              deleting ||
              (!expense.isTemporary && Boolean(deleteBlockReason))
            }
            title={
              !canDeleteExpense
                ? "无权限删除该费用明细"
                : deleteBlockReason || "删除这条费用明细"
            }
            onClick={(event) => {
              event.stopPropagation();
              onStageDelete(expense);
            }}
          >
            {deleting ? "删除中..." : expense.isTemporary ? "移除" : "删除"}
          </button>
        </div>
      </td>
    </tr>
  );
}
