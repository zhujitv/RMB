import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  PAYMENT_STATUSES,
  PAYMENT_INPUT_SCHEMA,
  PAYMENT_TYPES,
  ORDER_COST_STATUS_VOID,
  amountCny,
  assertInputSchema,
  assertJsonObject,
  assertWrite,
  codedError,
  dateFromInput,
  dateToInput,
  deriveOrderCollectionBalance,
  deriveOrderCollectionStatus,
  effectivePermissions,
  inputHasOwn,
  logServerError,
  nonEmpty,
  optional,
  pageParams,
  pageResult,
  paymentAmountForOrderCurrency,
  permissionError,
  requirePositive,
  requireText,
  resolveExchangeRateSnapshot,
  serializePayment,
  type PaymentDto,
  todayInputInChina,
  writeAudit,
} from "./shared";
import { assertRead } from "./shared-auth";
import {
  assertOrderCanReceivePayment,
  assertOrderOpen,
  canAccessOrder,
  orderAccessWhere,
} from "./order-access";
import { summarizeCurrencyTotals } from "./currency-totals";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";

type ActorLike = ({
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} & Record<string, unknown>) | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type QueryLike = URLSearchParams;
type PaymentInput = Record<string, unknown>;
type PaymentListFilters = {
  keyword: string;
  currency: string;
  paymentType: string;
  paymentStatus: string;
  month: string;
};

const FOREIGN_PAYMENT_CURRENCIES = new Set(["USD", "EUR", "GBP", "HKD"]);
const FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE = "该订单尚无历史收款，不能登记尾款，请选择预付款、分批款或全款。";
const PAYMENT_WRITE_TRANSACTION_MAX_ATTEMPTS = 3;
const PAYMENT_CURRENCY_MISMATCH_SYNC_REASON = "PAYMENT_CURRENCY_MISMATCH";

const paymentAccessOrderInclude = Prisma.validator<Prisma.ReceivableOrderInclude>()({
  customer: true,
  costs: {
    where: { deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } },
    select: { createdById: true, status: true, deletedAt: true },
  },
});

const paymentAccessInclude = Prisma.validator<Prisma.PaymentInclude>()({
  order: { include: paymentAccessOrderInclude },
});

const paymentResponseInclude = Prisma.validator<Prisma.PaymentInclude>()({
  order: { include: { customer: true, businessEntity: true, salesperson: true } },
  createdBy: true,
  updatedBy: true,
});

function actorId(actor: ActorLike) {
  return requireText(actor?.id, "当前用户");
}

function actorRole(actor: ActorLike) {
  return String(actor?.role || "");
}

async function syncOrderStatusInPaymentTransaction(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.receivableOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      actualShipmentAmount: true,
      currency: true,
      exchangeRate: true,
      finalReceivableAmount: true,
    },
  });
  if (!order || ["草稿", "已关闭", "已取消"].includes(order.status)) {
    return { order, skippedReason: null } as const;
  }
  const arrivedPaymentGroups = await tx.payment.groupBy({
    by: ["currency"],
    where: {
      orderId,
      status: "已到账",
      deletedAt: null,
    },
    _sum: { amount: true, amountCny: true },
  });
  const orderCurrency = String(order.currency || "CNY").toUpperCase();
  if (arrivedPaymentGroups.some((group) => String(group.currency || "").toUpperCase() !== orderCurrency)) {
    return { order, skippedReason: PAYMENT_CURRENCY_MISMATCH_SYNC_REASON } as const;
  }
  const receivedAmount = arrivedPaymentGroups.reduce(
    (sum, group) => sum + paymentAmountForOrderCurrency({
      currency: group.currency,
      amount: group._sum.amount,
      amountCny: group._sum.amountCny,
    }, order.currency, order.exchangeRate),
    0,
  );
  const collection = deriveOrderCollectionBalance({
    receivableAmount: order.finalReceivableAmount,
    receivedAmount,
    receivedAmountCny: arrivedPaymentGroups.reduce((sum, group) => sum + Number(group._sum.amountCny || 0), 0),
    orderExchangeRate: order.exchangeRate,
  });
  const status = deriveOrderCollectionStatus({
    currentStatus: order.status,
    actualShipmentAmount: order.actualShipmentAmount,
    receivedAmount,
    outstandingAmount: collection.outstandingAmount,
    overpaidAmount: collection.overpaidAmount,
  });
  if (status !== order.status) {
    const updatedOrder = await tx.receivableOrder.update({
      where: { id: orderId },
      data: { status },
      select: { id: true, status: true },
    });
    return { order: updatedOrder, skippedReason: null } as const;
  }
  return { order, skippedReason: null } as const;
}

