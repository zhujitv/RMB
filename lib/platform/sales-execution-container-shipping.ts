import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import type { loadSalesExecution } from "./sales-execution-query-service";

type ShippingExecution = Awaited<ReturnType<typeof loadSalesExecution>>;

export type ReleasedContainerMaterialization = {
  loadedByPurchaseOrderItem: Map<string, Prisma.Decimal>;
  actualDeliveryDateByPurchaseOrder: Map<string, Date>;
};

function sameIds(left: string[], right: string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Rebuild authoritative loading solely from RELEASED container ledgers. */
export function releasedContainerMaterialization(
  execution: ShippingExecution,
): ReleasedContainerMaterialization {
  const activePurchaseOrders = execution.purchaseOrders.filter((order) => !["REJECTED", "VOIDED"].includes(order.status));
  const activePoIds = new Set(activePurchaseOrders.map((order) => order.id));
  // A replacement PO may leave behind an unfinalized container that belongs
  // only to the rejected PO. It is no longer part of the active shipment.
  // Mixed active/inactive allocations remain in scope and are rejected below.
  const containers = execution.containerLoads.filter((container) => (
    container.status !== "VOIDED"
    && container.allocations.some((allocation) => activePoIds.has(allocation.purchaseOrderId))
  ));
  if (!containers.length) {
    throw codedError("请先建立集装箱装柜总账", 409, "SHIPPING_CONTAINER_LOAD_REQUIRED");
  }
  if (containers.some((container) => container.status !== "RELEASED")) {
    throw codedError("仍有集装箱未放行，不能进入发货", 409, "SHIPPING_CONTAINER_NOT_RELEASED");
  }

  const loadedByPurchaseOrderItem = new Map<string, Prisma.Decimal>();
  const actualDeliveryDateByPurchaseOrder = new Map<string, Date>();
  for (const container of containers) {
    if (!container.loadingDate) {
      throw codedError("已放行集装箱缺少装柜日期", 409, "SHIPPING_CONTAINER_DATE_REQUIRED");
    }
    if (container.loadingResults.some((result) => result.status === "PENDING")) {
      throw codedError("已放行集装箱存在待审批装柜结果", 409, "SHIPPING_CONTAINER_PENDING_RESULT");
    }
    const poIds = [...new Set(container.allocations.map((allocation) => allocation.purchaseOrderId))];
    if (poIds.some((purchaseOrderId) => !activePoIds.has(purchaseOrderId))) {
      throw codedError("已放行集装箱包含失效采购单", 409, "SHIPPING_CONTAINER_PURCHASE_ORDER_INVALID");
    }
    let containerLoaded = new Prisma.Decimal(0);
    for (const purchaseOrderId of poIds) {
      const approved = container.loadingResults.filter((result) => (
        result.purchaseOrderId === purchaseOrderId && result.status === "APPROVED"
      ));
      if (approved.length !== 1) {
        throw codedError("已放行集装箱的供应商槽位未唯一批准", 409, "SHIPPING_CONTAINER_SLOT_INVALID");
      }
      const allocationItemIds = container.allocations
        .filter((allocation) => allocation.purchaseOrderId === purchaseOrderId)
        .map((allocation) => allocation.purchaseOrderItemId);
      if (!sameIds(allocationItemIds, approved[0].items.map((item) => item.purchaseOrderItemId))) {
        throw codedError("已放行集装箱的装柜结果未完整覆盖柜内分配", 409, "SHIPPING_CONTAINER_RESULT_INCOMPLETE");
      }
      for (const item of approved[0].items) {
        loadedByPurchaseOrderItem.set(
          item.purchaseOrderItemId,
          (loadedByPurchaseOrderItem.get(item.purchaseOrderItemId) || new Prisma.Decimal(0)).add(item.loadedQuantity),
        );
        containerLoaded = containerLoaded.add(item.loadedQuantity);
      }
      const existingDate = actualDeliveryDateByPurchaseOrder.get(purchaseOrderId);
      if (!existingDate || existingDate.getTime() < container.loadingDate.getTime()) {
        actualDeliveryDateByPurchaseOrder.set(purchaseOrderId, container.loadingDate);
      }
    }
    if (!containerLoaded.gt(0)) {
      throw codedError("已放行集装箱实际装柜数量为 0", 409, "SHIPPING_CONTAINER_TOTAL_REQUIRED");
    }
  }

  const deliveredByExecutionItem = new Map<string, Prisma.Decimal>();
  for (const order of activePurchaseOrders) {
    if (!actualDeliveryDateByPurchaseOrder.has(order.id)) {
      throw codedError("仍有有效采购单未纳入已放行集装箱", 409, "SHIPPING_PURCHASE_ORDER_NOT_LOADED");
    }
    for (const item of order.items) {
      if (!loadedByPurchaseOrderItem.has(item.id)) {
        throw codedError("仍有采购明细未纳入已放行集装箱", 409, "SHIPPING_PURCHASE_ITEM_NOT_LOADED");
      }
      deliveredByExecutionItem.set(
        item.executionItemId,
        (deliveredByExecutionItem.get(item.executionItemId) || new Prisma.Decimal(0))
          .add(loadedByPurchaseOrderItem.get(item.id) || 0),
      );
    }
  }
  if (execution.items.some((item) => (
    (deliveredByExecutionItem.get(item.id) || new Prisma.Decimal(0)).lt(item.quantity)
  ))) {
    throw codedError(
      "所有已放行柜汇总实际装柜数量少于客户销售数量",
      409,
      "SHIPPING_ACTUAL_DELIVERY_QUANTITY_SHORT",
    );
  }
  return { loadedByPurchaseOrderItem, actualDeliveryDateByPurchaseOrder };
}

export async function materializeReleasedContainerActuals(
  tx: Prisma.TransactionClient,
  execution: ShippingExecution,
  materialization: ReleasedContainerMaterialization,
  actorId: string,
  recordedAt: Date,
) {
  for (const order of execution.purchaseOrders.filter((row) => !["REJECTED", "VOIDED"].includes(row.status))) {
    for (const item of order.items) {
      const loadedQuantity = materialization.loadedByPurchaseOrderItem.get(item.id);
      if (loadedQuantity === undefined) {
        throw codedError("采购明细实际装柜数量不完整", 409, "SHIPPING_PURCHASE_ITEM_NOT_LOADED");
      }
      const changed = await tx.factoryPurchaseOrderItem.updateMany({
        where: { id: item.id, purchaseOrderId: order.id, actualDeliveredQuantity: null },
        data: { actualDeliveredQuantity: loadedQuantity },
      });
      if (changed.count !== 1) {
        throw codedError("采购明细已被其他操作物化", 409, "SHIPPING_ACTUAL_DELIVERY_CONFLICT");
      }
    }
    const actualDeliveryDate = materialization.actualDeliveryDateByPurchaseOrder.get(order.id);
    if (!actualDeliveryDate) {
      throw codedError("采购单缺少实际装柜日期", 409, "SHIPPING_PURCHASE_ORDER_DATE_MISSING");
    }
    const changed = await tx.factoryPurchaseOrder.updateMany({
      where: {
        id: order.id,
        executionId: execution.id,
        revision: order.revision,
        actualDeliveryDate: null,
        actualDeliveryRecordedAt: null,
        actualDeliveryRecordedById: null,
        settlement: { is: null },
      },
      data: {
        actualDeliveryDate,
        actualDeliveryRecordedAt: recordedAt,
        actualDeliveryRecordedById: actorId,
        revision: { increment: 1 },
        updatedById: actorId,
      },
    });
    if (changed.count !== 1) {
      throw codedError("采购单实际交付物化冲突", 409, "SHIPPING_ACTUAL_DELIVERY_CONFLICT");
    }
  }
}
