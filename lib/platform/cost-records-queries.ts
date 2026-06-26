import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  COST_PAYMENT_STATUSES,
  COST_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES,
  assertRead,
  dateFromInput,
  equivalentCostTypes,
  isTaxRefundFactoryCost,
  isTaxRefundLogisticsInvoiceCost,
  nonEmpty,
  permissionError,
  safeSerializeCost,
  type CostDto,
  successDocument,
} from "./shared";
import { costAccessWhere } from "./masters-access";
import { orderAccessWhere } from "./order-access";
import {
  archiveScope,
  costPageParams,
  includeCostRelations,
  orderArchiveWhereForScope,
  serializeCostOrderSummary,
} from "./cost-records-shared";

type ActorLike = Record<string, unknown> | null;
type CostQuery = URLSearchParams;
type CostBusinessScope = ReturnType<typeof archiveScope>;
type CostListFilters = {
  keyword: Prisma.StringFilter | null;
  costType: string;
  paymentStatus: string;
  costConfirmed: boolean | null;
  invoiceStatus: string;
  dateFrom: Date | null;
  dateTo: Date | null;
  businessScope: CostBusinessScope;
};

const SUCCESS_SUPPLIER_INVOICE_FILTER: Prisma.OrderDocumentWhereInput = {
  documentType: "SUPPLIER_INVOICE",
  uploadStatus: "SUCCESS",
  deletedAt: null,
};

function insensitiveContains(value: unknown): Prisma.StringFilter | null {
  const text = nonEmpty(value);
  return text ? { contains: text, mode: "insensitive" } : null;
}

function costConfirmedFilter(value: unknown): boolean | null {
  const text = nonEmpty(value);
  if (!text) return null;
  if (["true", "1", "已确认"].includes(text)) return true;
  if (["false", "0", "未确认"].includes(text)) return false;
  return null;
}

function costListFiltersFromQuery(query: CostQuery): CostListFilters {
  const keyword = insensitiveContains(query.get("keyword"));
  return {
    keyword,
    costType: nonEmpty(query.get("costType")),
    paymentStatus: nonEmpty(query.get("paymentStatus")),
    costConfirmed: costConfirmedFilter(query.get("costConfirmed")),
    invoiceStatus: nonEmpty(query.get("invoiceStatus")),
    dateFrom: dateFromInput(query.get("dateFrom")),
    dateTo: dateFromInput(query.get("dateTo")),
    businessScope: archiveScope(query),
  };
}

function costDateRangeFilter(filters: CostListFilters): Prisma.OrderCostWhereInput | null {
  if (!filters.dateFrom && !filters.dateTo) return null;
  const range: Prisma.DateTimeFilter<"OrderCost"> = {};
  if (filters.dateFrom) range.gte = filters.dateFrom;
  if (filters.dateTo) {
    const end = new Date(filters.dateTo);
    end.setDate(end.getDate() + 1);
    range.lt = end;
  }
  return {
    OR: [
      { createdAt: range },
      { updatedAt: range },
      { paymentDate: range },
    ],
  };
}

function costInvoiceStatusFilter(invoiceStatus: string): Prisma.OrderCostWhereInput | null {
  if (!invoiceStatus) return null;
  if (invoiceStatus === "已收到") return costEffectiveInvoiceReceivedWhere();
  if (invoiceStatus === "未收到") return costEffectiveInvoiceMissingWhere();
  return null;
}

function costEffectiveInvoiceReceivedWhere(): Prisma.OrderCostWhereInput {
  return {
    OR: [
      { documents: { some: SUCCESS_SUPPLIER_INVOICE_FILTER } },
      { sourceType: "LOGISTICS_EXPENSE", invoiceStatus: "已收到" },
    ],
  };
}

function costEffectiveInvoiceMissingWhere(): Prisma.OrderCostWhereInput {
  return {
    AND: [
      { documents: { none: SUCCESS_SUPPLIER_INVOICE_FILTER } },
      {
        OR: [
          { sourceType: { not: "LOGISTICS_EXPENSE" } },
          { sourceType: "LOGISTICS_EXPENSE", invoiceStatus: { not: "已收到" } },
        ],
      },
    ],
  };
}

function costInvoiceExceptionWhere(): Prisma.OrderCostWhereInput {
  return {
    OR: [
      {
        paymentStatus: "已支付",
        ...costEffectiveInvoiceMissingWhere(),
      },
      {
        paymentStatus: { in: ["待支付", "部分支付"] },
        ...costEffectiveInvoiceReceivedWhere(),
      },
    ],
  };
}

