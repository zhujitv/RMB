import { Prisma } from "../generated/prisma/client.js";

type DateValue = Date | string | null | undefined;
type QuantityValue = { toString(): string } | string | number;

export type SupplierDeliveryQuantityVarianceRow = {
  id: string;
  purchaseOrderId: string;
  sequenceNo: number;
  status: string;
  source: string;
  channel: string;
  supplierContact: string;
  supplierRequestedAt: DateValue;
  requestedAt: DateValue;
  reason: string;
  decidedAt: DateValue;
  items: Array<{
    purchaseOrderItemId: string;
    orderedQuantitySnapshot: QuantityValue;
    proposedQuantity: QuantityValue;
  }>;
};

export type SupplierDeliveryQuantityVarianceDto = {
  id: string;
  purchaseOrderId: string;
  sequenceNo: number;
  status: string;
  source: string;
  channel: string;
  supplierContact: string;
  supplierRequestedAt: string | null;
  requestedAt: string | null;
  reason: string;
  decidedAt: string | null;
  items: Array<{
    purchaseOrderItemId: string;
    orderedQuantity: string;
    proposedQuantity: string;
    differenceQuantity: string;
  }>;
};

function isoDate(value: DateValue) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function serializeSupplierDeliveryQuantityVariance(
  variance: SupplierDeliveryQuantityVarianceRow,
): SupplierDeliveryQuantityVarianceDto {
  return {
    id: variance.id,
    purchaseOrderId: variance.purchaseOrderId,
    sequenceNo: variance.sequenceNo,
    status: variance.status,
    source: variance.source,
    channel: variance.channel,
    supplierContact: variance.supplierContact,
    supplierRequestedAt: isoDate(variance.supplierRequestedAt),
    requestedAt: isoDate(variance.requestedAt),
    reason: variance.reason,
    decidedAt: isoDate(variance.decidedAt),
    items: variance.items.map((item) => {
      const ordered = new Prisma.Decimal(item.orderedQuantitySnapshot.toString());
      const proposed = new Prisma.Decimal(item.proposedQuantity.toString());
      return {
        purchaseOrderItemId: item.purchaseOrderItemId,
        orderedQuantity: ordered.toString(),
        proposedQuantity: proposed.toString(),
        differenceQuantity: proposed.sub(ordered).toString(),
      };
    }),
  };
}

export function serializeSupplierDeliveryQuantityVariances(
  variances: SupplierDeliveryQuantityVarianceRow[],
) {
  return variances.map(serializeSupplierDeliveryQuantityVariance);
}
