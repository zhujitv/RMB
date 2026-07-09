import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  CURRENCIES,
  EXCHANGE_RATE_SOURCES,
  ORDER_STATUSES,
  RECEIVABLE_ORDER_INPUT_SCHEMA,
  TRADE_TERMS,
  addDays,
  amountCny,
  assertInputSchema,
  assertJsonObject,
  assertWrite,
  codedError,
  confirmedPayment,
  dateFromInput,
  depositRatioForPaymentTerm,
  getExchangeRateSettings,
  includeOrderRelations,
  inputHasOwn,
  logServerError,
  normalizeInstallments,
  optional,
  permissionError,
  refreshTaxRefundCompleteness,
  requirePositive,
  requireText,
  resolveBusinessEntityForOrderInput,
  resolveExchangeRateSnapshot,
  resolvePaymentTerm,
  runNonCriticalTask,
  serializeOrder,
  summarizeOrder,
  todayInputInChina,
  writeAudit,
} from "./shared";
import { assertCustomerScope, resolveSalespersonUserId } from "./shared-admin";
import { canAccessOrder, validateDuplicateOrder } from "./order-access";
import { syncOrderLogisticsSuppliers } from "./masters-access";
import {
  MAX_BL_NO_LENGTH,
  MAX_ORDER_NO_LENGTH,
  MAX_ORDER_REMARK_LENGTH,
  actorId,
  actorRole,
  normalizeOrderLogisticsSupplierIds,
  normalizeReminderDaysInput,
  optionalLimitedText,
  paymentTermTypeValue,
  requireLimitedText,
  resolveSalespersonCommissionRate,
  type ActorLike,
  type AuditRequestLike,
  type OrderInput,
} from "./orders-module-shared";

