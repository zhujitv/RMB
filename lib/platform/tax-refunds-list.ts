import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  ARCHIVE_TAX_REFUND_STATUSES,
  TAX_REFUND_STATUS_LABELS,
  TAX_REFUND_STATUSES,
  assertRead,
  cachedTaxRefundCompleteness,
  customerFullName,
  customerShortName,
  dateToInput,
  guardedPrismaFindMany,
  nonEmpty,
  num,
  taxRefundStatusFromCompleteness,
} from "./shared";
import { orderAccessWhere } from "./order-access";
import { businessEntityFieldsFromOrder, businessEntityWhereFromQuery } from "./business-entities";
import { isBusinessArchived } from "./business-archive";
import {
  type ActorLike,
  type QueryLike,
  type TaxRefundCompletenessOrder,
  type TaxRefundLightListOrder,
  type TaxRefundListFilters,
  type TaxRefundListMode,
  type TaxRefundSortableOrder,
  taxRefundCompletenessSummaryText,
  taxRefundLightListSelect,
  taxRefundOverallCompletenessPercent,
} from "./tax-refunds-shared";

export function serializeTaxRefundListOrderLight(order: TaxRefundLightListOrder) {
  const completeness = cachedTaxRefundCompleteness(order);
  const overallCompleteness = taxRefundOverallCompletenessPercent(order);
  const refundStatus = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
  const fullCustomerName = customerFullName(order.customer, order.customerNameSnapshot);
  const shortCustomerName = customerShortName(order.customer);
  const businessEntityFields = businessEntityFieldsFromOrder(order);
  const completenessIssuesSummary = taxRefundCompletenessSummaryText(completeness, order.taxRefundCompletenessIssuesSummary || "");
  return {
    id: order.id,
    orderNo: order.orderNo,
    billOfLadingNo: order.blNo || "",
    blNo: order.blNo || "",
    customerShortName: shortCustomerName || fullCustomerName,
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    businessEntityId: order.businessEntityId || "",
    businessEntityName: businessEntityFields.businessEntityDisplayName || businessEntityFields.businessEntityName || "",
    businessEntityShortName: businessEntityFields.businessEntityShortName || "",
    businessEntityDisplayName: businessEntityFields.businessEntityDisplayName || "",
    businessEntityNameSnapshot: businessEntityFields.businessEntityNameSnapshot || "",
    businessEntityIsDefault: businessEntityFields.businessEntityIsDefault,
    businessEntity: businessEntityFields.businessEntity,
    declarationDate: dateToInput(order.customsDeclarationDate),
    customsDeclarationDate: dateToInput(order.customsDeclarationDate),
    overallCompleteness,
    completenessUpdatedAt: order.taxRefundCompletenessUpdatedAt || null,
    completenessIssuesSummary,
    refundStatus,
    taxRefundStatus: refundStatus,
    taxRefundStatusLabel: (TAX_REFUND_STATUS_LABELS as Record<string, string>)[refundStatus] || refundStatus,
    taxArchived: isBusinessArchived({
      taxArchived: order.taxArchived,
      taxRefundStatus: refundStatus,
      taxRefundArchivedAt: order.taxRefundArchivedAt,
      taxSubmittedAt: order.taxSubmittedAt,
    }),
    taxRefundArchivedAt: order.taxRefundArchivedAt || null,
    taxRefundArchiveRemark: order.taxRefundArchiveRemark || "",
    taxSubmittedAt: order.taxSubmittedAt || order.taxRefundArchivedAt || null,
  };
}

export type TaxRefundLightListOrderDto = ReturnType<typeof serializeTaxRefundListOrderLight>;


function taxRefundCompletenessPercent(order: TaxRefundCompletenessOrder = {}) {
  const completeness = cachedTaxRefundCompleteness(order);
  const total = Number(completeness.total || 0);
  if (total <= 0) return 0;
  return Math.round((Number(completeness.completed || 0) / total) * 100);
}

function taxRefundStatusSortRank(status: string = "") {
  return ({
    NOT_READY: 1,
    PROBLEM: 2,
    READY: 3,
    SUBMITTED: 4,
    REFUND_RECEIVED: 5,
  } as Record<string, number>)[status] || 5;
}

