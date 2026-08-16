import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { codedError } from "./shared-base-errors";
import type { SalesExecutionActor } from "./sales-execution-access";
import { salesExecutionAccessWhere } from "./sales-execution-access";
import { approvedDeliveryQuantityVariance, resolveDeliveryQuantityTargets } from "./factory-purchase-order-delivery-quantity-variance-values";
import { factoryPurchaseLoadingResultSelect } from "./factory-purchase-order-loading-result-core";
import type { normalizeContainerLoadCreateInput } from "./sales-execution-container-load-inputs";
import { serializeInternalContainerLoad, type InternalContainerLoadRow } from "./sales-execution-container-load-serialization";

type ContainerDetailsInput = ReturnType<typeof normalizeContainerLoadCreateInput>;
const userSelect = { id: true, name: true } satisfies Prisma.UserSelect;

export const internalContainerLoadSelect = Prisma.validator<Prisma.SalesExecutionContainerLoadSelect>()({
  id: true, executionId: true, sequenceNo: true, status: true,
  containerNo: true, containerType: true, sealNo: true, loadingDate: true,
  revision: true, releasedAt: true, releasedById: true,
  releasedBy: { select: userSelect }, releaseRemark: true,
  voidedAt: true, voidedById: true, voidedBy: { select: userSelect },
  voidReason: true, legacyBackfill: true, createdAt: true, updatedAt: true,
  allocations: {
    orderBy: [{ purchaseOrderId: "asc" }, { purchaseOrderItemId: "asc" }],
    select: {
      id: true, purchaseOrderId: true, purchaseOrderItemId: true,
      plannedQuantity: true,
    },
  },
  loadingResults: {
    orderBy: [{ purchaseOrderId: "asc" }, { sequenceNo: "desc" }], take: 500,
    select: {
      ...factoryPurchaseLoadingResultSelect,
      requestedBy: { select: userSelect }, decidedBy: { select: userSelect },
    },
  },
});

export type InternalContainerLoad = Prisma.SalesExecutionContainerLoadGetPayload<{
  select: typeof internalContainerLoadSelect;
}>;

export function containerLoadDto(container: InternalContainerLoad) {
  return serializeInternalContainerLoad(container as unknown as InternalContainerLoadRow);
}

export function scopedContainerExecution(
  tx: Prisma.TransactionClient,
  executionId: string,
  actor: SalesExecutionActor,
) {
  return tx.salesExecution.findFirst({
    where: { id: executionId, ...salesExecutionAccessWhere(actor) },
    select: {
      id: true, status: true, revision: true, shippingStartedAt: true,
      receivableOrder: { select: { id: true } },
    },
  });
}

export function scopedInternalContainerLoad(
  tx: Prisma.TransactionClient,
  executionId: string,
  containerLoadId: string,
  actor: SalesExecutionActor,
) {
  return tx.salesExecutionContainerLoad.findFirst({
    where: {
      id: containerLoadId, executionId,
      execution: { is: salesExecutionAccessWhere(actor) },
    },
    select: internalContainerLoadSelect,
  });
}

export function assertContainerExecutionOpen(
  execution: NonNullable<Awaited<ReturnType<typeof scopedContainerExecution>>>,
) {
  if (execution.status !== "DISPATCHED") {
    throw codedError("只有已下发的销售执行单可以管理集装箱", 409, "CONTAINER_LOAD_EXECUTION_NOT_DISPATCHED");
  }
  if (execution.shippingStartedAt || execution.receivableOrder) {
    throw codedError("销售执行单已进入发货，集装箱已冻结", 409, "CONTAINER_LOAD_EXECUTION_FROZEN");
  }
}