type PaymentStatusSyncResult = Awaited<ReturnType<typeof syncOrderStatusInPaymentTransaction>>;

function logSkippedPaymentStatusSyncs(results: PaymentStatusSyncResult[]) {
  for (const result of results) {
    if (result?.skippedReason !== PAYMENT_CURRENCY_MISMATCH_SYNC_REASON) continue;
    logServerError(
      "订单收款状态同步已跳过",
      new Error("存在与订单币种不一致的历史到账记录"),
      { orderId: result.order?.id || "", reason: result.skippedReason },
    );
  }
}

function isPaymentWriteSerializationConflict(error: unknown) {
  return String((error as { code?: string })?.code || "") === "P2034";
}

function paymentWriteSerializationConflict() {
  return Object.assign(new Error("收款记录在写入期间发生变化，请重试"), { code: "P2034" });
}

function expectedPaymentUpdatedAt(input: PaymentInput, before: { updatedAt?: Date | null } | null) {
  const expectedText = nonEmpty(input.expectedUpdatedAt || input.updatedAt);
  if (!expectedText) return before?.updatedAt || null;
  const expected = new Date(expectedText);
  if (Number.isNaN(expected.getTime())) {
    throw codedError("收款记录版本无效，请刷新后重试。", 400, "PAYMENT_UPDATE_VERSION_INVALID");
  }
  return expected;
}

function assertCurrentPaymentVersion(
  current: { updatedAt: Date } | null,
  expectedUpdatedAt: Date | null,
) {
  if (current && expectedUpdatedAt && current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw codedError("收款记录已被其他人更新，请刷新后重试。", 409, "PAYMENT_UPDATE_CONFLICT");
  }
}

async function runPaymentWriteTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= PAYMENT_WRITE_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 15000,
      });
    } catch (error: unknown) {
      if (!isPaymentWriteSerializationConflict(error)) throw error;
      if (attempt === PAYMENT_WRITE_TRANSACTION_MAX_ATTEMPTS) {
        throw codedError("收款记录刚刚被其他操作更新，请刷新后重试。", 409, "PAYMENT_UPDATE_CONFLICT");
      }
    }
  }
  throw codedError("收款记录刚刚被其他操作更新，请刷新后重试。", 409, "PAYMENT_UPDATE_CONFLICT");
}

async function loadCurrentPaymentInTransaction(
  tx: Prisma.TransactionClient,
  id: string,
  actor: ActorLike,
  operation: "update" | "delete",
) {
  const payment = await tx.payment.findUnique({
    where: { id },
    include: paymentAccessInclude,
  });
  if (!payment || payment.deletedAt) {
    if (operation === "update") {
      throw codedError("收款记录不存在或已删除", 404, "PAYMENT_NOT_FOUND");
    }
    throw permissionError("收款记录不存在或已删除", 404);
  }
  if (!canAccessOrder(actor, payment.order)) {
    throw permissionError(operation === "update" ? "无权限更新该收款记录" : "无权限删除该收款记录");
  }
  return payment;
}

async function loadTargetOrderInPaymentTransaction(
  tx: Prisma.TransactionClient,
  orderId: string,
  actor: ActorLike,
) {
  const order = await tx.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: paymentAccessOrderInclude,
  });
  if (!order) {
    throw codedError("请选择有效应收订单", 400, "ORDER_REQUIRED");
  }
  if (!canAccessOrder(actor, order)) {
    throw codedError("无权限访问该应收订单", 403, "ORDER_PERMISSION_DENIED");
  }
  if (["已关闭", "已取消"].includes(order.status) && actorRole(actor) !== "管理员") {
    throw codedError("已关闭或已取消订单不能继续新增收款或成本", 400, "ORDER_CLOSED");
  }
  return order;
}