function dateSortValue(value: unknown) {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function sortTaxRefundOrders(a: TaxRefundSortableOrder = {}, b: TaxRefundSortableOrder = {}) {
  const percentDiff = taxRefundCompletenessPercent(a) - taxRefundCompletenessPercent(b);
  if (percentDiff) return percentDiff;
  const aStatus = taxRefundStatusFromCompleteness(a.taxRefundStatus, cachedTaxRefundCompleteness(a));
  const bStatus = taxRefundStatusFromCompleteness(b.taxRefundStatus, cachedTaxRefundCompleteness(b));
  const statusDiff = taxRefundStatusSortRank(aStatus) - taxRefundStatusSortRank(bStatus);
  if (statusDiff) return statusDiff;
  const updatedDiff = dateSortValue(b.updatedAt) - dateSortValue(a.updatedAt);
  if (updatedDiff) return updatedDiff;
  return dateSortValue(b.createdAt) - dateSortValue(a.createdAt);
}

function taxRefundListFiltersFromQuery(query: QueryLike): TaxRefundListFilters {
  const page = Math.max(1, Math.round(num(query.get("page"), 1)));
  const pageSize = Math.min(100, Math.max(1, Math.round(num(query.get("pageSize"), 20))));
  const keyword = nonEmpty(query.get("keyword"));
  const mode = nonEmpty(query.get("mode")) === "archive" ? "archive" : "current";
  const statusFilter = nonEmpty(query.get("status"));
  const businessEntityId = nonEmpty(query.get("businessEntityId") || query.get("businessEntity"));
  const declarationStartMonth = nonEmpty(query.get("declarationStartMonth"));
  const declarationEndMonth = nonEmpty(query.get("declarationEndMonth"));
  const declarationStart = declarationStartMonth && /^\d{4}-\d{2}$/.test(declarationStartMonth) ? new Date(`${declarationStartMonth}-01T00:00:00.000Z`) : null;
  const declarationEnd = declarationEndMonth && /^\d{4}-\d{2}$/.test(declarationEndMonth) ? new Date(`${declarationEndMonth}-01T00:00:00.000Z`) : null;
  return {
    page,
    pageSize,
    keyword,
    mode,
    statusFilter,
    businessEntityId,
    declarationMonthStart: declarationStart || null,
    declarationMonthEnd: declarationEnd ? new Date(Date.UTC(declarationEnd.getUTCFullYear(), declarationEnd.getUTCMonth() + 1, 1)) : null,
  };
}

function taxRefundKeywordWhere(keyword: string): Prisma.ReceivableOrderWhereInput {
  const statusMatches = keyword
    ? Object.entries(TAX_REFUND_STATUS_LABELS)
      .filter(([status, label]) => status.toLowerCase().includes(keyword.toLowerCase()) || label.toLowerCase().includes(keyword.toLowerCase()))
      .map(([status]) => status)
    : [];
  return keyword ? {
    OR: [
      { orderNo: { contains: keyword, mode: "insensitive" } },
      { blNo: { contains: keyword, mode: "insensitive" } },
      { logisticsBills: { some: { deletedAt: null, status: { not: "voided" }, billOfLadingNo: { contains: keyword, mode: "insensitive" } } } },
      { customsDeclarationNo: { contains: keyword, mode: "insensitive" } },
      { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
      { taxRefundStatus: { contains: keyword, mode: "insensitive" } },
      { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
      { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
      { salesperson: { is: { name: { contains: keyword, mode: "insensitive" } } } },
      ...(statusMatches.length ? [{ taxRefundStatus: { in: statusMatches } }] : []),
    ],
  } : {};
}

function taxRefundListWhere(filters: TaxRefundListFilters, actor: ActorLike): Prisma.ReceivableOrderWhereInput {
  return {
    deletedAt: null,
    AND: [
      orderAccessWhere(actor),
      taxRefundKeywordWhere(filters.keyword),
      businessEntityWhereFromQuery(filters.businessEntityId),
      ...(filters.mode === "archive"
        ? [{ OR: [{ taxArchived: true }, { taxRefundStatus: { in: ARCHIVE_TAX_REFUND_STATUSES } }] }]
        : [{ taxArchived: false }, { taxRefundStatus: { in: ACTIVE_TAX_REFUND_STATUSES } }]),
      ...(TAX_REFUND_STATUSES.includes(filters.statusFilter) ? [{ taxRefundStatus: filters.statusFilter }] : []),
      ...(filters.declarationMonthStart || filters.declarationMonthEnd ? [{
        customsDeclarationDate: {
          ...(filters.declarationMonthStart ? { gte: filters.declarationMonthStart } : {}),
          ...(filters.declarationMonthEnd ? { lt: filters.declarationMonthEnd } : {}),
        },
      }] : []),
    ],
  };
}

type TaxRefundListResult = {
  orders: TaxRefundLightListOrderDto[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  query: string;
  mode: TaxRefundListMode;
};

function taxRefundListOrderBy(): Prisma.ReceivableOrderOrderByWithRelationInput[] {
  const orderBy: Prisma.ReceivableOrderOrderByWithRelationInput[] = [
    { taxRefundOverallCompleteness: { sort: "asc", nulls: "first" } },
  ];
  orderBy.push({ updatedAt: "desc" }, { createdAt: "desc" });
  return orderBy;
}

export async function listTaxRefundOrders(query: QueryLike, actor: ActorLike): Promise<TaxRefundListResult> {
  assertRead(actor, "taxRefund");
  const filters = taxRefundListFiltersFromQuery(query);
  const where = taxRefundListWhere(filters, actor);
  const skip = (filters.page - 1) * filters.pageSize;
  const orderBy = taxRefundListOrderBy();
  const [total, rows] = await Promise.all([
    prisma.receivableOrder.count({ where }),
    guardedPrismaFindMany<Prisma.ReceivableOrderGetPayload<{ select: typeof taxRefundLightListSelect }>[]>(prisma.receivableOrder, "receivableOrder", "lib/platform/tax-refunds.ts:listTaxRefundOrders.rows", {
      where,
      select: taxRefundLightListSelect,
      orderBy,
      skip,
      take: filters.pageSize,
    }),
  ]);
  return {
    orders: rows.map(serializeTaxRefundListOrderLight),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    },
    query: filters.keyword,
    mode: filters.mode,
  };
}
