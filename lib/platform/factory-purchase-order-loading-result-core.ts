import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import { shanghaiDateText } from "./factory-purchase-order-delivery-inputs";
import {
  approvedDeliveryQuantityVariance,
  resolveDeliveryQuantityTargets,
} from "./factory-purchase-order-delivery-quantity-variance-values";
import {
  buildFactoryPurchaseOrderLoadingSnapshot,
  FactoryPurchaseLoadingSnapshotError,
  type FactoryPurchaseLoadedItemInput,
} from "./factory-purchase-order-loading-result-values";
import {
  serializeInternalFactoryPurchaseLoadingResult,
  type FactoryPurchaseLoadingResultRow,
} from "./factory-purchase-order-loading-result-serialization";
import type {
  ContainerLoadingScope,
  FactoryPurchaseLoadingOrder,
  FactoryPurchaseLoadingResult,
} from "./factory-purchase-order-loading-result-query";
export {
  containerLoadingScopeSelect,
  factoryPurchaseLoadingOrderSelect,
  factoryPurchaseLoadingResultSelect,
} from "./factory-purchase-order-loading-result-query";
export type {
  ContainerLoadingScope,
  FactoryPurchaseLoadingOrder,
  FactoryPurchaseLoadingResult,
} from "./factory-purchase-order-loading-result-query";

export type FactoryPurchaseLoadingAttribution = {
  source: "SUPPLIER_PORTAL" | "INTERNAL_OFFLINE";
  channel: "PORTAL" | "WECHAT" | "PHONE" | "EMAIL" | "PAPER" | "OTHER";
  supplierContact: string;
};

export function assertFactoryPurchaseLoadingDecisionOpen(
  order: FactoryPurchaseLoadingOrder,
  container: ContainerLoadingScope,
) {
  if (container.executionId !== order.executionId || container.status !== "OPEN") {
    throw codedError("该集装箱尚未开放填报或已经冻结", 409, "CONTAINER_LOAD_NOT_OPEN");
  }
  if (order.status !== "ACCEPTED" || order.productionStatus !== "COMPLETED") {
    throw codedError(
      "只有已接受且生产完成的采购单可以提交本柜装柜结果",
      409,
      "FACTORY_PURCHASE_LOADING_NOT_ALLOWED",
    );
  }
  if (order.execution.shippingStartedAt || order.settlement) {
    throw codedError("采购单已进入发货或结算，不能提交装柜结果", 409, "FACTORY_PURCHASE_LOADING_FROZEN");
  }
  if (!container.allocations.some((allocation) => allocation.purchaseOrderId === order.id)) {
    throw codedError("本集装箱没有分配该采购单", 404, "CONTAINER_LOAD_PURCHASE_SLOT_NOT_FOUND");
  }
}

export function assertFactoryPurchaseLoadingOpen(
  order: FactoryPurchaseLoadingOrder,
  container: ContainerLoadingScope,
) {
  assertFactoryPurchaseLoadingDecisionOpen(order, container);
  const active = order.loadingResults.find((result) => (
    result.containerLoadId === container.id
    && (result.status === "PENDING" || result.status === "APPROVED")
  ));
  if (active) {
    throw codedError(
      active.status === "PENDING" ? "本柜该采购单已有待审批装柜结果" : "本柜该采购单已有批准装柜结果",
      409,
      active.status === "PENDING"
        ? "FACTORY_PURCHASE_LOADING_ALREADY_PENDING"
        : "FACTORY_PURCHASE_LOADING_ALREADY_APPROVED",
    );
  }
  if (order.loadingResults.some((result) => result.status === "PENDING")) {
    throw codedError(
      "该采购单在其它集装箱仍有待审批装柜结果，请先完成审批",
      409,
      "FACTORY_PURCHASE_LOADING_OTHER_CONTAINER_PENDING",
    );
  }
}

export function validateFactoryPurchaseLoadingDate(
  order: FactoryPurchaseLoadingOrder,
  container: ContainerLoadingScope,
  dateText: string,
) {
  if (!container.loadingDate) {
    throw codedError("集装箱缺少装柜日期，请由内部先完善柜信息", 409, "CONTAINER_LOAD_DATE_REQUIRED");
  }
  const containerDate = container.loadingDate.toISOString().slice(0, 10);
  if (dateText !== containerDate) {
    throw codedError("装柜日期与本柜计划日期不一致，请刷新后重试", 409, "CONTAINER_LOAD_DATE_MISMATCH");
  }
  if (dateText > shanghaiDateText(new Date())) {
    throw codedError("装柜日期不能晚于今天", 400, "CONTAINER_LOAD_DATE_IN_FUTURE");
  }
  if (!order.productionCompletedAt) {
    throw codedError("采购单缺少生产完成时间", 409, "FACTORY_PRODUCTION_COMPLETION_TIME_MISSING");
  }
  if (dateText < shanghaiDateText(order.productionCompletedAt)) {
    throw codedError("装柜日期不能早于生产完成日期", 400, "FACTORY_PURCHASE_LOADING_BEFORE_COMPLETION");
  }
}

