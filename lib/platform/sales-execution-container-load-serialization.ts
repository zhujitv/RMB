import type { FactoryPurchaseLoadingResultRow } from "./factory-purchase-order-loading-result-serialization";
import {
  serializeInternalFactoryPurchaseLoadingResult,
  serializeSupplierFactoryPurchaseLoadingResult,
} from "./factory-purchase-order-loading-result-serialization";

type DateValue = Date | string | null | undefined;
type QuantityValue = { toString(): string } | string | number;

export type InternalContainerLoadRow = {
  id: string;
  executionId: string;
  sequenceNo: number;
  status: string;
  containerNo: string | null;
  containerType: string | null;
  sealNo: string | null;
  loadingDate: DateValue;
  revision: number;
  releasedAt: DateValue;
  releasedBy?: { id: string; name: string } | null;
  releaseRemark: string | null;
  voidedAt: DateValue;
  voidedBy?: { id: string; name: string } | null;
  voidReason: string | null;
  legacyBackfill: boolean;
  createdAt?: DateValue;
  updatedAt?: DateValue;
  allocations: Array<{
    id: string;
    purchaseOrderId: string;
    purchaseOrderItemId: string;
    plannedQuantity: QuantityValue;
  }>;
  loadingResults: FactoryPurchaseLoadingResultRow[];
};

function iso(value: DateValue) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function serializeInternalContainerLoad(row: InternalContainerLoadRow) {
  return {
    id: row.id,
    executionId: row.executionId,
    sequenceNo: row.sequenceNo,
    status: row.status,
    containerNo: row.containerNo || "",
    containerType: row.containerType || "",
    sealNo: row.sealNo || "",
    loadingDate: iso(row.loadingDate),
    revision: row.revision,
    releasedAt: iso(row.releasedAt),
    releasedBy: row.releasedBy?.id
      ? { id: row.releasedBy.id, name: row.releasedBy.name || "" }
      : null,
    releaseRemark: row.releaseRemark || "",
    voidedAt: iso(row.voidedAt),
    voidedBy: row.voidedBy?.id
      ? { id: row.voidedBy.id, name: row.voidedBy.name || "" }
      : null,
    voidReason: row.voidReason || "",
    legacyBackfill: Boolean(row.legacyBackfill),
    allocations: row.allocations.map((allocation) => ({
      id: allocation.id,
      purchaseOrderId: allocation.purchaseOrderId,
      purchaseOrderItemId: allocation.purchaseOrderItemId,
      plannedQuantity: allocation.plannedQuantity.toString(),
    })),
    loadingResults: row.loadingResults.map(serializeInternalFactoryPurchaseLoadingResult),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export type SupplierContainerLoadRow = {
  id: string;
  sequenceNo: number;
  status: string;
  containerNo: string | null;
  containerType: string | null;
  sealNo: string | null;
  loadingDate: DateValue;
  revision: number;
  releasedAt: DateValue;
  allocations: Array<{
    id: string;
    purchaseOrderId: string;
    purchaseOrderItemId: string;
    plannedQuantity: QuantityValue;
  }>;
  loadingResults: FactoryPurchaseLoadingResultRow[];
};

/** Supplier boundary: only this purchase order's allocations and results are passed in. */
export function serializeSupplierContainerLoad(row: SupplierContainerLoadRow) {
  return {
    id: row.id,
    sequenceNo: row.sequenceNo,
    status: row.status,
    containerNo: row.containerNo || "",
    containerType: row.containerType || "",
    sealNo: row.sealNo || "",
    loadingDate: iso(row.loadingDate),
    revision: row.revision,
    releasedAt: iso(row.releasedAt),
    allocations: row.allocations.map((allocation) => ({
      id: allocation.id,
      purchaseOrderItemId: allocation.purchaseOrderItemId,
      plannedQuantity: allocation.plannedQuantity.toString(),
    })),
    loadingResults: row.loadingResults.map(serializeSupplierFactoryPurchaseLoadingResult),
  };
}
