import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { assertRead } from "./shared";
import { orderAccessWhere } from "./order-access";
import { attachBusinessDocumentsToCostOrders, successfulSupplierInvoicePairs } from "./business-documents";
import { costPageParams, orderArchiveWhereForScope, serializeCostOrderSummary } from "./cost-records-shared";
import {
  COST_UNPAGINATED_SCAN_LIMIT,
  COST_WORKFLOW_SORT_WEIGHTS,
  costPaymentInvoiceSortGroupWhere,
  costListFiltersFromQuery,
  pagedCostWhere,
  type ActorLike,
  type CostQuery,
  type CostWorkflowSortWeight,
  type SupplierInvoicePair,
} from "./cost-records-query-shared";

const COST_ORDER_SUMMARY_BATCH_SIZE = 120;

function costOrderSortedWhere(
  costWhere: Prisma.OrderCostWhereInput,
  orderWhere: Prisma.ReceivableOrderWhereInput,
  weight: CostWorkflowSortWeight,
  supplierInvoicePairs: SupplierInvoicePair[],
): Prisma.OrderCostWhereInput {
  return {
    AND: [
      costWhere,
      costPaymentInvoiceSortGroupWhere(weight, supplierInvoicePairs),
      { order: { is: orderWhere } },
    ],
  };
}

async function findSortedCostOrderIds(
  costWhere: Prisma.OrderCostWhereInput,
  orderWhere: Prisma.ReceivableOrderWhereInput,
  supplierInvoicePairs: SupplierInvoicePair[],
  skip: number,
  take: number,
) {
  const requiredOrderCount = skip + take;
  const maxRows = Math.min(
    COST_UNPAGINATED_SCAN_LIMIT,
    Math.max(requiredOrderCount * 8, take * 12, COST_ORDER_SUMMARY_BATCH_SIZE),
  );
  const orderIds: string[] = [];
  const seenOrderIds = new Set<string>();
  let scannedRows = 0;

  outer:
  for (const weight of COST_WORKFLOW_SORT_WEIGHTS) {
    let rowSkip = 0;
    while (scannedRows < maxRows && seenOrderIds.size < requiredOrderCount) {
      const rowTake = Math.min(COST_ORDER_SUMMARY_BATCH_SIZE, maxRows - scannedRows);
      if (rowTake <= 0) break outer;
      const rows = await prisma.orderCost.findMany({
        where: costOrderSortedWhere(costWhere, orderWhere, weight, supplierInvoicePairs),
        select: { orderId: true },
        orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }],
        skip: rowSkip,
        take: rowTake,
      });
      rowSkip += rows.length;
      scannedRows += rows.length;
      for (const row of rows) {
        if (!row.orderId || seenOrderIds.has(row.orderId)) continue;
        seenOrderIds.add(row.orderId);
        orderIds.push(row.orderId);
      }
      if (rows.length < rowTake) break;
    }
    if (seenOrderIds.size >= requiredOrderCount || scannedRows >= maxRows) break;
  }

  return orderIds.slice(skip, skip + take);
}

export async function listCostOrderSummaries(query: CostQuery, actor: ActorLike = null) {
  assertRead(actor, "costs");
  const { page, pageSize } = costPageParams(query);
  const filters = costListFiltersFromQuery(query);
  const invoicePairs = await successfulSupplierInvoicePairs();
  const costWhere = pagedCostWhere(filters, actor, invoicePairs);
  const where: Prisma.ReceivableOrderWhereInput = {
    deletedAt: null,
    ...orderArchiveWhereForScope(filters.businessScope),
    ...orderAccessWhere(actor),
    costs: { some: costWhere },
  };
  const skip = (page - 1) * pageSize;
  const [total, orderIds] = await Promise.all([
    prisma.receivableOrder.count({ where }),
    findSortedCostOrderIds(costWhere, where, invoicePairs, skip, pageSize),
  ]);
  const orders = orderIds.length
    ? await prisma.receivableOrder.findMany({
      where: {
        ...where,
        id: { in: orderIds },
      },
      include: {
        customer: true,
        businessEntity: true,
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
    })
    : [];
  const orderRank = new Map(orderIds.map((id, index) => [id, index]));
  orders.sort((a, b) => (orderRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderRank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  const ordersWithBusinessDocuments = await attachBusinessDocumentsToCostOrders(orders);
  return {
    rows: ordersWithBusinessDocuments.map(serializeCostOrderSummary),
    total,
    page,
    pageSize,
  };
}
