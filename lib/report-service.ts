import JSZip from "jszip";
import {
  apiError,
  assertRead,
  canRead,
  codedError,
  getActor,
  getProfitAnalysis,
  getReminders,
  listCosts,
  listOrders,
  listPayments,
  parseJsonBody,
} from "./platform-db";
import type { AccessUser } from "./platform/shared-access";
import { logisticsCostTypeLabel } from "./platform/logistics-cost-types";

export const REPORT_TYPES = {
  receivables: { label: "应收订单明细", area: "orders", filename: "receivable-orders" },
  payments: { label: "收款明细", area: "payments", filename: "payments" },
  costs: { label: "成本明细", area: "costs", filename: "order-costs" },
  profits: { label: "利润分析", area: "commissions", filename: "profit-analysis" },
  commissions: { label: "业务员提成", area: "commissions", filename: "salesperson-commissions" },
  overdue: { label: "逾期催款", area: "orders", filename: "payment-reminders" },
  "tax-refunds": { label: "退税资料", area: "taxRefund", filename: "tax-refund-materials" },
};

type ReportType = keyof typeof REPORT_TYPES;
type ReportRow = Record<string, unknown>;
type ReportFilterKey =
  | "keyword"
  | "customerName"
  | "customer"
  | "orderNo"
  | "blNo"
  | "billOfLadingNo"
  | "salespersonName"
  | "salesperson"
  | "supplierName"
  | "supplier"
  | "currency"
  | "orderStatus"
  | "paymentStatus"
  | "costType"
  | "taxRefundStatus"
  | "archiveScope"
  | "businessScope"
  | "declarationMonth"
  | "dateFrom"
  | "dateTo";
type ReportFilters = Partial<Record<ReportFilterKey, unknown>>;
type ActorLike = AccessUser;
type ReportColumn = { key: string; label: string };
type ReportColumnTuple = [key: string, label: string];
type ReportQueryOptions = {
  filters?: ReportFilters;
  page?: number | string;
  pageSize?: number | string;
  sortBy?: string;
  sortDir?: string;
  selectedIds?: string[];
  noPagination?: boolean;
};
type DomesticLogisticsReportOrder = ReportRow & {
  domesticLogisticsInfo?: ReportRow | null;
  documentCompleteness?: {
    domesticLogistics?: {
      info?: ReportRow | null;
    };
  };
};
type MissingCostItem = {
  costType?: string;
  supplierName?: string;
  currency?: string;
  amount?: number | string;
};
type CompletenessReport = ReportRow & {
  factory?: ReportRow;
  supplier?: ReportRow;
  logistics?: ReportRow;
  customs?: ReportRow;
  export?: ReportRow;
  domesticLogistics?: ReportRow;
  completed?: unknown;
  total?: unknown;
};
type BusinessReportRow = DomesticLogisticsReportOrder & {
  customer?: ReportRow;
  summary?: ReportRow;
  documentCompleteness?: CompletenessReport;
};

function reportTypeFrom(value: unknown): ReportType {
  const type = text(value) as ReportType;
  if (!REPORT_TYPES[type]) throw codedError("请选择有效报表类型", 400, "REPORT_TYPE_INVALID");
  return type;
}

function recordFrom(value: unknown): ReportFilters {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ReportFilters : {};
}

function reportRecord(value: unknown): ReportRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ReportRow : {};
}

function stringArrayFrom(value: unknown) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function text(value: unknown) {
  return String(value ?? "");
}

function lower(value: unknown) {
  return text(value).trim().toLowerCase();
}

function displayCustomerName(value: unknown, fallback = "") {
  const textValue = text(value).trim();
  return textValue ? textValue.toUpperCase() : fallback;
}

function dateOnly(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return text(value).slice(0, 10);
}

function toReportDate(value: unknown) {
  return dateOnly(value);
}

function inDateRange(row: ReportRow, from: string, to: string) {
  if (!from && !to) return true;
  const dates = [row.date, row.createdAt, row.updatedAt, row.paymentDate, row.dueDate, row.blDate, row.uploadedAt]
    .map(dateOnly)
    .filter(Boolean);
  if (!dates.length) return true;
  return dates.some((date) => (!from || date >= from) && (!to || date <= to));
}

