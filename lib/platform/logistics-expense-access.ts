// @ts-nocheck
import { prisma } from "../prisma";
import { includeCostRelations } from "./cost-records-shared";
import {
  CURRENCIES,
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_COST_TYPES,
  LOGISTICS_EXPENSE_AUDIT_STATUSES,
  LOGISTICS_EXPENSE_INVOICE_STATUSES,
  LOGISTICS_OPERATOR_ROLE,
  amountCny,
  canRead,
  canWrite,
  codedError,
  customerBusinessName,
  customerShortName,
  dateToInput,
  nonEmpty,
  normalizeLogisticsCostTypeList,
  normalizedCostType,
  optional,
  permissionError,
  requirePositive,
  resolveExchangeRateSnapshot,
  serializeOrderDocument,
  serializeSupplier,
  serializeUser,
  todayInputInChina,
} from "./shared";
import { assertSupplierActive } from "./supplier-masters";
import {
  logisticsInvoiceGroupForCostType,
  logisticsInvoiceGroupsForCostTypes,
} from "./logistics-invoice-groups";

const LOGISTICS_EXPENSE_BILLING_METHODS = ["按柜", "按票", "按次", "按重量", "按金额比例", "手工输入"];
const DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD = "按柜";

export function includeLogisticsExpenseRelations() {
  return {
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
  };
}

