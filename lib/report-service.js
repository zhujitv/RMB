import JSZip from "jszip";
import {
  apiError,
  assertRead,
  canRead,
  getActor,
  getProfitAnalysis,
  getReminders,
  listCosts,
  listOrders,
  listPayments,
} from "./platform-db";

export const REPORT_TYPES = {
  receivables: { label: "应收订单明细", area: "orders", filename: "receivable-orders" },
  payments: { label: "收款明细", area: "payments", filename: "payments" },
  costs: { label: "成本明细", area: "costs", filename: "order-costs" },
  profits: { label: "利润分析", area: "orders", filename: "profit-analysis" },
  commissions: { label: "业务员提成", area: "commissions", filename: "salesperson-commissions" },
  overdue: { label: "逾期催款", area: "orders", filename: "payment-reminders" },
  "tax-refunds": { label: "退税资料", area: "taxRefund", filename: "tax-refund-materials" },
};

function text(value) {
  return String(value ?? "");
}

function lower(value) {
  return text(value).trim().toLowerCase();
}

function dateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return text(value).slice(0, 10);
}

function inDateRange(row, from, to) {
  if (!from && !to) return true;
  const dates = [row.date, row.createdAt, row.updatedAt, row.paymentDate, row.dueDate, row.blDate, row.uploadedAt]
    .map(dateOnly)
    .filter(Boolean);
  if (!dates.length) return true;
  return dates.some((date) => (!from || date >= from) && (!to || date <= to));
}