function filterRows(rows: ReportRow[], filters: ReportFilters = {}) {
  const keyword = lower(filters.keyword);
  const customer = lower(filters.customerName || filters.customer);
  const orderNo = lower(filters.orderNo);
  const blNo = lower(filters.blNo || filters.billOfLadingNo);
  const salesperson = lower(filters.salespersonName || filters.salesperson);
  const supplier = lower(filters.supplierName || filters.supplier);
  const currency = text(filters.currency);
  const orderStatus = text(filters.orderStatus);
  const paymentStatus = text(filters.paymentStatus);
  const costType = text(filters.costType);
  const taxRefundStatus = text(filters.taxRefundStatus);
  const archiveScope = text(filters.archiveScope || filters.businessScope || "current");
  const declarationMonth = text(filters.declarationMonth);
  const dateFrom = dateOnly(filters.dateFrom);
  const dateTo = dateOnly(filters.dateTo);
  return rows.filter((row) => {
    const blob = lower([
      row.orderNo,
      row.blNo,
      row.billOfLadingNo,
      row.customerName,
      row.customerFullName,
      row.customerShortName,
      row.supplierName,
      row.salespersonName,
      row.country,
      row.currency,
      row.status,
      row.paymentStatus,
      row.taxRefundStatusLabel,
      row.costType,
    ].join(" "));
    if (!inDateRange(row, dateFrom, dateTo)) return false;
    if (keyword && !blob.includes(keyword)) return false;
    if (customer && !lower([row.customerName, row.customerFullName, row.customerShortName].join(" ")).includes(customer)) return false;
    if (orderNo && !lower(row.orderNo).includes(orderNo)) return false;
    if (blNo && !lower(row.blNo || row.billOfLadingNo).includes(blNo)) return false;
    if (salesperson && !lower(row.salespersonName).includes(salesperson)) return false;
    if (supplier && !lower(row.supplierName).includes(supplier)) return false;
    if (currency && row.currency !== currency) return false;
    if (orderStatus && row.status !== orderStatus && row.orderStatus !== orderStatus) return false;
    if (paymentStatus && row.paymentStatus !== paymentStatus && row.status !== paymentStatus) return false;
    if (costType && row.costType !== costType && row.costTypeRaw !== costType) return false;
    if (taxRefundStatus && row.taxRefundStatus !== taxRefundStatus) return false;
    if (archiveScope === "current" && row.taxArchived === true) return false;
    if (archiveScope === "archive" && row.taxArchived !== true) return false;
    if (declarationMonth && !dateOnly(row.customsDeclarationDate).startsWith(declarationMonth)) return false;
    return true;
  });
}

function sortRows(rows: ReportRow[], sortBy = "", sortDir = "asc") {
  if (!sortBy) return rows;
  const dir = sortDir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    const an = Number(av);
    const bn = Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
    return text(av).localeCompare(text(bv), "zh-Hans-CN") * dir;
  });
}

function pageRows(rows: ReportRow[], page: number | string = 1, pageSize: number | string = 20) {
  const current = Math.max(1, Math.round(Number(page) || 1));
  const size = Math.min(200, Math.max(1, Math.round(Number(pageSize) || 20)));
  return {
    rows: rows.slice((current - 1) * size, current * size),
    pagination: {
      page: current,
      pageSize: size,
      total: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / size)),
    },
  };
}

function moneyNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

