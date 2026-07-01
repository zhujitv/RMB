import { Prisma } from "../generated/prisma/client.js";
import { includeCostRelations } from "./cost-records-shared";
import {
  customerBusinessName,
  customerShortName,
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
  LOGISTICS_EXPENSE_BILL_SORT_PRIORITY,
  LogisticsBillLike,
  LogisticsExpenseLike,
  LogisticsOrderLike,
  UnknownRecord,
  asRecord,
  normalizeBillingMethodValue,
} from "./logistics-expense-access-model";

export function includeLogisticsExpenseRelations() {
  return Prisma.validator<Prisma.LogisticsExpenseInclude>()({
    bill: {
      include: {
        submittedBy: true,
        reviewedBy: true,
        createdBy: true,
        updatedBy: true,
      },
    },
    order: {
      include: {
        customer: true,
        salesperson: true,
        logisticsSuppliers: { include: { supplier: true } },
        domesticLogisticsInfos: {
          include: { transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
          orderBy: [{ updatedAt: "desc" }],
          take: 1,
        },
      },
    },
    supplier: { include: { operatorUsers: true } },
    cost: { include: includeCostRelations() },
    createdBy: true,
    updatedBy: true,
    reviewedBy: true,
    invoiceDocument: { include: { uploadedBy: true, supplier: true, cost: true } },
    invoiceUploadedBy: true,
    invoiceConfirmedBy: true,
  });
}

export function includeLogisticsExpenseListRelations() {
  return Prisma.validator<Prisma.LogisticsExpenseInclude>()({
    bill: {
      include: {
        submittedBy: true,
        reviewedBy: true,
        createdBy: true,
        updatedBy: true,
      },
    },
    order: {
      include: {
        customer: true,
        salesperson: true,
        domesticLogisticsInfos: {
          include: { transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
          orderBy: [{ updatedAt: "desc" }],
          take: 1,
        },
      },
    },
    supplier: true,
    createdBy: true,
    updatedBy: true,
    reviewedBy: true,
    invoiceDocument: { include: { uploadedBy: true, supplier: true } },
    invoiceUploadedBy: true,
    invoiceConfirmedBy: true,
  });
}

export function logisticsExpenseBillOfLadingNo(order: LogisticsOrderLike = {}) {
  return nonEmpty(order.blNo || order.orderNo || "no-bl");
}

export function logisticsExpenseBillKey(orderId: unknown, billOfLadingNo: unknown) {
  const id = nonEmpty(orderId);
  const blNo = nonEmpty(billOfLadingNo || "no-bl").toLowerCase();
  return id ? `${id}::${blNo}` : "";
}

export function logisticsExpenseBillKeyForOrder(order: LogisticsOrderLike = {}) {
  return logisticsExpenseBillKey(order.id, logisticsExpenseBillOfLadingNo(order));
}

export function logisticsExpenseBillRecord(expense: LogisticsExpenseLike = {}): LogisticsBillLike {
  return asRecord(expense.bill) as LogisticsBillLike;
}

export function logisticsExpenseBillField(expense: LogisticsExpenseLike = {}, field: keyof LogisticsBillLike, fallback: unknown = "") {
  const bill = logisticsExpenseBillRecord(expense);
  return bill[field] ?? fallback;
}

export function logisticsExpenseBillAuditStatusValue(expense: LogisticsExpenseLike = {}) {
  return nonEmpty(logisticsExpenseBillRecord(expense).auditStatus || "草稿");
}

export function logisticsExpenseBillInvoiceStatusValue(expense: LogisticsExpenseLike = {}) {
  return nonEmpty(logisticsExpenseBillRecord(expense).invoiceStatus || "待开票");
}

export function logisticsExpenseBillPaymentStatusValue(expense: LogisticsExpenseLike = {}) {
  return nonEmpty(logisticsExpenseBillRecord(expense).paymentStatus || "待开票");
}

export function logisticsExpenseDetailInvoiceStatusValue(expense: LogisticsExpenseLike = {}) {
  return nonEmpty(expense.detailInvoiceStatus || expense.invoiceStatus || "未通知");
}

export function resolveLogisticsExpenseVesselVoyage(order: LogisticsOrderLike = {}) {
  const info = (order.domesticLogisticsInfos || [])[0] || {};
  const firstItem = (info.transportItems || [])[0] || {};
  const shippingInfo = asRecord(info.shippingInfo || order.shippingInfo);
  const sailingSchedule = asRecord(info.sailingSchedule || order.sailingSchedule);
  const containerShipment = asRecord(info.containerShipment || order.containerShipment);
  return nonEmpty(
    order.vesselVoyage ||
    order.vessel_voyage ||
    info.vesselVoyage ||
    info.vessel_voyage ||
    firstItem.vesselVoyage ||
    firstItem.vessel_voyage ||
    shippingInfo.vesselVoyage ||
    shippingInfo.vessel_voyage ||
    sailingSchedule.vesselVoyage ||
    sailingSchedule.vessel_voyage ||
    containerShipment.vesselVoyage ||
    containerShipment.vessel_voyage
  );
}

export function logisticsExpenseOrderSummary(order: LogisticsOrderLike = {}) {
  const info = (order.domesticLogisticsInfos || [])[0] || {};
  const firstItem = (info.transportItems || [])[0] || {};
	  const transportItems = (info.transportItems || []).map((item) => ({
	    id: item.id || "",
	    containerNo: item.containerNo || "",
	    containerType: item.containerType || item.container_type || "",
	    sealNo: item.sealNo || item.seal_no || "",
	    truckPlateNo: item.truckPlateNo || "",
    departureDate: dateToInput(dateFromInput(item.departureDate)),
    departurePlace: item.departurePlace || "",
    arrivalPlace: item.arrivalPlace || "",
    cargoName: item.cargoName || "",
  }));
  const containerNos = transportItems.map((item) => item.containerNo).filter(Boolean);
  const containerTypes = [...new Set(transportItems.map((item) => item.containerType).filter(Boolean))];
  return {
    orderId: order.id || "",
    orderNo: order.orderNo || "",
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerShortName: customerShortName(order.customer),
    customerName: customerBusinessName(order.customer, nonEmpty(order.customerNameSnapshot)),
    vesselVoyage: resolveLogisticsExpenseVesselVoyage(order),
    containerType: containerTypes.length === 1 ? containerTypes[0] : "",
    containerTypes,
    port: firstItem.arrivalPlace || info.destinationPlace || "",
    loadingAddress: firstItem.departurePlace || info.departurePlace || "",
    sailingDate: dateToInput(dateFromInput(firstItem.departureDate || info.departureDate || order.actualShipmentDate || order.blDate || order.expectedShipmentDate)),
    truckPlateNo: firstItem.truckPlateNo || info.truckPlateNo || "",
    cargoName: firstItem.cargoName || info.cargoDescription || "",
    transportItems,
    containerNos,
    containerCount: containerNos.length || transportItems.length || 0,
  };
}

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
    const includedFeeTypes = [...new Set(groupItems
      .map((item) => nonEmpty(item.costType))
      .filter(Boolean))];
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
    paymentStatus: bill.paymentStatus || "待开票",
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
  return Array.from(groups.values())
    .map(serializeLogisticsExpenseShipment)
    .sort(compareLogisticsExpenseBillsForDisplay);
}

export function logisticsExpenseBillId(expense: LogisticsExpenseLike = {}) {
  const directBillId = nonEmpty(expense.billId || logisticsExpenseBillRecord(expense).id);
  if (directBillId) return directBillId;
  const orderSummary = expense.order?.orderId ? expense.order : logisticsExpenseOrderSummary(expense.order || {});
  return `bill:${expense.orderId || orderSummary.orderId || "order"}:${orderSummary.blNo || orderSummary.billOfLadingNo || orderSummary.orderNo || "no-bl"}`;
}

export function groupLogisticsExpensesByBill(rows: LogisticsExpenseLike[] = []) {
  const groups = new Map<string, LogisticsExpenseLike[]>();
  for (const row of rows) {
    const orderSummary = logisticsExpenseOrderSummary(row.order || {});
    const key = row.billId || logisticsExpenseBillRecord(row).id || [row.orderId || orderSummary.orderId || "", orderSummary.blNo || orderSummary.billOfLadingNo || orderSummary.orderNo || ""].join("::");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return Array.from(groups.values())
    .map(serializeLogisticsExpenseBill)
    .sort(compareLogisticsExpenseBillsForDisplay);
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