export async function loadContainerAllocationTargets(
  tx: Prisma.TransactionClient,
  executionId: string,
  allocationInputs: ContainerDetailsInput["allocations"],
) {
  const itemIds = allocationInputs.map((item) => item.purchaseOrderItemId);
  const rows = await tx.factoryPurchaseOrderItem.findMany({
    where: {
      id: { in: itemIds }, executionId,
      purchaseOrder: { is: { status: { notIn: ["REJECTED", "VOIDED"] }, dispatchedAt: { not: null } } },
    },
    select: {
      id: true, purchaseOrderId: true,
      purchaseOrder: {
        select: {
          deliveryQuantityVariances: {
            where: { status: "APPROVED" }, orderBy: [{ sequenceNo: "desc" }], take: 1,
            select: {
              status: true,
              items: { select: { purchaseOrderItemId: true, proposedQuantity: true } },
            },
          },
          items: { select: { id: true, allocatedQuantity: true } },
        },
      },
    },
  });
  if (rows.length !== itemIds.length) {
    throw codedError("本柜分配包含无效、未下发或已失效的采购明细", 400, "CONTAINER_LOAD_ALLOCATION_ITEM_INVALID");
  }
  const rowById = new Map(rows.map((row) => [row.id, row]));
  return allocationInputs.map((input) => {
    const row = rowById.get(input.purchaseOrderItemId);
    if (!row) throw codedError("本柜分配包含无效采购明细", 400, "CONTAINER_LOAD_ALLOCATION_ITEM_INVALID");
    const approved = approvedDeliveryQuantityVariance(row.purchaseOrder.deliveryQuantityVariances);
    const target = resolveDeliveryQuantityTargets(row.purchaseOrder.items, approved)
      .find((item) => item.purchaseOrderItemId === row.id)?.targetQuantity;
    if (!target) throw codedError("采购明细交付目标异常", 409, "CONTAINER_LOAD_DELIVERY_TARGET_INVALID");
    return { ...input, purchaseOrderId: row.purchaseOrderId, deliveryTargetQuantity: target };
  });
}

export async function assertContainerPlannedTotals(
  tx: Prisma.TransactionClient,
  targets: Awaited<ReturnType<typeof loadContainerAllocationTargets>>,
  excludingContainerLoadId?: string,
) {
  const existing = await tx.containerLoadAllocation.findMany({
    where: {
      purchaseOrderItemId: { in: targets.map((target) => target.purchaseOrderItemId) },
      ...(excludingContainerLoadId ? { containerLoadId: { not: excludingContainerLoadId } } : {}),
      containerLoad: { is: { status: { not: "VOIDED" } } },
    },
    select: {
      purchaseOrderItemId: true, purchaseOrderId: true, plannedQuantity: true,
      containerLoad: {
        select: {
          loadingResults: {
            where: { status: "APPROVED" },
            select: {
              purchaseOrderId: true,
              items: { select: { purchaseOrderItemId: true, loadedQuantity: true } },
            },
          },
        },
      },
    },
  });
  const reservedByItem = new Map<string, Prisma.Decimal>();
  for (const row of existing) {
    const approved = row.containerLoad.loadingResults
      .find((result) => result.purchaseOrderId === row.purchaseOrderId)?.items
      .find((item) => item.purchaseOrderItemId === row.purchaseOrderItemId);
    const reserved = approved?.loadedQuantity ?? row.plannedQuantity;
    reservedByItem.set(
      row.purchaseOrderItemId,
      (reservedByItem.get(row.purchaseOrderItemId) || new Prisma.Decimal(0)).add(reserved),
    );
  }
  for (const target of targets) {
    const total = (reservedByItem.get(target.purchaseOrderItemId) || new Prisma.Decimal(0)).add(target.plannedQuantity);
    if (total.gt(target.deliveryTargetQuantity)) {
      throw codedError("同一采购明细跨柜有效占用不能超过已批准交付目标", 409, "CONTAINER_LOAD_PLANNED_QUANTITY_EXCEEDED");
    }
  }
}

export async function lockContainerPurchaseOrders(
  tx: Prisma.TransactionClient,
  executionId: string,
  purchaseOrderIds: string[],
) {
  const ids = [...new Set(purchaseOrderIds)].sort();
  if (!ids.length) return;
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "factory_purchase_orders"
    WHERE "execution_id" = ${executionId} AND "id" IN (${Prisma.join(ids)})
    ORDER BY "id" FOR UPDATE
  `);
}

export async function runContainerMutation<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000, timeout: 15_000,
    });
  } catch (error: unknown) {
    const code = String((error as { code?: string } | null)?.code || "");
    if (code === "P2034") throw codedError("集装箱状态已变化，请刷新后重试", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    if (code === "P2002") throw codedError("柜号或集装箱序号已存在，请刷新后重试", 409, "CONTAINER_LOAD_DUPLICATE");
    throw error;
  }
}