function costFilterClauses(filters: CostListFilters): Prisma.OrderCostWhereInput[] {
  const keyword = filters.keyword;
  const invoiceStatus = costInvoiceStatusFilter(filters.invoiceStatus);
  const dateRange = costDateRangeFilter(filters);
  const clauses: Array<Prisma.OrderCostWhereInput | null> = [
    { order: { is: orderArchiveWhereForScope(filters.businessScope) } },
    keyword ? {
      OR: [
        { costType: keyword },
        { vendorName: keyword },
        { supplierNameSnapshot: keyword },
        { remark: keyword },
        { order: { is: { orderNo: keyword } } },
        { order: { is: { customerNameSnapshot: keyword } } },
        { order: { is: { customer: { is: { name: keyword } } } } },
        { order: { is: { customer: { is: { shortName: keyword } } } } },
        { supplier: { is: { supplierName: keyword } } },
        { supplier: { is: { supplierType: keyword } } },
      ],
    } : null,
    filters.costType && COST_TYPES.includes(filters.costType) ? { costType: { in: equivalentCostTypes(filters.costType) } } : null,
    filters.paymentStatus && COST_PAYMENT_STATUSES.includes(filters.paymentStatus) ? { paymentStatus: filters.paymentStatus } : null,
    filters.costConfirmed == null ? null : { costConfirmed: filters.costConfirmed },
    invoiceStatus,
    dateRange,
  ];
  return clauses.filter((clause): clause is Prisma.OrderCostWhereInput => Boolean(clause));
}

function pagedCostWhere(filters: CostListFilters, actor: ActorLike): Prisma.OrderCostWhereInput {
  const clauses = costFilterClauses(filters);
  return {
    deletedAt: null,
    ...costAccessWhere(actor),
    ...(clauses.length ? { AND: clauses } : {}),
  };
}

export async function listCosts(query: CostQuery, actor: ActorLike = null): Promise<CostDto[]> {
  assertRead(actor, "costs");
  const where = pagedCostWhere(costListFiltersFromQuery(query), actor);
  const rows = await prisma.orderCost.findMany({
    where,
    include: includeCostRelations(),
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map(safeSerializeCost);
}

export async function listCostsPage(query: CostQuery, actor: ActorLike = null) {
  assertRead(actor, "costs");
  const { page, pageSize } = costPageParams(query);
  const filters = costListFiltersFromQuery(query);
  const where = pagedCostWhere(filters, actor);
  const [total, rows] = await Promise.all([
    prisma.orderCost.count({ where }),
    prisma.orderCost.findMany({
      where,
      include: includeCostRelations(),
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    rows: rows.map(safeSerializeCost),
    total,
    page,
    pageSize,
  };
}

function invoiceExceptionType(cost: CostDto) {
  if (cost.paymentStatus === "已支付" && cost.invoiceStatus !== "已收到") return "PAID_WITHOUT_INVOICE";
  if (["待支付", "部分支付"].includes(cost.paymentStatus || "") && cost.invoiceStatus === "已收到") return "INVOICE_WITH_UNPAID";
  return "UNKNOWN";
}

function invoiceExceptionLabel(type: string) {
  if (type === "PAID_WITHOUT_INVOICE") return "已付款未收票";
  if (type === "INVOICE_WITH_UNPAID") return "已收票未付款";
  return "发票异常";
}

export async function listCostInvoiceExceptions(query: CostQuery, actor: ActorLike = null) {
  assertRead(actor, "costs");
  const { page, pageSize } = costPageParams(query);
  const filters = costListFiltersFromQuery(query);
  const baseWhere = pagedCostWhere(filters, actor);
  const baseAnd = Array.isArray(baseWhere.AND) ? baseWhere.AND : (baseWhere.AND ? [baseWhere.AND] : []);
  const where: Prisma.OrderCostWhereInput = {
    ...baseWhere,
    AND: [
      ...baseAnd,
      costInvoiceExceptionWhere(),
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.orderCost.count({ where }),
    prisma.orderCost.findMany({
      where,
      include: includeCostRelations(),
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const serializedRows = rows.map(safeSerializeCost).map((cost) => {
    const type = invoiceExceptionType(cost);
    return {
      ...cost,
      invoiceExceptionType: type,
      invoiceExceptionLabel: invoiceExceptionLabel(type),
    };
  });
  return {
    rows: serializedRows,
    total,
    page,
    pageSize,
  };
}

export async function listCostOrderSummaries(query: CostQuery, actor: ActorLike = null) {
  assertRead(actor, "costs");
  const { page, pageSize } = costPageParams(query);
  const filters = costListFiltersFromQuery(query);
  const costWhere = pagedCostWhere(filters, actor);
  const where: Prisma.ReceivableOrderWhereInput = {
    deletedAt: null,
    ...orderArchiveWhereForScope(filters.businessScope),
    ...orderAccessWhere(actor),
    costs: { some: costWhere },
  };
  const [total, orders] = await Promise.all([
    prisma.receivableOrder.count({ where }),
    prisma.receivableOrder.findMany({
      where,
      include: {
        customer: true,
        costs: {
          where: costWhere,
          include: {
            supplier: true,
            documents: {
              where: { deletedAt: null },
              include: { uploadedBy: true, supplier: true },
              orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
            },
          },
          orderBy: [{ createdAt: "desc" }],
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    rows: orders.map(serializeCostOrderSummary),
    total,
    page,
    pageSize,
  };
}

export async function getCost(id: string, actor: ActorLike = null) {
  assertRead(actor, "costs");
  const cost = await prisma.orderCost.findFirst({
    where: {
      id,
      deletedAt: null,
      ...costAccessWhere(actor),
    },
    include: includeCostRelations(),
  });
  if (!cost) throw permissionError("成本记录不存在或无权查看", 404);
  return safeSerializeCost(cost);
}
