import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  applyCommonFilters,
  assertRead,
  businessEntityWhereFromQuery,
  codedError,
  includeOrderListRelations,
  includeOrderRelations,
  nonEmpty,
  pageParams,
  pageResult,
  serializeOrder,
  serializeOrderListRow,
  type SerializedOrderDto,
  type SerializedOrderListRowDto,
} from "./shared";
import { orderAccessWhere, scopeOrderForActor } from "./order-access";
import { sortReceivableRowsByShipmentDate } from "./order-receivable-sort";
import { summarizeCurrencyTotals } from "./currency-totals";
import {
  ORDER_UNPAGINATED_SCAN_LIMIT,
  type ActorLike,
  type PageResult,
  type QueryLike,
} from "./orders-module-shared";

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
export type OrderPageRow = SerializedOrderListRowDto;

type PaginatedOrderList = PageResult<OrderPageRow> & {
  summary: ReturnType<typeof summarizeCurrencyTotals>;
};

export async function listOrders(query: QueryLike, actor: ActorLike, options: { paginated: true }): Promise<PaginatedOrderList>;
export async function listOrders(query: QueryLike, actor: ActorLike, options?: { paginated?: false }): Promise<OrderListRow[]>;
export async function listOrders(query: QueryLike, actor: ActorLike, options: { paginated?: boolean } = {}): Promise<OrderListRow[] | PaginatedOrderList> {
  assertRead(actor, "orders");
  const filters = orderListFiltersFromQuery(query);
  const where = orderListWhere(filters, actor);
  if (options.paginated) return listPaginatedOrders(query, actor, where);

  const orders = await prisma.receivableOrder.findMany({
    where,
    include: includeOrderRelations(),
    orderBy: [{ createdAt: "desc" }],
    take: ORDER_UNPAGINATED_SCAN_LIMIT,
  });
  return sortReceivableRowsByShipmentDate(applyCommonFilters(
    orders.map((order) => serializeOrder(scopeOrderForActor(order, actor))),
    query,
  ));
}

async function listPaginatedOrders(query: QueryLike, actor: ActorLike, where: Prisma.ReceivableOrderWhereInput) {
  const { page, pageSize } = pageParams(query, 20, 20);
  const [total, orders, summaryGroups] = await Promise.all([
    prisma.receivableOrder.count({ where }),
    prisma.receivableOrder.findMany({
      where,
      include: includeOrderListRelations(),
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
  const rows = sortReceivableRowsByShipmentDate(
    orders.map((order) => serializeOrderListRow(scopeOrderForActor(order, actor))),
  );
  return {
    ...pageResult(rows, total, page, pageSize),
    summary: summarizeCurrencyTotals(summaryGroups.map((group) => ({
      currency: group.currency,
      amount: group._sum.finalReceivableAmount,
      amountCny: group._sum.finalReceivableAmountCny,
    }))),
  };
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
  if (filters.keyword) clauses.push(orderKeywordWhere(filters.keyword));
  if (filters.country) {
    clauses.push({
      OR: [
        { country: { contains: filters.country, mode: "insensitive" } },
        { customer: { is: { country: { contains: filters.country, mode: "insensitive" } } } },
      ],
    });
  }
  return { AND: clauses.filter((item) => Object.keys(item).length) };
}

function orderKeywordWhere(keyword: string): Prisma.ReceivableOrderWhereInput {
  return {
    OR: [
      { orderNo: { contains: keyword, mode: "insensitive" } },
      { blNo: { contains: keyword, mode: "insensitive" } },
      { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
      { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
      { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
      { salesperson: { is: { name: { contains: keyword, mode: "insensitive" } } } },
    ],
  };
}

export async function getOrder(id: string, actor: ActorLike) {
  assertRead(actor, "orders");
  const order = await prisma.receivableOrder.findFirst({
    where: { id, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!order) throw codedError("应收订单不存在或无权查看", 404, "ORDER_NOT_FOUND");
  return serializeOrder(scopeOrderForActor(order, actor));
}
