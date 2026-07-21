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
  dateFromInput,
  deriveOrderCollectionStatus,
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
  serializeOrder,
  summarizeOrder,
  todayInputInChina,
  writeAudit,
} from "./shared";
import { assertCustomerScope, resolveSalespersonUserId } from "./shared-admin";
import { canAccessOrder, validateDuplicateOrder } from "./order-access";
import { syncOrderLogisticsSuppliers } from "./masters-access";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
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

const ORDER_WRITE_TRANSACTION_MAX_ATTEMPTS = 3;
const ORDER_COLLECTION_STATUSES = ["部分收款", "已收齐", "多收款"];
const ORDER_CURRENCY_LOCK_PAYMENT_STATUSES = ["待确认", "已到账"];

function isOrderWriteSerializationConflict(error: unknown) {
  return String((error as { code?: string })?.code || "") === "P2034";
}

async function runOrderWriteTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= ORDER_WRITE_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 15000,
      });
    } catch (error: unknown) {
      if (!isOrderWriteSerializationConflict(error)) {
        throw error;
      }
      if (attempt === ORDER_WRITE_TRANSACTION_MAX_ATTEMPTS) {
        throw codedError("订单刚刚被其他操作更新，请刷新后重试。", 409, "ORDER_UPDATE_CONFLICT");
      }
    }
  }
  throw new Error("订单事务重试次数已耗尽");
}

export async function saveOrder(request: AuditRequestLike, actor: ActorLike, input: unknown, id: string | null = null) {
  assertWrite(actor, "orders");
  const currentActorId = actorId(actor);
  const currentActor = { ...(actor || {}), id: currentActorId, role: actorRole(actor) };
  const inputData = assertInputSchema(assertJsonObject(input), RECEIVABLE_ORDER_INPUT_SCHEMA) as OrderInput;
  const before = id ? await prisma.receivableOrder.findFirst({ where: { id, deletedAt: null }, include: includeOrderRelations() }) : null;
  if (id && !before) throw codedError("应收订单不存在或已删除", 404, "ORDER_NOT_FOUND");
  if (before && !canAccessOrder(actor, before)) throw codedError("无权限修改该应收订单", 403, "ORDER_PERMISSION_DENIED");
  const expectedUpdatedAt = expectedOrderUpdatedAt(inputData, before);
  const customerId = requireText(inputData.customerId, "客户");
  const orderNo = requireLimitedText(inputData.orderNo, "订单号", MAX_ORDER_NO_LENGTH);
  const blNo = optionalLimitedText(inputData.blNo || inputData.billOfLadingNo, "提单号", MAX_BL_NO_LENGTH);

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
  const order = await runOrderWriteTransaction(async (tx) => {
    if (id) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        id,
        "该订单已提交退税并归档，修改前请先取消归档。",
      );
      await assertCommissionOrderWritableInTransaction(tx, id);
    }
    const current = id
      ? await tx.receivableOrder.findFirst({ where: { id, deletedAt: null }, include: includeOrderRelations() })
      : null;
    assertCurrentOrderWritable(current, id, actor, expectedUpdatedAt);
    const transactionCustomer = await assertCustomerScope(actor, customerId, tx);
    const duplicate = await validateDuplicateOrder(orderNo, id, tx);
    if (duplicate) throw codedError("订单号已存在，不能重复提交", 409, "ORDER_DUPLICATE");
    await assertNoUnfinishedOrderDocuments(id, tx);
    const transactionSalespersonUserId = await resolveSalespersonUserId(inputData, actor, transactionCustomer, current, tx);
    const transactionBusinessEntity = await resolveBusinessEntityForOrderInput(inputData, current, tx);
    if (current?.businessEntityId && transactionBusinessEntity.id !== current.businessEntityId) {
      throw codedError("已有订单如需变更业务主体，请使用业务主体转移操作。", 400, "BUSINESS_ENTITY_TRANSFER_REQUIRED");
    }
    if (current && normalizedCurrency(current.currency) !== currency && hasCurrencyLockPayments(current.payments)) {
      throw codedError("订单已有待确认或已到账收款，不能修改币种；如需更正请先处理收款记录。", 409, "ORDER_CURRENCY_LOCKED_BY_PAYMENTS");
    }

    const transactionData = buildReceivableOrderData({
      inputData,
      before: current,
      customer: transactionCustomer,
      businessEntity: transactionBusinessEntity,
      orderNo,
      blNo,
      currentActorId,
      salespersonUserId: transactionSalespersonUserId,
      currency,
      exchange,
      orderAmounts,
      payment,
    });
    const writeData = withServerControlledCollectionStatus(transactionData, current);
    let saved;
    if (id && current) {
      const updated = await tx.receivableOrder.updateMany({
        where: { id, deletedAt: null, updatedAt: current.updatedAt },
        data: writeData as Prisma.ReceivableOrderUncheckedUpdateManyInput,
      });
      if (updated.count !== 1) {
        throw codedError("订单刚刚被其他操作更新，请刷新后重试。", 409, "ORDER_UPDATE_CONFLICT");
      }
      saved = await tx.receivableOrder.findUnique({ where: { id }, include: includeOrderRelations() });
      if (!saved) throw codedError("应收订单不存在或已删除", 404, "ORDER_NOT_FOUND");
    } else {
      saved = await tx.receivableOrder.create({ data: writeData, include: includeOrderRelations() });
    }
    const syncedOrder = await syncOrderStatusInTransaction(tx, saved);
    const orderWithSuppliers = await maybeSyncOrderLogisticsSuppliersInTransaction(tx, syncedOrder, inputData, actor);
    await writeAudit(
      request,
      actor,
      id ? "更新应收订单" : "新增应收订单",
      "receivable_orders",
      orderWithSuppliers.id,
      current,
      orderWithSuppliers,
      tx,
    );
    return orderWithSuppliers;
  });
  refreshTaxRefundCompleteness(order.id).catch((error) => logServerError("退税资料完整度刷新失败", error, { orderId: order.id }));
  return serializeOrder(order);
}

