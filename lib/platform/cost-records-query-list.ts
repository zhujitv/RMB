import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { assertRead, permissionError, safeSerializeCost, type CostDto } from "./shared";
import { attachBusinessDocumentsToCost, attachBusinessDocumentsToCosts, successfulSupplierInvoicePairs } from "./business-documents";
import { costAccessWhere } from "./masters-access";
import { attachLogisticsSourcesToCosts } from "./cost-records-logistics-source";
import { includeCostRelations, costPageParams } from "./cost-records-shared";
import {
  COST_UNPAGINATED_SCAN_LIMIT,
  COST_WORKFLOW_SORT_WEIGHTS,
  costPaymentInvoiceSortGroupWhere,
  costListFiltersFromQuery,
  includeCostListRelations,
  pagedCostWhere,
  type ActorLike,
  type CostQuery,
  type CostWorkflowSortWeight,
  type SupplierInvoicePair,
} from "./cost-records-query-shared";

type CostListRow = Prisma.OrderCostGetPayload<{ include: ReturnType<typeof includeCostListRelations> }>;

function costSortedWhere(
  where: Prisma.OrderCostWhereInput,
  weight: CostWorkflowSortWeight,
  supplierInvoicePairs: SupplierInvoicePair[],
): Prisma.OrderCostWhereInput {
  return {
    AND: [
      where,
      costPaymentInvoiceSortGroupWhere(weight, supplierInvoicePairs),
    ],
  };
}

async function countCostSortGroups(
  where: Prisma.OrderCostWhereInput,
  supplierInvoicePairs: SupplierInvoicePair[],
) {
  const counts = await Promise.all(
    COST_WORKFLOW_SORT_WEIGHTS.map((weight) => prisma.orderCost.count({
      where: costSortedWhere(where, weight, supplierInvoicePairs),
    })),
  );
  return {
    counts,
    total: counts.reduce((sum, count) => sum + count, 0),
  };
}

async function findSortedCostRows(
  where: Prisma.OrderCostWhereInput,
  supplierInvoicePairs: SupplierInvoicePair[],
  skip: number,
  take: number,
) {
  const { counts, total } = await countCostSortGroups(where, supplierInvoicePairs);
  const rows: CostListRow[] = [];
  let remainingSkip = Math.max(skip, 0);
  let remainingTake = Math.max(take, 0);

  for (const [index, weight] of COST_WORKFLOW_SORT_WEIGHTS.entries()) {
    if (remainingTake <= 0) break;
    const groupCount = counts[index] || 0;
    if (remainingSkip >= groupCount) {
      remainingSkip -= groupCount;
      continue;
    }
    const groupRows = await prisma.orderCost.findMany({
      where: costSortedWhere(where, weight, supplierInvoicePairs),
      include: includeCostListRelations(),
      orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }],
      skip: remainingSkip,
      take: remainingTake,
    });
    rows.push(...groupRows);
    remainingTake -= groupRows.length;
    remainingSkip = 0;
  }

  return { rows, total };
}

export async function listCosts(query: CostQuery, actor: ActorLike = null): Promise<CostDto[]> {
  assertRead(actor, "costs");
  const filters = costListFiltersFromQuery(query);
  const invoicePairs = await successfulSupplierInvoicePairs();
  const where = pagedCostWhere(filters, actor, invoicePairs);
  const requestedPageSize = Number(query.get("pageSize") || query.get("limit") || 0);
  const take = Math.min(
    COST_UNPAGINATED_SCAN_LIMIT,
    Math.max(Number.isFinite(requestedPageSize) && requestedPageSize > 0 ? requestedPageSize : 1000, 1),
  );
  const { rows } = await findSortedCostRows(where, invoicePairs, 0, take);
  return (await attachBusinessDocumentsToCosts(await attachLogisticsSourcesToCosts(rows))).map(safeSerializeCost);
}

export async function listCostsPage(query: CostQuery, actor: ActorLike = null) {
  assertRead(actor, "costs");
  const { page, pageSize } = costPageParams(query);
  const filters = costListFiltersFromQuery(query);
  const invoicePairs = await successfulSupplierInvoicePairs();
  const where = pagedCostWhere(filters, actor, invoicePairs);
  const { rows, total } = await findSortedCostRows(where, invoicePairs, (page - 1) * pageSize, pageSize);
  const rowsWithBusinessDocuments = await attachBusinessDocumentsToCosts(await attachLogisticsSourcesToCosts(rows));
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
  const [costWithSource] = await attachLogisticsSourcesToCosts([cost]);
  return safeSerializeCost(await attachBusinessDocumentsToCost(costWithSource));
}