function filterRows(rows, filters = {}) {
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
  const dateFrom = dateOnly(filters.dateFrom);
  const dateTo = dateOnly(filters.dateTo);
  return rows.filter((row) => {
    const blob = lower([
      row.orderNo,
      row.blNo,
      row.billOfLadingNo,
      row.customerName,
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
    if (customer && !lower(row.customerName).includes(customer)) return false;
    if (orderNo && !lower(row.orderNo).includes(orderNo)) return false;
    if (blNo && !lower(row.blNo || row.billOfLadingNo).includes(blNo)) return false;
    if (salesperson && !lower(row.salespersonName).includes(salesperson)) return false;
    if (supplier && !lower(row.supplierName).includes(supplier)) return false;
    if (currency && row.currency !== currency) return false;
    if (orderStatus && row.status !== orderStatus && row.orderStatus !== orderStatus) return false;
    if (paymentStatus && row.paymentStatus !== paymentStatus && row.status !== paymentStatus) return false;
    if (costType && row.costType !== costType) return false;
    if (taxRefundStatus && row.taxRefundStatus !== taxRefundStatus) return false;
    return true;
  });
}

function sortRows(rows, sortBy = "", sortDir = "asc") {
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

function pageRows(rows, page = 1, pageSize = 20) {
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

function moneyNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

const columnSets = {
  receivables: [
    ["orderNo", "订单号"], ["blNo", "提单号"], ["customerName", "客户名称"], ["salespersonName", "业务员"], ["currency", "币种"], ["finalReceivableAmount", "最终应收"], ["finalReceivableAmountCny", "最终应收人民币"], ["receivedAmountCny", "已收人民币"], ["outstandingCny", "未收人民币"], ["dueDate", "到期日"], ["status", "订单状态"], ["domesticLogisticsSupplier", "物流供应商"], ["temporarySupplierName", "临时供应商名称"], ["domesticTransportType", "运输方式"], ["truckPlateNo", "车牌号"], ["trailerPlateNo", "挂车车牌"], ["departurePlace", "起运地"], ["departureDate", "起运日期"], ["expressTrackingNo", "快递单号"], ["exportInvoiceRemark", "出口发票备注"], ["domesticSubmitterRole", "录入来源"], ["domesticSubmittedBy", "录入人"], ["domesticSubmittedAt", "录入时间"], ["domesticFinanceStatus", "财务审核状态"], ["domesticReviewedBy", "审核人"], ["domesticReviewedAt", "审核时间"], ["domesticRejectReason", "驳回原因"],
  ],
  payments: [
    ["orderNo", "订单号"], ["customerName", "客户名称"], ["paymentDate", "收款日期"], ["paymentType", "收款类型"], ["currency", "币种"], ["amount", "收款金额"], ["amountCny", "折人民币"], ["status", "收款状态"], ["bankReference", "银行流水号"],
  ],
  costs: [
    ["orderNo", "订单号"], ["customerName", "客户名称"], ["costType", "成本类型"], ["supplierName", "供应商"], ["supplierType", "供应商类型"], ["currency", "币种"], ["amount", "成本金额"], ["amountCny", "折人民币"], ["paymentStatus", "付款状态"], ["invoiceStatus", "发票状态"],
  ],
  profits: [
    ["orderNo", "订单号"], ["customerName", "客户名称"], ["salespersonName", "业务员"], ["receivableCny", "应收人民币"], ["receivedAmountCny", "已收人民币"], ["outstandingCny", "未收人民币"], ["totalCostCny", "总成本"], ["actualGrossProfit", "实际毛利"], ["grossMargin", "毛利率"], ["status", "订单状态"],
  ],
  commissions: [
    ["orderNo", "订单号"], ["customerName", "客户名称"], ["salespersonName", "业务员"], ["commissionRate", "提成比例"], ["receivedAmountCny", "已到账收款"], ["logisticsCostCny", "物流成本"], ["commissionBaseCny", "提成基数"], ["commissionAmountCny", "提成金额"], ["commissionStatus", "提成状态"], ["commissionSettledAt", "结算时间"],
  ],
  overdue: [
    ["orderNo", "订单号"], ["blNo", "提单号"], ["customerName", "客户名称"], ["salespersonName", "业务员"], ["dueDate", "到期日"], ["outstandingCny", "未收人民币"], ["reminderStatus", "逾期状态"], ["overdueDays", "逾期天数"],
  ],
  "tax-refunds": [
    ["orderNo", "订单号"], ["blNo", "提单号"], ["customerName", "客户名称"], ["currency", "币种"], ["finalReceivableAmountCny", "最终应收人民币"], ["receivedAmountCny", "已收人民币"], ["exportCompleteness", "出口资料完整度"], ["domesticLogisticsCompleteness", "国内物流信息完整度"], ["factoryCompleteness", "工厂资料完整度"], ["logisticsInvoiceCompleteness", "物流港杂资料完整度"], ["overallCompleteness", "总体完整度"], ["missingLogisticsInvoices", "缺失拖车费发票明细"], ["missingCustomsInvoices", "缺失报关费发票明细"], ["missingPortInvoices", "缺失港杂费发票明细"], ["taxRefundStatusLabel", "退税状态"], ["domesticLogisticsSupplier", "物流供应商"], ["temporarySupplierName", "临时供应商名称"], ["domesticTransportType", "运输方式"], ["truckPlateNo", "车牌号"], ["trailerPlateNo", "挂车车牌"], ["departurePlace", "起运地"], ["departureDate", "起运日期"], ["expressTrackingNo", "快递单号"], ["exportInvoiceRemark", "出口发票备注"], ["domesticSubmitterRole", "录入来源"], ["domesticSubmittedBy", "录入人"], ["domesticSubmittedAt", "录入时间"], ["domesticFinanceStatus", "财务审核状态"], ["domesticReviewedBy", "审核人"], ["domesticReviewedAt", "审核时间"], ["domesticRejectReason", "驳回原因"],
  ],
};

function columnsFor(type) {
  return (columnSets[type] || columnSets.receivables).map(([key, label]) => ({ key, label }));
}

function domesticLogisticsColumns(order = {}) {
  const info = order.domesticLogisticsInfo || order.documentCompleteness?.domesticLogistics?.info || {};
  return {
    domesticLogisticsSupplier: info.responsibleSupplierName || "",
    temporarySupplierName: info.temporarySupplierName || "",
    domesticTransportType: info.transportTypeLabel || "",
    truckPlateNo: info.truckPlateNo || "",
    trailerPlateNo: info.trailerPlateNo || "",
    departurePlace: info.departurePlace || "",
    departureDate: info.departureDate || "",
    expressTrackingNo: info.expressTrackingNo || "",
    exportInvoiceRemark: info.remarkText || "",
    domesticSubmitterRole: info.submitterRole || "",
    domesticSubmittedBy: info.submittedByName || "",
    domesticSubmittedAt: info.submittedAt || "",
    domesticFinanceStatus: info.financeStatusLabel || "",
    domesticReviewedBy: info.financeConfirmedByName || "",
    domesticReviewedAt: info.financeConfirmedAt || "",
    domesticRejectReason: info.rejectReason || "",
  };
}

function orderToReceivable(order) {
  return {
    id: order.id,
    orderId: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "待发货",
    customerName: order.customerName,
    salespersonName: order.salespersonName,
    country: order.country,
    currency: order.currency,
    finalReceivableAmount: order.finalReceivableAmount,
    finalReceivableAmountCny: moneyNumber(order.finalReceivableAmountCny),
    receivedAmountCny: moneyNumber(order.summary?.confirmedPaymentsCny),
    outstandingCny: moneyNumber(order.summary?.outstandingCny),
    dueDate: order.dueDate,
    status: order.status,
    date: order.createdAt,
    createdAt: order.createdAt,
    ...domesticLogisticsColumns(order),
  };
}

function orderToProfit(order) {
  return {
    ...orderToReceivable(order),
    receivableCny: moneyNumber(order.summary?.receivableCny),
    totalCostCny: moneyNumber(order.summary?.totalCostCny),
    actualGrossProfit: moneyNumber(order.summary?.actualGrossProfit),
    grossMargin: `${((Number(order.summary?.grossMargin || 0)) * 100).toFixed(2)}%`,
  };
}

function orderToCommission(order) {
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

function orderToOverdue(order) {
  return {
    ...orderToReceivable(order),
    reminderStatus: order.summary?.reminderStatus,
    overdueDays: order.summary?.overdueDays || 0,
  };
}

function orderToTaxRefund(order) {
  const completeness = order.documentCompleteness || {};
  const factory = completeness.factory || completeness.supplier || {};
  const logistics = completeness.logistics || {};
  const missingDetail = (items = []) => items.map((item) => (
    `${item.costType || "-"} / ${item.supplierName || "-"} / ${item.currency || "CNY"} ${Number(item.amount || 0).toFixed(2)}`
  )).join("；");
  return {
    ...orderToReceivable(order),
    taxRefundStatus: order.taxRefundStatus,
    taxRefundStatusLabel: order.taxRefundStatusLabel,
    exportCompleteness: `${completeness.export?.completed || 0}/${completeness.export?.total || 8}`,
    factoryCompleteness: factory.missingFactoryCost
      ? "0/2（未录入工厂供应商）"
      : `${factory.completed || 0}/${Math.max(2, Number(factory.total || 0))}`,
    supplierCompleteness: factory.missingFactoryCost
      ? "0/2（未录入工厂供应商）"
      : `${factory.completed || 0}/${Math.max(2, Number(factory.total || 0))}`,
    logisticsInvoiceCompleteness: `${logistics.completed || 0}/${logistics.total || 0}`,
    domesticLogisticsCompleteness: `${completeness.domesticLogistics?.completed || 0}/${completeness.domesticLogistics?.total || 1}`,
    missingLogisticsInvoices: missingDetail(logistics.missingLogisticsInvoices || []),
    missingCustomsInvoices: missingDetail(logistics.missingCustomsInvoices || []),
    missingPortInvoices: missingDetail(logistics.missingPortInvoices || []),
    overallCompleteness: `${completeness.completed || 0}/${completeness.total || 0}`,
  };
}

function paymentToRow(payment) {
  return { ...payment, date: payment.paymentDate, paymentStatus: payment.status };
}

function costToRow(cost) {
  return { ...cost, date: cost.paymentDate || cost.createdAt };
}

async function baseRows(type, query, actor) {
  if (!REPORT_TYPES[type]) {
    const error = new Error("请选择有效报表类型");
    error.status = 400;
    throw error;
  }
  assertRead(actor, "reports");
  const area = REPORT_TYPES[type].area;
  assertRead(actor, area);
  if (type === "payments") return (await listPayments(query, actor)).map(paymentToRow);
  if (type === "costs") return (await listCosts(query, actor)).map(costToRow);
  if (type === "overdue") return (await getReminders(query, actor)).map(orderToOverdue);
  if (type === "profits") return (await getProfitAnalysis(query, actor)).map(orderToProfit);
  if (type === "commissions") return (await listOrders(query, actor)).map(orderToCommission);
  if (type === "tax-refunds") return (await listOrders(query, actor)).map(orderToTaxRefund);
  return (await listOrders(query, actor)).map(orderToReceivable);
}

function queryFilters(query) {
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
    keyword: query.get("keyword") || "",
  };
}

export async function queryReport(type, query, actor, options = {}) {
  const filters = options.filters || queryFilters(query);
  const page = options.page || query.get("page") || 1;
  const pageSize = options.pageSize || query.get("pageSize") || 20;
  const sortBy = options.sortBy || query.get("sortBy") || "";
  const sortDir = options.sortDir || query.get("sortDir") || "asc";
  const selectedIds = new Set(options.selectedIds || []);
  let rows = await baseRows(type, query, actor);
  rows = filterRows(rows, filters);
  if (selectedIds.size) rows = rows.filter((row) => selectedIds.has(row.id));
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

function csvCell(value) {
  const valueText = text(value);
  return /[",\n]/.test(valueText) ? `"${valueText.replaceAll('"', '""')}"` : valueText;
}

function csvResponse(filename, columns, rows) {
  const header = columns.map((column) => csvCell(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(",")).join("\n");
  return new Response(`\ufeff${header}\n${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}

function xmlCell(value) {
  return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function excelColumnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

async function xlsxResponse(filename, columns, rows) {
  const values = [columns.map((column) => column.label), ...rows.map((row) => columns.map((column) => row[column.key]))];
  const sheetData = values.map((row, rowIndex) => `
    <row r="${rowIndex + 1}">
      ${row.map((cell, colIndex) => `<c r="${excelColumnName(colIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlCell(cell)}</t></is></c>`).join("")}
    </row>
  `).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="报表" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.folder("xl").folder("worksheets").file("sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`);
  const body = await zip.generateAsync({ type: "uint8array" });
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}

export async function exportReport(request, actor) {
  assertRead(actor, "reports");
  const body = await request.json();
  const type = body.reportType || "receivables";
  const exportScope = body.exportScope || "allFiltered";
  const format = body.format === "xlsx" ? "xlsx" : "csv";
  const query = new URLSearchParams();
  const filters = body.filters || {};
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const result = await queryReport(type, query, actor, {
    filters,
    selectedIds: exportScope === "selected" ? (body.selectedIds || []) : [],
    page: exportScope === "currentPage" ? (body.page || 1) : 1,
    pageSize: exportScope === "currentPage" ? (body.pageSize || 20) : 100000,
    sortBy: body.sortBy || "",
    sortDir: body.sortDir || "asc",
    noPagination: exportScope !== "currentPage",
  });
  if (format === "xlsx") return xlsxResponse(REPORT_TYPES[type].filename, result.columns, result.rows);
  return csvResponse(REPORT_TYPES[type].filename, result.columns, result.rows);
}

export async function reportGetHandler(request, type) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    return Response.json(await queryReport(type, query, actor));
  } catch (error) {
    return apiError(error, "查询报表失败");
  }
}
