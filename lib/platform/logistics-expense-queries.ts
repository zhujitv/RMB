import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  LOGISTICS_COST_TYPES,
  nonEmpty,
  pageParams,
  pageResult,
  serializeSupplier,
} from "./shared";
import { summarizeCurrencyTotals, type CurrencyTotalInput } from "./currency-totals";
import { orderAccessWhere } from "./order-access";
import {
  assertCanReadLogisticsExpenses,
  includeLogisticsExpenseRelations,
  insensitiveContains,
  logisticsExpenseAccessWhere,
  logisticsExpenseOrderSummary,
  logisticsExpenseStatusWhere,
  groupLogisticsExpensesByBill,
  serializeLogisticsExpense,
  LOGISTICS_OPERATOR_ROLE,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  type LogisticsExpenseBillDto,
  type LogisticsExpenseDto,
} from "./logistics-expense-shared";

type SupplierStatementRow = {
  supplierId: string;
  supplierName: string;
  orderIds: Set<string>;
  approvedRows: CurrencyTotalInput[];
  paidRows: CurrencyTotalInput[];
  approvedAmountCny: number;
  pendingPaymentAmountCny: number;
  paidAmountCny: number;
};
type QueryLike = {
  get(name: string): string | null;
};
type LogisticsExpenseListView = "bills" | "items";
type LogisticsExpenseListFilters = {
  view: LogisticsExpenseListView;
  keyword: Prisma.StringFilter | null;
  supplierId: string;
  costType: string;
  status: string;
};
type LogisticsQueryActor = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;

type PaginatedRows<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
type PaginatedLogisticsExpenseItems = PaginatedRows<LogisticsExpenseDto>;
type PaginatedLogisticsExpenseBills = PaginatedRows<LogisticsExpenseBillDto>;

function logisticsExpenseListFiltersFromQuery(query: QueryLike): LogisticsExpenseListFilters {
  const view = nonEmpty(query.get("view") || "bills") === "items" ? "items" : "bills";
  const keyword = insensitiveContains(query.get("keyword") || query.get("q"));
  return {
    view,
    keyword,
    supplierId: nonEmpty(query.get("supplierId")),
    costType: String(query.get("costType") || "").trim(),
    status: String(query.get("status") || ""),
  };
}

function logisticsExpenseListWhere(filters: LogisticsExpenseListFilters, actor: LogisticsQueryActor): Prisma.LogisticsExpenseWhereInput {
  const keyword = filters.keyword;
  const conditions: Prisma.LogisticsExpenseWhereInput[] = [
    { deletedAt: null },
    logisticsExpenseAccessWhere(actor),
    logisticsExpenseStatusWhere(filters.status),
  ];
  if (filters.supplierId && actor?.role === "管理员") conditions.push({ supplierId: filters.supplierId });
  if (filters.costType && LOGISTICS_COST_TYPES.includes(filters.costType)) conditions.push({ costType: filters.costType });
  if (keyword) {
    conditions.push({
      OR: [
        { costType: keyword },
        { supplierNameSnapshot: keyword },
        { remark: keyword },
        { order: { is: { orderNo: keyword } } },
        { order: { is: { blNo: keyword } } },
        { order: { is: { customerNameSnapshot: keyword } } },
        { order: { is: { customer: { is: { shortName: keyword } } } } },
        { supplier: { is: { supplierName: keyword } } },
      ],
    });
  }
  return { AND: conditions };
}

