import { prisma } from "../prisma";
import { Prisma, type PaymentTermType } from "../generated/prisma/client.js";
import {
  CURRENCIES,
  ORDER_STATUSES,
  RECEIVABLE_ORDER_INPUT_SCHEMA,
  TRADE_TERMS,
  addDays,
  amountCny,
  applyCommonFilters,
  assertInputSchema,
  assertJsonObject,
  assertRead,
  assertWrite,
  businessEntityWhereFromQuery,
  codedError,
  confirmedPayment,
  dateFromInput,
  dateToInput,
  depositRatioForPaymentTerm,
  getExchangeRateSettings,
  includeOrderRelations,
  inputHasOwn,
  logServerError,
  nonEmpty,
  optional,
  pageParams,
  pageResult,
  permissionError,
  refreshTaxRefundCompleteness,
  requirePositive,
  requireText,
  resolveExchangeRateSnapshot,
  resolveBusinessEntityForOrderInput,
  resolvePaymentTerm,
  runNonCriticalTask,
  serializeOrder,
  summarizeOrder,
  type SerializedOrderDto,
  todayInputInChina,
  writeAudit,
} from "./shared";
import { assertCustomerScope, resolveSalespersonUserId } from "./shared-admin";
import {
  assertOrderCanReceivePayment,
  canAccessOrder,
  orderAccessWhere,
  scopeOrderForActor,
  validateDuplicateOrder,
} from "./order-access";
import {
  defaultOrderLogisticsSupplier,
  syncOrderLogisticsSuppliers,
} from "./masters-access";
import { sortReceivableRowsByShipmentDate } from "./order-receivable-sort";
import { summarizeCurrencyTotals } from "./currency-totals";

type ActorLike = ({
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} & Record<string, unknown>) | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type QueryLike = URLSearchParams;
type OrderInput = Record<string, unknown>;

function actorId(actor: ActorLike) {
  return requireText(actor?.id, "当前用户");
}

function actorRole(actor: ActorLike) {
  return String(actor?.role || "");
}

function resolveSalespersonCommissionRate(
  inputData: OrderInput,
  actor: ActorLike,
  customer: { commissionStatus?: string | null; commissionRate?: unknown } | null | undefined,
  before: { salespersonCommissionRate?: unknown } | null,
) {
  const fallback = before
    ? Number(before.salespersonCommissionRate || 0)
    : Math.max(0, Number(customer?.commissionStatus === "停用" ? 0 : customer?.commissionRate || 0));
  if (actorRole(actor) !== "管理员") return fallback;
  const hasInput = inputHasOwn(inputData, "salespersonCommissionRate") || inputHasOwn(inputData, "commissionRate");
  if (!hasInput) return fallback;
  const rawValue = inputData.salespersonCommissionRate ?? inputData.commissionRate;
  return Math.max(0, Math.round(Number(rawValue || 0) * 100) / 100);
}

type PageResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type OrderListFilters = {
  keyword: string;
  businessEntityId: string;
  country: string;
  currency: string;
  orderStatus: string;
  reminderStatus: string;
  month: string;
  archiveScope: string;
};

export type OrderListRow = SerializedOrderDto;
const ORDER_UNPAGINATED_SCAN_LIMIT = 1000;

type PaginatedOrderList = PageResult<OrderListRow> & {
  summary: ReturnType<typeof summarizeCurrencyTotals>;
};

