import { Prisma } from "../generated/prisma/client.js";

type DecimalValue = Prisma.Decimal | { toString(): string } | string | number;

export type DeliveryQuantityTargetItem = {
  id: string;
  allocatedQuantity: DecimalValue;
};

export type ApprovedDeliveryQuantityVariance = {
  status: string;
  items: Array<{
    purchaseOrderItemId: string;
    proposedQuantity: DecimalValue;
  }>;
} | null | undefined;

export type DeliveryQuantityProgressItem = {
  purchaseOrderItemId: string;
  completedQuantity: DecimalValue;
};

export function approvedDeliveryQuantityVariance<T extends ApprovedDeliveryQuantityVariance>(
  variances: T[] | null | undefined,
) {
  return (variances || []).find((variance) => variance?.status === "APPROVED") || null;
}

function decimal(value: DecimalValue) {
  return Prisma.Decimal.isDecimal(value) ? value : new Prisma.Decimal(value.toString());
}

export function deliveryQuantityTarget(
  allocatedQuantity: DecimalValue,
  approvedProposedQuantity?: DecimalValue | null,
) {
  return approvedProposedQuantity == null
    ? decimal(allocatedQuantity)
    : decimal(approvedProposedQuantity);
}

export function resolveDeliveryQuantityTargets(
  purchaseItems: DeliveryQuantityTargetItem[],
  approvedVariance: ApprovedDeliveryQuantityVariance,
) {
  if (!approvedVariance || approvedVariance.status !== "APPROVED") {
    return purchaseItems.map((item) => ({
      purchaseOrderItemId: item.id,
      targetQuantity: deliveryQuantityTarget(item.allocatedQuantity),
    }));
  }
  const proposedByItemId = new Map<string, DecimalValue>();
  for (const item of approvedVariance.items) {
    if (proposedByItemId.has(item.purchaseOrderItemId)) {
      throw new Error("approved delivery quantity variance contains duplicate purchase-order items");
    }
    proposedByItemId.set(item.purchaseOrderItemId, item.proposedQuantity);
  }
  if (proposedByItemId.size !== purchaseItems.length) {
    throw new Error("approved delivery quantity variance is not a complete purchase-order snapshot");
  }
  return purchaseItems.map((item) => {
    const proposed = proposedByItemId.get(item.id);
    if (proposed == null) {
      throw new Error("approved delivery quantity variance is not a complete purchase-order snapshot");
    }
    proposedByItemId.delete(item.id);
    return {
      purchaseOrderItemId: item.id,
      targetQuantity: deliveryQuantityTarget(item.allocatedQuantity, proposed),
    };
  });
}

export function resolveProductionProgressTargets(
  purchaseItems: DeliveryQuantityTargetItem[],
  approvedVariance?: ApprovedDeliveryQuantityVariance,
) {
  const targetByItemId = new Map(resolveDeliveryQuantityTargets(
    purchaseItems,
    approvedVariance,
  ).map((item) => [item.purchaseOrderItemId, item.targetQuantity]));
  return purchaseItems.map((item) => ({
    id: item.id,
    allocatedQuantity: item.allocatedQuantity,
    targetQuantity: targetByItemId.get(item.id) || deliveryQuantityTarget(item.allocatedQuantity),
  }));
}

export function productionProgressMeetsDeliveryTarget(
  progressItems: DeliveryQuantityProgressItem[],
  purchaseItems: DeliveryQuantityTargetItem[],
  approvedVariance?: ApprovedDeliveryQuantityVariance,
) {
  const targets = resolveDeliveryQuantityTargets(purchaseItems, approvedVariance);
  const completedByItemId = new Map<string, Prisma.Decimal>();
  for (const item of progressItems) {
    if (completedByItemId.has(item.purchaseOrderItemId)) return false;
    completedByItemId.set(item.purchaseOrderItemId, decimal(item.completedQuantity));
  }
  return Boolean(targets.length) && completedByItemId.size === targets.length && targets.every((target) => {
    const completed = completedByItemId.get(target.purchaseOrderItemId);
    return completed != null && completed.gte(target.targetQuantity);
  });
}