export async function listLogisticsExpenses(query: QueryLike, actor: LogisticsQueryActor): Promise<PaginatedLogisticsExpenseItems | PaginatedLogisticsExpenseBills> {
  assertCanReadLogisticsExpenses(actor);
  const filters = logisticsExpenseListFiltersFromQuery(query);
  const where = logisticsExpenseListWhere(filters, actor);
  const { page, pageSize } = pageParams(query, 20, 100);
  if (filters.view === "items") {
    const [total, rows] = await Promise.all([
      prisma.logisticsExpense.count({ where }),
      prisma.logisticsExpense.findMany({
        where,
        include: includeLogisticsExpenseRelations(),
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return pageResult(rows.map(serializeLogisticsExpense), total, page, pageSize);
  }
  const rows = await prisma.logisticsExpense.findMany({
    where,
    include: includeLogisticsExpenseRelations(),
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  const bills = groupLogisticsExpensesByBill(rows);
  const start = (page - 1) * pageSize;
  return pageResult(bills.slice(start, start + pageSize), bills.length, page, pageSize);
}

export async function listLogisticsExpenseOrders(query: QueryLike, actor: LogisticsQueryActor) {
  assertCanReadLogisticsExpenses(actor);
  const role = nonEmpty(actor?.role);
  const supplierId = nonEmpty(actor?.supplierId);
  const q = nonEmpty(query.get("keyword") || query.get("q") || query.get("orderNo"));
  const filters: Prisma.ReceivableOrderWhereInput[] = [
    { deletedAt: null },
    { status: { notIn: ["已关闭", "已取消"] } },
  ];
  if (role === "业务员") filters.push(orderAccessWhere(actor));
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role) && supplierId) {
    filters.push({ logisticsSuppliers: { some: { supplierId } } });
  } else if (role === LOGISTICS_OPERATOR_ROLE) {
    filters.push({ id: "__no_supplier_bound__" });
  }
  if (q) {
    filters.push({
      OR: [
        { orderNo: { contains: q, mode: "insensitive" } },
        { blNo: { contains: q, mode: "insensitive" } },
        { customerNameSnapshot: { contains: q, mode: "insensitive" } },
        { customer: { is: { name: { contains: q, mode: "insensitive" } } } },
        { customer: { is: { shortName: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  const rows = await prisma.receivableOrder.findMany({
    where: { AND: filters },
    include: {
      customer: true,
      logisticsSuppliers: { include: { supplier: true } },
      domesticLogisticsInfos: {
        include: { transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 50,
  });
  return rows.map((order) => ({
    ...logisticsExpenseOrderSummary(order),
    logisticsSupplierIds: (order.logisticsSuppliers || []).map((row) => row.supplierId),
    logisticsSuppliers: (order.logisticsSuppliers || []).map((row) => serializeSupplier(row.supplier)).filter((item) => item.id),
  }));
}

export async function logisticsSupplierStatement(query: QueryLike, actor: LogisticsQueryActor) {
  assertCanReadLogisticsExpenses(actor);
  const month = nonEmpty(query.get("month"));
  const reviewedMonthWhere: Prisma.LogisticsExpenseWhereInput = month ? {
    OR: [
      {
        bill: {
          is: {
            reviewedAt: {
              gte: new Date(`${month}-01T00:00:00.000Z`),
              lt: new Date(new Date(`${month}-01T00:00:00.000Z`).setUTCMonth(new Date(`${month}-01T00:00:00.000Z`).getUTCMonth() + 1)),
            },
          },
        },
      },
      {
        billId: null,
        reviewedAt: {
          gte: new Date(`${month}-01T00:00:00.000Z`),
          lt: new Date(new Date(`${month}-01T00:00:00.000Z`).setUTCMonth(new Date(`${month}-01T00:00:00.000Z`).getUTCMonth() + 1)),
        },
      },
    ],
  } : {};
  const where: Prisma.LogisticsExpenseWhereInput = {
    deletedAt: null,
    AND: [
      {
        OR: [
          { bill: { is: { auditStatus: "审核通过" } } },
          { billId: null, auditStatus: "审核通过" },
        ],
      },
      reviewedMonthWhere,
    ],
    ...logisticsExpenseAccessWhere(actor),
  };
  const rows = await prisma.logisticsExpense.findMany({ where, include: includeLogisticsExpenseRelations(), orderBy: [{ reviewedAt: "desc" }] });
  return Object.values(rows.reduce<Record<string, SupplierStatementRow>>((acc, row) => {
    const key = row.supplierId;
    acc[key] ||= {
      supplierId: row.supplierId,
      supplierName: row.supplierNameSnapshot || row.supplier?.supplierName || "",
      orderIds: new Set(),
      approvedRows: [],
      paidRows: [],
      approvedAmountCny: 0,
      pendingPaymentAmountCny: 0,
      paidAmountCny: 0,
    };
    acc[key].orderIds.add(row.orderId);
    const currencyRow = { currency: row.currency, amount: row.amount, amountCny: row.amountCny };
    acc[key].approvedRows.push(currencyRow);
    const paidRow = logisticsPaymentLedgerRow(row);
    if (paidRow) acc[key].paidRows.push(paidRow);
    return acc;
  }, {})).map((item) => {
    const approvedCurrencyTotals = summarizeCurrencyTotals(item.approvedRows);
    const paidCurrencyTotals = summarizeCurrencyTotals(item.paidRows);
    const pendingPaymentCurrencyTotals = subtractCurrencyTotals(approvedCurrencyTotals, paidCurrencyTotals);
    return {
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      orderCount: item.orderIds.size,
      approvedCurrencyTotals,
      pendingPaymentCurrencyTotals,
      paidCurrencyTotals,
      approvedAmountCny: approvedCurrencyTotals.cnyActual,
      pendingPaymentAmountCny: pendingPaymentCurrencyTotals.cnyActual,
      paidAmountCny: paidCurrencyTotals.cnyActual,
    };
  });
}

function logisticsPaymentLedgerRow(row: {
  cost?: {
    paymentDate?: Date | string | null;
    deletedAt?: Date | string | null;
    currency?: unknown;
    amount?: unknown;
    amountCny?: unknown;
  } | null;
}): CurrencyTotalInput | null {
  const cost = row.cost;
  if (!cost || cost.deletedAt || !cost.paymentDate) return null;
  return { currency: cost.currency, amount: cost.amount, amountCny: cost.amountCny };
}

function subtractCurrencyTotals(
  payable: ReturnType<typeof summarizeCurrencyTotals>,
  paid: ReturnType<typeof summarizeCurrencyTotals>,
) {
  const rows: CurrencyTotalInput[] = [
    { currency: "CNY", amount: payable.cnyActual, amountCny: payable.cnyActual },
    ...payable.foreignTotals.map((item) => ({ currency: item.currency, amount: item.amount, amountCny: 0 })),
    { currency: "CNY", amount: -paid.cnyActual, amountCny: -paid.cnyActual },
    ...paid.foreignTotals.map((item) => ({ currency: item.currency, amount: -item.amount, amountCny: 0 })),
  ];
  return summarizeCurrencyTotals(rows);
}
