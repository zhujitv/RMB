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
    supplier: true,
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
  return {
    orderId: order.id || "",
    orderNo: order.orderNo || "",
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerShortName: customerShortName(order.customer),
    customerName: customerBusinessName(order.customer, order.customerNameSnapshot),
    vesselVoyage: "",
    containerType: "",
    port: firstItem.arrivalPlace || info.destinationPlace || "",
    loadingAddress: firstItem.departurePlace || info.departurePlace || "",
    sailingDate: dateToInput(firstItem.departureDate || info.departureDate || order.expectedShipmentDate || order.blDate),
    truckPlateNo: firstItem.truckPlateNo || info.truckPlateNo || "",
    cargoName: firstItem.cargoName || info.cargoDescription || "",
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
    remark: expense.remark || "",
    auditStatus: expense.auditStatus || "草稿",
    invoiceStatus: expense.invoiceStatus || "未通知",
    paymentStatus: expense.paymentStatus || "待开票",
    submittedAt: expense.submittedAt || null,
    reviewedBy: serializeUser(expense.reviewedBy),
    reviewedAt: expense.reviewedAt || null,
    reviewRemark: expense.reviewRemark || "",
    rejectReason: expense.rejectReason || "",
    invoiceNo: expense.invoiceNo || "",
    invoiceDate: dateToInput(expense.invoiceDate),
    invoiceAmount: expense.invoiceAmount == null ? "" : Number(expense.invoiceAmount),
    invoiceRemark: expense.invoiceRemark || "",
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
  const requestedStatus = nonEmpty(input.auditStatus || input.status || (input.submit === false ? "草稿" : "待审核"));
  const auditStatus = LOGISTICS_EXPENSE_AUDIT_STATUSES.includes(requestedStatus) ? requestedStatus : "待审核";
  if (before?.auditStatus === "待审核" && actor?.role !== "管理员") {
    throw codedError("待审核费用不能直接修改，请先撤回后再修改。", 403, "LOGISTICS_EXPENSE_PENDING_LOCKED");
  }
  if (before?.auditStatus === "审核通过" && actor?.role !== "管理员") {
    throw codedError("已审核通过的费用金额不能修改。", 403, "LOGISTICS_EXPENSE_APPROVED_LOCKED");
  }
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