export function logisticsExpenseOrderSummary(order = {}) {
  const info = (order.domesticLogisticsInfos || [])[0] || {};
  const firstItem = (info.transportItems || [])[0] || {};
	  const transportItems = (info.transportItems || []).map((item) => ({
	    id: item.id || "",
	    containerNo: item.containerNo || "",
	    containerType: item.containerType || item.container_type || "",
	    sealNo: item.sealNo || item.seal_no || "",
	    truckPlateNo: item.truckPlateNo || "",
    departureDate: dateToInput(item.departureDate),
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
    customerName: customerBusinessName(order.customer, order.customerNameSnapshot),
    vesselVoyage: "",
    containerType: containerTypes.length === 1 ? containerTypes[0] : "",
    containerTypes,
    port: firstItem.arrivalPlace || info.destinationPlace || "",
    loadingAddress: firstItem.departurePlace || info.departurePlace || "",
    sailingDate: dateToInput(firstItem.departureDate || info.departureDate || order.actualShipmentDate || order.blDate || order.expectedShipmentDate),
    truckPlateNo: firstItem.truckPlateNo || info.truckPlateNo || "",
    cargoName: firstItem.cargoName || info.cargoDescription || "",
    transportItems,
    containerNos,
    containerCount: containerNos.length || transportItems.length || 0,
  };
}

export function serializeLogisticsExpense(expense = {}) {
  const orderSummary = logisticsExpenseOrderSummary(expense.order || {});
  const invoiceDocument = expense.invoiceDocument ? serializeOrderDocument(expense.invoiceDocument, expense.order) : null;
  return {
    id: expense.id,
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
    costType: normalizedCostType(expense.costType),
    currency: expense.currency || "CNY",
    exchangeRate: Number(expense.exchangeRate || 1),
    exchangeRateDate: dateToInput(expense.exchangeRateDate),
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
    auditStatus: expense.auditStatus || "草稿",
    invoiceStatus: expense.invoiceStatus || "未通知",
    paymentStatus: expense.paymentStatus || "待开票",
    submittedAt: expense.submittedAt || null,
    reviewedBy: serializeUser(expense.reviewedBy),
    reviewedAt: expense.reviewedAt || null,
    rejectedBy: expense.auditStatus === "已驳回" ? serializeUser(expense.reviewedBy) : null,
    rejectedAt: expense.auditStatus === "已驳回" ? (expense.reviewedAt || null) : null,
    reviewRemark: expense.reviewRemark || "",
    rejectReason: expense.rejectReason || "",
    invoiceNo: expense.invoiceNo || "",
    invoiceDate: dateToInput(expense.invoiceDate),
    invoiceAmount: expense.invoiceAmount == null ? "" : Number(expense.invoiceAmount),
    invoiceRemark: expense.invoiceRemark || "",
    invoiceNotifiedAt: expense.invoiceNotifiedAt || null,
    invoiceNotificationError: expense.invoiceNotificationError || "",
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

export function aggregateLogisticsExpenseStatus(rows = [], field = "") {
  if (field === "auditStatus") return logisticsExpenseBillAuditStatus(rows);
  const values = rows.map((row) => row[field]).filter(Boolean);
  const unique = [...new Set(values)];
  if (!unique.length) return "-";
  if (unique.length === 1) return unique[0];
  if (field === "invoiceStatus") {
    if (unique.includes("已上传")) return "部分已上传";
    if (unique.includes("已确认")) return "部分已确认";
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

export function logisticsExpenseBillAuditStatus(rows = []) {
  const values = rows.map((row) => row.auditStatus || "草稿").filter(Boolean);
  const unique = [...new Set(values)];
  if (!unique.length) return "草稿";
  if (unique.length === 1) return unique[0];
  if (unique.includes("审核通过")) return "审核通过";
  if (unique.includes("待审核")) return "待审核";
  if (unique.includes("已驳回")) return "已驳回";
  return "草稿";
}

export function logisticsExpenseInvoiceGroups(items = []) {
  return logisticsInvoiceGroupsForCostTypes(items.map((item) => item.costType)).map((group) => {
    const groupItems = items.filter((item) => logisticsInvoiceGroupForCostType(item.costType)?.key === group.key);
    const uploaded = groupItems.length > 0 && groupItems.every((item) => ["已上传", "已确认"].includes(item.invoiceStatus || ""));
    const confirmed = groupItems.length > 0 && groupItems.every((item) => item.invoiceStatus === "已确认");
    const failed = groupItems.some((item) => item.invoiceStatus === "通知失败");
    const notified = groupItems.some((item) => item.invoiceStatus === "已通知开票");
    return {
      key: group.key,
      label: group.label,
      costTypes: group.costTypes,
      amountCny: groupItems.reduce((sum, item) => sum + Number(item.amountCny || 0), 0),
      itemIds: groupItems.map((item) => item.id).filter(Boolean),
      status: confirmed ? "已确认" : (uploaded ? "已上传" : (failed ? "通知失败" : (notified ? "已通知开票" : "待开票"))),
      uploaded,
      confirmed,
      failed,
      notified,
      invoiceDocumentId: groupItems.find((item) => item.invoiceDocumentId)?.invoiceDocumentId || "",
      invoiceNo: groupItems.find((item) => item.invoiceNo)?.invoiceNo || "",
      invoiceNotificationError: groupItems.map((item) => item.invoiceNotificationError || "").find(Boolean) || "",
    };
  });
}

export function aggregateLogisticsExpenseInvoiceStatus(items = []) {
  const groups = logisticsExpenseInvoiceGroups(items);
  if (!groups.length) return aggregateLogisticsExpenseStatus(items, "invoiceStatus");
  if (groups.every((group) => group.confirmed)) return "已确认";
  if (groups.every((group) => group.uploaded || group.confirmed)) return "已上传发票";
  if (groups.some((group) => group.uploaded || group.confirmed)) return "部分上传发票";
  if (groups.some((group) => group.failed)) return "待开票 / 通知失败";
  return "待开票";
}

export function serializeLogisticsExpenseBill(rows = []) {
  const items = rows.map(serializeLogisticsExpense);
  const first = items[0] || {};
  const amountCny = items.reduce((sum, item) => sum + Number(item.amountCny || 0), 0);
  const invoiceGroups = logisticsExpenseInvoiceGroups(items);
  return {
    id: logisticsExpenseBillId(first),
    isBill: true,
    orderId: first.orderId || "",
    orderNo: first.orderNo || "",
    blNo: first.blNo || first.billOfLadingNo || "",
    billOfLadingNo: first.billOfLadingNo || first.blNo || "",
    customerName: first.customerName || "",
    customerShortName: first.customerShortName || "",
    supplierName: "",
    supplierNames: [...new Set(items.map((item) => item.supplierName).filter(Boolean))],
    costType: items.length === 1 ? items[0].costType : `${items.length} 项费用`,
    currency: "CNY",
    amount: amountCny,
    amountCny,
    auditStatus: aggregateLogisticsExpenseStatus(items, "auditStatus"),
    invoiceStatus: aggregateLogisticsExpenseInvoiceStatus(items),
    paymentStatus: aggregateLogisticsExpenseStatus(items, "paymentStatus"),
    itemCount: items.length,
    invoiceGroups,
    items,
    order: first.order || {},
    updatedAt: rows.reduce((latest, row) => {
      const time = new Date(row.updatedAt || row.createdAt || 0).getTime();
      return time > latest ? time : latest;
    }, 0),
  };
}

export function logisticsExpenseBillId(expense = {}) {
  const orderSummary = expense.order?.orderId ? expense.order : logisticsExpenseOrderSummary(expense.order || {});
  return `bill:${expense.orderId || orderSummary.orderId || "order"}:${orderSummary.blNo || orderSummary.billOfLadingNo || orderSummary.orderNo || "no-bl"}`;
}

export function groupLogisticsExpensesByBill(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const orderSummary = logisticsExpenseOrderSummary(row.order || {});
    const key = [row.orderId || orderSummary.orderId || "", orderSummary.blNo || orderSummary.billOfLadingNo || orderSummary.orderNo || ""].join("::");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Array.from(groups.values())
    .map(serializeLogisticsExpenseBill)
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

export function logisticsExpenseAccessWhere(actor) {
  if (actor?.role === "管理员") return {};
  if (actor?.role === "财务") return { auditStatus: "审核通过" };
  if (actor?.role === "业务员") return { order: { is: { customer: { is: { salespersonUserId: actor.id } } } } };
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(actor?.role)) {
    if (actor.supplierId) return { supplierId: actor.supplierId };
    return { supplierId: "__no_supplier_bound__" };
  }
  return { id: "__no_logistics_expense_access__" };
}

export function assertCanReadLogisticsExpenses(actor) {
  if (actor?.role === "管理员" || actor?.role === "财务") return;
  if (canRead(actor, "domesticLogistics") || canRead(actor, "costs")) return;
  throw permissionError("无权限查看物流费用", 403);
}

export function assertCanWriteLogisticsExpense(actor) {
  if (canWrite(actor, "logistics")) return;
  throw permissionError("无权限录入物流费用", 403);
}

export function assertCanReviewLogisticsExpense(actor) {
  if (actor?.role === "管理员") return;
  throw permissionError("只有管理员可以审核物流费用", 403);
}

export function assertCanConfirmLogisticsInvoice(actor) {
  if (["管理员", "财务"].includes(actor?.role)) return;
  throw permissionError("只有管理员或财务可以确认物流发票", 403);
}

export function logisticsExpenseStatusWhere(status = "") {
  const text = nonEmpty(status);
  if (!text || text === "all") return {};
  if (text === "pending") return { auditStatus: "待审核" };
  if (text === "approved") return { auditStatus: "审核通过" };
  if (text === "rejected") return { auditStatus: "已驳回" };
  if (text === "draft") return { auditStatus: "草稿" };
  if (text === "toInvoice") return { auditStatus: "审核通过", invoiceStatus: { in: ["未通知", "已通知开票"] } };
  if (text === "uploaded") return { invoiceStatus: "已上传" };
  if (text === "confirmedInvoice") return { invoiceStatus: "已确认" };
  if (LOGISTICS_EXPENSE_AUDIT_STATUSES.includes(text)) return { auditStatus: text };
  if (LOGISTICS_EXPENSE_INVOICE_STATUSES.includes(text)) return { invoiceStatus: text };
  return {};
}

export function insensitiveContains(value) {
  const text = nonEmpty(value);
  return text ? { contains: text, mode: "insensitive" } : null;
}

export async function assertLogisticsExpenseOrder(input = {}, actor) {
  const orderId = nonEmpty(input.orderId || input.order_id);
  const orderNo = nonEmpty(input.orderNo || input.order_no);
  const blNo = nonEmpty(input.blNo || input.billOfLadingNo || input.bill_of_lading_no);
  if (!orderId && !orderNo && !blNo) {
    throw codedError("未找到对应发货订单，请先建立或完善发货订单后再录入费用。", 400, "LOGISTICS_EXPENSE_ORDER_REQUIRED");
  }
  const order = await prisma.receivableOrder.findFirst({
    where: {
      deletedAt: null,
      OR: [
        orderId ? { id: orderId } : null,
        orderNo ? { orderNo: { equals: orderNo, mode: "insensitive" } } : null,
        blNo ? { blNo: { equals: blNo, mode: "insensitive" } } : null,
      ].filter(Boolean),
    },
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
  });
  if (!order) throw codedError("未找到对应发货订单，请先建立或完善发货订单后再录入费用。", 404, "LOGISTICS_EXPENSE_ORDER_NOT_FOUND");
  if (actor?.role === "管理员") return order;
  if (actor?.role === "业务员" && order.customer?.salespersonUserId === actor.id) return order;
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(actor?.role)) {
    if (actor.supplierId && (order.logisticsSuppliers || []).some((row) => row.supplierId === actor.supplierId)) return order;
  }
  throw permissionError("无权限访问该发货订单", 403);
}

export async function assertLogisticsExpenseSupplier(actor, order, input = {}) {
  const requestedSupplierId = nonEmpty(input.supplierId || input.supplier_id);
  const supplierId = [LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(actor?.role) && actor.supplierId
    ? actor.supplierId
    : requestedSupplierId;
  if (!supplierId) throw codedError("请选择物流供应商。", 400, "LOGISTICS_SUPPLIER_REQUIRED");
  const supplier = await assertSupplierActive(supplierId);
  if (!DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
    throw codedError("只有物流、报关、海运或港杂费用供应商可以提交物流费用。", 400, "LOGISTICS_SUPPLIER_TYPE_INVALID");
  }
  if (actor?.role !== "管理员") {
    if (!supplier.allowLogisticsExpenseEntry) throw codedError("该供应商尚未开启物流费用录入权限。", 403, "LOGISTICS_EXPENSE_ENTRY_DISABLED");
    if (!(order.logisticsSuppliers || []).some((row) => row.supplierId === supplier.id)) {
      throw codedError("该订单未分配给当前物流供应商，不能录入费用。", 403, "LOGISTICS_SUPPLIER_NOT_ASSIGNED");
    }
  }
  return supplier;
}

function assertSupplierCostTypeAllowed(actor, supplier, costType) {
  if (actor?.role === "管理员") return;
  const allowed = normalizeLogisticsCostTypeList(supplier.allowedLogisticsCostTypes || []);
  if (!allowed.includes(costType)) {
    throw codedError(`当前供应商不能录入${costType}。`, 403, "LOGISTICS_COST_TYPE_NOT_ALLOWED");
  }
}

export async function buildLogisticsExpenseData(order, supplier, actor, input = {}, before = null) {
  const inputCostType = normalizedCostType(input.costType);
  const costType = LOGISTICS_COST_TYPES.includes(inputCostType) ? inputCostType : "";
  if (!costType) throw codedError("请选择有效物流费用类型。", 400, "LOGISTICS_EXPENSE_COST_TYPE_REQUIRED");
  assertSupplierCostTypeAllowed(actor, supplier, costType);
  const amount = requirePositive(input.amount, "物流费用金额");
  const currency = nonEmpty(input.currency || "CNY").toUpperCase();
  if (!CURRENCIES.includes(currency)) throw codedError("请选择有效币种。", 400, "CURRENCY_REQUIRED");
  const exchange = await resolveExchangeRateSnapshot(currency === "CNY"
    ? { ...input, currency: "CNY", exchangeRate: 1, exchangeRateSource: "系统", exchangeRateDate: input.exchangeRateDate || todayInputInChina() }
    : input, actor, {
      currency,
      defaultDate: todayInputInChina(),
      allowHistoricalSource: before?.exchangeRateSource === "历史录入",
    });
  const requestedStatus = nonEmpty(input.auditStatus || input.status || (before ? before.auditStatus : (input.submit === false ? "草稿" : "待审核")));
  const auditStatus = LOGISTICS_EXPENSE_AUDIT_STATUSES.includes(requestedStatus) ? requestedStatus : "待审核";
  if (before?.auditStatus === "审核通过" && actor?.role !== "管理员") {
    throw codedError("已审核通过的费用金额不能修改。", 403, "LOGISTICS_EXPENSE_APPROVED_LOCKED");
  }
  const billingMethod = normalizeLogisticsExpenseBillingMethod(input, before);
  const billingQuantity = normalizeLogisticsExpenseBillingQuantity(input, billingMethod, before);
  const appliedContainerCount = normalizeAppliedContainerCount(input, order, before, billingQuantity);
  const containerType = normalizeLogisticsExpenseContainerType(input, order, before);
  return {
    orderId: order.id,
    supplierId: supplier.id,
    supplierNameSnapshot: supplier.supplierName,
    costType,
    currency: exchange.currency,
    exchangeRate: exchange.exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
	    amountCny: amountCny(amount, exchange.exchangeRate),
	    containerType,
	    appliedContainerCount,
	    billingMethod,
	    billingQuantity,
	    remark: optional(input.remark),
    auditStatus,
    submittedAt: auditStatus === "待审核" ? (before?.submittedAt || new Date()) : before?.submittedAt || null,
    invoiceStatus: before?.invoiceStatus || "未通知",
    paymentStatus: before?.paymentStatus || "待开票",
    rejectReason: auditStatus === "待审核" ? null : before?.rejectReason || null,
    updatedById: actor.id,
    ...(before ? {} : { createdById: actor.id }),
  };
}

function normalizeBillingMethodValue(value) {
  const text = nonEmpty(value || DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD);
  return LOGISTICS_EXPENSE_BILLING_METHODS.includes(text) ? text : DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD;
}

function integerBillingMethod(method) {
  return ["按柜", "按票", "按次"].includes(normalizeBillingMethodValue(method));
}

function normalizeLogisticsExpenseBillingMethod(input = {}, before = null) {
  const hasBillingMethodInput = Object.prototype.hasOwnProperty.call(input, "billingMethod")
    || Object.prototype.hasOwnProperty.call(input, "billing_method");
  if (!hasBillingMethodInput && before) return normalizeBillingMethodValue(before.billingMethod);
  const requested = nonEmpty(input.billingMethod ?? input.billing_method ?? DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD);
  if (!LOGISTICS_EXPENSE_BILLING_METHODS.includes(requested)) {
    throw codedError("请选择有效计费方式。", 400, "LOGISTICS_BILLING_METHOD_INVALID");
  }
  return requested;
}

function normalizeLogisticsExpenseBillingQuantity(input = {}, billingMethod = DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD, before = null) {
  const hasQuantityInput = Object.prototype.hasOwnProperty.call(input, "billingQuantity")
    || Object.prototype.hasOwnProperty.call(input, "billing_quantity")
    || Object.prototype.hasOwnProperty.call(input, "appliedContainerCount")
    || Object.prototype.hasOwnProperty.call(input, "containerCount")
    || Object.prototype.hasOwnProperty.call(input, "applied_container_count");
  if (!hasQuantityInput && before) return Number(before.billingQuantity ?? before.appliedContainerCount ?? 1);
  const raw = input.billingQuantity ?? input.billing_quantity ?? input.appliedContainerCount ?? input.containerCount ?? input.applied_container_count;
  const text = nonEmpty(raw);
  if (!text || ["整票", "whole_shipment", "shipment", "all"].includes(text.toLowerCase())) return 1;
  const quantity = Number(text);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw codedError("适用数量/范围必须大于 0。", 400, "LOGISTICS_BILLING_QUANTITY_INVALID");
  }
  if (integerBillingMethod(billingMethod) && !Number.isInteger(quantity)) {
    throw codedError("按柜、按票、按次的适用数量/范围必须为正整数。", 400, "LOGISTICS_BILLING_QUANTITY_INTEGER_REQUIRED");
  }
  return quantity;
}

function normalizeLogisticsExpenseContainerType(input = {}, order = {}, before = null) {
  const hasContainerTypeInput = Object.prototype.hasOwnProperty.call(input, "containerType")
    || Object.prototype.hasOwnProperty.call(input, "container_type");
  if (!hasContainerTypeInput && before) return before.containerType || null;
  const requested = optional(input.containerType ?? input.container_type);
  if (!requested) return null;
  const summary = logisticsExpenseOrderSummary(order);
  const allowedTypes = summary.containerTypes || [];
  if (allowedTypes.length && !allowedTypes.includes(requested)) {
    throw codedError("请选择有效集装箱柜型。", 400, "LOGISTICS_CONTAINER_TYPE_INVALID");
  }
  return requested;
}

function normalizeAppliedContainerCount(input = {}, order = {}, before = null, billingQuantity = 1) {
  const hasContainerCountInput = Object.prototype.hasOwnProperty.call(input, "appliedContainerCount")
	    || Object.prototype.hasOwnProperty.call(input, "containerCount")
	    || Object.prototype.hasOwnProperty.call(input, "applied_container_count");
  if (!hasContainerCountInput && before) return before.appliedContainerCount ?? 1;
  const raw = input.appliedContainerCount ?? input.containerCount ?? input.applied_container_count;
  const text = nonEmpty(raw);
  if (!text || ["整票", "whole_shipment", "shipment", "all"].includes(text.toLowerCase())) return Math.max(1, Math.ceil(Number(billingQuantity || 1)));
  const count = Number(text);
  if (!Number.isFinite(count) || count <= 0) {
	    throw codedError("适用数量必须为正整数。", 400, "LOGISTICS_CONTAINER_COUNT_INVALID");
  }
  return Math.max(1, Math.ceil(count));
}

export async function loadLogisticsExpenseForAction(id, actor) {
  const expense = await prisma.logisticsExpense.findFirst({
    where: {
      id,
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseRelations(),
  });
  if (!expense) throw permissionError("物流费用不存在或无权访问", 404);
  return expense;
}

export async function createOrUpdateCostFromLogisticsExpense(tx, expense, actor) {
  const costType = normalizedCostType(expense.costType);
  const duplicate = await tx.orderCost.findFirst({
    where: {
      orderId: expense.orderId,
      costType,
      deletedAt: null,
      NOT: { sourceId: expense.id },
    },
  });
  if (duplicate) {
    throw codedError("同一订单同一物流费用类型已存在正式成本，不能重复进入成本。", 409, "LOGISTICS_EXPENSE_DUPLICATE_COST");
  }
  const costData = {
    orderId: expense.orderId,
    supplierId: expense.supplierId,
    supplierNameSnapshot: expense.supplierNameSnapshot || expense.supplier?.supplierName || "",
    vendorName: expense.supplierNameSnapshot || expense.supplier?.supplierName || "",
    costType,
    currency: expense.currency,
    exchangeRate: expense.exchangeRate,
    exchangeRateDate: expense.exchangeRateDate,
    exchangeRateSource: expense.exchangeRateSource,
    exchangeRateType: expense.exchangeRateType,
    amount: expense.amount,
    amountCny: expense.amountCny,
    paymentStatus: "待支付",
    costConfirmed: true,
    costConfirmedAt: new Date(),
    paymentDate: null,
    invoiceStatus: "未通知",
    sourceType: "LOGISTICS_EXPENSE",
    sourceId: expense.id,
    remark: expense.remark || "",
    updatedById: actor.id,
  };
  const existing = expense.costId
    ? await tx.orderCost.findFirst({ where: { id: expense.costId, deletedAt: null } })
    : await tx.orderCost.findFirst({ where: { sourceType: "LOGISTICS_EXPENSE", sourceId: expense.id, deletedAt: null } });
  if (existing) return tx.orderCost.update({ where: { id: existing.id }, data: costData });
  return tx.orderCost.create({ data: { ...costData, createdById: actor.id } });
}

export {
  LOGISTICS_OPERATOR_ROLE,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
};