const columnSets = {
  receivables: [
    ["orderNo", "订单号"], ["blNo", "提单号"], ["customerName", "客户简称"], ["salespersonName", "业务员"], ["currency", "币种"], ["exchangeRate", "汇率"], ["finalReceivableAmount", "原币应收金额"], ["finalReceivableAmountCny", "折人民币应收金额"], ["receivedAmount", "已收原币金额"], ["receivedAmountCny", "已收折人民币"], ["outstandingAmount", "未收原币金额"], ["outstandingCny", "未收折人民币"], ["dueDate", "到期日"], ["status", "订单状态"], ["domesticTransportType", "运输方式"], ["truckPlateNo", "车牌号"], ["trailerPlateNo", "挂车车牌"], ["departurePlace", "起运地"], ["destinationPlace", "到达地"], ["departureDate", "起运日期"], ["cargoDescription", "运输货物名称"], ["expressTrackingNo", "快递单号"], ["exportInvoiceRemark", "出口发票备注"], ["domesticSubmitterRole", "录入来源"], ["domesticSubmittedBy", "录入人"], ["domesticSubmittedAt", "录入时间"],
  ],
  payments: [
    ["orderNo", "订单号"], ["customerName", "客户简称"], ["paymentDate", "收款日期"], ["paymentType", "收款类型"], ["currency", "币种"], ["amount", "原币收款金额"], ["exchangeRate", "汇率"], ["amountCny", "折人民币金额"], ["status", "收款状态"], ["bankReference", "银行流水号"],
  ],
  costs: [
    ["orderNo", "订单号"], ["customerName", "客户简称"], ["costType", "成本类型"], ["supplierName", "供应商"], ["supplierType", "供应商类型"], ["currency", "币种"], ["amount", "原币成本金额"], ["exchangeRate", "汇率"], ["amountCny", "折人民币金额"], ["paymentStatus", "付款状态"], ["invoiceStatus", "发票状态"],
  ],
  profits: [
    ["orderNo", "订单号"], ["customerName", "客户简称"], ["salespersonName", "业务员"], ["receivableCny", "最终应收人民币"], ["receivedAmountCny", "已到账金额"], ["outstandingCny", "未收人民币"], ["totalCostCny", "总成本"], ["expectedGrossProfit", "预计毛利"], ["expectedGrossMargin", "预计毛利率"], ["realizedGrossProfit", "已实现毛利"], ["realizedGrossMargin", "已实现毛利率"], ["status", "订单状态"], ["destinationPlace", "到达地"], ["cargoDescription", "运输货物名称"],
  ],
  commissions: [
    ["orderNo", "订单号"], ["customerName", "客户简称"], ["salespersonName", "业务员"], ["commissionRate", "提成比例"], ["receivedAmountCny", "已到账收款"], ["logisticsCostCny", "物流成本"], ["commissionBaseCny", "提成基数"], ["commissionAmountCny", "提成金额"], ["commissionStatus", "提成状态"], ["commissionSettledAt", "结算时间"], ["destinationPlace", "到达地"], ["cargoDescription", "运输货物名称"],
  ],
  overdue: [
    ["orderNo", "订单号"], ["blNo", "提单号"], ["customerName", "客户简称"], ["salespersonName", "业务员"], ["dueDate", "到期日"], ["outstandingCny", "未收人民币"], ["reminderStatus", "逾期状态"], ["overdueDays", "逾期天数"], ["destinationPlace", "到达地"], ["cargoDescription", "运输货物名称"],
  ],
  "tax-refunds": [
    ["orderNo", "订单号"], ["blNo", "提单号"], ["customerName", "客户名称"], ["customsDeclarationNo", "报关单号"], ["customsDeclarationDate", "申报日期"], ["currency", "币种"], ["finalReceivableAmountCny", "最终应收人民币"], ["receivedAmountCny", "已收人民币"], ["customsCompleteness", "报关资料完整度"], ["exportCompleteness", "出口资料完整度"], ["domesticLogisticsCompleteness", "物流信息完整度"], ["factoryCompleteness", "工厂资料完整度"], ["logisticsInvoiceCompleteness", "物流资料完整度"], ["overallCompleteness", "总体完整度"], ["missingLogisticsInvoices", "缺失拖车费发票明细"], ["missingCustomsInvoices", "缺失报关费发票明细"], ["missingPortInvoices", "缺失港杂费发票明细"], ["taxRefundStatusLabel", "退税状态"], ["domesticTransportType", "运输方式"], ["truckPlateNo", "车牌号"], ["trailerPlateNo", "挂车车牌"], ["departurePlace", "起运地"], ["destinationPlace", "到达地"], ["departureDate", "起运日期"], ["cargoDescription", "运输货物名称"], ["expressTrackingNo", "快递单号"], ["exportInvoiceRemark", "出口发票备注"], ["domesticSubmitterRole", "录入来源"], ["domesticSubmittedBy", "录入人"], ["domesticSubmittedAt", "录入时间"],
  ],
} satisfies Record<ReportType, ReportColumnTuple[]>;

function columnsFor(type: ReportType): ReportColumn[] {
  return (columnSets[type] || columnSets.receivables).map(([key, label]) => ({ key, label }));
}

function domesticLogisticsColumns(order: DomesticLogisticsReportOrder = {}) {
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
    exportInvoiceRemark: info.remarkText || "",
    domesticSubmitterRole: info.submitterRole || "",
    domesticSubmittedBy: info.submittedByName || "",
    domesticSubmittedAt: info.submittedAt || "",
  };
}

