import { prisma } from "../prisma";
import { assertRead, permissionError, safeSerializeCost, type CostDto } from "./shared";
import { attachBusinessDocumentsToCost, attachBusinessDocumentsToCosts, successfulSupplierInvoicePairs } from "./business-documents";
import { costAccessWhere } from "./masters-access";
import { includeCostRelations, costPageParams } from "./cost-records-shared";
import {
  COST_UNPAGINATED_SCAN_LIMIT,
  costListFiltersFromQuery,
  includeCostListRelations,
  pagedCostWhere,
  type ActorLike,
  type CostQuery,
} from "./cost-records-query-shared";

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
    include: includeCostListRelations(),
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
      include: includeCostListRelations(),
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
