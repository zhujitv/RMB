import { codedError } from "./platform-db";
import type { AccessUser } from "./platform/shared-access";

export const REPORT_TYPES = {
  receivables: { label: "应收订单明细", area: "orders", filename: "receivable-orders" },
  payments: { label: "收款明细", area: "payments", filename: "payments" },
  costs: { label: "成本明细", area: "costs", filename: "order-costs" },
  profits: { label: "利润分析", area: "commissions", filename: "profit-analysis" },
  commissions: { label: "业务员提成", area: "commissions", filename: "salesperson-commissions" },
  overdue: { label: "逾期催款", area: "orders", filename: "payment-reminders" },
  "tax-refunds": { label: "退税资料", area: "taxRefund", filename: "tax-refund-materials" },
  "customer-analysis": { label: "客户经营分析", area: "commissions", filename: "customer-analysis" },
  "salesperson-performance": { label: "业务员绩效", area: "commissions", filename: "salesperson-performance" },
};

export type ReportType = keyof typeof REPORT_TYPES;
export type ReportRow = Record<string, unknown>;
export type ReportFilterKey =
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
  | "businessEntityId"
  | "businessEntityName"
  | "businessEntity"
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
export type ReportFilters = Partial<Record<ReportFilterKey, unknown>>;
export type ActorLike = AccessUser;
export type ReportColumn = { key: string; label: string };
type ReportColumnTuple = [key: string, label: string];
export type ReportQueryOptions = {
  filters?: ReportFilters;
  page?: number | string;
  pageSize?: number | string;
  sortBy?: string;
  sortDir?: string;
  selectedIds?: string[];
  noPagination?: boolean;
};
export type DomesticLogisticsReportOrder = ReportRow & {
  domesticLogisticsInfo?: ReportRow | null;
  documentCompleteness?: {
    domesticLogistics?: {
      info?: ReportRow | null;
    };
  };
};
export type MissingCostItem = {
  costType?: string;
  supplierName?: string;
  currency?: string;
  amount?: number | string;
};
export type CompletenessReport = ReportRow & {
  factory?: ReportRow;
  supplier?: ReportRow;
  logistics?: ReportRow;
  customs?: ReportRow;
  export?: ReportRow;
  domesticLogistics?: ReportRow;
  completed?: unknown;
  total?: unknown;
};
export type BusinessReportRow = DomesticLogisticsReportOrder & {
  customer?: ReportRow;
  summary?: ReportRow;
  documentCompleteness?: CompletenessReport;
  taxArchived?: boolean | null;
  taxRefundStatus?: string | null;
  taxRefundArchivedAt?: Date | string | null;
  taxSubmittedAt?: Date | string | null;
};

export function reportTypeFrom(value: unknown): ReportType {
  const type = text(value) as ReportType;
  if (!REPORT_TYPES[type]) throw codedError("请选择有效报表类型", 400, "REPORT_TYPE_INVALID");
  return type;
}

export function recordFrom(value: unknown): ReportFilters {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ReportFilters : {};
}

export function reportRecord(value: unknown): ReportRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ReportRow : {};
}

export function stringArrayFrom(value: unknown) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

export function text(value: unknown) {
  return String(value ?? "");
}

export function lower(value: unknown) {
  return text(value).trim().toLowerCase();
}

export function nonEmptyText(value: unknown) {
  return text(value).trim();
}

export function displayCustomerName(value: unknown, fallback = "") {
  const textValue = text(value).trim();
  return textValue ? textValue.toUpperCase() : fallback;
}

export function dateOnly(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return text(value).slice(0, 10);
}

export function toReportDate(value: unknown) {
  return dateOnly(value);
}

function reportBusinessDate(row: ReportRow, type?: ReportType) {
  if (type === "payments") return dateOnly(row.paymentDate || row.createdAt);
  if (type === "costs") return dateOnly(row.createdAt || row.paymentDate);
  if (type === "overdue") return dateOnly(row.dueDate);
  if (type === "tax-refunds") return dateOnly(row.customsDeclarationDate || row.createdAt);
  return dateOnly(row.createdAt || row.date);
}

function inDateRange(row: ReportRow, from: string, to: string, type?: ReportType) {
  if (!from && !to) return true;
  const date = reportBusinessDate(row, type);
  if (!date) return false;
  return (!from || date >= from) && (!to || date <= to);
}

