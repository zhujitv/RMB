import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import type { NormalizedDeliveryQuantityVarianceItem } from "./factory-purchase-order-delivery-quantity-variance-inputs";

export const deliveryQuantityVarianceOrderSelect = Prisma.validator<Prisma.FactoryPurchaseOrderSelect>()({
  id: true,
  executionId: true,
  supplierId: true,
  revision: true,
  status: true,
  productionStatus: true,
  productionStartedAt: true,
  actualDeliveryDate: true,
  deliveryQuantityToleranceRatio: true,
  settlement: { select: { id: true } },
  execution: { select: { shippingStartedAt: true } },
  items: {
    orderBy: [{ lineNumber: "asc" }],
    select: { id: true, allocatedQuantity: true, actualDeliveredQuantity: true },
  },
  deliveryQuantityVariances: {
    orderBy: [{ sequenceNo: "desc" }],
    take: 100,
    select: {
      id: true,
      purchaseOrderId: true,
      sequenceNo: true,
      status: true,
      source: true,
      channel: true,
      supplierContact: true,
      supplierRequestedAt: true,
      requestedAt: true,
      requestedById: true,
      reason: true,
      decidedAt: true,
      decidedById: true,
      decisionRemark: true,
      items: {
        orderBy: [{ purchaseOrderItemId: "asc" }],
        select: {
          purchaseOrderItemId: true,
          orderedQuantitySnapshot: true,
          proposedQuantity: true,
        },
      },
    },
  },
});

export type DeliveryQuantityVarianceOrder = Prisma.FactoryPurchaseOrderGetPayload<{
  select: typeof deliveryQuantityVarianceOrderSelect;
}>;
export type DeliveryQuantityVarianceRow = DeliveryQuantityVarianceOrder["deliveryQuantityVariances"][number];

export type DeliveryQuantityVarianceAttribution = {
  source: "SUPPLIER_PORTAL" | "INTERNAL_OFFLINE";
  channel: "PORTAL" | "WECHAT" | "PHONE" | "EMAIL" | "PAPER" | "OTHER";
  supplierContact: string;
  supplierRequestedAt: Date;
};

export function serializeDeliveryQuantityVariance(row: DeliveryQuantityVarianceRow) {
  return {
    id: row.id,
    purchaseOrderId: row.purchaseOrderId,
    sequenceNo: row.sequenceNo,
    status: row.status,
    source: row.source,
    channel: row.channel,
    supplierContact: row.supplierContact,
    supplierRequestedAt: row.supplierRequestedAt,
    requestedAt: row.requestedAt,
    requestedById: row.requestedById,
    reason: row.reason,
    decidedAt: row.decidedAt,
    decidedById: row.decidedById,
    decisionRemark: row.decisionRemark || "",
    items: row.items.map((item) => ({
      purchaseOrderItemId: item.purchaseOrderItemId,
      orderedQuantity: item.orderedQuantitySnapshot.toString(),
      proposedQuantity: item.proposedQuantity.toString(),
      differenceQuantity: item.proposedQuantity.sub(item.orderedQuantitySnapshot).toString(),
    })),
  };
}

export function assertDeliveryQuantityVarianceOpen(order: DeliveryQuantityVarianceOrder) {
  if (order.status !== "ACCEPTED" || order.productionStatus !== "IN_PRODUCTION") {
    throw codedError(
      "只有已接受且生产中的采购单可以申请交付数量差异",
      409,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_NOT_ALLOWED",
    );
  }
  if (order.actualDeliveryDate || order.execution.shippingStartedAt || order.settlement) {
    throw codedError(
      "采购单已交付、进入发货或结算，不能申请或审批交付数量差异",
      409,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_FROZEN",
    );
  }
}

