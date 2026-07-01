import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { summarizeCurrencyTotals } from "./currency-totals";
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
  attachBusinessDocumentsToCost,
  attachBusinessDocumentsToCostOrders,
  attachBusinessDocumentsToCosts,
  successfulSupplierInvoicePairs,
} from "./business-documents";
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
type CostInvoiceGroupCostDto = CostDto & {
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
};
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
type SupplierInvoicePair = {
  orderId: string;
  supplierId: string;
};

const SUCCESS_SUPPLIER_INVOICE_FILTER: Prisma.OrderDocumentWhereInput = {
  documentType: "SUPPLIER_INVOICE",
  uploadStatus: "SUCCESS",
  deletedAt: null,
};
const COST_UNPAGINATED_SCAN_LIMIT = 5000;
const COST_INVOICE_GROUP_SCAN_LIMIT = 1000;
const COST_INVOICE_GROUP_DETAIL_LIMIT = 3000;

function includeCostInvoiceGroupRelations() {
  return Prisma.validator<Prisma.OrderCostInclude>()({
    ...includeCostRelations(),
    generatedLogisticsExpense: {
      include: {
        bill: true,
      },
    },
  });
}

type CostWithInvoiceGroupRelations = Prisma.OrderCostGetPayload<{ include: ReturnType<typeof includeCostInvoiceGroupRelations> }>;

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

function pagedCostWhere(filters: CostListFilters, actor: ActorLike, supplierInvoicePairs: SupplierInvoicePair[] = []): Prisma.OrderCostWhereInput {
  const clauses = costFilterClauses(filters, supplierInvoicePairs);
  return {
    deletedAt: null,
    ...costAccessWhere(actor),
    ...(clauses.length ? { AND: clauses } : {}),
  };
}

export async function listCosts(query: CostQuery, actor: ActorLike = null): Promise<CostDto[]> {
  assertRead(actor, "costs");
  const filters = costListFiltersFromQuery(query);
  const invoicePairs = filters.invoiceStatus ? await successfulSupplierInvoicePairs() : [];
  const where = pagedCostWhere(filters, actor, invoicePairs);
  const requestedPageSize = Number(query.get("pageSize") || query.get("limit") || 0);
  const take = Math.min(
    COST_UNPAGINATED_SCAN_LIMIT,
    Math.max(Number.isFinite(requestedPageSize) && requestedPageSize > 0 ? requestedPageSize : 1000, 1),
  );
  const rows = await prisma.orderCost.findMany({
    where,
    include: includeCostRelations(),
    orderBy: [{ createdAt: "desc" }],
    take,
  });
  return (await attachBusinessDocumentsToCosts(rows)).map(safeSerializeCost);
}

export async function listCostsPage(query: CostQuery, actor: ActorLike = null) {
  assertRead(actor, "costs");
  const { page, pageSize } = costPageParams(query);
  const filters = costListFiltersFromQuery(query);
  const invoicePairs = filters.invoiceStatus ? await successfulSupplierInvoicePairs() : [];
  const where = pagedCostWhere(filters, actor, invoicePairs);
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
  const rowsWithBusinessDocuments = await attachBusinessDocumentsToCosts(rows);
  return {
    rows: rowsWithBusinessDocuments.map(safeSerializeCost),
    total,
    page,
    pageSize,
  };
}

function logisticsBillIdForCost(cost: CostWithInvoiceGroupRelations | null | undefined) {
  return nonEmpty(cost?.generatedLogisticsExpense?.billId || cost?.generatedLogisticsExpense?.bill?.id);
}

function costInvoiceGroupKey(cost: CostWithInvoiceGroupRelations) {
  const billId = logisticsBillIdForCost(cost);
  if (cost.sourceType === "LOGISTICS_EXPENSE" && billId) return `logistics-bill:${billId}`;
  if (cost.sourceType === "LOGISTICS_EXPENSE") {
    return [
      "logistics-fallback",
      cost.orderId || "",
      cost.supplierId || "",
      cost.order?.blNo || "",
      cost.currency || "CNY",
    ].join(":");
  }
  return `cost:${cost.id}`;
}

function groupPaymentStatus(costs: CostDto[] = []) {
  const statuses = costs.map((cost) => cost.paymentStatus || "待支付");
  if (statuses.length && statuses.every((status) => status === "已支付")) return "已支付";
  if (statuses.some((status) => status === "已支付" || status === "部分支付")) return "部分支付";
  if (statuses.length && statuses.every((status) => status === "已取消")) return "已取消";
  return statuses[0] || "待支付";
}

function groupInvoiceStatus(costs: CostDto[] = []) {
  const statuses = costs.map((cost) => cost.invoiceStatus || "未收到");
  if (statuses.length && statuses.every((status) => status === "已收到")) return "已收到";
  if (statuses.some((status) => status === "已收到")) return "部分收到";
  return "未收到";
}