async function updatePaymentWithCas(
  tx: Prisma.TransactionClient,
  currentPayment: Awaited<ReturnType<typeof loadCurrentPaymentInTransaction>>,
  data: Prisma.PaymentUncheckedCreateInput,
) {
  const update = await tx.payment.updateMany({
    where: {
      id: currentPayment.id,
      orderId: currentPayment.orderId,
      deletedAt: null,
      updatedAt: currentPayment.updatedAt,
    },
    data: data as Prisma.PaymentUncheckedUpdateManyInput,
  });
  if (update.count !== 1) throw paymentWriteSerializationConflict();
  const saved = await tx.payment.findUnique({
    where: { id: currentPayment.id },
    include: paymentResponseInclude,
  });
  if (!saved || saved.deletedAt) throw paymentWriteSerializationConflict();
  return saved;
}

type PageResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type PaymentListRow = PaymentDto;
const PAYMENT_UNPAGINATED_SCAN_LIMIT = 1000;

type PaginatedPaymentList = PageResult<PaymentListRow> & {
  summary: {
    arrivedAmountCny: number;
    pendingAmountCny: number;
    arrivedCurrencyTotals: ReturnType<typeof summarizeCurrencyTotals>;
    pendingCurrencyTotals: ReturnType<typeof summarizeCurrencyTotals>;
    currentMonthCount: number;
  };
};

export async function listPayments(query: QueryLike, actor: ActorLike | null, options: { paginated: true }): Promise<PaginatedPaymentList>;
export async function listPayments(query: QueryLike, actor?: ActorLike | null, options?: { paginated?: false }): Promise<PaymentListRow[]>;
export async function listPayments(query: QueryLike, actor: ActorLike | null = null, options: { paginated?: boolean } = {}): Promise<PaymentListRow[] | PaginatedPaymentList> {
  assertRead(actor, "payments");
  const accessWhere = orderAccessWhere(actor);
  const filters = paymentListFiltersFromQuery(query);
  if (options.paginated) {
    const { page, pageSize } = pageParams(query, 20, 100);
    const where = paymentListWhere(filters, accessWhere);
    const currentMonth = todayInputInChina().slice(0, 7);
    const currentMonthStart = new Date(`${currentMonth}-01T00:00:00.000Z`);
    const currentMonthEnd = new Date(currentMonthStart);
    currentMonthEnd.setUTCMonth(currentMonthEnd.getUTCMonth() + 1);
    const [total, rows, arrivedGroups, pendingGroups, currentMonthCount] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        include: { order: { include: { customer: true, businessEntity: true, salesperson: true } }, createdBy: true, updatedBy: true },
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.payment.groupBy({
        by: ["currency"],
        where: withPaymentWhere(where, { status: "已到账" }),
        _sum: { amount: true, amountCny: true },
      }),
      prisma.payment.groupBy({
        by: ["currency"],
        where: withPaymentWhere(where, { status: "待确认" }),
        _sum: { amount: true, amountCny: true },
      }),
      prisma.payment.count({
        where: withPaymentWhere(where, {
          OR: [
            { paymentDate: { gte: currentMonthStart, lt: currentMonthEnd } },
            { createdAt: { gte: currentMonthStart, lt: currentMonthEnd } },
          ],
        }),
      }),
    ]);
    const arrivedCurrencyTotals = summarizeCurrencyTotals(arrivedGroups.map((group) => ({
      currency: group.currency,
      amount: group._sum.amount,
      amountCny: group._sum.amountCny,
    })));
    const pendingCurrencyTotals = summarizeCurrencyTotals(pendingGroups.map((group) => ({
      currency: group.currency,
      amount: group._sum.amount,
      amountCny: group._sum.amountCny,
    })));
    return {
      ...pageResult(rows.map(serializePayment), total, page, pageSize),
      summary: {
        arrivedAmountCny: arrivedCurrencyTotals.totalCny,
        pendingAmountCny: pendingCurrencyTotals.totalCny,
        arrivedCurrencyTotals,
        pendingCurrencyTotals,
        currentMonthCount,
      },
    };
  }
  const rows = await prisma.payment.findMany({
    where: paymentListWhere(filters, accessWhere),
    include: { order: { include: { customer: true, businessEntity: true, salesperson: true } }, createdBy: true, updatedBy: true },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    take: PAYMENT_UNPAGINATED_SCAN_LIMIT,
  });
  return rows.map(serializePayment);
}

