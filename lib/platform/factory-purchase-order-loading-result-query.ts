import { Prisma } from "../generated/prisma/client.js";

export const factoryPurchaseLoadingResultSelect = Prisma.validator<Prisma.FactoryPurchaseOrderLoadingResultSelect>()({
  id: true, containerLoadId: true, executionId: true, purchaseOrderId: true,
  sequenceNo: true, status: true, reason: true, reasonDetail: true,
  source: true, channel: true, supplierContact: true, requestedAt: true,
  requestedById: true, decidedAt: true, decidedById: true,
  decisionRemark: true, legacyBackfill: true,
  containerLoad: { select: { loadingDate: true, status: true } },
  items: { orderBy: [{ purchaseOrderItemId: "asc" }] },
});

export const factoryPurchaseLoadingOrderSelect = Prisma.validator<Prisma.FactoryPurchaseOrderSelect>()({
  id: true, executionId: true, supplierId: true, revision: true,
  status: true, productionStatus: true, productionCompletedAt: true,
  actualDeliveryDate: true, actualDeliveryRecordedAt: true,
  actualDeliveryRecordedById: true,
  settlement: { select: { id: true } },
  execution: { select: { shippingStartedAt: true } },
  items: {
    orderBy: [{ lineNumber: "asc" }],
    select: {
      id: true, executionItemId: true, allocatedQuantity: true,
      actualDeliveredQuantity: true,
    },
  },
  deliveryQuantityVariances: {
    where: { status: "APPROVED" }, orderBy: [{ sequenceNo: "desc" }], take: 1,
    select: {
      status: true,
      items: { select: { purchaseOrderItemId: true, proposedQuantity: true } },
    },
  },
  productionProgressReports: {
    orderBy: [{ sequenceNo: "desc" }], take: 1,
    select: {
      sequenceNo: true,
      items: { select: { purchaseOrderItemId: true, completedQuantity: true } },
    },
  },
  loadingResults: {
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }], take: 500,
    select: factoryPurchaseLoadingResultSelect,
  },
});

export const containerLoadingScopeSelect = Prisma.validator<Prisma.SalesExecutionContainerLoadSelect>()({
  id: true, executionId: true, sequenceNo: true, status: true,
  containerNo: true, containerType: true, sealNo: true, loadingDate: true,
  revision: true, releasedAt: true, releasedById: true, releaseRemark: true,
  voidedAt: true, voidedById: true, voidReason: true, legacyBackfill: true,
  allocations: {
    orderBy: [{ purchaseOrderId: "asc" }, { purchaseOrderItemId: "asc" }],
    select: {
      id: true, containerLoadId: true, executionId: true,
      purchaseOrderId: true, purchaseOrderItemId: true, plannedQuantity: true,
    },
  },
  loadingResults: {
    orderBy: [{ purchaseOrderId: "asc" }, { sequenceNo: "desc" }], take: 500,
    select: factoryPurchaseLoadingResultSelect,
  },
});

export type FactoryPurchaseLoadingOrder = Prisma.FactoryPurchaseOrderGetPayload<{
  select: typeof factoryPurchaseLoadingOrderSelect;
}>;
export type FactoryPurchaseLoadingResult = FactoryPurchaseLoadingOrder["loadingResults"][number];
export type ContainerLoadingScope = Prisma.SalesExecutionContainerLoadGetPayload<{
  select: typeof containerLoadingScopeSelect;
}>;