export async function listOrders(query: QueryLike, actor: ActorLike, options: { paginated: true }): Promise<PaginatedOrderList>;
export async function listOrders(query: QueryLike, actor: ActorLike, options?: { paginated?: false }): Promise<OrderListRow[]>;
export async function listOrders(query: QueryLike, actor: ActorLike, options: { paginated?: boolean } = {}): Promise<OrderListRow[] | PaginatedOrderList> {
  assertRead(actor, "orders");
  const filters = orderListFiltersFromQuery(query);
  const where = orderListWhere(filters, actor);
  if (options.paginated) {
    const { page, pageSize } = pageParams(query, 20, 20);
    const [total, orders, summaryGroups] = await Promise.all([
      prisma.receivableOrder.count({ where }),
      prisma.receivableOrder.findMany({
        where,
        include: includeOrderRelations(),
        orderBy: [{ actualShipmentDate: "desc" }, { blDate: "desc" }, { createdAt: "desc" }, { updatedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.receivableOrder.groupBy({
        by: ["currency"],
        where,
        _sum: {
          finalReceivableAmount: true,
          finalReceivableAmountCny: true,
        },
      }),
    ]);
    const rows = sortReceivableRowsByShipmentDate(orders.map((order) => serializeOrder(scopeOrderForActor(order, actor))));
    return {
      ...pageResult(rows, total, page, pageSize),
      summary: summarizeCurrencyTotals(summaryGroups.map((group) => ({
        currency: group.currency,
        amount: group._sum.finalReceivableAmount,
        amountCny: group._sum.finalReceivableAmountCny,
      }))),
    };
  }

  const orders = await prisma.receivableOrder.findMany({
    where,
    include: includeOrderRelations(),
    orderBy: [{ createdAt: "desc" }],
    take: ORDER_UNPAGINATED_SCAN_LIMIT,
  });
  const sortedRows = sortReceivableRowsByShipmentDate(applyCommonFilters(
    orders.map((order) => serializeOrder(scopeOrderForActor(order, actor))),
    query,
  ));
  return sortedRows;
}

function orderListFiltersFromQuery(query: QueryLike): OrderListFilters {
  const keyword = nonEmpty(query?.get("keyword"));
  return {
    keyword,
    businessEntityId: nonEmpty(query?.get("businessEntityId") || query?.get("businessEntity")),
    country: nonEmpty(query?.get("country")),
    currency: nonEmpty(query?.get("currency")),
    orderStatus: nonEmpty(query?.get("orderStatus")),
    reminderStatus: nonEmpty(query?.get("reminderStatus")),
    month: nonEmpty(query?.get("month")),
    archiveScope: nonEmpty(query?.get("archiveScope") || query?.get("businessScope") || query?.get("taxArchiveScope") || "current"),
  };
}

function orderArchiveWhere(scope = "current"): Prisma.ReceivableOrderWhereInput {
  if (scope === "archive") return { OR: [{ taxArchived: true }, { taxRefundStatus: "SUBMITTED" }] };
  if (scope === "all") return {};
  return { taxArchived: false, NOT: { taxRefundStatus: "SUBMITTED" } };
}

function orderListWhere(filters: OrderListFilters, actor: ActorLike): Prisma.ReceivableOrderWhereInput {
  const keyword = filters.keyword;
  const clauses: Prisma.ReceivableOrderWhereInput[] = [
    { deletedAt: null },
    orderAccessWhere(actor),
    orderArchiveWhere(filters.archiveScope),
  ];
  const businessEntityWhere = businessEntityWhereFromQuery(filters.businessEntityId);
  if (Object.keys(businessEntityWhere).length) clauses.push(businessEntityWhere);
  if (filters.currency) clauses.push({ currency: filters.currency });
  if (filters.orderStatus) clauses.push({ status: filters.orderStatus });
  if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
    const start = new Date(`${filters.month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    clauses.push({ createdAt: { gte: start, lt: end } });
  }
  if (keyword) {
    clauses.push({
      OR: [
        { orderNo: { contains: keyword, mode: "insensitive" } },
        { blNo: { contains: keyword, mode: "insensitive" } },
        { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
        { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
        { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
        { salesperson: { is: { name: { contains: keyword, mode: "insensitive" } } } },
      ],
    });
  }
  if (filters.country) {
    clauses.push({
      OR: [
        { country: { contains: filters.country, mode: "insensitive" } },
        { customer: { is: { country: { contains: filters.country, mode: "insensitive" } } } },
      ],
    });
  }
  if (filters.reminderStatus) {
    // 继续保留旧行为：该状态由 in-memory 汇总判断
  }
  return { AND: clauses.filter((item) => Object.keys(item).length) };
}

export async function getOrder(id: string, actor: ActorLike) {
  assertRead(actor, "orders");
  const order = await prisma.receivableOrder.findFirst({
    where: {
      id,
      deletedAt: null,
      ...orderAccessWhere(actor),
    },
    include: includeOrderRelations(),
  });
  if (!order) {
    throw codedError("应收订单不存在或无权查看", 404, "ORDER_NOT_FOUND");
  }
  return serializeOrder(scopeOrderForActor(order, actor));
}

export async function saveOrder(request: AuditRequestLike, actor: ActorLike, input: unknown, id: string | null = null) {
  assertWrite(actor, "orders");
  const currentActorId = actorId(actor);
  const currentActor = { ...(actor || {}), id: currentActorId, role: actorRole(actor) };
  const inputData = assertInputSchema(assertJsonObject(input), RECEIVABLE_ORDER_INPUT_SCHEMA) as OrderInput;
  const before = id
    ? await prisma.receivableOrder.findFirst({ where: { id, deletedAt: null }, include: includeOrderRelations() })
    : null;
  if (id && !before) throw codedError("应收订单不存在或已删除", 404, "ORDER_NOT_FOUND");
  if (before && !canAccessOrder(actor, before)) throw codedError("无权限修改该应收订单", 403, "ORDER_PERMISSION_DENIED");
  const customer = await assertCustomerScope(actor, requireText(inputData.customerId, "客户"));
  const orderNo = requireText(inputData.orderNo, "订单号");
  const blNo = optional(inputData.blNo || inputData.billOfLadingNo);
  const duplicate = await validateDuplicateOrder(orderNo, id);
  if (duplicate) throw codedError("订单号已存在，不能重复提交", 409, "ORDER_DUPLICATE");
  if (id) {
    const unfinishedDocuments = await prisma.orderDocument.count({
      where: { orderId: id, deletedAt: null, uploadStatus: { not: "SUCCESS" } },
    });
    if (unfinishedDocuments > 0) throw codedError("存在未完成上传的文件，请处理后再提交。", 400, "ORDER_DOCUMENT_UPLOAD_UNFINISHED");
  }
  const estimatedReceivableAmount = requirePositive(inputData.estimatedReceivableAmount ?? inputData.receivableAmount, "预计应收金额");
  const actualShipmentAmount = inputData.actualShipmentAmount === "" || inputData.actualShipmentAmount == null ? null : requirePositive(inputData.actualShipmentAmount, "实际发货金额");
  const actualShipmentDate = dateFromInput(inputData.actualShipmentDate);
  const finalReceivableAmount = inputData.finalReceivableAmount === "" || inputData.finalReceivableAmount == null
    ? (actualShipmentAmount ?? estimatedReceivableAmount)
    : requirePositive(inputData.finalReceivableAmount, "最终应收金额");
  const paymentTermInfo = resolvePaymentTerm(inputData, before);
  const paymentTermType = paymentTermInfo.type;
  const paymentTermTypeValue: PaymentTermType | null = paymentTermType
    ? paymentTermType as PaymentTermType
    : null;
  const paymentTerm = paymentTermInfo.label;
  const depositRatio = depositRatioForPaymentTerm(paymentTermType, before);
  const currency = optional(inputData.currency)?.toUpperCase();
  if (!currency) throw codedError("请选择币种", 400, "CURRENCY_REQUIRED");
  if (!CURRENCIES.includes(currency)) throw codedError("请选择有效币种", 400, "CURRENCY_REQUIRED");
  const exchange = await resolveExchangeRateSnapshot(inputData, currentActor, {
    currency,
    defaultDate: todayInputInChina(),
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  const exchangeRate = exchange.exchangeRate;
  const salespersonUserId = await resolveSalespersonUserId(inputData, actor, customer, before);
  const salespersonCommissionRate = resolveSalespersonCommissionRate(inputData, actor, customer, before);
  const createdAt = before?.createdAt || new Date();
  const businessEntity = await resolveBusinessEntityForOrderInput(inputData, before);
  if (before && before.businessEntityId && businessEntity.id !== before.businessEntityId) {
    throw codedError("已有订单如需变更业务主体，请使用业务主体转移操作。", 400, "BUSINESS_ENTITY_TRANSFER_REQUIRED");
  }
  const baseCreatedDate = dateFromInput(createdAt.toISOString().slice(0, 10));
  const expectedArrivalDate = paymentTermType === "AFTER_ARRIVAL"
    ? dateFromInput(inputData.expectedArrivalDate || inputData.expectedPaymentDate)
    : (!paymentTermType && before ? before.expectedArrivalDate : null);
  const expectedShipmentDate = !paymentTermType && before ? before.expectedShipmentDate : null;
  const blDate = paymentTermType === "COPY_BL"
    ? dateFromInput(inputData.blDate)
    : (!paymentTermType && before ? before.blDate : null);
  const creditDays = ["OA", "AFTER_ARRIVAL"].includes(String(paymentTermType))
    ? Number(inputData.creditDays)
    : (!paymentTermType && before ? before.creditDays : null);
  if (paymentTermType === "AFTER_ARRIVAL" && !expectedArrivalDate) throw codedError("到港后付款请填写预计到港日期", 400, "EXPECTED_ARRIVAL_DATE_REQUIRED");
  const dueDate = paymentTermType === "OA"
    ? addDays(baseCreatedDate, creditDays)
    : paymentTermType === "AFTER_ARRIVAL"
      ? addDays(expectedArrivalDate, creditDays)
      : paymentTermType === "COPY_BL"
        ? (blDate || actualShipmentDate || dateFromInput(inputData.dueDate))
        : paymentTermType === "INSTALLMENT"
          ? dateFromInput(inputData.dueDate)
          : (dateFromInput(inputData.dueDate) || before?.dueDate || null);
  const expectedPaymentDate = paymentTermType === "AFTER_ARRIVAL"
    ? expectedArrivalDate
    : paymentTermType === "COPY_BL"
      ? (dateFromInput(inputData.expectedPaymentDate) || actualShipmentDate)
      : (!paymentTermType && before ? before.expectedPaymentDate : null);
  const paymentInstallments = paymentTermType === "INSTALLMENT"
    ? inputData.paymentInstallments
    : (!paymentTermType && before ? before.paymentInstallments : null);
  if (dueDate && createdAt && dueDate < new Date(createdAt.toISOString().slice(0, 10))) {
    throw codedError("到期日不能早于订单创建日期", 400, "DUE_DATE_BEFORE_ORDER_DATE");
  }
  const data: Prisma.ReceivableOrderUncheckedCreateInput = {
    orderNo,
    blNo,
    customerId: customer.id,
    customerNameSnapshot: before && before.customerId === customer.id ? before.customerNameSnapshot : customer.name,
    businessEntityId: businessEntity.id,
    businessEntityNameSnapshot: businessEntity.name,
    salespersonUserId,
    salespersonCommissionRate,
    country: optional(customer.country),
    currency,
    exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    estimatedReceivableAmount,
    estimatedReceivableAmountCny: amountCny(estimatedReceivableAmount, exchangeRate),
    actualShipmentAmount,
    actualShipmentAmountCny: actualShipmentAmount == null ? null : amountCny(actualShipmentAmount, exchangeRate),
    actualShipmentDate,
    finalReceivableAmount,
    finalReceivableAmountCny: amountCny(finalReceivableAmount, exchangeRate),
    receivableAmount: finalReceivableAmount,
    receivableAmountCny: amountCny(finalReceivableAmount, exchangeRate),
    tradeTerm: TRADE_TERMS.includes(String(inputData.tradeTerm || "")) ? String(inputData.tradeTerm) : "FOB",
    paymentTerm,
    paymentTermType: paymentTermTypeValue,
    depositRatio,
    expectedPaymentDate,
    expectedArrivalDate,
    expectedShipmentDate,
    blDate,
    paymentInstallments: paymentInstallments == null ? Prisma.DbNull : paymentInstallments,
    creditDays,
    dueDate,
    reminderDays: Math.max(0, Math.round(Number(inputData.reminderDays ?? 7))),
    status: ORDER_STATUSES.includes(String(inputData.status || "")) ? String(inputData.status) : "已确认",
    remark: optional(inputData.remark),
    updatedById: currentActorId,
    ...(id ? {} : { createdById: currentActorId }),
  };
  if (before && before.status === "已关闭" && actorRole(actor) !== "管理员") {
    throw codedError("已关闭订单不能修改", 400, "ORDER_CLOSED");
  }
  const hasLogisticsSupplierInput = inputHasOwn(inputData, "logisticsSupplierIds") || inputHasOwn(inputData, "logisticsSuppliers");
  const logisticsSettings = await getExchangeRateSettings();
  if (!logisticsSettings.allowMultipleOrderLogisticsSuppliers && !(await defaultOrderLogisticsSupplier())) {
    throw codedError("请先在供应商资料中设置默认物流供应商。", 400, "DEFAULT_LOGISTICS_SUPPLIER_REQUIRED");
  }
  const order = id
    ? await prisma.receivableOrder.update({ where: { id }, data, include: includeOrderRelations() })
    : await prisma.receivableOrder.create({ data, include: includeOrderRelations() });
  let orderWithSuppliers: typeof order = order;
  if (hasLogisticsSupplierInput || !logisticsSettings.allowMultipleOrderLogisticsSuppliers) {
    await syncOrderLogisticsSuppliers(order.id, Array.isArray(inputData.logisticsSupplierIds) ? inputData.logisticsSupplierIds : Array.isArray(inputData.logisticsSuppliers) ? inputData.logisticsSuppliers : [], actor);
    orderWithSuppliers = await prisma.receivableOrder.findUnique({ where: { id: order.id }, include: includeOrderRelations() }) || order;
  }
  writeAudit(request, actor, id ? "更新应收订单" : "新增应收订单", "receivable_orders", order.id, before, order)
    .catch((error) => logServerError("订单操作日志写入失败", error, { orderId: order.id }));
  const shouldSyncStatus = data.actualShipmentAmount != null || orderWithSuppliers.payments?.some(confirmedPayment);
  let synced: typeof orderWithSuppliers = orderWithSuppliers;
  if (shouldSyncStatus) {
    try {
      const statusSynced = await syncOrderStatus(order.id);
      if (statusSynced) synced = statusSynced;
    } catch (error: unknown) {
      logServerError("订单状态同步失败", error, { orderId: order.id });
    }
  }
  refreshTaxRefundCompleteness(order.id).catch((error) => logServerError("退税资料完整度刷新失败", error, { orderId: order.id }));
  return serializeOrder(synced || order);
}

export async function deleteOrder(request: AuditRequestLike, actor: ActorLike, id: string) {
  assertWrite(actor, "orders");
  const currentActorId = actorId(actor);
  const before = await prisma.receivableOrder.findUnique({ where: { id }, include: includeOrderRelations() });
  if (!before || before.deletedAt) throw permissionError("应收订单不存在或已删除", 404);
  if (!canAccessOrder(actor, before)) throw codedError("无权限删除该应收订单", 403, "ORDER_PERMISSION_DENIED");
  const row = await prisma.receivableOrder.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: currentActorId },
  });
  await runNonCriticalTask("订单删除操作日志写入", () => writeAudit(request, actor, "删除应收订单", "receivable_orders", id, before, row));
}

export async function syncOrderStatus(orderId: string) {
  const order = await prisma.receivableOrder.findUnique({
    where: { id: orderId },
    include: includeOrderRelations(),
  });
  if (!order || ["草稿", "已关闭", "已取消"].includes(order.status)) return order;
  const summary = summarizeOrder(order);
  let status = order.status;
  if (Number(summary.overpaidCny || 0) > 0) status = "多收款";
  else if (Number(summary.outstandingCny || 0) <= 0) status = "已收齐";
  else if (Number(summary.confirmedPaymentsCny || 0) > 0) status = "部分收款";
  else if (["部分收款", "已收齐", "多收款"].includes(order.status)) {
    status = order.actualShipmentAmount == null ? "已确认" : "已发货";
  }
  if (status !== order.status) {
    return prisma.receivableOrder.update({
      where: { id: orderId },
      data: { status },
      include: includeOrderRelations(),
    });
  }
  return order;
}

export { searchReceivableOrders } from "./order-receivable-search";
export { repairMissingOrderSalespeople } from "./order-salesperson-repair";