function snapshotError(error: unknown): never {
  if (error instanceof FactoryPurchaseLoadingSnapshotError) {
    throw codedError(error.message, 400, error.code);
  }
  throw error;
}

export function buildLoadingSnapshot(
  order: FactoryPurchaseLoadingOrder,
  container: ContainerLoadingScope,
  loadedItems: FactoryPurchaseLoadedItemInput[],
  requestedReason: "EXACT" | "WEIGHT_LIMIT" | "VOLUME_LIMIT" | "OTHER" | null,
  reasonDetail: string,
) {
  const allocations = container.allocations.filter((allocation) => allocation.purchaseOrderId === order.id);
  if (!allocations.length) {
    throw codedError("本集装箱没有分配该采购单", 404, "CONTAINER_LOAD_PURCHASE_SLOT_NOT_FOUND");
  }
  const approvedVariance = approvedDeliveryQuantityVariance(order.deliveryQuantityVariances);
  const targetById = new Map(resolveDeliveryQuantityTargets(order.items, approvedVariance).map((target) => [
    target.purchaseOrderItemId,
    target.targetQuantity,
  ]));
  const completedById = new Map(
    (order.productionProgressReports[0]?.items || []).map((item) => [
      item.purchaseOrderItemId,
      item.completedQuantity,
    ]),
  );
  if (!order.productionProgressReports[0]
    || order.items.some((item) => !completedById.has(item.id))) {
    throw codedError(
      "采购单缺少完整的生产完成数量，不能提交装柜结果",
      409,
      "FACTORY_PURCHASE_LOADING_PROGRESS_MISSING",
    );
  }
  const previouslyApprovedById = new Map<string, Prisma.Decimal>();
  for (const result of order.loadingResults) {
    if (result.status !== "APPROVED" || result.containerLoadId === container.id
      || result.containerLoad.status === "VOIDED") continue;
    for (const item of result.items) {
      previouslyApprovedById.set(
        item.purchaseOrderItemId,
        (previouslyApprovedById.get(item.purchaseOrderItemId) || new Prisma.Decimal(0)).add(item.loadedQuantity),
      );
    }
  }
  const targetItems = allocations.map((allocation) => {
    const deliveryTargetQuantity = targetById.get(allocation.purchaseOrderItemId);
    const completedQuantity = completedById.get(allocation.purchaseOrderItemId);
    if (deliveryTargetQuantity === undefined || completedQuantity === undefined) {
      throw codedError("本柜分配包含无效采购明细", 409, "CONTAINER_LOAD_ALLOCATION_ITEM_INVALID");
    }
    return {
      purchaseOrderItemId: allocation.purchaseOrderItemId,
      plannedQuantity: allocation.plannedQuantity,
      deliveryTargetQuantity,
      completedQuantity,
      previouslyApprovedLoadedQuantity: previouslyApprovedById.get(allocation.purchaseOrderItemId) || new Prisma.Decimal(0),
    };
  });
  try {
    const exact = buildFactoryPurchaseOrderLoadingSnapshot({ reason: "EXACT", targetItems, loadedItems });
    if (requestedReason && requestedReason !== "EXACT") {
      throw codedError(
        "本柜装柜数量与计划完全一致，无需选择差异原因",
        400,
        "FACTORY_PURCHASE_LOADING_DIFFERENCE_REQUIRED",
      );
    }
    return { ...exact, reasonDetail: "" };
  } catch (error: unknown) {
    if (!(error instanceof FactoryPurchaseLoadingSnapshotError)
      || error.code !== "FACTORY_PURCHASE_LOADING_EXACT_MISMATCH") snapshotError(error);
  }
  if (!requestedReason || requestedReason === "EXACT") {
    throw codedError(
      "本柜装柜数量与计划存在差异，请选择限重、限容或其它原因",
      400,
      "FACTORY_PURCHASE_LOADING_REASON_REQUIRED",
    );
  }
  if (!reasonDetail) {
    throw codedError("装柜数量存在差异时必须填写说明", 400, "FACTORY_PURCHASE_LOADING_REASON_DETAIL_REQUIRED");
  }
  try {
    return {
      ...buildFactoryPurchaseOrderLoadingSnapshot({
        reason: requestedReason,
        targetItems,
        loadedItems,
      }),
      reasonDetail,
    };
  } catch (error: unknown) {
    snapshotError(error);
  }
}

export function factoryPurchaseLoadingAuditState(
  order: FactoryPurchaseLoadingOrder,
  container: ContainerLoadingScope,
  result?: FactoryPurchaseLoadingResult | null,
) {
  return {
    purchaseOrderId: order.id,
    purchaseOrderRevision: order.revision,
    containerLoadId: container.id,
    containerRevision: container.revision,
    containerStatus: container.status,
    status: order.status,
    productionStatus: order.productionStatus,
    actualDeliveryDate: order.actualDeliveryDate,
    loadingResult: result
      ? serializeInternalFactoryPurchaseLoadingResult(result as FactoryPurchaseLoadingResultRow)
      : null,
  };
}
