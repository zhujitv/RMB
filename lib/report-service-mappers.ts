import { logServerError, codedError } from "./platform-db";
import { logisticsCostTypeLabel } from "./platform/logistics-cost-types";
import {
  dateOnly,
  displayCustomerName,
  moneyNumber,
  nonEmptyText,
  reportRecord,
  text,
  toReportDate,
  type BusinessReportRow,
  type DomesticLogisticsReportOrder,
  type MissingCostItem,
  type ReportFilters,
  type ReportRow,
  type ReportType,
} from "./report-service-shared";

export function domesticLogisticsColumns(order: DomesticLogisticsReportOrder = {}) {
  const info = order.domesticLogisticsInfo || order.documentCompleteness?.domesticLogistics?.info || {};
  return {
    domesticTransportType: info.transportTypeLabel || "",
    truckPlateNo: info.truckPlateNo || "",
    trailerPlateNo: info.trailerPlateNo || "",
    departurePlace: info.departurePlace || "",
    destinationPlace: info.destinationPlace || "",
    departureDate: info.departureDate || "",
    cargoDescription: info.cargoDescription || "",
    expressTrackingNo: info.expressTrackingNo || "",
    exportInvoiceRemark: info.invoiceRemark || info.remarkText || "",
    domesticSubmitterRole: info.submitterRole || "",
    domesticSubmittedBy: info.submittedByName || "",
    domesticSubmittedAt: info.submittedAt || "",
  };
}

export function orderToReceivable(order: BusinessReportRow) {
  const customer = reportRecord(order.customer);
  return {
    id: order.id,
    orderId: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "待发货",
    customerName: displayCustomerName(order.customerName || order.customerShortName || order.customerNameSnapshot || customer.name || ""),
    customerFullName: displayCustomerName(order.customerFullName || order.customerNameSnapshot || customer.name || ""),
    customerShortName: displayCustomerName(order.customerShortName || ""),
    businessEntityId: order.businessEntityId || "",
    businessEntityName: order.businessEntityName || order.businessEntityNameSnapshot || "",
    businessEntityShortName: order.businessEntityShortName || "",
    businessEntityDisplayName: order.businessEntityDisplayName || order.businessEntityShortName || order.businessEntityName || order.businessEntityNameSnapshot || "",
    businessEntityIsDefault: typeof order.businessEntityIsDefault === "boolean"
      ? order.businessEntityIsDefault
      : (reportRecord(order.businessEntity).isDefault === false ? false : true),
    salespersonName: order.salespersonName,
    country: order.country,
    currency: order.currency,
    exchangeRate: Number(order.exchangeRate || 0),
    finalReceivableAmount: order.finalReceivableAmount,
    finalReceivableAmountCny: moneyNumber(order.finalReceivableAmountCny),
    receivedAmount: moneyNumber(order.summary?.confirmedPaymentsAmount),
    receivedAmountCny: moneyNumber(order.summary?.confirmedPaymentsCny),
    outstandingAmount: moneyNumber(order.summary?.outstandingAmount),
    outstandingCny: moneyNumber(order.summary?.outstandingCny),
    dueDate: order.dueDate,
    status: order.status,
    taxRefundStatus: order.taxRefundStatus,
    taxArchived: Boolean(order.taxArchived || order.taxRefundStatus === "SUBMITTED"),
    customsDeclarationNo: order.customsDeclarationNo || "",
    customsDeclarationDate: toReportDate(order.customsDeclarationDate),
    date: order.createdAt,
    createdAt: order.createdAt,
    ...domesticLogisticsColumns(order),
  };
}

