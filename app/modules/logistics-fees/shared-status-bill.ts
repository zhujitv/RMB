import {
  canReviewLogisticsBill,
  canSubmitLogisticsBill,
  logisticsBillDefaultTab,
  logisticsBillDeleteBlockReason,
  logisticsBillEditBlockReason,
} from "../../../lib/platform/logistics-bill-state-machine";
import {
  LOGISTICS_EXPENSE_BILL_SORT_PRIORITY,
  type LogisticsExpense,
} from "./model";
import { aggregateClientStatusValues } from "./shared-status-core";

export function aggregateClientLogisticsExpenseStatus(
  rows: LogisticsExpense[],
  field: keyof LogisticsExpense | "invoiceStatus" | "paymentStatus",
) {
  if (field === "auditStatus") {
    return aggregateClientStatusValues(rows.map(logisticsExpenseBillAuditStatusFromRow), field);
  }
  if (field === "invoiceStatus") {
    return aggregateClientStatusValues(rows.map(logisticsExpenseBillInvoiceStatusFromRow), field);
  }
  if (field === "paymentStatus") {
    return aggregateClientStatusValues(rows.map(logisticsExpenseBillPaymentStatusFromRow), field);
  }
  return aggregateClientStatusValues(
    rows
      .map((item) => item[field as keyof LogisticsExpense])
      .filter(Boolean)
      .map(String),
    field,
  );
}

export function logisticsExpenseBillAuditStatusFromRow(expense: LogisticsExpense) {
  return String(expense.auditStatus || "草稿").trim() || "草稿";
}

export function logisticsExpenseBillInvoiceStatusFromRow(expense: LogisticsExpense) {
  return (
    String(
      expense.invoiceStatus || expense.billInvoiceStatus || "待开票",
    ).trim() || "待开票"
  );
}

export function logisticsExpenseBillPaymentStatusFromRow(expense: LogisticsExpense) {
  const invoiceStatus = logisticsExpenseBillInvoiceStatusFromRow(expense);
  const paymentStatus = (
    String(
      expense.paymentStatus || expense.billPaymentStatus || "待开票",
    ).trim() || "待开票"
  );
  if (
    paymentStatus === "待付款" &&
    ["待开票", "未通知", "已通知开票", "通知失败", "待开票 / 通知失败", "部分未通知", "部分已通知", "部分待开票", "部分上传发票", "部分已确认", "部分已上传", "部分上传", "已上传发票", "已上传", "已开票"].includes(invoiceStatus)
  ) return "待开票";
  return paymentStatus;
}

export function isVoidedLogisticsExpenseBill(expense: LogisticsExpense) {
  if (String(expense.status || "").trim() === "voided") return true;
  return logisticsExpenseBillItems(expense).some(
    (item) => String(item.status || "").trim() === "voided",
  );
}

export function logisticsExpenseDetailInvoiceStatus(expense: LogisticsExpense) {
  return String(expense.detailInvoiceStatus || "待开票").trim() || "待开票";
}

export function logisticsExpenseDetailPaymentStatus(expense: LogisticsExpense) {
  const detailPaymentStatus = String(expense.detailPaymentStatus || "").trim();
  if (detailPaymentStatus) return detailPaymentStatus;
  const billPaymentStatus = String(expense.billPaymentStatus || "").trim();
  const paymentStatus = String(expense.paymentStatus || "").trim();
  if (billPaymentStatus && paymentStatus === billPaymentStatus) return "待开票";
  return paymentStatus || "待开票";
}

export function logisticsExpenseBillItems(expense: LogisticsExpense) {
  return expense.items?.length ? expense.items : [expense];
}

export function logisticsExpenseShipmentBillIds(expense: LogisticsExpense) {
  const ids = expense.shipmentBillIds?.length
    ? expense.shipmentBillIds
    : [expense.billId || expense.id];
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
}

export function logisticsExpenseSelectionSelected(
  expense: LogisticsExpense,
  selectedIds: string[],
) {
  const ids = logisticsExpenseShipmentBillIds(expense);
  return ids.length > 0 && ids.every((id) => selectedIds.includes(id));
}

export function defaultLogisticsExpenseDetailTab({
  auditStatus,
  invoiceStatus,
  paymentStatus,
}: {
  auditStatus?: string;
  invoiceStatus?: string;
  paymentStatus?: string;
  status?: string;
}) {
  return logisticsBillDefaultTab({ auditStatus, invoiceStatus, paymentStatus, status });
}

export function logisticsExpenseBillAuditStatus(items: LogisticsExpense[]) {
  const unique = [
    ...new Set(
      items.map(logisticsExpenseBillAuditStatusFromRow).filter(Boolean),
    ),
  ];
  if (!unique.length) return "草稿";
  if (unique.length === 1) return unique[0];
  if (unique.includes("审核通过")) return "审核通过";
  if (unique.includes("待审核")) return "待审核";
  if (unique.includes("已驳回")) return "已驳回";
  return "草稿";
}

export function logisticsExpenseBillIsEditable(status: string) {
  return canSubmitLogisticsBill({ auditStatus: status });
}

