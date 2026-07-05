import {
  dateFromInput,
  dateToInput,
  nonEmpty,
  normalizedCostType,
  serializeOrderDocument,
  serializeUser,
} from "./shared";
import {
  logisticsInvoiceGroupForExpense,
  logisticsInvoiceGroupsForExpenses,
} from "./logistics-invoice-groups";
import { summarizeCurrencyTotals } from "./currency-totals";
import {
  LogisticsBillLike,
  LogisticsExpenseLike,
  UnknownRecord,
  normalizeBillingMethodValue,
} from "./logistics-expense-access-model";
import {
  logisticsExpenseBillAuditStatusValue,
  logisticsExpenseBillField,
  logisticsExpenseBillInvoiceStatusValue,
  logisticsExpenseBillPaymentStatusValue,
  logisticsExpenseBillRecord,
  logisticsExpenseDetailInvoiceStatusValue,
  logisticsExpenseOrderSummary,
} from "./logistics-expense-access-order-summary";

export function serializeLogisticsExpense(expense: LogisticsExpenseLike = {}) {
  const orderSummary = logisticsExpenseOrderSummary(expense.order || {});
  const invoiceDocument = expense.invoiceDocument ? serializeOrderDocument(expense.invoiceDocument, expense.order) : null;
  const bill = logisticsExpenseBillRecord(expense);
  const auditStatus = logisticsExpenseBillAuditStatusValue(expense);
  return {
    id: expense.id,
    billId: expense.billId || bill.id || "",
    orderId: expense.orderId || "",
    orderNo: orderSummary.orderNo,
    blNo: orderSummary.blNo,
    billOfLadingNo: orderSummary.billOfLadingNo,
    customerName: orderSummary.customerName,
    customerShortName: orderSummary.customerShortName,
    supplierId: expense.supplierId || "",
    supplierName: expense.supplierNameSnapshot || expense.supplier?.supplierName || "",
    supplierEmail: expense.supplier?.email || "",
    costId: expense.costId || "",
    costType: normalizedCostType(nonEmpty(expense.costType)),
    currency: expense.currency || "CNY",
    exchangeRate: Number(expense.exchangeRate || 1),
    exchangeRateDate: dateToInput(dateFromInput(expense.exchangeRateDate)),
    exchangeRateSource: expense.exchangeRateSource || "",
    exchangeRateType: expense.exchangeRateType || "",
    amount: Number(expense.amount || 0),
    amountCny: Number(expense.amountCny || 0),
    containerType: expense.containerType || "",
    appliedContainerCount: expense.appliedContainerCount == null ? 1 : Number(expense.appliedContainerCount || 1),
    billingMethod: normalizeBillingMethodValue(expense.billingMethod),
    billingQuantity: expense.billingQuantity == null
      ? Number(expense.appliedContainerCount || 1)
      : Number(expense.billingQuantity || 1),
    containerScope: `${expense.billingQuantity == null ? Number(expense.appliedContainerCount || 1) : Number(expense.billingQuantity || 1)}`,
    remark: expense.remark || "",
    auditStatus,
    invoiceStatus: logisticsExpenseBillInvoiceStatusValue(expense),
    paymentStatus: logisticsExpenseBillPaymentStatusValue(expense),
    detailInvoiceStatus: expense.invoiceStatus || "未通知",
    detailPaymentStatus: expense.paymentStatus || "待开票",
    billInvoiceStatus: bill.invoiceStatus || "",
    billPaymentStatus: bill.paymentStatus || "",
    paymentDate: dateToInput(dateFromInput(logisticsExpenseBillField(expense, "paymentDate", null))),
    submittedAt: logisticsExpenseBillField(expense, "submittedAt", expense.submittedAt) || null,
    submittedBy: serializeUser(bill.submittedBy),
    reviewedBy: serializeUser(bill.reviewedBy || expense.reviewedBy),
    reviewedAt: logisticsExpenseBillField(expense, "reviewedAt", expense.reviewedAt) || null,
    rejectedBy: auditStatus === "已驳回" ? serializeUser(bill.reviewedBy || expense.reviewedBy) : null,
    rejectedAt: auditStatus === "已驳回" ? (logisticsExpenseBillField(expense, "reviewedAt", expense.reviewedAt) || null) : null,
    reviewRemark: bill.reviewRemark || expense.reviewRemark || "",
    rejectReason: bill.rejectReason || expense.rejectReason || "",
    invoiceNotifiedAt: bill.invoiceNotifiedAt || expense.invoiceNotifiedAt || null,
    invoiceNotificationError: bill.invoiceNotificationError || expense.invoiceNotificationError || "",
    invoiceDocument,
    invoiceDocumentId: expense.invoiceDocumentId || "",
    invoiceUploadedBy: serializeUser(expense.invoiceUploadedBy),
    invoiceUploadedAt: expense.invoiceUploadedAt || null,
    invoiceConfirmedBy: serializeUser(expense.invoiceConfirmedBy),
    invoiceConfirmedAt: expense.invoiceConfirmedAt || null,
    forceConfirmReason: expense.forceConfirmReason || "",
    createdBy: serializeUser(expense.createdBy),
    updatedBy: serializeUser(expense.updatedBy),
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    order: orderSummary,
    sourceLabel: expense.costId ? "物流费用审核生成" : "供应商提交",
  };
}

