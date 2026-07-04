
import {
  canReviewLogisticsBill,
  canSubmitLogisticsBill,
  logisticsBillDefaultTab,
  logisticsBillDeleteBlockReason,
  logisticsBillEditBlockReason,
  logisticsBillPayState,
} from "../../../lib/platform/logistics-bill-state-machine";
import {
  logisticsInvoiceGroupForExpense,
  logisticsInvoiceGroupsForExpenses,
} from "../../../lib/platform/logistics-invoice-groups";
import {
  LOGISTICS_EXPENSE_BILL_SORT_PRIORITY,
  PAY_BUTTON_RULE,
  type LogisticsExpense,
  type LogisticsInvoiceGroupSummary,
} from "./model";
import { logisticsExpenseCurrencySummaryFromItems } from "./shared-currency";

export function compactStatusLabel(
  value: unknown,
  type: "audit" | "invoice" | "payment",
) {
  const text = String(value || "").trim();
  if (!text || text === "-") {
    if (type === "audit") return "草稿";
    if (type === "invoice") return "待开票";
    return "待付款";
  }
  if (type === "audit") {
    if (text.includes("待审核")) return "待审核";
    if (text.includes("审核通过")) return "审核通过";
    if (text.includes("驳回")) return "已驳回";
    return "草稿";
  }
  if (type === "invoice") {
    if (text.includes("通知失败")) return "通知失败";
    if (text.includes("部分")) return "部分上传";
    if (text.includes("已确认") || text.includes("已上传")) return "已上传";
    return "待开票";
  }
  if (text.includes("已付款")) return "已付款";
  if (text.includes("部分")) return "部分付款";
  return "待付款";
}

export function logisticsExpensePayButtonState(expense: LogisticsExpense) {
  const items = logisticsExpenseBillItems(expense);
  const auditStatus = compactStatusLabel(
    logisticsExpenseBillAuditStatusFromRow(expense),
    "audit",
  );
  const invoiceStatus = normalizePayButtonInvoiceStatus([
    logisticsExpenseBillInvoiceStatusFromRow(expense),
    expense.billInvoiceStatus,
    expense.invoiceStatus,
    ...items.flatMap((item) => [
      item.billInvoiceStatus,
      item.invoiceStatus,
      item.detailInvoiceStatus,
    ]),
  ]);
  const paymentStatus = compactStatusLabel(
    logisticsExpenseBillPaymentStatusFromRow(expense),
    "payment",
  );
  return {
    ...logisticsBillPayState({ auditStatus, invoiceStatus, paymentStatus }),
    rule: PAY_BUTTON_RULE,
  };
}

export function normalizePayButtonInvoiceStatus(values: unknown[]) {
  const statuses = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (
    statuses.some((status) =>
      status.includes("部分") ||
      status.includes("通知失败") ||
      status.includes("待开票") ||
      status.includes("未通知") ||
      status.includes("已通知开票")
    )
  ) {
    return "未上传发票";
  }
  if (
    statuses.some(
      (status) =>
        status.includes("已上传发票") ||
        status === "已上传" ||
        status.includes("已确认"),
    )
  ) {
    return "已上传发票";
  }
  if (statuses.some((status) => status.includes("部分"))) return "未上传发票";
  return "未上传发票";
}

export function aggregateClientLogisticsExpenseStatus(
  items: LogisticsExpense[],
  field: keyof LogisticsExpense,
) {
  if (field === "auditStatus") return logisticsExpenseBillAuditStatus(items);
  if (field === "invoiceStatus") {
    const billValues = items
      .map(logisticsExpenseBillInvoiceStatusFromRow)
      .filter(Boolean);
    if (billValues.length)
      return aggregateClientStatusValues(billValues, field);
  }
  if (field === "paymentStatus") {
    const billValues = items
      .map(logisticsExpenseBillPaymentStatusFromRow)
      .filter(Boolean);
    if (billValues.length)
      return aggregateClientStatusValues(billValues, field);
  }
  return aggregateClientStatusValues(
    items
      .map((item) => item[field])
      .filter(Boolean)
      .map(String),
    field,
  );
}

export function aggregateClientStatusValues(
  values: string[] = [],
  field: keyof LogisticsExpense | "invoiceStatus" | "paymentStatus",
) {
  const unique = [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ];
  if (!unique.length) return "-";
  if (unique.length === 1) return unique[0];
  if (field === "invoiceStatus") {
    if (unique.includes("已上传")) return "部分已上传";
    if (unique.includes("已上传发票")) return "部分上传发票";
    if (unique.includes("已确认")) return "部分已确认";
    if (unique.includes("已确认发票")) return "部分已确认";
    if (unique.includes("已通知开票")) return "部分已通知";
    if (unique.includes("未通知")) return "部分未通知";
  }
  if (field === "paymentStatus") {
    if (unique.includes("已付款")) return "部分已付款";
    if (unique.includes("待付款")) return "部分待付款";
    if (unique.includes("已开票")) return "部分已开票";
    if (unique.includes("待开票")) return "部分待开票";
  }
  return "混合状态";
}