function assertSupplierRequestedAt(
  order: DeliveryQuantityVarianceOrder,
  supplierRequestedAt: Date,
  recordedAt: Date,
) {
  const productionStartedAt = order.productionStartedAt
    ? new Date(order.productionStartedAt)
    : null;
  const latestRequestedAt = order.deliveryQuantityVariances[0]?.supplierRequestedAt;
  if (!productionStartedAt
    || supplierRequestedAt.getTime() < productionStartedAt.getTime()
    || supplierRequestedAt.getTime() > recordedAt.getTime()) {
    throw codedError(
      "供应商实际申请时间必须在开始生产后且不能晚于当前时间",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_REQUESTED_AT_INVALID",
    );
  }
  if (latestRequestedAt && supplierRequestedAt.getTime() < new Date(latestRequestedAt).getTime()) {
    throw codedError(
      "供应商实际申请时间不能早于上一份差异申请",
      409,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_REQUESTED_AT_DECREASED",
    );
  }
}

function assertNoActiveVariance(order: DeliveryQuantityVarianceOrder) {
  const active = order.deliveryQuantityVariances.find((row) => (
    row.status === "PENDING" || row.status === "APPROVED"
  ));
  if (!active) return;
  throw codedError(
    active.status === "APPROVED"
      ? "该采购单已有批准的交付数量差异，不能重复申请"
      : "该采购单已有待审批的交付数量差异申请",
    409,
    active.status === "APPROVED"
      ? "FACTORY_DELIVERY_QUANTITY_VARIANCE_ALREADY_APPROVED"
      : "FACTORY_DELIVERY_QUANTITY_VARIANCE_ALREADY_PENDING",
  );
}

export async function appendDeliveryQuantityVariance({
  tx,
  order,
  expectedRevision,
  requestedById,
  reason,
  items,
  attribution,
}: {
  tx: Prisma.TransactionClient;
  order: DeliveryQuantityVarianceOrder;
  expectedRevision: number;
  requestedById: string;
  reason: string;
  items: NormalizedDeliveryQuantityVarianceItem[];
  attribution: DeliveryQuantityVarianceAttribution;
}) {
  assertDeliveryQuantityVarianceOpen(order);
  if (order.revision !== expectedRevision) {
    throw codedError(
      "采购单状态已变化，请刷新后重试",
      409,
      "FACTORY_PURCHASE_ORDER_REVISION_CONFLICT",
    );
  }
  assertNoActiveVariance(order);
  const requestedAt = new Date();
  assertSupplierRequestedAt(order, attribution.supplierRequestedAt, requestedAt);
  const sequenceNo = order.deliveryQuantityVariances.reduce(
    (maximum, row) => Math.max(maximum, row.sequenceNo),
    0,
  ) + 1;
  const variance = await tx.factoryPurchaseOrderDeliveryQuantityVariance.create({
    data: {
      purchaseOrderId: order.id,
      sequenceNo,
      status: "PENDING",
      source: attribution.source,
      channel: attribution.channel,
      supplierContact: attribution.supplierContact,
      supplierRequestedAt: attribution.supplierRequestedAt,
      requestedAt,
      requestedById,
      reason,
      items: {
        create: items.map((item) => ({
          purchaseOrderId: order.id,
          purchaseOrderItemId: item.purchaseOrderItemId,
          orderedQuantitySnapshot: item.orderedQuantitySnapshot,
          proposedQuantity: item.proposedQuantity,
        })),
      },
    },
    select: deliveryQuantityVarianceOrderSelect.deliveryQuantityVariances.select,
  });
  const changed = await tx.factoryPurchaseOrder.updateMany({
    where: {
      id: order.id,
      revision: expectedRevision,
      status: "ACCEPTED",
      productionStatus: "IN_PRODUCTION",
      actualDeliveryDate: null,
      settlement: { is: null },
      execution: { is: { shippingStartedAt: null } },
    },
    data: { revision: { increment: 1 }, updatedById: requestedById },
  });
  if (changed.count !== 1) {
    throw codedError(
      "采购单状态已变化，请刷新后重试",
      409,
      "FACTORY_PURCHASE_ORDER_REVISION_CONFLICT",
    );
  }
  return variance;
}

export function deliveryQuantityVarianceAuditState(
  order: DeliveryQuantityVarianceOrder,
  variance?: DeliveryQuantityVarianceRow | null,
) {
  return {
    purchaseOrderId: order.id,
    revision: order.revision,
    status: order.status,
    productionStatus: order.productionStatus,
    variance: variance ? serializeDeliveryQuantityVariance(variance) : null,
  };
}