const MISSING_INVOICE_OVERDUE_DAYS = 30;

function costTimestamp(value: unknown) {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function costDateField(cost: CostDto, field: "costConfirmedAt" | "paymentDate" | "updatedAt" | "createdAt") {
  if (field in cost) return cost[field as keyof CostDto];
  return null;
}

function hasOverdueMissingInvoice(costs: CostDto[] = []) {
  const cutoff = Date.now() - MISSING_INVOICE_OVERDUE_DAYS * 24 * 60 * 60 * 1000;
  return costs.some((cost) => {
    const baseTime = costTimestamp(
      costDateField(cost, "costConfirmedAt")
      || costDateField(cost, "paymentDate")
      || costDateField(cost, "updatedAt")
      || costDateField(cost, "createdAt"),
    );
    return baseTime > 0 && baseTime < cutoff;
  });
}

function invoiceExceptionType(costs: CostDto[] = [], paymentStatus = "", invoiceStatus = "") {
  if (invoiceStatus !== "未收到") return "";
  if (paymentStatus === "已支付") return "PAID_WITHOUT_INVOICE";
  if (costs.some((cost) => cost.costConfirmed)) return "CONFIRMED_WITHOUT_INVOICE";
  if (hasOverdueMissingInvoice(costs)) return "OVERDUE_WITHOUT_INVOICE";
  return "";
}

function invoiceExceptionLabel(type: string) {
  if (type === "PAID_WITHOUT_INVOICE") return "已付款未收票";
  if (type === "CONFIRMED_WITHOUT_INVOICE") return "已确认未收票";
  if (type === "OVERDUE_WITHOUT_INVOICE") return "超期未收票";
  return "";
}

function uniqueTextList(values: Array<string | null | undefined>) {
  return values.map(nonEmpty).filter((value, index, rows) => value && rows.indexOf(value) === index);
}

function groupInvoiceFiles(costs: CostDto[] = []) {
  const documents = costs.flatMap((cost) => cost.documents || [])
    .filter((document) => (
      document.documentType === "SUPPLIER_INVOICE"
      && document.uploadStatus === "SUCCESS"
    ));
  const seen = new Set<string>();
  return documents.filter((document) => {
    const key = document.id || document.fileName || "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function serializeCostInvoiceGroup(key: string, costs: CostDto[], rawRows: CostWithInvoiceGroupRelations[] = []) {
  const groupCosts = costs as CostInvoiceGroupCostDto[];
  const first = groupCosts[0] || {};
  const firstRaw = rawRows[0];
  const currencyTotals = summarizeCurrencyTotals(groupCosts);
  const invoiceFiles = groupInvoiceFiles(groupCosts);
  const paymentStatus = groupPaymentStatus(groupCosts);
  const invoiceStatus = groupInvoiceStatus(groupCosts);
  const exceptionType = invoiceExceptionType(groupCosts, paymentStatus, invoiceStatus);
  const sourceTypes = uniqueTextList(groupCosts.map((cost) => cost.sourceType));
  const groupType = sourceTypes.includes("LOGISTICS_EXPENSE") ? "LOGISTICS_BILL" : "COST";
  const costTypeLabels = uniqueTextList(groupCosts.map((cost) => cost.costType));
  const latestUpdatedAt = groupCosts
    .map((cost) => new Date(cost.updatedAt || cost.createdAt || 0).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0] || 0;
  return {
    id: key,
    groupKey: key,
    groupType,
    logisticsBillId: logisticsBillIdForCost(firstRaw),
    orderId: first.orderId || "",
    orderNo: first.orderNo || "",
    blNo: first.blNo || first.billOfLadingNo || "",
    billOfLadingNo: first.billOfLadingNo || first.blNo || "",
    customerName: first.customerName || "",
    customerFullName: first.customerFullName || "",
    customerShortName: first.customerShortName || "",
    supplierId: first.supplierId || "",
    supplierName: first.supplierName || first.supplierNameSnapshot || first.vendorName || "",
    supplierNameSnapshot: first.supplierNameSnapshot || first.supplierName || first.vendorName || "",
    vendorName: first.vendorName || first.supplierNameSnapshot || first.supplierName || "",
    invoiceNo: uniqueTextList(invoiceFiles.map((document) => document.fileName)).join(" / "),
    costTypes: costTypeLabels,
    costTypeSummary: costTypeLabels.join(" / "),
    currencyTotals,
    paymentStatus,
    invoiceStatus,
    invoiceExceptionType: exceptionType,
    invoiceExceptionLabel: invoiceExceptionLabel(exceptionType),
    costCount: groupCosts.length,
    costs: groupCosts,
    documents: invoiceFiles,
    updatedAt: latestUpdatedAt ? new Date(latestUpdatedAt).toISOString() : first.updatedAt || first.createdAt || "",
    sourceType: groupType,
  };
}

async function buildCostInvoiceGroups(query: CostQuery, actor: ActorLike = null, options: { exceptionsOnly?: boolean } = {}) {
  assertRead(actor, "costs");
  const { page, pageSize } = costPageParams(query);
  const filters = costListFiltersFromQuery(query);
  const invoicePairs = filters.invoiceStatus ? await successfulSupplierInvoicePairs() : [];
  const where = pagedCostWhere(filters, actor, invoicePairs);
  const candidateTake = Math.min(
    COST_INVOICE_GROUP_SCAN_LIMIT,
    Math.max(page * pageSize * 4, pageSize * 8),
  );
  const [matchingCostCount, matchingRows] = await Promise.all([
    prisma.orderCost.count({ where }),
    prisma.orderCost.findMany({
      where,
      include: includeCostInvoiceGroupRelations(),
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: candidateTake,
    }),
  ]);
  const matchingRowsWithBusinessDocuments = await attachBusinessDocumentsToCosts(matchingRows);
  const groupMap = new Map<string, CostWithInvoiceGroupRelations[]>();
  matchingRowsWithBusinessDocuments.forEach((cost) => {
    const key = costInvoiceGroupKey(cost);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(cost);
  });
  const keys = [...groupMap.keys()];
  const billIds = uniqueTextList(keys.filter((key) => key.startsWith("logistics-bill:")).map((key) => key.replace(/^logistics-bill:/, "")));
  const singleCostIds = uniqueTextList(keys.filter((key) => key.startsWith("cost:")).map((key) => key.replace(/^cost:/, "")));
  const fallbackCostIds = keys
    .filter((key) => key.startsWith("logistics-fallback:"))
    .flatMap((key) => (groupMap.get(key) || []).map((cost) => cost.id));
  const fullWhere: Prisma.OrderCostWhereInput[] = [];
  if (billIds.length) {
    fullWhere.push({
      sourceType: "LOGISTICS_EXPENSE",
      generatedLogisticsExpense: { is: { billId: { in: billIds } } },
    });
  }
  const costIds = uniqueTextList([...singleCostIds, ...fallbackCostIds]);
  if (costIds.length) fullWhere.push({ id: { in: costIds } });
  const fullRows = fullWhere.length
    ? await prisma.orderCost.findMany({
      where: {
        deletedAt: null,
        ...costAccessWhere(actor),
        OR: fullWhere,
      },
      include: includeCostInvoiceGroupRelations(),
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: COST_INVOICE_GROUP_DETAIL_LIMIT,
    })
    : [];
  const fullRowsWithBusinessDocuments = await attachBusinessDocumentsToCosts(fullRows);
  const rawRowsByKey = fullRowsWithBusinessDocuments.reduce<Map<string, CostWithInvoiceGroupRelations[]>>((acc, cost) => {
    const key = costInvoiceGroupKey(cost);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(cost);
    return acc;
  }, new Map());
  const groups = keys
    .map((key) => {
      const rawRows = rawRowsByKey.get(key) || groupMap.get(key) || [];
      const costs = rawRows.map(safeSerializeCost);
      return serializeCostInvoiceGroup(key, costs, rawRows);
    })
    .filter((group) => !options.exceptionsOnly || (group.invoiceStatus === "未收到" && Boolean(group.invoiceExceptionType)))
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  const start = (page - 1) * pageSize;
  const scannedAllCandidates = matchingRows.length < candidateTake || matchingRows.length >= matchingCostCount;
  const totalGroups = scannedAllCandidates
    ? groups.length
    : Math.max(groups.length, start + pageSize + 1);
  return {
    rows: groups.slice(start, start + pageSize),
    total: totalGroups,
    page,
    pageSize,
  };
}

export async function listCostInvoiceGroups(query: CostQuery, actor: ActorLike = null) {
  return buildCostInvoiceGroups(query, actor);
}

export async function listCostInvoiceExceptions(query: CostQuery, actor: ActorLike = null) {
  return buildCostInvoiceGroups(query, actor, { exceptionsOnly: true });
}

export async function listCostOrderSummaries(query: CostQuery, actor: ActorLike = null) {
  assertRead(actor, "costs");
  const { page, pageSize } = costPageParams(query);
  const filters = costListFiltersFromQuery(query);
  const invoicePairs = filters.invoiceStatus ? await successfulSupplierInvoicePairs() : [];
  const costWhere = pagedCostWhere(filters, actor, invoicePairs);
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
  const ordersWithBusinessDocuments = await attachBusinessDocumentsToCostOrders(orders);
  return {
    rows: ordersWithBusinessDocuments.map(serializeCostOrderSummary),
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
  return safeSerializeCost(await attachBusinessDocumentsToCost(cost));
}
