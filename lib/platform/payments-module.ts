import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  PAYMENT_STATUSES,
  PAYMENT_INPUT_SCHEMA,
  PAYMENT_TYPES,
  amountCny,
  assertInputSchema,
  assertJsonObject,
  assertWrite,
  codedError,
  dateFromInput,
  dateToInput,
  effectivePermissions,
  includeOrderRelations,
  inputHasOwn,
  nonEmpty,
  optional,
  pageParams,
  pageResult,
  permissionError,
  requirePositive,
  requireText,
  resolveExchangeRateSnapshot,
  runNonCriticalTask,
  serializePayment,
  summarizeOrder,
  type PaymentDto,
  todayInputInChina,
  writeAudit,
} from "./shared";
import { assertRead } from "./shared-auth";
import {
  assertOrderOpen,
  canAccessOrder,
  orderAccessWhere,
} from "./order-access";
import { summarizeCurrencyTotals } from "./currency-totals";

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

function actorId(actor: ActorLike) {
  return requireText(actor?.id, "当前用户");
}

function actorRole(actor: ActorLike) {
  return String(actor?.role || "");
}

async function syncOrderStatusInPaymentTransaction(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.receivableOrder.findUnique({
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
    return tx.receivableOrder.update({
      where: { id: orderId },
      data: { status },
      include: includeOrderRelations(),
    });
  }
  return order;
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

export async function savePayment(request: AuditRequestLike, actor: ActorLike, input: unknown, id: string | null = null) {
  assertWrite(actor, "payments");
  const currentActorId = actorId(actor);
  const currentActor = { ...(actor || {}), id: currentActorId, role: actorRole(actor) };
  const inputData = assertInputSchema(assertJsonObject(input), PAYMENT_INPUT_SCHEMA) as PaymentInput;
  const before = id ? await prisma.payment.findFirst({
    where: { id, deletedAt: null },
    include: {
      order: {
        include: {
          customer: true,
          costs: { where: { deletedAt: null }, select: { createdById: true, deletedAt: true } },
        },
      },
    },
  }) : null;
  if (id && !before) throw codedError("收款记录不存在或已删除", 404, "PAYMENT_NOT_FOUND");
  if (before && !canAccessOrder(actor, before.order)) {
    throw permissionError("无权限更新该收款记录");
  }
  const order = await assertOrderOpen(requireText(inputData.orderId, "关联订单"), actor);
  if (!id || before?.orderId !== order.id) {
    const { assertOrderCanReceivePayment } = await import("./order-access");
    await assertOrderCanReceivePayment(order);
  }
  const amount = requirePositive(inputData.amount, "收款金额");
  const paymentDate = dateFromInput(inputData.paymentDate) || dateFromInput(todayInputInChina()) || new Date();
  const orderCurrency = requireText(order.currency, "订单币种").toUpperCase();
  const requestedCurrency = requireText(inputData.currency || orderCurrency, "币种").toUpperCase();
  if (requestedCurrency !== orderCurrency) {
    throw codedError("收款币种必须与订单币种一致。", 400, "PAYMENT_CURRENCY_MISMATCH");
  }
  const exchangeInput: PaymentInput = { ...inputData, currency: orderCurrency };
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
    paymentType: PAYMENT_TYPES.includes(String(inputData.paymentType || "")) ? String(inputData.paymentType) : "",
    status: requestedStatus,
    bankReference: optional(inputData.bankReference),
    remark: optional(inputData.remark),
    updatedById: currentActorId,
    ...(id ? {} : { createdById: currentActorId }),
  };
  const payment = await prisma.$transaction(async (tx) => {
    const saved = id
      ? await tx.payment.update({ where: { id }, data, include: { order: { include: { customer: true, businessEntity: true, salesperson: true } }, createdBy: true, updatedBy: true } })
      : await tx.payment.create({ data, include: { order: { include: { customer: true, businessEntity: true, salesperson: true } }, createdBy: true, updatedBy: true } });
    await syncOrderStatusInPaymentTransaction(tx, order.id);
    if (before?.orderId && before.orderId !== order.id) {
      await syncOrderStatusInPaymentTransaction(tx, before.orderId);
    }
    return saved;
  });
  const auditAction = id && before?.status !== requestedStatus ? `修改收款状态：${before?.status || ""}→${requestedStatus}` : (id ? "更新收款" : "新增收款");
  await runNonCriticalTask("收款操作日志写入", () => writeAudit(request, actor, auditAction, "payments", payment.id, before, payment));
  return serializePayment(payment);
}

export async function deletePayment(request: AuditRequestLike, actor: ActorLike, id: string) {
  assertWrite(actor, "payments");
  const currentActorId = actorId(actor);
  const before = await prisma.payment.findUnique({ where: { id }, include: { order: { include: { customer: true } } } });
  if (!before || before.deletedAt) throw permissionError("收款记录不存在或已删除", 404);
  if (!canAccessOrder(actor, before.order)) throw permissionError("无权限删除该收款记录");
  const payment = await prisma.$transaction(async (tx) => {
    const saved = await tx.payment.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: currentActorId },
    });
    await syncOrderStatusInPaymentTransaction(tx, saved.orderId);
    return saved;
  });
  await runNonCriticalTask("收款删除操作日志写入", () => writeAudit(request, actor, "删除收款", "payments", id, before, payment));
}