export function logisticsExpenseBillCanApprove(expense: LogisticsExpense) {
  if (isVoidedLogisticsExpenseBill(expense)) return false;
  const items = logisticsExpenseBillItems(expense);
  return (
    canReviewLogisticsBill({
      auditStatus: logisticsExpenseBillAuditStatusFromRow(expense),
    }) ||
    items.some((item) =>
      canReviewLogisticsBill({
        auditStatus: logisticsExpenseBillAuditStatusFromRow(item),
      }),
    ) ||
    (items.length > 0 &&
      canReviewLogisticsBill({
        auditStatus: logisticsExpenseBillAuditStatus(items),
      }))
  );
}

export function logisticsExpenseBillCanSubmit(expense: LogisticsExpense) {
  if (isVoidedLogisticsExpenseBill(expense)) return false;
  const items = logisticsExpenseBillItems(expense);
  return (
    items.length > 0 &&
    logisticsExpenseBillIsEditable(logisticsExpenseBillAuditStatus(items))
  );
}

export function billSupplierIds(expense: LogisticsExpense) {
  return logisticsExpenseBillItems(expense)
    .map((item) => item.supplierId || item.supplierName || "")
    .filter(
      (value, index, arr) => Boolean(value) && arr.indexOf(value) === index,
    );
}

export function sortLogisticsExpenseBillsForDisplay(rows: LogisticsExpense[]) {
  return [...rows].sort((left, right) => {
    const rankDiff = logisticsExpenseBillSortRank(left) - logisticsExpenseBillSortRank(right);
    if (rankDiff !== 0) return rankDiff;
    return logisticsExpenseBillUpdatedAtValue(right) - logisticsExpenseBillUpdatedAtValue(left);
  });
}

export function logisticsExpenseBillSortRank(expense: LogisticsExpense) {
  if (isVoidedLogisticsExpenseBill(expense)) return 1000;
  const auditStatus = normalizeLogisticsExpenseSortStatus(
    logisticsExpenseBillAuditStatusFromRow(expense),
  );
  const invoiceStatus = normalizeLogisticsExpenseSortStatus(
    logisticsExpenseBillInvoiceStatusFromRow(expense),
  );
  const paymentStatus = normalizeLogisticsExpenseSortStatus(
    logisticsExpenseBillPaymentStatusFromRow(expense),
  );
  if (["草稿", "已驳回", "待审核"].includes(auditStatus)) {
    return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[auditStatus] ?? 999;
  }
  const invoiceRank = LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[invoiceStatus];
  if (Number.isFinite(invoiceRank) && invoiceRank < LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票) return invoiceRank;
  if (["部分付款", "部分已付款"].includes(paymentStatus)) return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.部分付款;
  if (paymentStatus === "已付款") return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已付款;
  if (Number.isFinite(invoiceRank) && invoiceRank === LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票) return invoiceRank;
  const paymentRank = LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[paymentStatus];
  if (Number.isFinite(paymentRank)) return paymentRank;
  return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[auditStatus] ?? 999;
}

export function normalizeLogisticsExpenseSortStatus(value: unknown) {
  const text = String(value || "").trim();
  if (text === "部分上传") return "部分上传发票";
  if (text === "已确认发票") return "已确认";
  if (text === "部分已付款") return "部分付款";
  return text || "草稿";
}

export function logisticsExpenseBillUpdatedAtValue(expense: LogisticsExpense) {
  const value = expense.updatedAt || 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function expenseCostSyncText(expense: LogisticsExpense) {
  const status = String(
    (expense as LogisticsExpense & { costSyncStatus?: string })
      .costSyncStatus || "",
  ).trim();
  if (["未同步", "已同步", "同步失败"].includes(status)) return status;
  return expense.costId ? "已同步" : "未同步";
}

export function logisticsExpenseEditBlockReason(expense: LogisticsExpense) {
  if (isVoidedLogisticsExpenseBill(expense)) return "该物流费用账单已作废，不能修改";
  const auditStatus = logisticsExpenseBillAuditStatusFromRow(expense);
  const invoiceStatus = logisticsExpenseDetailInvoiceStatus(expense);
  const paymentStatus = logisticsExpenseBillPaymentStatusFromRow(expense);
  return logisticsBillEditBlockReason({
    auditStatus,
    invoiceStatus,
    paymentStatus,
    costSynced: Boolean(expense.costId),
  }).replace(/。$/, "");
}

export function logisticsExpenseDeleteBlockReason(expense: LogisticsExpense) {
  if (isVoidedLogisticsExpenseBill(expense)) return "该物流费用账单已作废，不能删除明细";
  const auditStatus = logisticsExpenseBillAuditStatusFromRow(expense);
  const invoiceStatus = logisticsExpenseDetailInvoiceStatus(expense);
  const paymentStatus = logisticsExpenseDetailPaymentStatus(expense);
  const costSyncStatus = expenseCostSyncText(expense);
  return logisticsBillDeleteBlockReason({
    auditStatus,
    invoiceStatus,
    paymentStatus,
    costSynced: Boolean(expense.costId) || costSyncStatus === "已同步",
    hasInvoiceDocument: Boolean(expense.invoiceDocumentId),
  });
}

export function logisticsExpenseBillCanVoid(expense: LogisticsExpense) {
  if (isVoidedLogisticsExpenseBill(expense)) return false;
  const paymentStatus = logisticsExpenseBillPaymentStatusFromRow(expense);
  if (paymentStatus.includes("已付款")) return false;
  return true;
}
