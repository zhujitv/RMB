import { dateFromInput, dateToInput, nonEmpty, serializeUser } from "./shared";
import { summarizeCurrencyTotals } from "./currency-totals";
import {
  LOGISTICS_EXPENSE_BILL_SORT_PRIORITY,
  LogisticsExpenseLike,
  UnknownRecord,
} from "./logistics-expense-access-model";
import {
  logisticsExpenseBillRecord,
  logisticsExpenseOrderSummary,
  normalizeLogisticsBillPaymentStatus,
} from "./logistics-expense-access-order-summary";
import {
  aggregateLogisticsExpenseStatus,
  logisticsExpenseInvoiceGroups,
  serializeLogisticsExpense,
} from "./logistics-expense-access-item-serialization";

export function serializeLogisticsExpenseBill(rows: LogisticsExpenseLike[] = []) {
  const items = rows.map(serializeLogisticsExpense);
  const first = items[0] || {};
  const firstRaw = rows[0] || {};
  const bill = logisticsExpenseBillRecord(firstRaw);
  const amountCny = items.reduce((sum, item) => sum + Number(item.amountCny || 0), 0);
  const currencyTotals = summarizeCurrencyTotals(items);
  const invoiceGroups = logisticsExpenseInvoiceGroups(rows);
  return {
    id: logisticsExpenseBillId(firstRaw || first),
    billId: logisticsExpenseBillId(firstRaw || first),
    isBill: true,
    orderId: first.orderId || "",
    orderNo: first.orderNo || "",
    blNo: first.blNo || first.billOfLadingNo || "",
    billOfLadingNo: first.billOfLadingNo || first.blNo || "",
    customerName: first.customerName || "",
    customerShortName: first.customerShortName || "",
    businessEntityId: first.businessEntityId || "",
    businessEntityName: first.businessEntityName || "",
    businessEntityShortName: first.businessEntityShortName || "",
    businessEntityDisplayName: first.businessEntityDisplayName || "",
    businessEntityNameSnapshot: first.businessEntityNameSnapshot || "",
    businessEntityIsDefault: first.businessEntityIsDefault !== false,
    businessEntity: first.businessEntity || null,
    vesselVoyage: first.order?.vesselVoyage || "",
    supplierName: "",
    supplierNames: [...new Set(items.map((item) => item.supplierName).filter(Boolean))],
    costType: items.length === 1 ? items[0].costType : `${items.length} 项费用`,
    currency: "CNY",
    amount: currencyTotals.cnyActual,
    amountCny,
    currencyTotals,
    auditStatus: bill.auditStatus || "草稿",
    invoiceStatus: bill.invoiceStatus || "待开票",
    paymentStatus: normalizeLogisticsBillPaymentStatus(bill.invoiceStatus, bill.paymentStatus),
    status: bill.status || "",
    voidedAt: bill.voidedAt || null,
    voidedBy: serializeUser(bill.voidedBy),
    voidedById: bill.voidedById || "",
    voidReason: bill.voidReason || "",
    voidRemark: bill.voidRemark || "",
    paymentDate: dateToInput(dateFromInput(bill.paymentDate)),
    submittedAt: bill.submittedAt || first.submittedAt || null,
    submittedBy: serializeUser(bill.submittedBy),
    reviewedBy: serializeUser(bill.reviewedBy),
    reviewedAt: bill.reviewedAt || first.reviewedAt || null,
    rejectedBy: bill.auditStatus === "已驳回" ? serializeUser(bill.reviewedBy) : null,
    rejectedAt: bill.auditStatus === "已驳回" ? (bill.reviewedAt || null) : null,
    reviewRemark: bill.reviewRemark || first.reviewRemark || "",
    rejectReason: bill.rejectReason || first.rejectReason || "",
    invoiceNotifiedAt: bill.invoiceNotifiedAt || first.invoiceNotifiedAt || null,
    invoiceNotificationError: bill.invoiceNotificationError || first.invoiceNotificationError || "",
    itemCount: items.length,
    invoiceGroups,
    items,
    order: first.order || {},
    updatedAt: rows.reduce((latest, row) => {
      const dateValue = logisticsExpenseBillRecord(row).updatedAt || row.updatedAt || row.createdAt || 0;
      const time = new Date(dateValue instanceof Date || typeof dateValue === "string" || typeof dateValue === "number" ? dateValue : 0).getTime();
      return time > latest ? time : latest;
    }, 0),
  };
}

