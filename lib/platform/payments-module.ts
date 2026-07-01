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
  effectivePermissions,
  includeOrderRelations,
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
import { syncOrderStatus } from "./orders-module";
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
  paymentStatus: string;
  month: string;
};

function actorId(actor: ActorLike) {
  return requireText(actor?.id, "当前用户");
}

function actorRole(actor: ActorLike) {
  return String(actor?.role || "");
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
        include: { order: { include: { customer: true, salesperson: true } }, createdBy: true, updatedBy: true },
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
    include: { order: { include: { customer: true, salesperson: true } }, createdBy: true, updatedBy: true },
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
    paymentStatus: nonEmpty(query?.get("paymentStatus")),
    month: nonEmpty(query?.get("month")),
  };
}

function paymentListWhere(filters: PaymentListFilters, accessWhere: Prisma.ReceivableOrderWhereInput): Prisma.PaymentWhereInput {
  const keyword = filters.keyword;
  const clauses: Prisma.PaymentWhereInput[] = [{ deletedAt: null }, { order: { is: accessWhere } }];
  if (filters.currency) clauses.push({ currency: filters.currency });
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
  const before = id ? await prisma.payment.findFirst({ where: { id, deletedAt: null } }) : null;
  if (id && !before) throw codedError("收款记录不存在或已删除", 404, "PAYMENT_NOT_FOUND");
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
  const exchange = await resolveExchangeRateSnapshot({ ...inputData, currency: orderCurrency }, currentActor, {
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
    paymentType: PAYMENT_TYPES.includes(String(inputData.paymentType || "")) ? String(inputData.paymentType) : "尾款",
    status: requestedStatus,
    bankReference: optional(inputData.bankReference),
    remark: optional(inputData.remark),
    updatedById: currentActorId,
    ...(id ? {} : { createdById: currentActorId }),
  };
  const payment = id
    ? await prisma.payment.update({ where: { id }, data, include: { order: { include: { customer: true, salesperson: true } }, createdBy: true, updatedBy: true } })
    : await prisma.payment.create({ data, include: { order: { include: { customer: true, salesperson: true } }, createdBy: true, updatedBy: true } });
  await syncOrderStatus(order.id);
  if (before?.orderId && before.orderId !== order.id) await syncOrderStatus(before.orderId);
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
  const payment = await prisma.payment.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: currentActorId },
  });
  await syncOrderStatus(payment.orderId);
  await runNonCriticalTask("收款删除操作日志写入", () => writeAudit(request, actor, "删除收款", "payments", id, before, payment));
}