function orderToReceivable(order: BusinessReportRow) {
  const customer = reportRecord(order.customer);
  return {
    id: order.id,
    orderId: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "待发货",
    customerName: displayCustomerName(order.customerName || order.customerShortName || order.customerNameSnapshot || customer.name || ""),
    customerFullName: displayCustomerName(order.customerFullName || order.customerNameSnapshot || customer.name || ""),
    customerShortName: displayCustomerName(order.customerShortName || ""),
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

function orderToProfit(order: BusinessReportRow) {
  return {
    ...orderToReceivable(order),
    receivableCny: moneyNumber(order.summary?.receivableCny),
    receivedAmountCny: moneyNumber(order.summary?.arrivedPaymentsCny),
    totalCostCny: moneyNumber(order.summary?.confirmedTotalCostCny ?? order.summary?.totalCostCny),
    expectedGrossProfit: moneyNumber(order.summary?.expectedGrossProfit),
    expectedGrossMargin: order.summary?.expectedGrossMargin == null ? "--" : `${((Number(order.summary.expectedGrossMargin || 0)) * 100).toFixed(2)}%`,
    realizedGrossProfit: moneyNumber(order.summary?.realizedGrossProfit ?? order.summary?.actualGrossProfit),
    realizedGrossMargin: order.summary?.realizedGrossMargin == null ? "--" : `${((Number(order.summary.realizedGrossMargin || 0)) * 100).toFixed(2)}%`,
  };
}

function orderToCommission(order: BusinessReportRow) {
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

function orderToOverdue(order: BusinessReportRow) {
  return {
    ...orderToReceivable(order),
    reminderStatus: order.summary?.reminderStatus,
    overdueDays: order.summary?.overdueDays || 0,
  };
}

function missingCostItems(value: unknown): MissingCostItem[] {
  return Array.isArray(value) ? value as MissingCostItem[] : [];
}

function orderToTaxRefund(order: BusinessReportRow) {
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
      ? "0/2（未录入工厂供应商）"
      : `${factory.completed || 0}/${Math.max(2, Number(factory.total || 0))}`,
    supplierCompleteness: factory.missingFactoryCost
      ? "0/2（未录入工厂供应商）"
      : `${factory.completed || 0}/${Math.max(2, Number(factory.total || 0))}`,
    logisticsInvoiceCompleteness: `${logistics.completed || 0}/${logistics.total || 0}`,
    domesticLogisticsCompleteness: `${completeness.domesticLogistics?.completed || 0}/${completeness.domesticLogistics?.total || 1}`,
    missingLogisticsInvoices: missingDetail(missingCostItems(logistics.missingLogisticsInvoices)),
    missingCustomsInvoices: missingDetail(missingCostItems(logistics.missingCustomsInvoices)),
    missingPortInvoices: missingDetail(missingCostItems(logistics.missingPortInvoices)),
    overallCompleteness: `${completeness.completed || 0}/${completeness.total || 0}`,
  };
}

function paymentToRow(payment: ReportRow) {
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

function costToRow(cost: ReportRow) {
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

async function baseRows(type: ReportType, query: URLSearchParams, actor: ActorLike): Promise<ReportRow[]> {
  if (!REPORT_TYPES[type]) {
    throw codedError("请选择有效报表类型", 400, "REPORT_TYPE_INVALID");
  }
  assertRead(actor, "reports");
  const area = REPORT_TYPES[type].area;
  assertRead(actor, area);
  if (type === "payments") return (await listPayments(query, actor)).map(paymentToRow);
  if (type === "costs") return (await listCosts(query, actor)).map(costToRow);
  if (type === "overdue") return (await getReminders(query, actor)).map(orderToOverdue);
  if (type === "profits") return (await getProfitAnalysis(query, actor)).map(orderToProfit);
  if (type === "commissions") return (await getProfitAnalysis(query, actor)).map(orderToCommission);
  if (type === "tax-refunds") return (await listOrders(query, actor)).map(orderToTaxRefund);
  return (await listOrders(query, actor)).map(orderToReceivable);
}

function queryFilters(query: URLSearchParams) {
  return {
    dateFrom: query.get("dateFrom") || "",
    dateTo: query.get("dateTo") || "",
    customerName: query.get("customerName") || "",
    orderNo: query.get("orderNo") || "",
    blNo: query.get("blNo") || "",
    currency: query.get("currency") || "",
    salespersonName: query.get("salespersonName") || "",
    supplierName: query.get("supplierName") || "",
    orderStatus: query.get("orderStatus") || "",
    paymentStatus: query.get("paymentStatus") || "",
    costType: query.get("costType") || "",
    taxRefundStatus: query.get("taxRefundStatus") || "",
    declarationMonth: query.get("declarationMonth") || "",
    archiveScope: query.get("archiveScope") || query.get("businessScope") || "current",
    keyword: query.get("keyword") || "",
  };
}

export async function queryReport(typeInput: unknown, query: URLSearchParams, actor: ActorLike, options: ReportQueryOptions = {}) {
  const type = reportTypeFrom(typeInput);
  const filters = options.filters || queryFilters(query);
  const page = options.page || query.get("page") || 1;
  const pageSize = options.pageSize || query.get("pageSize") || 20;
  const sortBy = options.sortBy || query.get("sortBy") || "";
  const sortDir = options.sortDir || query.get("sortDir") || "asc";
  const selectedIds = new Set(options.selectedIds || []);
  let rows: ReportRow[] = await baseRows(type, query, actor);
  rows = filterRows(rows, filters);
  if (selectedIds.size) rows = rows.filter((row) => selectedIds.has(String(row.id || "")));
  rows = sortRows(rows, sortBy, sortDir);
  const paged = options.noPagination ? { rows, pagination: { page: 1, pageSize: rows.length, total: rows.length, totalPages: 1 } } : pageRows(rows, page, pageSize);
  return {
    reportType: type,
    label: REPORT_TYPES[type].label,
    columns: columnsFor(type),
    rows: paged.rows,
    pagination: paged.pagination,
    filters,
    sortBy,
    sortDir,
  };
}

function csvCell(value: unknown) {
  let valueText = text(value);
  if (/^[=+\-@]/.test(valueText.trimStart())) {
    valueText = `'${valueText}`;
  }
  return /[",\n]/.test(valueText) ? `"${valueText.replaceAll('"', '""')}"` : valueText;
}

function csvResponse(filename: string, columns: ReportColumn[], rows: ReportRow[]) {
  const header = columns.map((column) => csvCell(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(",")).join("\n");
  return new Response(`\ufeff${header}\n${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}

function xmlCell(value: unknown) {
  return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function excelColumnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

async function xlsxResponse(filename: string, columns: ReportColumn[], rows: ReportRow[]) {
  const values = [columns.map((column) => column.label), ...rows.map((row) => columns.map((column) => row[column.key]))];
  const sheetData = values.map((row, rowIndex) => `
    <row r="${rowIndex + 1}">
      ${row.map((cell, colIndex) => `<c r="${excelColumnName(colIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlCell(cell)}</t></is></c>`).join("")}
    </row>
  `).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.folder("_rels")!.file(".rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl")!.file("workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="报表" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl")!.folder("_rels")!.file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.folder("xl")!.folder("worksheets")!.file("sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`);
  const body = await zip.generateAsync({ type: "uint8array" });
  return new Response(Buffer.from(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}

export async function exportReport(request: Request, actor: ActorLike) {
  assertRead(actor, "reports");
  const body = await parseJsonBody(request);
  const type = reportTypeFrom(body.reportType || "receivables");
  const exportScope = text(body.exportScope) || "allFiltered";
  const format = body.format === "xlsx" ? "xlsx" : "csv";
  const query = new URLSearchParams();
  const filters = recordFrom(body.filters);
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, String(value));
  });
  const result = await queryReport(type, query, actor, {
    filters,
    selectedIds: exportScope === "selected" ? stringArrayFrom(body.selectedIds) : [],
    page: exportScope === "currentPage" ? (text(body.page) || 1) : 1,
    pageSize: exportScope === "currentPage" ? (text(body.pageSize) || 20) : 100000,
    sortBy: text(body.sortBy),
    sortDir: text(body.sortDir) || "asc",
    noPagination: exportScope !== "currentPage",
  });
  if (format === "xlsx") return xlsxResponse(REPORT_TYPES[type].filename, result.columns, result.rows);
  return csvResponse(REPORT_TYPES[type].filename, result.columns, result.rows);
}

export async function reportGetHandler(request: Request, type: unknown) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    return Response.json(await queryReport(type, query, actor));
  } catch (error: unknown) {
    return apiError(error, "查询报表失败");
  }
}