export function orderToProfit(order: BusinessReportRow) {
  return {
    ...orderToReceivable(order),
    receivableCny: moneyNumber(order.summary?.receivableCny),
    receivedAmountCny: moneyNumber(order.summary?.arrivedPaymentsCny),
    totalCostCny: moneyNumber(order.summary?.confirmedTotalCostCny ?? order.summary?.totalCostCny),
    expectedGrossProfit: moneyNumber(order.summary?.expectedGrossProfit),
    expectedGrossMargin: order.summary?.expectedGrossMargin == null ? "--" : `${((Number(order.summary.expectedGrossMargin || 0)) * 100).toFixed(2)}%`,
    realizedGrossProfit: order.summary?.realizedGrossProfit == null ? "--" : moneyNumber(order.summary.realizedGrossProfit),
    realizedGrossMargin: order.summary?.realizedGrossMargin == null ? "--" : `${((Number(order.summary.realizedGrossMargin || 0)) * 100).toFixed(2)}%`,
    netCashFlowCny: moneyNumber(order.summary?.netCashFlowCny),
  };
}

export function orderToCommission(order: BusinessReportRow) {
  return {
    ...orderToReceivable(order),
    commissionRate: `${Number(order.salespersonCommissionRate || order.commissionRate || 0).toFixed(2)}%`,
    receivedAmountCny: moneyNumber(order.summary?.arrivedPaymentsCny),
    logisticsCostCny: moneyNumber(order.summary?.logisticsCostCny),
    commissionBaseCny: moneyNumber(order.summary?.commissionBaseCny),
    commissionAmountCny: moneyNumber(order.summary?.commissionAmountCny ?? order.summary?.estimatedCommissionCny),
    commissionStatus: order.commissionStatus,
    commissionSettledAt: order.commissionSettledAt,
  };
}

export function orderToOverdue(order: BusinessReportRow) {
  return {
    ...orderToReceivable(order),
    reminderStatus: order.summary?.reminderStatus,
    overdueDays: order.summary?.overdueDays || 0,
  };
}

function missingCostItems(value: unknown): MissingCostItem[] {
  return Array.isArray(value) ? value as MissingCostItem[] : [];
}

export function orderToTaxRefund(order: BusinessReportRow) {
  const customer = reportRecord(order.customer);
  const completeness = order.documentCompleteness || {};
  const factory = (completeness.factory || completeness.supplier || {}) as ReportRow;
  const logistics = (completeness.logistics || {}) as ReportRow;
  const missingDetail = (items: MissingCostItem[] = []) => items.map((item) => (
    `${item.costType || "-"} / ${item.supplierName || "-"} / ${item.currency || "CNY"} ${Number(item.amount || 0).toFixed(2)}`
  )).join("；");
  return {
    ...orderToReceivable(order),
    customerName: displayCustomerName(order.customerFullName || order.customerNameSnapshot || customer.name || order.customerName || ""),
    taxRefundStatus: order.taxRefundStatus,
    taxRefundStatusLabel: order.taxRefundStatusLabel,
    taxArchived: Boolean(order.taxArchived || order.taxRefundStatus === "SUBMITTED"),
    customsDeclarationNo: order.customsDeclarationNo || "",
    customsDeclarationDate: toReportDate(order.customsDeclarationDate),
    customsCompleteness: `${completeness.customs?.completed || 0}/${completeness.customs?.total || 3}`,
    exportCompleteness: `${completeness.export?.completed || 0}/${completeness.export?.total || 5}`,
    factoryCompleteness: factory.missingFactoryCost
      ? "0/2（未录入产品供应商）"
      : `${factory.completed || 0}/${Math.max(2, Number(factory.total || 0))}`,
    supplierCompleteness: factory.missingFactoryCost
      ? "0/2（未录入产品供应商）"
      : `${factory.completed || 0}/${Math.max(2, Number(factory.total || 0))}`,
    logisticsInvoiceCompleteness: `${logistics.completed || 0}/${logistics.total || 0}`,
    domesticLogisticsCompleteness: `${completeness.domesticLogistics?.completed || 0}/${completeness.domesticLogistics?.total || 1}`,
    missingLogisticsInvoices: missingDetail(missingCostItems(logistics.missingLogisticsInvoices)),
    missingCustomsInvoices: missingDetail(missingCostItems(logistics.missingCustomsInvoices)),
    missingPortInvoices: missingDetail(missingCostItems(logistics.missingPortInvoices)),
    overallCompleteness: `${completeness.completed || 0}/${completeness.total || 0}`,
  };
}