export function filterRows(rows: ReportRow[], filters: ReportFilters = {}, type?: ReportType) {
  const keyword = lower(filters.keyword);
  const customer = lower(filters.customerName || filters.customer);
  const orderNo = lower(filters.orderNo);
  const blNo = lower(filters.blNo || filters.billOfLadingNo);
  const salesperson = lower(filters.salespersonName || filters.salesperson);
  const supplier = lower(filters.supplierName || filters.supplier);
  const businessEntityId = text(filters.businessEntityId);
  const businessEntity = lower(filters.businessEntityName || filters.businessEntity);
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
      row.businessEntityName,
      row.businessEntityNameSnapshot,
      row.businessEntityDisplayName,
      row.businessEntityShortName,
      row.salespersonName,
      row.country,
      row.currency,
      row.status,
      row.paymentStatus,
      row.taxRefundStatusLabel,
      row.costType,
    ].join(" "));
    if (!inDateRange(row, dateFrom, dateTo, type)) return false;
    if (keyword && !blob.includes(keyword)) return false;
    if (customer && !lower([row.customerName, row.customerFullName, row.customerShortName].join(" ")).includes(customer)) return false;
    if (orderNo && !lower(row.orderNo).includes(orderNo)) return false;
    if (blNo && !lower(row.blNo || row.billOfLadingNo).includes(blNo)) return false;
    if (salesperson && !lower(row.salespersonName).includes(salesperson)) return false;
    if (supplier && !lower(row.supplierName).includes(supplier)) return false;
    if (businessEntityId && row.businessEntityId !== businessEntityId) return false;
    if (businessEntity && !lower([row.businessEntityName, row.businessEntityNameSnapshot, row.businessEntityShortName].join(" ")).includes(businessEntity)) return false;
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

