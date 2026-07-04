import { useEffect, useState } from "react";
import { logisticsCostTypeDefaultCurrency } from "../../../lib/platform/logistics-cost-types";
import {
  type LogisticsExpense,
  type LogisticsExpenseBatchSavePayload,
  type LogisticsExpenseBatchSaveResult,
  type LogisticsExpenseDraft,
} from "./model";
import {
  createTemporaryLogisticsExpenseRow,
  defaultLogisticsExpenseDetailTab,
  logisticsCurrencySummaryPlainText,
  logisticsExpenseBillAuditStatus,
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
  validLogisticsExpenseDraft,
} from "./shared";

type UseLogisticsExpenseDrawerStateParams = {
  expense: LogisticsExpense;
  canEditAmount: boolean;
  canReview: boolean;
  canSubmitDraft: boolean;
  onValidationError: (message: string) => void;
  onSaveDetails: (payload: LogisticsExpenseBatchSavePayload) => Promise<LogisticsExpenseBatchSaveResult | null>;
};

export function useLogisticsExpenseDrawerState({
  expense,
  canEditAmount,
  canReview,
  canSubmitDraft,
  onValidationError,
  onSaveDetails,
}: UseLogisticsExpenseDrawerStateParams) {
  const items = expense.items?.length ? expense.items : [expense];
  const auditStatus = logisticsExpenseBillAuditStatus(items);
  const invoiceStatus = logisticsExpenseBillInvoiceStatusFromRow(expense);
  const paymentStatus = logisticsExpenseBillPaymentStatusFromRow(expense);
  const canEditBillDetails = canEditAmount && logisticsExpenseBillIsEditable(auditStatus);
  const containerSummary = logisticsExpenseContainerSummary(expense, items);
  const itemsSignature = items.map(logisticsExpenseDraftSignature).join("|");
  const defaultTab = defaultLogisticsExpenseDetailTab({ auditStatus, invoiceStatus, paymentStatus });
  const [drafts, setDrafts] = useState<Record<string, LogisticsExpenseDraft>>(() => logisticsExpenseDraftsFromItems(items));
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

  const persistedEditingRows = items.filter((item) => !deletedExpenseIds.includes(item.id));
  const editingExpenseRows = [...persistedEditingRows, ...newExpenseRows];
  const changedItems = persistedEditingRows.filter((item) => logisticsExpenseDraftChanged(item, drafts[item.id]));
  const hasDirtyChanges = changedItems.length > 0;
  const hasPendingCreates = newExpenseRows.length > 0;
  const hasPendingDeletes = deletedExpenseIds.length > 0;
  const hasPendingChanges = hasDirtyChanges || hasPendingCreates || hasPendingDeletes;
  const billCurrencySummary = hasPendingChanges
    ? logisticsExpenseCurrencySummaryFromDrafts(editingExpenseRows, drafts)
    : logisticsExpenseCurrencySummaryFromItems(items);
  const canSubmitThisBill = canSubmitDraft && logisticsExpenseBillCanSubmit(expense);
  const shouldShowSubmitBill = canSubmitDraft && logisticsExpenseBillIsEditable(auditStatus);
  const canReviewBill = canReview && logisticsExpenseBillCanApprove(expense);
  const invoiceGroups = expense.invoiceGroups?.length ? expense.invoiceGroups : logisticsInvoiceGroupsForBill(editingExpenseRows);
  const rejectReasons = [...new Set(items.map((item) => item.rejectReason || "").filter(Boolean))];
  const hasInvoiceNoticeFailure =
    invoiceGroups.some((group) => group.failed || group.status === "通知失败") ||
    items.some((item) => logisticsExpenseDetailInvoiceStatus(item) === "通知失败" || Boolean(item.invoiceNotificationError));

  function updateDraft(id: string, field: keyof LogisticsExpenseDraft, value: string) {
    setBillSaved(false);
    setDrafts((current) => {
      const currentDraft = current[id] || logisticsExpenseDraftFromItem(items.find((item) => item.id === id) || ({ id } as LogisticsExpense));
      const nextDraft = field === "costType"
        ? {
            ...currentDraft,
            costType: value,
            currency: currentDraft.currencyTouched ? currentDraft.currency : logisticsCostTypeDefaultCurrency(value),
          }
        : field === "currency"
          ? { ...currentDraft, currency: value, currencyTouched: true }
          : { ...currentDraft, [field]: value };
      return { ...current, [id]: nextDraft };
    });
  }

  function addExpenseDetailRow() {
    if (!canEditBillDetails) {
      onValidationError(`账单${auditStatus}，不能新增费用明细`);
      return;
    }
    const temporaryRow = createTemporaryLogisticsExpenseRow(expense, items, newExpenseRows.length);
    setNewExpenseRows((current) => [...current, temporaryRow]);
    setDrafts((current) => ({ ...current, [temporaryRow.id]: logisticsExpenseDraftFromItem(temporaryRow) }));
    setBillSaved(false);
  }

  function stageDeleteExpenseDetail(row: LogisticsExpense) {
    if (row.isTemporary) {
      setNewExpenseRows((current) => current.filter((item) => item.id !== row.id));
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setBillSaved(false);
      return;
    }
    if (!canEditBillDetails) {
      onValidationError(`账单${auditStatus}，不能删除费用明细`);
      return;
    }
    const blockReason = logisticsExpenseDeleteBlockReason(row);
    if (blockReason) {
      onValidationError(blockReason);
      return;
    }
    setDeletedExpenseIds((current) => current.includes(row.id) ? current : [...current, row.id]);
    setBillSaved(false);
  }

  async function handleSaveBillDetails() {
    if (!canEditBillDetails) {
      onValidationError(`账单${auditStatus}，不能修改费用明细`);
      return;
    }
    const invalidIndex = editingExpenseRows.findIndex((item) => {
      const draft = drafts[item.id];
      return (item.isTemporary || logisticsExpenseDraftChanged(item, draft)) && !validLogisticsExpenseDraft(draft, item.isTemporary);
    });
    if (invalidIndex >= 0) {
      const item = editingExpenseRows[invalidIndex];
      onValidationError(logisticsExpenseDraftValidationMessage(item, drafts[item.id], invalidIndex));
      return;
    }
    const payload: LogisticsExpenseBatchSavePayload = {
      groupKey: expense.id,
      orderId: expense.orderId,
      updates: changedItems.map((item) => logisticsExpenseDraftPayload(item, drafts[item.id])),
      creates: newExpenseRows.map((item) => logisticsExpenseDraftCreatePayload(item, drafts[item.id])),
      deletes: deletedExpenseIds,
    };
    const saved = await onSaveDetails(payload);
    if (saved) {
      setNewExpenseRows([]);
      setDeletedExpenseIds([]);
      setBillSaved(true);
    }
  }

  return {
    items,
    auditStatus,
    invoiceStatus,
    paymentStatus,
    canEditBillDetails,
    canReviewBill,
    canSubmitThisBill,
    shouldShowSubmitBill,
    containerSummary,
    drafts,
    billSaved,
    activeTab,
    setActiveTab,
    editingExpenseRows,
    hasPendingChanges,
    billCurrencySummary,
    invoiceGroups,
    rejectReasons,
    hasInvoiceNoticeFailure,
    drawerSubtitle: [
      `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`,
      `柜型：${containerSummary.shortText}`,
      `账单合计：${logisticsCurrencySummaryPlainText(billCurrencySummary)}`,
    ].join(" · "),
    updateDraft,
    addExpenseDetailRow,
    stageDeleteExpenseDetail,
    handleSaveBillDetails,
  };
}