export type LogisticsExpenseBillDto = ReturnType<typeof serializeLogisticsExpenseBill>;

export function serializeLogisticsExpenseShipment(rows: LogisticsExpenseLike[] = []) {
  const items = rows.map(serializeLogisticsExpense);
  const first = items[0] || {};
  const rawRows = rows.length ? rows : items;
  const bills = groupLogisticsExpensesByBill(rawRows);
  const currencyTotals = summarizeCurrencyTotals(items);
  const billIds = [...new Set(bills.map((bill) => nonEmpty(bill.billId || bill.id)).filter(Boolean))];
  const invoiceGroups = logisticsExpenseInvoiceGroups(rawRows);
  const shipmentNo = first.orderNo || first.orderId || first.blNo || "";
  return {
    id: billIds.length === 1 ? billIds[0] : `shipment:${first.orderId || shipmentNo || "unknown"}`,
    shipmentNo,
    customer: first.customerShortName || first.customerName || "",
    isShipment: true,
    isBill: true,
    orderId: first.orderId || "",
    orderNo: first.orderNo || shipmentNo,
    blNo: [...new Set(items.map((item) => item.blNo || item.billOfLadingNo).filter(Boolean))].join(" / "),
    billOfLadingNo: [...new Set(items.map((item) => item.billOfLadingNo || item.blNo).filter(Boolean))].join(" / "),
    customerName: first.customerName || "",
    customerShortName: first.customerShortName || "",
    businessEntityId: first.businessEntityId || "",
    businessEntityName: first.businessEntityName || "",
    businessEntityShortName: first.businessEntityShortName || "",
    businessEntityDisplayName: first.businessEntityDisplayName || "",
    businessEntityNameSnapshot: first.businessEntityNameSnapshot || "",
    businessEntityIsDefault: first.businessEntityIsDefault !== false,
    businessEntity: first.businessEntity || null,
    vesselVoyage: first.order?.vesselVoyage || "",
    supplierName: "",
    supplierNames: [...new Set(items.map((item) => item.supplierName).filter(Boolean))],
    costType: `${items.length} 项费用`,
    currency: "CNY",
    amount: currencyTotals.cnyActual,
    amountCny: currencyTotals.totalCny,
    totalCNY: currencyTotals.cnyActual,
    totalUSD: Number((currencyTotals.foreignTotals || []).find((item) => item.currency === "USD")?.amount || 0),
    currencyTotals,
    auditStatus: aggregateLogisticsExpenseStatus(rawRows, "auditStatus"),
    invoiceStatus: aggregateLogisticsExpenseStatus(rawRows, "invoiceStatus"),
    paymentStatus: aggregateLogisticsExpenseStatus(rawRows, "paymentStatus"),
    status: [...new Set(rawRows.map((row) => logisticsExpenseBillRecord(row).status).filter(Boolean))].includes("voided") ? "voided" : "",
    voidedAt: rawRows.map((row) => logisticsExpenseBillRecord(row).voidedAt).find(Boolean) || null,
    voidedBy: serializeUser(rawRows.map((row) => logisticsExpenseBillRecord(row).voidedBy).find(Boolean)),
    voidedById: rawRows.map((row) => logisticsExpenseBillRecord(row).voidedById || "").find(Boolean) || "",
    voidReason: rawRows.map((row) => logisticsExpenseBillRecord(row).voidReason || "").find(Boolean) || "",
    voidRemark: rawRows.map((row) => logisticsExpenseBillRecord(row).voidRemark || "").find(Boolean) || "",
    submittedAt: items.map((item) => item.submittedAt).find(Boolean) || null,
    reviewedBy: items.map((item) => item.reviewedBy).find((item) => item?.name),
    reviewedAt: items.map((item) => item.reviewedAt).find(Boolean) || null,
    reviewRemark: items.map((item) => item.reviewRemark || "").find(Boolean) || "",
    rejectReason: items.map((item) => item.rejectReason || "").find(Boolean) || "",
    invoiceNotifiedAt: items.map((item) => item.invoiceNotifiedAt).find(Boolean) || null,
    invoiceNotificationError: items.map((item) => item.invoiceNotificationError || "").find(Boolean) || "",
    itemCount: items.length,
    billCount: bills.length,
    shipmentBillIds: billIds,
    invoiceGroups,
    items,
    order: first.order || {},
    updatedAt: rows.reduce((latest, row) => {
      const dateValue = logisticsExpenseBillRecord(row).updatedAt || row.updatedAt || row.createdAt || 0;
      const time = new Date(dateValue instanceof Date || typeof dateValue === "string" || typeof dateValue === "number" ? dateValue : 0).getTime();
      return time > latest ? time : latest;
    }, 0),
  };
}

