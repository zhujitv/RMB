import {
  assertRead,
  codedError,
  getProfitAnalysis,
  getReminders,
  listCosts,
  listOrders,
  listPayments,
  logServerError,
} from "./platform-db";
import {
  REPORT_TYPES,
  columnsFor,
  filterRows,
  pageRows,
  queryFilters,
  reportTypeFrom,
  sortRows,
  type ActorLike,
  type ReportFilters,
  type ReportQueryOptions,
  type ReportRow,
  type ReportType,
} from "./report-service-shared";
import {
  costToRow,
  friendlyReportQueryError,
  orderToCommission,
  orderToOverdue,
  orderToProfit,
  orderToReceivable,
  orderToTaxRefund,
  paymentToRow,
  reportQueryForBaseRows,
  safeMapReportRows,
} from "./report-service-mappers";

async function baseRows(type: ReportType, query: URLSearchParams, actor: ActorLike): Promise<ReportRow[]> {
  if (!REPORT_TYPES[type]) {
    throw codedError("请选择有效报表类型", 400, "REPORT_TYPE_INVALID");
  }
  assertRead(actor, "reports");
  const area = REPORT_TYPES[type].area;
  assertRead(actor, area);
  if (type === "payments") return safeMapReportRows(await listPayments(query, actor), type, paymentToRow);
  if (type === "costs") return safeMapReportRows(await listCosts(query, actor), type, costToRow);
  if (type === "overdue") return safeMapReportRows(await getReminders(query, actor), type, orderToOverdue);
  if (type === "profits") return safeMapReportRows(await getProfitAnalysis(query, actor), type, orderToProfit);
  if (type === "commissions") return safeMapReportRows(await getProfitAnalysis(query, actor), type, orderToCommission);
  if (type === "tax-refunds") return safeMapReportRows(await listOrders(query, actor), type, orderToTaxRefund);
  return safeMapReportRows(await listOrders(query, actor), type, orderToReceivable);
}

export async function queryReport(typeInput: unknown, query: URLSearchParams, actor: ActorLike, options: ReportQueryOptions = {}) {
  const type = reportTypeFrom(typeInput);
  const filters: ReportFilters = options.filters || queryFilters(query);
  const page = options.page || query.get("page") || 1;
  const pageSize = options.pageSize || query.get("pageSize") || 20;
  const sortBy = options.sortBy || query.get("sortBy") || "";
  const sortDir = options.sortDir || query.get("sortDir") || "asc";
  const selectedIds = new Set(options.selectedIds || []);
  let rows: ReportRow[] = [];
  try {
    rows = await baseRows(type, reportQueryForBaseRows(type, query, filters), actor);
  } catch (error) {
    logServerError("报表基础数据查询失败", error, {
      reportType: type,
      customerName: filters.customerName || filters.customer || "",
      archiveScope: filters.archiveScope || filters.businessScope || "current",
    });
    throw friendlyReportQueryError(error, filters);
  }
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
