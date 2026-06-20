// @ts-nocheck
import { prisma } from "../prisma";
import {
  CURRENCIES,
  ORDER_STATUSES,
  PAYMENT_TYPES,
  RECEIVABLE_ORDER_INPUT_SCHEMA,
  TRADE_TERMS,
  addDays,
  amountCny,
  applyCommonFilters,
  assertInputSchema,
  assertJsonObject,
  assertRead,
  assertWrite,
  canWrite,
  codedError,
  confirmedPayment,
  customerBusinessName,
  customerFullName,
  customerShortName,
  dateFromInput,
  dateToInput,
  depositRatioForPaymentTerm,
  effectivePermissions,
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
  resolvePaymentTerm,
  runNonCriticalTask,
  serializeOrder,
  summarizeOrder,
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

export async function listOrders(query, actor, options = {}) {
  assertRead(actor, "orders");
  const where = orderListWhere(query, actor);
  if (options.paginated) {
    const { page, pageSize } = pageParams(query, 20, 100);
    const [total, orders] = await Promise.all([
      prisma.receivableOrder.count({ where }),
      prisma.receivableOrder.findMany({
        where,
        include: includeOrderRelations(),
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return pageResult(orders.map((order) => serializeOrder(scopeOrderForActor(order, actor))), total, page, pageSize);
  }
  const orders = await prisma.receivableOrder.findMany({
    where,
    include: includeOrderRelations(),
    orderBy: [{ createdAt: "desc" }],
  });
  return applyCommonFilters(orders.map((order) => serializeOrder(scopeOrderForActor(order, actor))), query);
}

function orderListWhere(query, actor) {
  const keyword = nonEmpty(query?.get("keyword") || query?.get("q") || query?.get("search"));
  const orderText = nonEmpty(query?.get("order") || query?.get("orderNo"));
  const party = nonEmpty(query?.get("party") || query?.get("customerName"));
  const country = nonEmpty(query?.get("country"));
  const currency = nonEmpty(query?.get("currency"));
  const orderStatus = nonEmpty(query?.get("orderStatus"));
  const reminderStatus = nonEmpty(query?.get("reminderStatus"));
  const month = nonEmpty(query?.get("month"));
  const filters = [
    { deletedAt: null },
    orderAccessWhere(actor),
  ];
  if (currency) filters.push({ currency });
  if (orderStatus) filters.push({ status: orderStatus });
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    filters.push({ createdAt: { gte: start, lt: end } });
  }
  if (keyword) {
    filters.push({
      OR: [
        { orderNo: { contains: keyword, mode: "insensitive" } },
        { blNo: { contains: keyword, mode: "insensitive" } },
        { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
        { country: { contains: keyword, mode: "insensitive" } },
        { currency: { contains: keyword, mode: "insensitive" } },
        { status: { contains: keyword, mode: "insensitive" } },
        { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
        { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
        { customer: { is: { country: { contains: keyword, mode: "insensitive" } } } },
        { salesperson: { is: { name: { contains: keyword, mode: "insensitive" } } } },
        { costs: { some: {
          deletedAt: null,
          OR: [
            { supplierNameSnapshot: { contains: keyword, mode: "insensitive" } },
            { vendorName: { contains: keyword, mode: "insensitive" } },
            { supplier: { is: { supplierName: { contains: keyword, mode: "insensitive" } } } },
          ],
        } } },
      ],
    });
  }
  if (orderText) {
    filters.push({
      OR: [
        { orderNo: { contains: orderText, mode: "insensitive" } },
        { blNo: { contains: orderText, mode: "insensitive" } },
      ],
    });
  }
  if (party) {
    filters.push({
      OR: [
        { customerNameSnapshot: { contains: party, mode: "insensitive" } },
        { customer: { is: { name: { contains: party, mode: "insensitive" } } } },
        { customer: { is: { shortName: { contains: party, mode: "insensitive" } } } },
        { salesperson: { is: { name: { contains: party, mode: "insensitive" } } } },
      ],
    });
  }
  if (country) {
    filters.push({
      OR: [
        { country: { contains: country, mode: "insensitive" } },
        { customer: { is: { country: { contains: country, mode: "insensitive" } } } },
      ],
    });
  }
  if (reminderStatus) {
    // 继续保留旧行为：该状态由 in-memory 汇总判断
  }
  return { AND: filters.filter((item) => Object.keys(item).length) };
}

export async function getOrder(id, actor) {
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
    const error = new Error("应收订单不存在或无权查看");
    error.status = 404;
    throw error;
  }
  return serializeOrder(scopeOrderForActor(order, actor));
}

function serializeReceivableSearchOrder(order) {
  const fullCustomerName = customerFullName(order.customer, order.customerNameSnapshot);
  const shortCustomerName = customerShortName(order.customer);
  const summary = summarizeOrder(order);
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerId: order.customerId || "",
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    customerShortName: shortCustomerName,
    customerNameSnapshot: fullCustomerName,
    salespersonId: order.salespersonUserId || "",
    salespersonUserId: order.salespersonUserId || "",
    salespersonName: order.salesperson?.name || "",
    country: order.customer?.country || order.country || "",
    currency: order.currency,
    exchangeRate: Number(order.exchangeRate),
    exchangeRateDate: dateToInput(order.exchangeRateDate),
    exchangeRateSource: order.exchangeRateSource || "",
    exchangeRateType: order.exchangeRateType || "",
    receivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    receivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    finalReceivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    finalReceivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    receivedAmountCny: Number(summary.confirmedPaymentsCny || 0),
    outstandingAmount: Number(summary.outstandingAmount || 0),
    outstandingCny: Number(summary.outstandingCny || 0),
    status: order.status,
    dueDate: dateToInput(order.dueDate),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    summary: {
      receivableAmount: Number(summary.receivableAmount || 0),
      receivableCny: Number(summary.receivableCny || 0),
      confirmedPaymentsCny: Number(summary.confirmedPaymentsCny || 0),
      outstandingAmount: Number(summary.outstandingAmount || 0),
      outstandingCny: Number(summary.outstandingCny || 0),
    },
  };
}

function receivableOrderCanAcceptPayment(order) {
  if (["已关闭", "已取消"].includes(order.status)) return false;
  return Number(summarizeOrder(order).outstandingCny || 0) > 0;
}

export async function searchReceivableOrders(query, actor) {
  assertRead(actor, "orders");
  const q = nonEmpty(query.get("q"));
  const purpose = nonEmpty(query.get("purpose") || query.get("mode"));
  const isPaymentSearch = purpose === "payment" || purpose === "payments";
  const scope = effectivePermissions(actor).dataScope;
  const isCostEntrySearch = canWrite(actor, "costs") && scope === "OWN_COST";
  if (isCostEntrySearch && !q) return [];
  const accessWhere = isCostEntrySearch ? {} : orderAccessWhere(actor);
  const filters = [
    accessWhere,
    q ? {
      OR: [
        { orderNo: { contains: q, mode: "insensitive" } },
        { blNo: { contains: q, mode: "insensitive" } },
        { customerNameSnapshot: { contains: q, mode: "insensitive" } },
        { customer: { is: { name: { contains: q, mode: "insensitive" } } } },
        { customer: { is: { shortName: { contains: q, mode: "insensitive" } } } },
        { salesperson: { is: { name: { contains: q, mode: "insensitive" } } } },
      ],
    } : {},
  ].filter((item) => Object.keys(item).length);
  const where = {
    deletedAt: null,
    ...(isPaymentSearch ? { status: { notIn: ["已关闭", "已取消"] } } : {}),
    ...(filters.length ? { AND: filters } : {}),
  };
  const orders = await prisma.receivableOrder.findMany({
    where,
    include: includeOrderRelations(),
    orderBy: [{ createdAt: "desc" }],
    take: isPaymentSearch ? 50 : 20,
  });
  const resultOrders = isPaymentSearch ? orders.filter(receivableOrderCanAcceptPayment).slice(0, 20) : orders;
  if (isCostEntrySearch) {
    return resultOrders.map((order) => ({
      id: order.id,
      orderNo: order.orderNo,
      blNo: order.blNo || "",
      billOfLadingNo: order.blNo || "",
      customerName: customerBusinessName(order.customer, order.customerNameSnapshot),
      customerFullName: customerFullName(order.customer, order.customerNameSnapshot),
      customerShortName: customerShortName(order.customer),
      status: order.status,
      dueDate: dateToInput(order.dueDate),
    }));
  }
  return resultOrders.map((order) => (
    isPaymentSearch
      ? serializeReceivableSearchOrder(scopeOrderForActor(order, actor))
      : serializeOrder(scopeOrderForActor(order, actor))
  ));
}

export async function saveOrder(request, actor, input, id = null) {
  assertWrite(actor, "orders");
  input = assertInputSchema(assertJsonObject(input), RECEIVABLE_ORDER_INPUT_SCHEMA);
  const before = id
    ? await prisma.receivableOrder.findFirst({ where: { id, deletedAt: null }, include: includeOrderRelations() })
    : null;
  if (id && !before) throw Object.assign(new Error("应收订单不存在或已删除"), { status: 404 });
  if (before && !canAccessOrder(actor, before)) throw Object.assign(new Error("无权限修改该应收订单"), { status: 403 });
  const customer = await assertCustomerScope(actor, requireText(input.customerId, "客户"));
  const orderNo = requireText(input.orderNo, "订单号");
  const blNo = optional(input.blNo || input.billOfLadingNo);
  const duplicate = await validateDuplicateOrder(orderNo, id);
  if (duplicate) throw Object.assign(new Error("订单号已存在，不能重复提交"), { status: 409 });
  if (id) {
    const unfinishedDocuments = await prisma.orderDocument.count({
      where: { orderId: id, deletedAt: null, uploadStatus: { not: "SUCCESS" } },
    });
    if (unfinishedDocuments > 0) throw Object.assign(new Error("存在未完成上传的文件，请处理后再提交。"), { status: 400 });
  }
  const estimatedReceivableAmount = requirePositive(input.estimatedReceivableAmount ?? input.receivableAmount, "预计应收金额");
  const actualShipmentAmount = input.actualShipmentAmount === "" || input.actualShipmentAmount == null ? null : requirePositive(input.actualShipmentAmount, "实际发货金额");
  const finalReceivableAmount = input.finalReceivableAmount === "" || input.finalReceivableAmount == null
    ? (actualShipmentAmount ?? estimatedReceivableAmount)
    : requirePositive(input.finalReceivableAmount, "最终应收金额");
  const paymentTermInfo = resolvePaymentTerm(input, before);
  const paymentTermType = paymentTermInfo.type;
  const paymentTerm = paymentTermInfo.label;
  const depositRatio = depositRatioForPaymentTerm(paymentTermType, before);
  const currency = optional(input.currency)?.toUpperCase();
  if (!currency) throw Object.assign(new Error("请选择币种"), { status: 400 });
  if (!CURRENCIES.includes(currency)) throw Object.assign(new Error("请选择有效币种"), { status: 400 });
  const exchange = await resolveExchangeRateSnapshot(input, actor, {
    currency,
    defaultDate: todayInputInChina(),
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  const exchangeRate = exchange.exchangeRate;
  const salespersonUserId = await resolveSalespersonUserId(input, actor, customer, before);
  const salespersonCommissionRate = before
    ? Number(before.salespersonCommissionRate || 0)
    : Math.max(0, Number(customer.commissionStatus === "停用" ? 0 : customer.commissionRate || 0));
  const createdAt = before?.createdAt || new Date();
  const baseCreatedDate = dateFromInput(createdAt.toISOString().slice(0, 10));
  const expectedArrivalDate = paymentTermType === "AFTER_ARRIVAL"
    ? dateFromInput(input.expectedArrivalDate || input.expectedPaymentDate)
    : (!paymentTermType && before ? before.expectedArrivalDate : null);
  const expectedShipmentDate = paymentTermType === "COPY_BL"
    ? dateFromInput(input.expectedShipmentDate || input.expectedPaymentDate)
    : (!paymentTermType && before ? before.expectedShipmentDate : null);
  const blDate = paymentTermType === "COPY_BL"
    ? dateFromInput(input.blDate)
    : (!paymentTermType && before ? before.blDate : null);
  const creditDays = ["OA", "AFTER_ARRIVAL"].includes(paymentTermType)
    ? Number(input.creditDays)
    : (!paymentTermType && before ? before.creditDays : null);
  if (paymentTermType === "AFTER_ARRIVAL" && !expectedArrivalDate) throw Object.assign(new Error("到港后付款请填写预计到港日期"), { status: 400 });
  const dueDate = paymentTermType === "OA"
    ? addDays(baseCreatedDate, creditDays)
    : paymentTermType === "AFTER_ARRIVAL"
      ? addDays(expectedArrivalDate, creditDays)
      : paymentTermType === "COPY_BL"
        ? (blDate || expectedShipmentDate || dateFromInput(input.dueDate))
        : paymentTermType === "INSTALLMENT"
          ? dateFromInput(input.dueDate)
          : (dateFromInput(input.dueDate) || before?.dueDate || null);
  const expectedPaymentDate = paymentTermType === "AFTER_ARRIVAL"
    ? expectedArrivalDate
    : paymentTermType === "COPY_BL"
      ? expectedShipmentDate
      : (!paymentTermType && before ? before.expectedPaymentDate : null);
  const paymentInstallments = paymentTermType === "INSTALLMENT"
    ? input.paymentInstallments
    : (!paymentTermType && before ? before.paymentInstallments : null);
  if (dueDate && createdAt && dueDate < new Date(createdAt.toISOString().slice(0, 10))) {
    throw Object.assign(new Error("到期日不能早于订单创建日期"), { status: 400 });
  }
  const data = {
    orderNo,
    blNo,
    customerId: customer.id,
    customerNameSnapshot: before && before.customerId === customer.id ? before.customerNameSnapshot : customer.name,
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
    finalReceivableAmount,
    finalReceivableAmountCny: amountCny(finalReceivableAmount, exchangeRate),
    receivableAmount: finalReceivableAmount,
    receivableAmountCny: amountCny(finalReceivableAmount, exchangeRate),
    tradeTerm: TRADE_TERMS.includes(input.tradeTerm) ? input.tradeTerm : "FOB",
    paymentTerm,
    paymentTermType,
    depositRatio,
    expectedPaymentDate,
    expectedArrivalDate,
    expectedShipmentDate,
    blDate,
    paymentInstallments,
    creditDays,
    dueDate,
    reminderDays: Math.max(0, Math.round(Number(input.reminderDays ?? 7))),
    status: ORDER_STATUSES.includes(input.status) ? input.status : "已确认",
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
  if (before && before.status === "已关闭" && actor.role !== "管理员") {
    throw Object.assign(new Error("已关闭订单不能修改"), { status: 400 });
  }
  const hasLogisticsSupplierInput = inputHasOwn(input, "logisticsSupplierIds") || inputHasOwn(input, "logisticsSuppliers");
  const logisticsSettings = await getExchangeRateSettings();
  if (!logisticsSettings.allowMultipleOrderLogisticsSuppliers && !(await defaultOrderLogisticsSupplier())) {
    throw codedError("请先在供应商资料中设置默认物流供应商。", 400, "DEFAULT_LOGISTICS_SUPPLIER_REQUIRED");
  }
  const order = id
    ? await prisma.receivableOrder.update({ where: { id }, data, include: includeOrderRelations() })
    : await prisma.receivableOrder.create({ data, include: includeOrderRelations() });
  let orderWithSuppliers = order;
  if (hasLogisticsSupplierInput || !logisticsSettings.allowMultipleOrderLogisticsSuppliers) {
    await syncOrderLogisticsSuppliers(order.id, input.logisticsSupplierIds ?? input.logisticsSuppliers ?? [], actor);
    orderWithSuppliers = await prisma.receivableOrder.findUnique({ where: { id: order.id }, include: includeOrderRelations() }) || order;
  }
  writeAudit(request, actor, id ? "更新应收订单" : "新增应收订单", "receivable_orders", order.id, before, order)
    .catch((error) => logServerError("订单操作日志写入失败", error, { orderId: order.id }));
  const shouldSyncStatus = data.actualShipmentAmount != null || orderWithSuppliers.payments?.some(confirmedPayment);
  let synced = orderWithSuppliers;
  if (shouldSyncStatus) {
    try {
      synced = await syncOrderStatus(order.id);
    } catch (error) {
      logServerError("订单状态同步失败", error, { orderId: order.id });
    }
  }
  refreshTaxRefundCompleteness(order.id).catch((error) => logServerError("退税资料完整度刷新失败", error, { orderId: order.id }));
  return serializeOrder(synced || order);
}

export async function deleteOrder(request, actor, id) {
  assertWrite(actor, "orders");
  const before = await prisma.receivableOrder.findUnique({ where: { id }, include: includeOrderRelations() });
  if (!before || before.deletedAt) throw permissionError("应收订单不存在或已删除", 404);
  if (!canAccessOrder(actor, before)) throw Object.assign(new Error("无权限删除该应收订单"), { status: 403 });
  const row = await prisma.receivableOrder.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
  });
  await runNonCriticalTask("订单删除操作日志写入", () => writeAudit(request, actor, "删除应收订单", "receivable_orders", id, before, row));
}

export async function syncOrderStatus(orderId) {
  const order = await prisma.receivableOrder.findUnique({
    where: { id: orderId },
    include: includeOrderRelations(),
  });
  if (!order || ["草稿", "已关闭", "已取消"].includes(order.status)) return order;
  const summary = summarizeOrder(order);
  let status = order.status;
  if (summary.overpaidCny > 0) status = "多收款";
  else if (summary.outstandingCny <= 0) status = "已收齐";
  else if (summary.confirmedPaymentsCny > 0) status = "部分收款";
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