export type LogisticsExpenseShipmentDto = ReturnType<typeof serializeLogisticsExpenseShipment>;

export function groupLogisticsExpensesByShipment(rows: LogisticsExpenseLike[] = []) {
  const groups = new Map<string, LogisticsExpenseLike[]>();
  for (const row of rows) {
    const orderSummary = logisticsExpenseOrderSummary(row.order || {});
    const shipmentNo = nonEmpty(orderSummary.orderNo || row.orderId || orderSummary.blNo || "unknown");
    const key = row.orderId || orderSummary.orderId || shipmentNo;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return Array.from(groups.values()).map(serializeLogisticsExpenseShipment).sort(compareLogisticsExpenseBillsForDisplay);
}

export function logisticsExpenseBillId(expense: LogisticsExpenseLike = {}) {
  const directBillId = nonEmpty(expense.billId || logisticsExpenseBillRecord(expense).id);
  if (directBillId) return directBillId;
  const orderSummary = expense.order?.orderId ? expense.order : logisticsExpenseOrderSummary(expense.order || {});
  const supplierId = nonEmpty(expense.supplierId || logisticsExpenseBillRecord(expense).supplierId);
  const legacyKey = [orderSummary.blNo || orderSummary.billOfLadingNo || orderSummary.orderNo || "no-bl", supplierId].filter(Boolean).join("::");
  return `bill:${expense.orderId || orderSummary.orderId || "order"}:${legacyKey || "no-bl"}`;
}

export function groupLogisticsExpensesByBill(rows: LogisticsExpenseLike[] = []) {
  const groups = new Map<string, LogisticsExpenseLike[]>();
  for (const row of rows) {
    const orderSummary = logisticsExpenseOrderSummary(row.order || {});
    const key = row.billId || logisticsExpenseBillRecord(row).id || [
      row.orderId || orderSummary.orderId || "",
      orderSummary.blNo || orderSummary.billOfLadingNo || orderSummary.orderNo || "",
      row.supplierId || logisticsExpenseBillRecord(row).supplierId || "",
    ].join("::");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return Array.from(groups.values()).map(serializeLogisticsExpenseBill).sort(compareLogisticsExpenseBillsForDisplay);
}

export function compareLogisticsExpenseBillsForDisplay(left: UnknownRecord = {}, right: UnknownRecord = {}) {
  return logisticsExpenseBillSortRank(left) - logisticsExpenseBillSortRank(right)
    || logisticsExpenseBillUpdatedAtValue(right) - logisticsExpenseBillUpdatedAtValue(left);
}

export function logisticsExpenseBillSortRank(bill: UnknownRecord = {}) {
  const auditStatus = normalizedLogisticsExpenseSortStatus(nonEmpty(bill.auditStatus || "草稿"));
  if (["草稿", "已驳回", "待审核"].includes(auditStatus)) return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[auditStatus];
  const invoiceStatus = normalizedLogisticsExpenseSortStatus(nonEmpty(bill.invoiceStatus || "待开票"));
  const paymentStatus = normalizedLogisticsExpenseSortStatus(nonEmpty(bill.paymentStatus || "待开票"));
  const invoiceRank = LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[invoiceStatus];
  if (Number.isFinite(invoiceRank) && invoiceRank < LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票) return invoiceRank;
  if (["部分付款", "部分已付款"].includes(paymentStatus)) return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.部分付款;
  if (paymentStatus === "已付款") return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已付款;
  if (Number.isFinite(invoiceRank) && invoiceRank === LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票) return invoiceRank;
  const paymentRank = LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[paymentStatus];
  if (Number.isFinite(paymentRank)) return paymentRank;
  return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[auditStatus] || 999;
}

function normalizedLogisticsExpenseSortStatus(value = "") {
  const text = String(value || "").trim();
  if (text === "部分上传") return "部分上传发票";
  if (text === "部分已付款") return "部分付款";
  if (text === "已确认发票") return "已确认";
  return text || "草稿";
}

function logisticsExpenseBillUpdatedAtValue(bill: UnknownRecord = {}) {
  const value = bill.updatedAt || bill.createdAt || 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const dateValue = value instanceof Date || typeof value === "string" || typeof value === "number" ? value : 0;
  const time = new Date(dateValue).getTime();
  return Number.isFinite(time) ? time : 0;
}