function expectedOrderUpdatedAt(inputData: OrderInput, before: { updatedAt?: Date | null } | null) {
  const expectedText = optional(inputData.expectedUpdatedAt || inputData.updatedAt);
  if (!expectedText) return before?.updatedAt || null;
  const expected = new Date(expectedText);
  if (Number.isNaN(expected.getTime())) {
    throw codedError("订单版本无效，请刷新后重试。", 400, "ORDER_UPDATE_VERSION_INVALID");
  }
  return expected;
}

function assertCurrentOrderWritable(
  current: Record<string, any> | null,
  id: string | null,
  actor: ActorLike,
  expectedUpdatedAt: Date | null,
) {
  if (!id) return;
  if (!current) throw codedError("应收订单不存在或已删除", 404, "ORDER_NOT_FOUND");
  if (!canAccessOrder(actor, current)) throw codedError("无权限修改该应收订单", 403, "ORDER_PERMISSION_DENIED");
  if (current.status === "已关闭" && actorRole(actor) !== "管理员") {
    throw codedError("已关闭订单不能修改", 400, "ORDER_CLOSED");
  }
  if (expectedUpdatedAt && current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw codedError("订单已被其他人或收款操作更新，请刷新后重试。", 409, "ORDER_UPDATE_CONFLICT");
  }
}

function normalizedCurrency(value: unknown) {
  return String(value || "CNY").trim().toUpperCase();
}

function hasCurrencyLockPayments(payments: Array<{ status?: string | null }> = []) {
  return payments.some((payment) => ORDER_CURRENCY_LOCK_PAYMENT_STATUSES.includes(String(payment.status || "")));
}

function withServerControlledCollectionStatus(
  data: Prisma.ReceivableOrderUncheckedCreateInput,
  current: { status?: string | null } | null,
) {
  const requestedStatus = String(data.status || "");
  if (!ORDER_COLLECTION_STATUSES.includes(requestedStatus)) return data;
  const currentStatus = String(current?.status || "");
  return {
    ...data,
    status: currentStatus || (data.actualShipmentAmount == null ? "已确认" : "已发货"),
  };
}

async function assertNoUnfinishedOrderDocuments(
  id: string | null,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  if (!id) return;
  const unfinishedDocuments = await client.orderDocument.count({
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

async function maybeSyncOrderLogisticsSuppliersInTransaction(
  tx: Prisma.TransactionClient,
  order: any,
  inputData: OrderInput,
  actor: ActorLike,
) {
  const hasInput = inputHasOwn(inputData, "logisticsSupplierIds") || inputHasOwn(inputData, "logisticsSuppliers");
  const logisticsSupplierIds = normalizeOrderLogisticsSupplierIds(inputData);
  const allowEmpty = isExwOrderInput(inputData, order);
  const logisticsSettings = await getExchangeRateSettings();
  if (!hasInput && logisticsSettings.allowMultipleOrderLogisticsSuppliers) return order;
  if (!hasInput && !logisticsSettings.allowMultipleOrderLogisticsSuppliers) {
    const existingCount = Array.isArray(order.logisticsSuppliers)
      ? order.logisticsSuppliers.length
      : await tx.orderLogisticsSupplier.count({ where: { orderId: order.id } });
    if (existingCount > 0) return order;
  }
  await syncOrderLogisticsSuppliers(order.id, logisticsSupplierIds, actor, { allowEmpty, client: tx });
  return await tx.receivableOrder.findUnique({ where: { id: order.id }, include: includeOrderRelations() }) || order;
}

async function syncOrderStatusInTransaction(tx: Prisma.TransactionClient, order: any | null) {
  if (!order || ["草稿", "已关闭", "已取消"].includes(order.status)) return order;
  const summary = summarizeOrder(order);
  if (summary.hasArrivedPaymentCurrencyMismatch) return order;
  const status = deriveOrderCollectionStatus({
    currentStatus: order.status,
    actualShipmentAmount: order.actualShipmentAmount,
    receivedAmount: summary.confirmedPaymentsAmount,
    outstandingAmount: summary.outstandingAmount,
    overpaidAmount: summary.overpaidAmount,
  });
  if (status !== order.status) {
    return tx.receivableOrder.update({ where: { id: order.id }, data: { status }, include: includeOrderRelations() });
  }
  return order;
}

export async function deleteOrder(request: AuditRequestLike, actor: ActorLike, id: string) {
  assertWrite(actor, "orders");
  const currentActorId = actorId(actor);
  await runOrderWriteTransaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      id,
      "该订单已提交退税并归档，删除前请先取消归档。",
    );
    await assertCommissionOrderWritableInTransaction(tx, id);
    const before = await tx.receivableOrder.findUnique({ where: { id }, include: includeOrderRelations() });
    if (!before || before.deletedAt) throw permissionError("应收订单不存在或已删除", 404);
    if (!canAccessOrder(actor, before)) throw codedError("无权限删除该应收订单", 403, "ORDER_PERMISSION_DENIED");
    const row = await tx.receivableOrder.update({ where: { id }, data: { deletedAt: new Date(), updatedById: currentActorId } });
    await writeAudit(request, actor, "删除应收订单", "receivable_orders", id, before, row, tx);
  });
}

export async function syncOrderStatus(orderId: string) {
  return runOrderWriteTransaction(async (tx) => {
    const order = await tx.receivableOrder.findUnique({ where: { id: orderId }, include: includeOrderRelations() });
    return syncOrderStatusInTransaction(tx, order);
  });
}