export type LogisticsExpenseDto = ReturnType<typeof serializeLogisticsExpense>;

export function aggregateLogisticsExpenseStatus(rows: UnknownRecord[] = [], field = ""): string {
  if (field === "auditStatus") return logisticsExpenseBillAuditStatus(rows);
  if (field === "invoiceStatus" || field === "paymentStatus") {
    const billValues = rows
      .map((row) => logisticsExpenseBillRecord(row as LogisticsExpenseLike)[field as keyof LogisticsBillLike])
      .filter(Boolean);
    if (billValues.length) return aggregateStatusValues(billValues.map(String), field);
  }
  const values = rows.map((row) => row[field]).filter(Boolean);
  return aggregateStatusValues(values.map(String), field);
}

function aggregateStatusValues(values: string[] = [], field = ""): string {
  const unique = [...new Set(values)];
  if (!unique.length) return "-";
  if (unique.length === 1) return nonEmpty(unique[0]);
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

export function logisticsExpenseBillAuditStatus(rows: LogisticsExpenseLike[] = []): string {
  const billStatuses = rows.map((row) => logisticsExpenseBillRecord(row).auditStatus).filter(Boolean);
  const uniqueBillStatuses = [...new Set(billStatuses)];
  if (uniqueBillStatuses.length === 1) return nonEmpty(uniqueBillStatuses[0]);
  if (uniqueBillStatuses.includes("审核通过")) return "审核通过";
  if (uniqueBillStatuses.includes("待审核")) return "待审核";
  if (uniqueBillStatuses.includes("已驳回")) return "已驳回";
  return "草稿";
}

export function logisticsExpenseInvoiceGroups(items: LogisticsExpenseLike[] = []) {
  return logisticsInvoiceGroupsForExpenses(items).map((group) => {
    const groupItems = items.filter((item) => logisticsInvoiceGroupForExpense(item)?.key === group.key);
    const includedFeeTypes = [...new Set(groupItems.map((item) => nonEmpty(item.costType)).filter(Boolean))];
    const currencyTotals = summarizeCurrencyTotals(groupItems);
    const uploaded = groupItems.length > 0 && groupItems.every((item) => ["已上传", "已确认"].includes(logisticsExpenseDetailInvoiceStatusValue(item)));
    const confirmed = groupItems.length > 0 && groupItems.every((item) => logisticsExpenseDetailInvoiceStatusValue(item) === "已确认");
    const failed = groupItems.some((item) => logisticsExpenseDetailInvoiceStatusValue(item) === "通知失败");
    const notified = groupItems.some((item) => logisticsExpenseDetailInvoiceStatusValue(item) === "已通知开票");
    return {
      key: group.key,
      label: group.label,
      costTypes: group.costTypes,
      includedFeeTypes,
      amountCny: groupItems.reduce((sum, item) => sum + Number(item.amountCny || 0), 0),
      currencyTotals,
      itemIds: groupItems.map((item) => item.id).filter(Boolean),
      status: confirmed ? "已确认" : (uploaded ? "已上传" : (failed ? "通知失败" : (notified ? "已通知开票" : "待开票"))),
      uploaded,
      confirmed,
      failed,
      notified,
      invoiceDocumentId: groupItems.find((item) => item.invoiceDocumentId)?.invoiceDocumentId || "",
      invoiceNotificationError: groupItems.map((item) => item.invoiceNotificationError || "").find(Boolean) || "",
    };
  });
}

export function aggregateLogisticsExpenseInvoiceStatus(items: LogisticsExpenseLike[] = []) {
  const groups = logisticsExpenseInvoiceGroups(items);
  if (!groups.length) return aggregateLogisticsExpenseStatus(items, "invoiceStatus");
  if (groups.every((group) => group.confirmed)) return "已确认";
  if (groups.every((group) => group.uploaded || group.confirmed)) return "已上传发票";
  if (groups.some((group) => group.uploaded || group.confirmed)) return "部分上传发票";
  if (groups.some((group) => group.failed)) return "待开票 / 通知失败";
  return "待开票";
}
