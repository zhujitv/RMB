import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import {
  assertFactoryPurchaseLoadingOpen,
  assertFactoryPurchaseLoadingDecisionOpen,
  buildLoadingSnapshot,
  factoryPurchaseLoadingResultSelect,
  type ContainerLoadingScope,
  type FactoryPurchaseLoadingAttribution,
  type FactoryPurchaseLoadingOrder,
} from "./factory-purchase-order-loading-result-core";
import type { FactoryPurchaseLoadedItemInput } from "./factory-purchase-order-loading-result-values";

export type AppendFactoryPurchaseLoadingInput = {
  containerLoadId: string;
  expectedRevision: number;
  reason: "EXACT" | "WEIGHT_LIMIT" | "VOLUME_LIMIT" | "OTHER" | null;
  reasonDetail: string;
  loadedItems: FactoryPurchaseLoadedItemInput[];
};

async function incrementOpenContainerRevision(
  tx: Prisma.TransactionClient,
  container: ContainerLoadingScope,
  expectedRevision: number,
) {
  const changed = await tx.salesExecutionContainerLoad.updateMany({
    where: {
      id: container.id,
      executionId: container.executionId,
      status: "OPEN",
      revision: expectedRevision,
    },
    data: { revision: { increment: 1 } },
  });
  if (changed.count !== 1) {
    throw codedError("集装箱状态已变化，请刷新后重试", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
  }
}

export async function appendFactoryPurchaseLoadingResult({
  tx,
  order,
  container,
  input,
  requestedById,
  attribution,
}: {
  tx: Prisma.TransactionClient;
  order: FactoryPurchaseLoadingOrder;
  container: ContainerLoadingScope;
  input: AppendFactoryPurchaseLoadingInput;
  requestedById: string;
  attribution: FactoryPurchaseLoadingAttribution;
}) {
  assertFactoryPurchaseLoadingOpen(order, container);
  if (container.id !== input.containerLoadId || container.revision !== input.expectedRevision) {
    throw codedError("集装箱状态已变化，请刷新后重试", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
  }
  const snapshot = buildLoadingSnapshot(
    order,
    container,
    input.loadedItems,
    input.reason,
    input.reasonDetail,
  );
  const sequenceNo = order.loadingResults
    .filter((result) => result.containerLoadId === container.id)
    .reduce((maximum, result) => Math.max(maximum, result.sequenceNo), 0) + 1;
  const pending = await tx.factoryPurchaseOrderLoadingResult.create({
    data: {
      containerLoadId: container.id,
      executionId: container.executionId,
      purchaseOrderId: order.id,
      sequenceNo,
      status: "PENDING",
      reason: snapshot.reason,
      reasonDetail: snapshot.reasonDetail || null,
      source: attribution.source,
      channel: attribution.channel,
      supplierContact: attribution.supplierContact,
      requestedById,
      items: {
        create: snapshot.items.map((item) => ({
          purchaseOrderItemId: item.purchaseOrderItemId,
          plannedQuantitySnapshot: item.plannedQuantitySnapshot,
          deliveryTargetQuantitySnapshot: item.deliveryTargetQuantitySnapshot,
          completedQuantitySnapshot: item.completedQuantitySnapshot,
          previouslyApprovedLoadedQuantitySnapshot: item.previouslyApprovedLoadedQuantitySnapshot,
          loadedQuantity: item.loadedQuantity,
          cumulativeApprovedLoadedQuantitySnapshot: item.cumulativeApprovedLoadedQuantitySnapshot,
          warehouseRetainedQuantitySnapshot: item.warehouseRetainedQuantitySnapshot,
        })),
      },
    },
    select: factoryPurchaseLoadingResultSelect,
  });

  let saved = pending;
  if (!snapshot.hasPlannedDifference) {
    const decidedAt = new Date();
    saved = await tx.factoryPurchaseOrderLoadingResult.update({
      where: { id: pending.id },
      data: {
        status: "APPROVED",
        decidedAt,
        decidedById: requestedById,
        decisionRemark: "本柜装柜数量与计划一致，系统自动批准",
      },
      select: factoryPurchaseLoadingResultSelect,
    });
  }
  // Approval only freezes this supplier/container snapshot. The purchase-order
  // actual quantities and date are materialized once, atomically, by shipping.
  await incrementOpenContainerRevision(tx, container, input.expectedRevision);
  return saved;
}

export async function decideFactoryPurchaseLoadingResultCore({
  tx,
  order,
  container,
  resultId,
  decision,
  remark,
  expectedRevision,
  actorId,
}: {
  tx: Prisma.TransactionClient;
  order: FactoryPurchaseLoadingOrder;
  container: ContainerLoadingScope;
  resultId: string;
  decision: "APPROVED" | "REJECTED";
  remark: string;
  expectedRevision: number;
  actorId: string;
}) {
  if (container.revision !== expectedRevision) {
    throw codedError("集装箱状态已变化，请刷新后重试", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
  }
  assertFactoryPurchaseLoadingDecisionOpen(order, container);
  const result = order.loadingResults.find((entry) => (
    entry.id === resultId && entry.containerLoadId === container.id
  ));
  if (!result) {
    throw codedError("装柜结果不存在或无权访问", 404, "FACTORY_PURCHASE_LOADING_RESULT_NOT_FOUND");
  }
  if (result.status !== "PENDING" || result.decidedAt || result.decidedById) {
    throw codedError("装柜结果已经处理", 409, "FACTORY_PURCHASE_LOADING_RESULT_ALREADY_DECIDED");
  }
  if (result.reason === "EXACT") {
    throw codedError("无差异装柜结果应由系统自动批准", 409, "FACTORY_PURCHASE_LOADING_EXACT_DECISION_INVALID");
  }
  if (result.source === "INTERNAL_OFFLINE" && result.requestedById === actorId) {
    throw codedError(
      "线下装柜结果的代录人与审批人不能是同一人",
      403,
      "FACTORY_PURCHASE_LOADING_SELF_APPROVAL_FORBIDDEN",
    );
  }
  const decidedAt = new Date();
  const changed = await tx.factoryPurchaseOrderLoadingResult.updateMany({
    where: {
      id: result.id,
      containerLoadId: container.id,
      purchaseOrderId: order.id,
      status: "PENDING",
      decidedAt: null,
      decidedById: null,
    },
    data: { status: decision, decidedAt, decidedById: actorId, decisionRemark: remark || null },
  });
  if (changed.count !== 1) {
    throw codedError("装柜结果状态已变化，请刷新后重试", 409, "FACTORY_PURCHASE_LOADING_DECISION_CONFLICT");
  }
  await incrementOpenContainerRevision(tx, container, expectedRevision);
  const decided = await tx.factoryPurchaseOrderLoadingResult.findUnique({
    where: { id: result.id },
    select: factoryPurchaseLoadingResultSelect,
  });
  if (!decided) {
    throw codedError("装柜结果不存在或无权访问", 404, "FACTORY_PURCHASE_LOADING_RESULT_NOT_FOUND");
  }
  return decided;
}
