import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { nonEmpty, pageParams, pageResult, serializePayment, todayInputInChina, type PaymentDto } from "./shared";
import { assertRead } from "./shared-auth";
import { orderAccessWhere } from "./order-access";
import { summarizeCurrencyTotals } from "./currency-totals";
import type { ActorLike } from "./payments-types";

type PaymentListFilters = { keyword: string; currency: string; paymentType: string; paymentStatus: string; month: string };
type PageResult<T> = { rows: T[]; total: number; page: number; pageSize: number; totalPages: number };
export type PaymentListRow = PaymentDto;
type PaginatedPaymentList = PageResult<PaymentListRow> & { summary: {
  arrivedAmountCny: number; pendingAmountCny: number;
  arrivedCurrencyTotals: ReturnType<typeof summarizeCurrencyTotals>;
  pendingCurrencyTotals: ReturnType<typeof summarizeCurrencyTotals>; currentMonthCount: number;
} };

function withWhere(where: Prisma.PaymentWhereInput, condition: Prisma.PaymentWhereInput): Prisma.PaymentWhereInput {
  return { AND: [where, condition] };
}
function filtersFromQuery(query: URLSearchParams): PaymentListFilters {
  return { keyword: nonEmpty(query.get("keyword")), currency: nonEmpty(query.get("currency")),
    paymentType: nonEmpty(query.get("paymentType")), paymentStatus: nonEmpty(query.get("paymentStatus")), month: nonEmpty(query.get("month")) };
}
function paymentWhere(filters: PaymentListFilters, accessWhere: Prisma.ReceivableOrderWhereInput): Prisma.PaymentWhereInput {
  const clauses: Prisma.PaymentWhereInput[] = [{ deletedAt: null }, { order: { is: accessWhere } }];
  if (filters.currency) clauses.push({ currency: filters.currency });
  if (filters.paymentType) clauses.push({ paymentType: filters.paymentType });
  if (filters.paymentStatus) clauses.push({ status: filters.paymentStatus });
  if (/^\d{4}-\d{2}$/.test(filters.month)) {
    const start = new Date(`${filters.month}-01T00:00:00.000Z`); const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    clauses.push({ OR: [{ paymentDate: { gte: start, lt: end } }, { createdAt: { gte: start, lt: end } }] });
  }
  if (filters.keyword) clauses.push({ OR: [
    { bankReference: { contains: filters.keyword, mode: "insensitive" } },
    { remark: { contains: filters.keyword, mode: "insensitive" } },
    { paymentType: { contains: filters.keyword, mode: "insensitive" } },
    { order: { is: { OR: [
      { orderNo: { contains: filters.keyword, mode: "insensitive" } },
      { customerNameSnapshot: { contains: filters.keyword, mode: "insensitive" } },
      { customer: { is: { name: { contains: filters.keyword, mode: "insensitive" } } } },
      { customer: { is: { shortName: { contains: filters.keyword, mode: "insensitive" } } } },
    ] } } },
  ] });
  return { AND: clauses };
}

export async function listPayments(query: URLSearchParams, actor: ActorLike | null, options: { paginated: true }): Promise<PaginatedPaymentList>;
export async function listPayments(query: URLSearchParams, actor?: ActorLike | null, options?: { paginated?: false }): Promise<PaymentListRow[]>;
export async function listPayments(query: URLSearchParams, actor: ActorLike | null = null, options: { paginated?: boolean } = {}): Promise<PaymentListRow[] | PaginatedPaymentList> {
  assertRead(actor, "payments");
  const where = paymentWhere(filtersFromQuery(query), orderAccessWhere(actor));
  const include = { order: { include: { customer: true, businessEntity: true, salesperson: true } }, createdBy: true, updatedBy: true };
  if (!options.paginated) {
    const rows = await prisma.payment.findMany({ where, include, orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }], take: 1000 });
    return rows.map(serializePayment);
  }
  const { page, pageSize } = pageParams(query, 20, 100);
  const currentMonth = todayInputInChina().slice(0, 7);
  const monthStart = new Date(`${currentMonth}-01T00:00:00.000Z`); const monthEnd = new Date(monthStart); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  const [total, rows, arrivedGroups, pendingGroups, currentMonthCount] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, include, orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.payment.groupBy({ by: ["currency"], where: withWhere(where, { status: "已到账" }), _sum: { amount: true, amountCny: true } }),
    prisma.payment.groupBy({ by: ["currency"], where: withWhere(where, { status: "待确认" }), _sum: { amount: true, amountCny: true } }),
    prisma.payment.count({ where: withWhere(where, { OR: [{ paymentDate: { gte: monthStart, lt: monthEnd } }, { createdAt: { gte: monthStart, lt: monthEnd } }] }) }),
  ]);
  const totals = (groups: typeof arrivedGroups) => summarizeCurrencyTotals(groups.map((group) => ({
    currency: group.currency, amount: group._sum.amount, amountCny: group._sum.amountCny,
  })));
  const arrivedCurrencyTotals = totals(arrivedGroups); const pendingCurrencyTotals = totals(pendingGroups);
  return { ...pageResult(rows.map(serializePayment), total, page, pageSize), summary: {
    arrivedAmountCny: arrivedCurrencyTotals.totalCny, pendingAmountCny: pendingCurrencyTotals.totalCny,
    arrivedCurrencyTotals, pendingCurrencyTotals, currentMonthCount,
  } };
}
