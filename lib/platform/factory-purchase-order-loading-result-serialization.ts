type DateValue = Date | string | null | undefined;
type QuantityValue = { toString(): string } | string | number;

export type FactoryPurchaseLoadingResultRow = {
  id: string;
  containerLoadId: string;
  executionId?: string;
  purchaseOrderId: string;
  sequenceNo: number;
  status: string;
  reason: string;
  reasonDetail: string | null;
  source: string;
  channel: string;
  supplierContact: string;
  containerLoad?: { loadingDate?: DateValue } | null;
  requestedAt: DateValue;
  requestedById?: string;
  requestedBy?: { id: string; name: string } | null;
  decidedAt: DateValue;
  decidedById?: string | null;
  decidedBy?: { id: string; name: string } | null;
  decisionRemark?: string | null;
  legacyBackfill: boolean;
  items: Array<{
    purchaseOrderItemId: string;
    plannedQuantitySnapshot: QuantityValue;
    deliveryTargetQuantitySnapshot: QuantityValue;
    completedQuantitySnapshot: QuantityValue;
    previouslyApprovedLoadedQuantitySnapshot: QuantityValue;
    loadedQuantity: QuantityValue;
    cumulativeApprovedLoadedQuantitySnapshot: QuantityValue;
    warehouseRetainedQuantitySnapshot: QuantityValue;
  }>;
};

function isoDate(value: DateValue) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeItems(row: FactoryPurchaseLoadingResultRow) {
  return row.items.map((item) => ({
    purchaseOrderItemId: item.purchaseOrderItemId,
    plannedQuantity: item.plannedQuantitySnapshot.toString(),
    deliveryTargetQuantity: item.deliveryTargetQuantitySnapshot.toString(),
    completedQuantity: item.completedQuantitySnapshot.toString(),
    previouslyApprovedLoadedQuantity: item.previouslyApprovedLoadedQuantitySnapshot.toString(),
    loadedQuantity: item.loadedQuantity.toString(),
    cumulativeApprovedLoadedQuantity: item.cumulativeApprovedLoadedQuantitySnapshot.toString(),
    warehouseRetainedQuantity: item.warehouseRetainedQuantitySnapshot.toString(),
  }));
}

export function serializeInternalFactoryPurchaseLoadingResult(
  row: FactoryPurchaseLoadingResultRow,
) {
  return {
    id: row.id,
    containerLoadId: row.containerLoadId,
    purchaseOrderId: row.purchaseOrderId,
    sequenceNo: row.sequenceNo,
    status: row.status,
    reason: row.reason,
    reasonDetail: row.reasonDetail || "",
    source: row.source,
    channel: row.channel,
    supplierContact: row.supplierContact,
    loadingDate: isoDate(row.containerLoad?.loadingDate),
    requestedAt: isoDate(row.requestedAt),
    requestedBy: row.requestedBy?.id
      ? { id: row.requestedBy.id, name: row.requestedBy.name || "" }
      : null,
    decidedAt: isoDate(row.decidedAt),
    decidedBy: row.decidedBy?.id
      ? { id: row.decidedBy.id, name: row.decidedBy.name || "" }
      : null,
    decisionRemark: row.decisionRemark || "",
    legacyBackfill: Boolean(row.legacyBackfill),
    items: serializeItems(row),
  };
}

/** Supplier boundary: deliberately omits all internal actors and decision remarks. */
export function serializeSupplierFactoryPurchaseLoadingResult(
  row: FactoryPurchaseLoadingResultRow,
) {
  return {
    id: row.id,
    containerLoadId: row.containerLoadId,
    purchaseOrderId: row.purchaseOrderId,
    sequenceNo: row.sequenceNo,
    status: row.status,
    reason: row.reason,
    reasonDetail: row.reasonDetail || "",
    source: row.source,
    channel: row.channel,
    supplierContact: row.supplierContact,
    loadingDate: isoDate(row.containerLoad?.loadingDate),
    requestedAt: isoDate(row.requestedAt),
    decidedAt: isoDate(row.decidedAt),
    legacyBackfill: Boolean(row.legacyBackfill),
    items: serializeItems(row),
  };
}

export type SupplierFactoryPurchaseLoadingResultDto = ReturnType<
  typeof serializeSupplierFactoryPurchaseLoadingResult
>;
