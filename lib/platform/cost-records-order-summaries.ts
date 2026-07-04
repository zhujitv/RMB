import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { assertRead } from "./shared";
import { orderAccessWhere } from "./order-access";
import { attachBusinessDocumentsToCostOrders, successfulSupplierInvoicePairs } from "./business-documents";
import { costPageParams, orderArchiveWhereForScope, serializeCostOrderSummary } from "./cost-records-shared";
import {
  costListFiltersFromQuery,
  pagedCostWhere,
  type ActorLike,
  type CostQuery,
} from "./cost-records-query-shared";

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