function withPaymentWhere(where: Prisma.PaymentWhereInput, condition: Prisma.PaymentWhereInput): Prisma.PaymentWhereInput {
  return { AND: [where, condition] };
}

function paymentListFiltersFromQuery(query: QueryLike): PaymentListFilters {
  const keyword = nonEmpty(query?.get("keyword"));
  return {
    keyword,
    currency: nonEmpty(query?.get("currency")),
    paymentType: nonEmpty(query?.get("paymentType")),
    paymentStatus: nonEmpty(query?.get("paymentStatus")),
    month: nonEmpty(query?.get("month")),
  };
}

function paymentListWhere(filters: PaymentListFilters, accessWhere: Prisma.ReceivableOrderWhereInput): Prisma.PaymentWhereInput {
  const keyword = filters.keyword;
  const clauses: Prisma.PaymentWhereInput[] = [{ deletedAt: null }, { order: { is: accessWhere } }];
  if (filters.currency) clauses.push({ currency: filters.currency });
  if (filters.paymentType) clauses.push({ paymentType: filters.paymentType });
  if (filters.paymentStatus) clauses.push({ status: filters.paymentStatus });
  if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
    const start = new Date(`${filters.month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    clauses.push({ OR: [{ paymentDate: { gte: start, lt: end } }, { createdAt: { gte: start, lt: end } }] });
  }
  if (keyword) {
    clauses.push({
      OR: [
        { bankReference: { contains: keyword, mode: "insensitive" } },
        { remark: { contains: keyword, mode: "insensitive" } },
        { paymentType: { contains: keyword, mode: "insensitive" } },
        {
          order: {
            is: {
              OR: [
                { orderNo: { contains: keyword, mode: "insensitive" } },
                { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
                { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
                { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
              ],
            },
          },
        },
      ],
    });
  }
  return { AND: clauses };
}

function assertPaymentInputRequiredFields(input: PaymentInput) {
  if (!nonEmpty(input.orderId)) throw codedError("请选择关联订单", 400, "PAYMENT_ORDER_REQUIRED");
  if (!nonEmpty(input.paymentDate)) throw codedError("请选择收款日期", 400, "PAYMENT_DATE_REQUIRED");
  if (!dateFromInput(input.paymentDate)) throw codedError("请选择收款日期", 400, "PAYMENT_DATE_REQUIRED");
  if (!nonEmpty(input.paymentType)) throw codedError("请选择收款类型", 400, "PAYMENT_TYPE_REQUIRED");
  if (!nonEmpty(input.amount)) throw codedError("请输入收款金额", 400, "PAYMENT_AMOUNT_REQUIRED");
  if (!(Number(input.amount) > 0)) throw codedError("收款金额必须大于 0", 400, "PAYMENT_AMOUNT_POSITIVE_REQUIRED");
  if (!nonEmpty(input.currency)) throw codedError("请选择币种", 400, "PAYMENT_CURRENCY_REQUIRED");
}

function assertPaymentExchangeInput(input: PaymentInput, currency: string) {
  if (currency === "CNY") return;
  if (FOREIGN_PAYMENT_CURRENCIES.has(currency) && !nonEmpty(input.exchangeRate)) {
    throw codedError("汇率不能为空", 400, "PAYMENT_EXCHANGE_RATE_REQUIRED");
  }
  if (FOREIGN_PAYMENT_CURRENCIES.has(currency) && !(Number(input.exchangeRate) > 0)) {
    throw codedError("汇率必须大于 0", 400, "PAYMENT_EXCHANGE_RATE_POSITIVE_REQUIRED");
  }
}

async function assertFinalPaymentHasHistory(
  orderId: string,
  paymentType: string,
  currentPaymentId: string | null,
  tx: Prisma.TransactionClient | null = null,
) {
  if (paymentType !== "尾款") return;
  const query = {
    where: {
      orderId,
      status: "已到账",
      deletedAt: null,
      ...(currentPaymentId ? { NOT: { id: currentPaymentId } } : {}),
    },
    _sum: { amountCny: true },
  } satisfies Prisma.PaymentAggregateArgs;
  const historicalArrived = tx
    ? await tx.payment.aggregate(query)
    : await prisma.payment.aggregate(query);
  if (Number(historicalArrived._sum.amountCny || 0) <= 0) {
    throw codedError(FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE, 400, "PAYMENT_FINAL_REQUIRES_HISTORY");
  }
}

export async function savePayment(request: AuditRequestLike, actor: ActorLike, input: unknown, id: string | null = null) {
  assertWrite(actor, "payments");
  const currentActorId = actorId(actor);
  const currentActor = { ...(actor || {}), id: currentActorId, role: actorRole(actor) };
  const jsonInput = assertJsonObject(input);
  assertPaymentInputRequiredFields(jsonInput);
  const inputData = assertInputSchema(jsonInput, PAYMENT_INPUT_SCHEMA) as PaymentInput;
  const before = id ? await prisma.payment.findFirst({
    where: { id, deletedAt: null },
    include: {
      order: {
        include: {
          customer: true,
          costs: { where: { deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } }, select: { createdById: true, status: true, deletedAt: true } },
        },
      },
    },
  }) : null;
  if (id && !before) throw codedError("收款记录不存在或已删除", 404, "PAYMENT_NOT_FOUND");
  if (before && !canAccessOrder(actor, before.order)) {
    throw permissionError("无权限更新该收款记录");
  }
  const expectedUpdatedAt = id ? expectedPaymentUpdatedAt(inputData, before) : null;
  const order = await assertOrderOpen(requireText(inputData.orderId, "关联订单"), actor);
  if (!id || before?.orderId !== order.id) {
    await assertOrderCanReceivePayment(order);
  }
  const amount = requirePositive(inputData.amount, "收款金额");
  const paymentDate = dateFromInput(inputData.paymentDate);
  if (!paymentDate) throw codedError("请选择收款日期", 400, "PAYMENT_DATE_REQUIRED");
  const paymentType = requireText(inputData.paymentType, "收款类型");
  const orderCurrency = requireText(order.currency, "订单币种").toUpperCase();
  const requestedCurrency = requireText(inputData.currency, "币种").toUpperCase();
  if (requestedCurrency !== orderCurrency) {
    throw codedError("收款币种必须与订单币种一致。", 400, "PAYMENT_CURRENCY_MISMATCH");
  }
  assertPaymentExchangeInput(inputData, orderCurrency);
  await assertFinalPaymentHasHistory(order.id, paymentType, id);
  const exchangeInput: PaymentInput = orderCurrency === "CNY"
    ? {
      ...inputData,
      currency: orderCurrency,
      exchangeRate: 1,
      exchangeRateDate: dateToInput(paymentDate),
      exchangeRateSource: "系统",
      exchangeRateType: "人民币",
    }
    : { ...inputData, currency: orderCurrency };
  if (before) {
    if (!inputHasOwn(exchangeInput, "exchangeRateDate") && !inputHasOwn(exchangeInput, "rateDate") && before.exchangeRateDate) {
      exchangeInput.exchangeRateDate = dateToInput(before.exchangeRateDate);
    }
    if (!inputHasOwn(exchangeInput, "exchangeRateSource") && before.exchangeRateSource) {
      exchangeInput.exchangeRateSource = before.exchangeRateSource;
    }
    if (!inputHasOwn(exchangeInput, "exchangeRateType") && before.exchangeRateType) {
      exchangeInput.exchangeRateType = before.exchangeRateType;
    }
  }
  const exchange = await resolveExchangeRateSnapshot(exchangeInput, currentActor, {
    currency: orderCurrency,
    defaultDate: paymentDate,
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  const exchangeRate = exchange.exchangeRate;
  const requestedStatus = PAYMENT_STATUSES.includes(String(inputData.status || "")) ? String(inputData.status) : "待确认";
  const data: Prisma.PaymentUncheckedCreateInput = {
    orderId: order.id,
    paymentDate,
    currency: exchange.currency,
    exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
    amountCny: amountCny(amount, exchangeRate),
    paymentType: PAYMENT_TYPES.includes(paymentType) ? paymentType : "",
    status: requestedStatus,
    bankReference: optional(inputData.bankReference),
    remark: optional(inputData.remark),
    updatedById: currentActorId,
    ...(id ? {} : { createdById: currentActorId }),
  };
  const transactionResult = await runPaymentWriteTransaction(async (tx) => {
    const transactionBefore = id
      ? await loadCurrentPaymentInTransaction(tx, id, actor, "update")
      : null;
    assertCurrentPaymentVersion(transactionBefore, expectedUpdatedAt);
    const transactionOrder = await loadTargetOrderInPaymentTransaction(tx, order.id, actor);
    if (!id || transactionBefore?.orderId !== transactionOrder.id) {
      await assertOrderCanReceivePayment(transactionOrder);
    }
    const transactionOrderCurrency = requireText(transactionOrder.currency, "订单币种").toUpperCase();
    if (requestedCurrency !== transactionOrderCurrency || exchange.currency !== transactionOrderCurrency) {
      throw codedError("收款币种必须与订单币种一致。", 400, "PAYMENT_CURRENCY_MISMATCH");
    }
    const affectedOrderIds = [...new Set(
      [transactionOrder.id, transactionBefore?.orderId]
        .filter((value): value is string => Boolean(value)),
    )].sort();
    for (const affectedOrderId of affectedOrderIds) {
      await assertCommissionOrderWritableInTransaction(tx, affectedOrderId);
    }
    await assertFinalPaymentHasHistory(transactionOrder.id, paymentType, id, tx);

    const saved = transactionBefore
      ? await updatePaymentWithCas(tx, transactionBefore, data)
      : await tx.payment.create({ data, include: paymentResponseInclude });
    const statusSyncResults: PaymentStatusSyncResult[] = [];
    for (const affectedOrderId of affectedOrderIds) {
      statusSyncResults.push(await syncOrderStatusInPaymentTransaction(tx, affectedOrderId));
    }
    const auditAction = id && transactionBefore?.status !== requestedStatus
      ? `修改收款状态：${transactionBefore?.status || ""}→${requestedStatus}`
      : (id ? "更新收款" : "新增收款");
    await writeAudit(request, actor, auditAction, "payments", saved.id, transactionBefore, saved, tx);
    return { payment: saved, transactionBefore, statusSyncResults };
  });
  logSkippedPaymentStatusSyncs(transactionResult.statusSyncResults);
  return serializePayment(transactionResult.payment);
}

export async function deletePayment(
  request: AuditRequestLike,
  actor: ActorLike,
  id: string,
  expectedUpdatedAtInput: unknown = null,
) {
  assertWrite(actor, "payments");
  const currentActorId = actorId(actor);
  const before = await prisma.payment.findUnique({ where: { id }, include: { order: { include: { customer: true } } } });
  if (!before || before.deletedAt) throw permissionError("收款记录不存在或已删除", 404);
  if (!canAccessOrder(actor, before.order)) throw permissionError("无权限删除该收款记录");
  const expectedUpdatedAt = expectedPaymentUpdatedAt({ expectedUpdatedAt: expectedUpdatedAtInput }, before);
  const transactionResult = await runPaymentWriteTransaction(async (tx) => {
    const transactionBefore = await loadCurrentPaymentInTransaction(tx, id, actor, "delete");
    assertCurrentPaymentVersion(transactionBefore, expectedUpdatedAt);
    await assertCommissionOrderWritableInTransaction(tx, transactionBefore.orderId);
    const update = await tx.payment.updateMany({
      where: {
        id,
        orderId: transactionBefore.orderId,
        deletedAt: null,
        updatedAt: transactionBefore.updatedAt,
      },
      data: { deletedAt: new Date(), updatedById: currentActorId },
    });
    if (update.count !== 1) throw paymentWriteSerializationConflict();
    const saved = await tx.payment.findUnique({ where: { id } });
    if (!saved?.deletedAt) throw paymentWriteSerializationConflict();
    const statusSyncResult = await syncOrderStatusInPaymentTransaction(tx, transactionBefore.orderId);
    await writeAudit(request, actor, "删除收款", "payments", id, transactionBefore, saved, tx);
    return { payment: saved, transactionBefore, statusSyncResults: [statusSyncResult] };
  });
  logSkippedPaymentStatusSyncs(transactionResult.statusSyncResults);
}