export function sortRows(rows: ReportRow[], sortBy = "", sortDir = "asc") {
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

export function pageRows(rows: ReportRow[], page: number | string = 1, pageSize: number | string = 20) {
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

export function moneyNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

const columnSets = {
  receivables: [
    ["orderNo", "订单号"], ["blNo", "提单号"], ["customerName", "客户简称"], ["businessEntityName", "业务主体"], ["salespersonName", "业务员"], ["currency", "币种"], ["exchangeRate", "汇率"], ["finalReceivableAmount", "原币应收金额"], ["finalReceivableAmountCny", "折人民币应收金额"], ["receivedAmount", "已收原币金额"], ["receivedAmountCny", "已收折人民币"], ["outstandingAmount", "未收原币金额"], ["outstandingCny", "未收折人民币"], ["dueDate", "到期日"], ["status", "订单状态"], ["domesticTransportType", "运输方式"], ["truckPlateNo", "车牌号"], ["trailerPlateNo", "挂车车牌"], ["departurePlace", "起运地"], ["destinationPlace", "到达地"], ["departureDate", "起运日期"], ["cargoDescription", "运输货物名称"], ["expressTrackingNo", "快递单号"], ["domesticSubmitterRole", "录入来源"], ["domesticSubmittedBy", "录入人"], ["domesticSubmittedAt", "录入时间"], ["exchangeDifferenceCny", "汇兑差额（收益正/损失负）"],
  ],
  payments: [
    ["orderNo", "订单号"], ["customerName", "客户简称"], ["businessEntityName", "业务主体"], ["paymentDate", "收款日期"], ["paymentType", "收款类型"], ["currency", "币种"], ["amount", "原币收款金额"], ["exchangeRate", "汇率"], ["amountCny", "折人民币金额"], ["status", "收款状态"], ["bankReference", "银行流水号"],
  ],
  costs: [
    ["orderNo", "订单号"], ["customerName", "客户简称"], ["businessEntityName", "业务主体"], ["costType", "成本类型"], ["supplierName", "供应商"], ["supplierType", "供应商类型"], ["currency", "币种"], ["amount", "原币成本金额"], ["exchangeRate", "汇率"], ["amountCny", "折人民币金额"], ["paymentStatus", "付款状态"], ["invoiceStatus", "发票状态"],
  ],
  profits: [
    ["orderNo", "订单号"], ["customerName", "客户简称"], ["businessEntityName", "业务主体"], ["salespersonName", "业务员"], ["receivableCny", "最终应收人民币"], ["receivedAmountCny", "已到账金额"], ["outstandingCny", "未收人民币"], ["totalCostCny", "总成本"], ["expectedGrossProfit", "预计毛利"], ["expectedGrossMargin", "预计毛利率"], ["realizedGrossProfit", "已实现毛利"], ["realizedGrossMargin", "已实现毛利率"], ["netCashFlowCny", "净现金流"], ["status", "订单状态"], ["destinationPlace", "到达地"], ["cargoDescription", "运输货物名称"], ["exchangeDifferenceCny", "汇兑差额（收益正/损失负）"],
  ],
  commissions: [
    ["orderNo", "订单号"], ["customerName", "客户简称"], ["salespersonName", "业务员"], ["commissionRate", "提成比例"], ["receivedAmountCny", "已到账收款"], ["logisticsCostCny", "物流成本"], ["commissionBaseCny", "提成基数"], ["commissionAmountCny", "提成金额"], ["commissionFormula", "结算公式"], ["commissionFormulaVersion", "公式快照版本"], ["commissionStatus", "提成状态"], ["commissionSettledAt", "结算时间"], ["destinationPlace", "到达地"], ["cargoDescription", "运输货物名称"],
  ],
  overdue: [
    ["orderNo", "订单号"], ["blNo", "提单号"], ["customerName", "客户简称"], ["salespersonName", "业务员"], ["dueDate", "到期日"], ["outstandingCny", "未收人民币"], ["reminderStatus", "逾期状态"], ["overdueDays", "逾期天数"], ["destinationPlace", "到达地"], ["cargoDescription", "运输货物名称"],
  ],
  "tax-refunds": [
    ["orderNo", "订单号"], ["blNo", "提单号"], ["customerName", "客户名称"], ["businessEntityName", "业务主体"], ["customsDeclarationNo", "报关单号"], ["customsDeclarationDate", "申报日期"], ["currency", "币种"], ["finalReceivableAmountCny", "最终应收人民币"], ["receivedAmountCny", "已收人民币"], ["customsCompleteness", "报关资料完整度"], ["exportCompleteness", "出口资料完整度"], ["domesticLogisticsCompleteness", "物流信息完整度"], ["factoryCompleteness", "工厂资料完整度"], ["logisticsInvoiceCompleteness", "物流资料完整度"], ["overallCompleteness", "总体完整度"], ["missingLogisticsInvoices", "缺失物流费资料明细"], ["missingCustomsInvoices", "缺失报关费资料明细"], ["missingPortInvoices", "缺失已发生费用资料明细"], ["taxRefundStatusLabel", "退税状态"], ["domesticTransportType", "运输方式"], ["truckPlateNo", "车牌号"], ["trailerPlateNo", "挂车车牌"], ["departurePlace", "起运地"], ["destinationPlace", "到达地"], ["departureDate", "起运日期"], ["cargoDescription", "运输货物名称"], ["expressTrackingNo", "快递单号"], ["exportInvoiceRemark", "出口发票备注"], ["domesticSubmitterRole", "录入来源"], ["domesticSubmittedBy", "录入人"], ["domesticSubmittedAt", "录入时间"],
  ],
  "customer-analysis": [
    ["customerName", "客户名称"], ["orderCount", "订单数"], ["receivableCny", "应收总额"], ["receivedAmountCny", "已收金额"], ["outstandingCny", "未收余额"], ["totalCostCny", "总成本"], ["expectedGrossProfit", "预计毛利"], ["expectedGrossMargin", "预计毛利率"], ["averageOrderValueCny", "平均订单额"], ["overdueOrders", "逾期订单"], ["overdueAmountCny", "逾期金额"], ["netCashFlowCny", "净现金流"], ["lastOrderDate", "最近订单日期"],
  ],
  "salesperson-performance": [
    ["salespersonName", "业务员"], ["customerCount", "客户数"], ["orderCount", "订单数"], ["receivableCny", "应收总额"], ["receivedAmountCny", "已收金额"], ["collectionRate", "回款率"], ["outstandingCny", "未收余额"], ["expectedGrossProfit", "预计毛利"], ["expectedGrossMargin", "预计毛利率"], ["overdueOrders", "逾期订单"], ["overdueAmountCny", "逾期金额"], ["netCashFlowCny", "净现金流"],
  ],
} satisfies Record<ReportType, ReportColumnTuple[]>;

export function columnsFor(type: ReportType): ReportColumn[] {
  return (columnSets[type] || columnSets.receivables).map(([key, label]) => ({ key, label }));
}

export function queryFilters(query: URLSearchParams): ReportFilters {
  return {
    dateFrom: query.get("dateFrom") || "",
    dateTo: query.get("dateTo") || "",
    customerName: query.get("customerName") || "",
    orderNo: query.get("orderNo") || "",
    blNo: query.get("blNo") || "",
    currency: query.get("currency") || "",
    salespersonName: query.get("salespersonName") || "",
    supplierName: query.get("supplierName") || "",
    businessEntityId: query.get("businessEntityId") || "",
    businessEntityName: query.get("businessEntityName") || query.get("businessEntity") || "",
    orderStatus: query.get("orderStatus") || "",
    paymentStatus: query.get("paymentStatus") || "",
    costType: query.get("costType") || "",
    taxRefundStatus: query.get("taxRefundStatus") || "",
    declarationMonth: query.get("declarationMonth") || "",
    archiveScope: query.get("archiveScope") || query.get("businessScope") || "current",
    keyword: query.get("keyword") || "",
  };
}