export function paymentToRow(payment: ReportRow) {
  const customer = reportRecord(payment.customer);
  return {
    ...payment,
    customerName: displayCustomerName(payment.customerName || payment.customerShortName || customer.name || ""),
    customerFullName: displayCustomerName(payment.customerFullName || customer.name || ""),
    customerShortName: displayCustomerName(payment.customerShortName || ""),
    date: payment.paymentDate,
    paymentStatus: payment.status,
  };
}

export function costToRow(cost: ReportRow) {
  const customer = reportRecord(cost.customer);
  return {
    ...cost,
    costType: logisticsCostTypeLabel(String(cost.costType || "")) || cost.costType,
    costTypeRaw: cost.costType,
    customerName: displayCustomerName(cost.customerName || cost.customerShortName || customer.name || ""),
    customerFullName: displayCustomerName(cost.customerFullName || customer.name || ""),
    customerShortName: displayCustomerName(cost.customerShortName || ""),
    date: cost.paymentDate || cost.createdAt,
  };
}

function reportRecordId(value: unknown) {
  const row = reportRecord(value);
  return text(row.id || row.orderId || row.paymentId || row.costId || row.orderNo || "").slice(0, 80);
}

export function safeMapReportRows<T>(items: T[], type: ReportType, mapper: (item: T) => ReportRow) {
  const rows: ReportRow[] = [];
  items.forEach((item, index) => {
    try {
      rows.push(mapper(item));
    } catch (error) {
      logServerError("报表记录转换失败，已跳过单条异常数据", error, {
        reportType: type,
        rowIndex: index,
        rowId: reportRecordId(item),
      });
    }
  });
  return rows;
}

export function reportQueryForBaseRows(type: ReportType, query: URLSearchParams, filters: ReportFilters) {
  const next = new URLSearchParams(query);
  const archiveScope = nonEmptyText(filters.archiveScope || filters.businessScope || query.get("archiveScope") || query.get("businessScope") || "current");
  if (["current", "archive", "all"].includes(archiveScope)) {
    next.set("archiveScope", archiveScope);
    next.set("businessScope", archiveScope);
  }

  const explicitKeyword = nonEmptyText(filters.keyword || query.get("keyword"));
  const focusedSearchTerms = [
    nonEmptyText(filters.customerName || filters.customer),
    nonEmptyText(filters.orderNo),
    nonEmptyText(filters.blNo || filters.billOfLadingNo),
    nonEmptyText(filters.salespersonName || filters.salesperson),
    nonEmptyText(filters.supplierName || filters.supplier),
  ].filter(Boolean);

  // Most list APIs only understand `keyword`; convert a single report-field filter
  // into a backend keyword so the report does not serialize the entire dataset first.
  if (!explicitKeyword && focusedSearchTerms.length === 1) {
    next.set("keyword", focusedSearchTerms[0]);
  } else if (explicitKeyword) {
    next.set("keyword", explicitKeyword);
  }

  // Receivable and profit-style reports never need supplier filtering in the base
  // query; keep that as a report-level filter so unrelated APIs do not reject it.
  if (!["costs"].includes(type)) {
    next.delete("supplierName");
    next.delete("supplier");
  }
  return next;
}

function isDatabaseFieldError(error: unknown) {
  const message = text((error as { message?: unknown } | null)?.message);
  return /Unknown (field|argument)|does not exist|not exist|column .* missing|no such column/i.test(message);
}

export function friendlyReportQueryError(error: unknown, filters: ReportFilters) {
  if (isDatabaseFieldError(error)) {
    return codedError("报表查询失败：数据库字段不存在，请先同步数据库迁移。", 500, "REPORT_DATABASE_FIELD_MISMATCH");
  }
  if (nonEmptyText(filters.customerName || filters.customer)) {
    return codedError("报表查询失败：客户筛选条件异常，请检查客户名称后重试。", 500, "REPORT_CUSTOMER_FILTER_FAILED");
  }
  return codedError("报表查询失败：请稍后重试或联系管理员查看服务器日志。", 500, "REPORT_QUERY_FAILED");
}