export async function saveOrder(request: AuditRequestLike, actor: ActorLike, input: unknown, id: string | null = null) {
  assertWrite(actor, "orders");
  const currentActorId = actorId(actor);
  const currentActor = { ...(actor || {}), id: currentActorId, role: actorRole(actor) };
  const inputData = assertInputSchema(assertJsonObject(input), RECEIVABLE_ORDER_INPUT_SCHEMA) as OrderInput;
  const before = id ? await prisma.receivableOrder.findFirst({ where: { id, deletedAt: null }, include: includeOrderRelations() }) : null;
  if (id && !before) throw codedError("应收订单不存在或已删除", 404, "ORDER_NOT_FOUND");
  if (before && !canAccessOrder(actor, before)) throw codedError("无权限修改该应收订单", 403, "ORDER_PERMISSION_DENIED");
  const customer = await assertCustomerScope(actor, requireText(inputData.customerId, "客户"));
  const orderNo = requireLimitedText(inputData.orderNo, "订单号", MAX_ORDER_NO_LENGTH);
  const blNo = optionalLimitedText(inputData.blNo || inputData.billOfLadingNo, "提单号", MAX_BL_NO_LENGTH);
  const duplicate = await validateDuplicateOrder(orderNo, id);
  if (duplicate) throw codedError("订单号已存在，不能重复提交", 409, "ORDER_DUPLICATE");
  await assertNoUnfinishedOrderDocuments(id);

  const currency = optional(inputData.currency)?.toUpperCase();
  if (!currency) throw codedError("请选择币种", 400, "CURRENCY_REQUIRED");
  if (!CURRENCIES.includes(currency)) throw codedError("请选择有效币种", 400, "CURRENCY_REQUIRED");
  if (currency !== "CNY" && (
    !Number(inputData.exchangeRate)
    || !inputData.exchangeRateDate
    || !EXCHANGE_RATE_SOURCES.includes(optional(inputData.exchangeRateSource) || "")
    || !inputData.exchangeRateType
  )) {
    throw codedError("当前订单缺少官方汇率，请点击【刷新官方汇率】后再保存。", 400, "OFFICIAL_RATE_REQUIRED");
  }
  const exchangeInput = currency === "CNY"
    ? { ...inputData, exchangeRate: 1, exchangeRateSource: "系统", exchangeRateType: "人民币" }
    : inputData;
  const exchange = await resolveExchangeRateSnapshot(exchangeInput, currentActor, {
    currency,
    defaultDate: todayInputInChina(),
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  if (currency !== "CNY" && !EXCHANGE_RATE_SOURCES.includes(exchange.exchangeRateSource)) {
    throw codedError("当前订单缺少官方汇率，请点击【刷新官方汇率】后再保存。", 400, "OFFICIAL_RATE_REQUIRED");
  }
  const orderAmounts = resolveOrderAmounts(inputData);
  const payment = resolveOrderPaymentDates(inputData, before, orderAmounts.finalReceivableAmount, exchange.exchangeRate);
  const salespersonUserId = await resolveSalespersonUserId(inputData, actor, customer, before);
  const businessEntity = await resolveBusinessEntityForOrderInput(inputData, before);
  if (before && before.businessEntityId && businessEntity.id !== before.businessEntityId) {
    throw codedError("已有订单如需变更业务主体，请使用业务主体转移操作。", 400, "BUSINESS_ENTITY_TRANSFER_REQUIRED");
  }
  const data = buildReceivableOrderData({
    inputData,
    before,
    customer,
    businessEntity,
    orderNo,
    blNo,
    currentActorId,
    salespersonUserId,
    currency,
    exchange,
    orderAmounts,
    payment,
  });
  if (before && before.status === "已关闭" && actorRole(actor) !== "管理员") throw codedError("已关闭订单不能修改", 400, "ORDER_CLOSED");
  const order = id
    ? await prisma.receivableOrder.update({ where: { id }, data, include: includeOrderRelations() })
    : await prisma.receivableOrder.create({ data, include: includeOrderRelations() });
  const orderWithSuppliers = await maybeSyncOrderLogisticsSuppliers(order, inputData, actor);
  writeAudit(request, actor, id ? "更新应收订单" : "新增应收订单", "receivable_orders", order.id, before, order)
    .catch((error) => logServerError("订单操作日志写入失败", error, { orderId: order.id }));
  const synced = await maybeSyncOrderStatus(orderWithSuppliers, data.actualShipmentAmount != null);
  refreshTaxRefundCompleteness(order.id).catch((error) => logServerError("退税资料完整度刷新失败", error, { orderId: order.id }));
  return serializeOrder(synced || order);
}

async function assertNoUnfinishedOrderDocuments(id: string | null) {
  if (!id) return;
  const unfinishedDocuments = await prisma.orderDocument.count({
    where: { orderId: id, deletedAt: null, uploadStatus: { not: "SUCCESS" } },
  });
  if (unfinishedDocuments > 0) throw codedError("存在未完成上传的文件，请处理后再提交。", 400, "ORDER_DOCUMENT_UPLOAD_UNFINISHED");
}

function resolveOrderAmounts(inputData: OrderInput) {
  const estimatedReceivableAmount = requirePositive(inputData.estimatedReceivableAmount ?? inputData.receivableAmount, "预计应收金额");
  const actualShipmentAmount = inputData.actualShipmentAmount === "" || inputData.actualShipmentAmount == null ? null : requirePositive(inputData.actualShipmentAmount, "实际发货金额");
  const finalReceivableAmount = inputData.finalReceivableAmount === "" || inputData.finalReceivableAmount == null
    ? (actualShipmentAmount ?? estimatedReceivableAmount)
    : requirePositive(inputData.finalReceivableAmount, "最终应收金额");
  return { estimatedReceivableAmount, actualShipmentAmount, finalReceivableAmount };
}

function resolveOrderPaymentDates(inputData: OrderInput, before: Record<string, any> | null, finalReceivableAmount: number, exchangeRate: number) {
  const paymentTermInfo = resolvePaymentTerm(inputData, before);
  const paymentTermType = paymentTermInfo.type;
  const paymentTerm = paymentTermInfo.label;
  const depositRatio = depositRatioForPaymentTerm(paymentTermType, before);
  const createdAt = before?.createdAt || new Date();
  const baseCreatedDate = dateFromInput(createdAt.toISOString().slice(0, 10));
  const actualShipmentDate = dateFromInput(inputData.actualShipmentDate);
  const expectedArrivalDate = paymentTermType === "AFTER_ARRIVAL"
    ? dateFromInput(inputData.expectedArrivalDate || inputData.expectedPaymentDate)
    : (!paymentTermType && before ? before.expectedArrivalDate : null);
  const expectedShipmentDate = !paymentTermType && before ? before.expectedShipmentDate : null;
  const blDate = paymentTermType === "COPY_BL" ? dateFromInput(inputData.blDate) : (!paymentTermType && before ? before.blDate : null);
  const creditDays = ["OA", "AFTER_ARRIVAL"].includes(String(paymentTermType)) ? Number(inputData.creditDays) : (!paymentTermType && before ? before.creditDays : null);
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
    ? normalizeInstallments(inputData.paymentInstallments, finalReceivableAmount, exchangeRate)
    : (!paymentTermType && before ? before.paymentInstallments : null);
  if (dueDate && createdAt && dueDate < new Date(createdAt.toISOString().slice(0, 10))) throw codedError("到期日不能早于订单创建日期", 400, "DUE_DATE_BEFORE_ORDER_DATE");
  return { paymentTermInfo, paymentTermType, paymentTerm, depositRatio, actualShipmentDate, expectedArrivalDate, expectedShipmentDate, blDate, creditDays, dueDate, expectedPaymentDate, paymentInstallments };
}

function buildReceivableOrderData(params: Record<string, any>): Prisma.ReceivableOrderUncheckedCreateInput {
  const { inputData, before, customer, businessEntity, orderNo, blNo, currentActorId, salespersonUserId, currency, exchange, orderAmounts, payment } = params;
  const exchangeRate = exchange.exchangeRate;
  return {
    orderNo,
    blNo,
    customerId: customer.id,
    customerNameSnapshot: before && before.customerId === customer.id ? before.customerNameSnapshot : customer.name,
    businessEntityId: businessEntity.id,
    businessEntityNameSnapshot: businessEntity.name,
    salespersonUserId,
    salespersonCommissionRate: resolveSalespersonCommissionRate(customer),
    country: optional(customer.country),
    currency,
    exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    estimatedReceivableAmount: orderAmounts.estimatedReceivableAmount,
    estimatedReceivableAmountCny: amountCny(orderAmounts.estimatedReceivableAmount, exchangeRate),
    actualShipmentAmount: orderAmounts.actualShipmentAmount,
    actualShipmentAmountCny: orderAmounts.actualShipmentAmount == null ? null : amountCny(orderAmounts.actualShipmentAmount, exchangeRate),
    actualShipmentDate: payment.actualShipmentDate,
    finalReceivableAmount: orderAmounts.finalReceivableAmount,
    finalReceivableAmountCny: amountCny(orderAmounts.finalReceivableAmount, exchangeRate),
    receivableAmount: orderAmounts.finalReceivableAmount,
    receivableAmountCny: amountCny(orderAmounts.finalReceivableAmount, exchangeRate),
    tradeTerm: TRADE_TERMS.includes(String(inputData.tradeTerm || "")) ? String(inputData.tradeTerm) : "FOB",
    paymentTerm: payment.paymentTerm,
    paymentTermType: paymentTermTypeValue(payment.paymentTermType),
    depositRatio: payment.depositRatio,
    expectedPaymentDate: payment.expectedPaymentDate,
    expectedArrivalDate: payment.expectedArrivalDate,
    expectedShipmentDate: payment.expectedShipmentDate,
    blDate: payment.blDate,
    paymentInstallments: payment.paymentInstallments == null ? Prisma.DbNull : payment.paymentInstallments,
    creditDays: payment.creditDays,
    dueDate: payment.dueDate,
    reminderDays: normalizeReminderDaysInput(inputData.reminderDays ?? 7),
    status: ORDER_STATUSES.includes(String(inputData.status || "")) ? String(inputData.status) : "已确认",
    remark: optionalLimitedText(inputData.remark, "备注", MAX_ORDER_REMARK_LENGTH),
    updatedById: currentActorId,
    ...(before ? {} : { createdById: currentActorId }),
  };
}

function normalizedOrderTradeTerm(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function isExwOrderInput(inputData: OrderInput, order: { tradeTerm?: string | null } = {}) {
  return normalizedOrderTradeTerm(inputData.tradeTerm ?? order.tradeTerm).includes("EXW");
}

async function maybeSyncOrderLogisticsSuppliers(order: any, inputData: OrderInput, actor: ActorLike) {
  const hasInput = inputHasOwn(inputData, "logisticsSupplierIds") || inputHasOwn(inputData, "logisticsSuppliers");
  const logisticsSupplierIds = normalizeOrderLogisticsSupplierIds(inputData);
  const allowEmpty = isExwOrderInput(inputData, order);
  const logisticsSettings = await getExchangeRateSettings();
  if (!hasInput && logisticsSettings.allowMultipleOrderLogisticsSuppliers) return order;
  if (!hasInput && !logisticsSettings.allowMultipleOrderLogisticsSuppliers) {
    const existingCount = Array.isArray(order.logisticsSuppliers)
      ? order.logisticsSuppliers.length
      : await prisma.orderLogisticsSupplier.count({ where: { orderId: order.id } });
    if (existingCount > 0) return order;
  }
  await syncOrderLogisticsSuppliers(order.id, logisticsSupplierIds, actor, { allowEmpty });
  return await prisma.receivableOrder.findUnique({ where: { id: order.id }, include: includeOrderRelations() }) || order;
}

async function maybeSyncOrderStatus(order: any, actualShipmentAmountChanged: boolean) {
  const shouldSyncStatus = actualShipmentAmountChanged || order.payments?.some(confirmedPayment);
  if (!shouldSyncStatus) return order;
  try {
    return await syncOrderStatus(order.id) || order;
  } catch (error: unknown) {
    logServerError("订单状态同步失败", error, { orderId: order.id });
    return order;
  }
}

export async function deleteOrder(request: AuditRequestLike, actor: ActorLike, id: string) {
  assertWrite(actor, "orders");
  const currentActorId = actorId(actor);
  const before = await prisma.receivableOrder.findUnique({ where: { id }, include: includeOrderRelations() });
  if (!before || before.deletedAt) throw permissionError("应收订单不存在或已删除", 404);
  if (!canAccessOrder(actor, before)) throw codedError("无权限删除该应收订单", 403, "ORDER_PERMISSION_DENIED");
  const row = await prisma.receivableOrder.update({ where: { id }, data: { deletedAt: new Date(), updatedById: currentActorId } });
  await runNonCriticalTask("订单删除操作日志写入", () => writeAudit(request, actor, "删除应收订单", "receivable_orders", id, before, row));
}

export async function syncOrderStatus(orderId: string) {
  const order = await prisma.receivableOrder.findUnique({ where: { id: orderId }, include: includeOrderRelations() });
  if (!order || ["草稿", "已关闭", "已取消"].includes(order.status)) return order;
  const summary = summarizeOrder(order);
  let status = order.status;
  if (Number(summary.overpaidCny || 0) > 0) status = "多收款";
  else if (Number(summary.outstandingCny || 0) <= 0) status = "已收齐";
  else if (Number(summary.confirmedPaymentsCny || 0) > 0) status = "部分收款";
  else if (["部分收款", "已收齐", "多收款"].includes(order.status)) status = order.actualShipmentAmount == null ? "已确认" : "已发货";
  if (status !== order.status) {
    return prisma.receivableOrder.update({ where: { id: orderId }, data: { status }, include: includeOrderRelations() });
  }
  return order;
}