export function logisticsInvoiceGroupsForBill(
  items: LogisticsExpense[],
): LogisticsInvoiceGroupSummary[] {
  return logisticsInvoiceGroupsForExpenses(items).map((group) => {
    const groupItems = items.filter(
      (item) => logisticsInvoiceGroupForExpense(item)?.key === group.key,
    );
    const includedFeeTypes = [...new Set(groupItems
      .map((item) => String(item.costType || "").trim())
      .filter(Boolean))];
    const uploaded =
      groupItems.length > 0 &&
      groupItems.every((item) =>
        ["已上传", "已确认"].includes(
          logisticsExpenseDetailInvoiceStatus(item),
        ),
      );
    const confirmed =
      groupItems.length > 0 &&
      groupItems.every(
        (item) => logisticsExpenseDetailInvoiceStatus(item) === "已确认",
      );
    const failed = groupItems.some(
      (item) => logisticsExpenseDetailInvoiceStatus(item) === "通知失败",
    );
    const notified = groupItems.some(
      (item) => logisticsExpenseDetailInvoiceStatus(item) === "已通知开票",
    );
    return {
      key: group.key,
      label: group.label,
      costTypes: group.costTypes,
      includedFeeTypes,
      amountCny: groupItems.reduce(
        (sum, item) => sum + Number(item.amountCny || 0),
        0,
      ),
      currencyTotals: logisticsExpenseCurrencySummaryFromItems(groupItems),
      itemIds: groupItems.map((item) => item.id).filter(Boolean),
      status: confirmed
        ? "已确认"
        : uploaded
          ? "已上传"
          : failed
            ? "通知失败"
            : notified
              ? "已通知开票"
              : "待开票",
      uploaded,
      confirmed,
      failed,
      notified,
      invoiceDocumentId:
        groupItems.find((item) => item.invoiceDocumentId)?.invoiceDocumentId ||
        "",
      invoiceNotificationError:
        groupItems
          .map((item) => item.invoiceNotificationError || "")
          .find(Boolean) || "",
    };
  });
}

export function aggregateClientLogisticsInvoiceStatus(
  items: LogisticsExpense[],
) {
  const groups = logisticsInvoiceGroupsForBill(items);
  if (!groups.length)
    return aggregateClientLogisticsExpenseStatus(items, "invoiceStatus");
  if (groups.every((group) => group.confirmed)) return "已确认";
  if (groups.every((group) => group.uploaded || group.confirmed))
    return "已上传发票";
  if (groups.some((group) => group.uploaded || group.confirmed))
    return "部分上传发票";
  if (groups.some((group) => group.failed)) return "待开票 / 通知失败";
  return "待开票";
}

export function logisticsExpenseBillAuditStatusFromRow(
  expense: LogisticsExpense,
) {
  return String(expense.auditStatus || "草稿").trim() || "草稿";
}

export function logisticsExpenseBillInvoiceStatusFromRow(
  expense: LogisticsExpense,
) {
  return (
    String(
      expense.invoiceStatus || expense.billInvoiceStatus || "待开票",
    ).trim() || "待开票"
  );
}

export function logisticsExpenseBillPaymentStatusFromRow(
  expense: LogisticsExpense,
) {
  const invoiceStatus = logisticsExpenseBillInvoiceStatusFromRow(expense);
  const paymentStatus = (
    String(
      expense.paymentStatus || expense.billPaymentStatus || "待开票",
    ).trim() || "待开票"
  );
  if (
    paymentStatus === "待付款" &&
    ["待开票", "未通知", "已通知开票", "通知失败", "待开票 / 通知失败", "部分未通知", "部分已通知", "部分待开票", "部分上传发票", "部分已确认", "部分已上传", "部分上传"].includes(invoiceStatus)
  ) return "待开票";
  return paymentStatus;
}

export function logisticsExpenseDetailInvoiceStatus(expense: LogisticsExpense) {
  return String(expense.detailInvoiceStatus || "未通知").trim() || "未通知";
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
}) {
  return logisticsBillDefaultTab({ auditStatus, invoiceStatus, paymentStatus });
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
    return (
      logisticsExpenseBillSortRank(left) -
        logisticsExpenseBillSortRank(right) ||
      logisticsExpenseBillUpdatedAtValue(right) -
        logisticsExpenseBillUpdatedAtValue(left)
    );
  });
}

export function logisticsExpenseBillSortRank(expense: LogisticsExpense) {
  const auditStatus = normalizeLogisticsExpenseSortStatus(
    logisticsExpenseBillAuditStatusFromRow(expense),
  );
  if (["草稿", "已驳回", "待审核"].includes(auditStatus)) {
    return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[auditStatus] ?? 999;
  }

  const invoiceStatus = normalizeLogisticsExpenseSortStatus(
    logisticsExpenseBillInvoiceStatusFromRow(expense),
  );
  const paymentStatus = normalizeLogisticsExpenseSortStatus(
    logisticsExpenseBillPaymentStatusFromRow(expense),
  );
  const invoiceRank = LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[invoiceStatus];
  if (
    Number.isFinite(invoiceRank) &&
    invoiceRank < LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票
  )
    return invoiceRank;
  if (["部分付款", "部分已付款"].includes(paymentStatus))
    return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.部分付款;
  if (paymentStatus === "已付款")
    return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已付款;
  if (
    Number.isFinite(invoiceRank) &&
    invoiceRank === LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票
  )
    return invoiceRank;
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
  const auditStatus = logisticsExpenseBillAuditStatusFromRow(expense);
  const invoiceStatus = logisticsExpenseDetailInvoiceStatus(expense);
  const paymentStatus = logisticsExpenseBillPaymentStatusFromRow(expense);
  return logisticsBillDeleteBlockReason({
    auditStatus,
    invoiceStatus,
    paymentStatus,
    costSynced: Boolean(expense.costId),
  });
}
