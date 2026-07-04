import { Prisma } from "../generated/prisma/client.js";
import {
  COST_PAYMENT_STATUSES,
  COST_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  assertRead,
  dateFromInput,
  equivalentCostTypes,
  nonEmpty,
  type CostDto,
} from "./shared";
import { costAccessWhere } from "./masters-access";
import { orderArchiveWhereForScope, archiveScope, includeCostRelations } from "./cost-records-shared";

export type ActorLike = Record<string, unknown> | null;
export type CostQuery = URLSearchParams;
type CostBusinessScope = ReturnType<typeof archiveScope>;
export type CostInvoiceGroupCostDto = CostDto & {
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
};
export type CostListFilters = {
  keyword: Prisma.StringFilter | null;
  costType: string;
  paymentStatus: string;
  costConfirmed: boolean | null;
  invoiceStatus: string;
  dateFrom: Date | null;
  dateTo: Date | null;
  businessScope: CostBusinessScope;
};
export type SupplierInvoicePair = {
  orderId: string;
  supplierId: string;
};

const SUCCESS_SUPPLIER_INVOICE_FILTER: Prisma.OrderDocumentWhereInput = {
  documentType: "SUPPLIER_INVOICE",
  uploadStatus: "SUCCESS",
  deletedAt: null,
};
export const COST_UNPAGINATED_SCAN_LIMIT = 5000;
export const COST_INVOICE_GROUP_SCAN_LIMIT = 1000;
export const COST_INVOICE_GROUP_DETAIL_LIMIT = 3000;

export function includeCostInvoiceGroupRelations() {
  return Prisma.validator<Prisma.OrderCostInclude>()({
    ...includeCostListRelations(),
    generatedLogisticsExpense: {
      include: {
        bill: true,
      },
    },
  });
}

export type CostWithInvoiceGroupRelations = Prisma.OrderCostGetPayload<{ include: ReturnType<typeof includeCostInvoiceGroupRelations> }>;

export function includeCostListRelations() {
  return Prisma.validator<Prisma.OrderCostInclude>()({
    order: { include: { customer: true, salesperson: true } },
    supplier: true,
    documents: {
      where: { deletedAt: null },
      include: { uploadedBy: true, supplier: true },
      orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    },
  });
}

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

export function costListFiltersFromQuery(query: CostQuery): CostListFilters {
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

function supplierInvoicePairWhere(pairs: SupplierInvoicePair[]): Prisma.OrderCostWhereInput | null {
  const rows = pairs.filter((pair) => pair.orderId && pair.supplierId);
  if (!rows.length) return null;
  return {
    OR: rows.map((pair) => ({
      orderId: pair.orderId,
      supplierId: pair.supplierId,
    })),
  };
}

function costInvoiceStatusFilter(invoiceStatus: string, supplierInvoicePairs: SupplierInvoicePair[] = []): Prisma.OrderCostWhereInput | null {
  if (!invoiceStatus) return null;
  if (invoiceStatus === "已收到") return costEffectiveInvoiceReceivedWhere(supplierInvoicePairs);
  if (invoiceStatus === "未收到") return costEffectiveInvoiceMissingWhere(supplierInvoicePairs);
  return null;
}

function costEffectiveInvoiceReceivedWhere(supplierInvoicePairs: SupplierInvoicePair[] = []): Prisma.OrderCostWhereInput {
  const supplierReturnWhere = supplierInvoicePairWhere(supplierInvoicePairs);
  return {
    OR: [
      { documents: { some: SUCCESS_SUPPLIER_INVOICE_FILTER } },
      ...(supplierReturnWhere ? [supplierReturnWhere] : []),
      { sourceType: "LOGISTICS_EXPENSE", invoiceStatus: "已收到" },
    ],
  };
}

function costEffectiveInvoiceMissingWhere(supplierInvoicePairs: SupplierInvoicePair[] = []): Prisma.OrderCostWhereInput {
  const supplierReturnWhere = supplierInvoicePairWhere(supplierInvoicePairs);
  return {
    AND: [
      { documents: { none: SUCCESS_SUPPLIER_INVOICE_FILTER } },
      ...(supplierReturnWhere ? [{ NOT: supplierReturnWhere }] : []),
      {
        OR: [
          { sourceType: { not: "LOGISTICS_EXPENSE" } },
          { sourceType: "LOGISTICS_EXPENSE", invoiceStatus: { not: "已收到" } },
        ],
      },
    ],
  };
}

function costFilterClauses(filters: CostListFilters, supplierInvoicePairs: SupplierInvoicePair[] = []): Prisma.OrderCostWhereInput[] {
  const keyword = filters.keyword;
  const invoiceStatus = costInvoiceStatusFilter(filters.invoiceStatus, supplierInvoicePairs);
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

export function pagedCostWhere(filters: CostListFilters, actor: ActorLike, supplierInvoicePairs: SupplierInvoicePair[] = []): Prisma.OrderCostWhereInput {
  const clauses = costFilterClauses(filters, supplierInvoicePairs);
  return {
    deletedAt: null,
    ...costAccessWhere(actor),
    ...(clauses.length ? { AND: clauses } : {}),
  };
}
