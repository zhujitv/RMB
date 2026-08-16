import { Prisma } from "../generated/prisma/client.js";

export const FACTORY_PURCHASE_LOADING_REASONS = [
  "EXACT",
  "WEIGHT_LIMIT",
  "VOLUME_LIMIT",
  "OTHER",
] as const;

export type FactoryPurchaseLoadingReasonValue = typeof FACTORY_PURCHASE_LOADING_REASONS[number];

type DecimalValue = Prisma.Decimal | { toString(): string } | string | number;

export type FactoryPurchaseLoadingTargetItem = {
  purchaseOrderItemId: string;
  plannedQuantity: DecimalValue;
  deliveryTargetQuantity: DecimalValue;
  completedQuantity: DecimalValue;
  previouslyApprovedLoadedQuantity: DecimalValue;
};

export type FactoryPurchaseLoadedItemInput = {
  purchaseOrderItemId: string;
  loadedQuantity: DecimalValue;
};

export type FactoryPurchaseLoadingSnapshotItem = {
  purchaseOrderItemId: string;
  plannedQuantitySnapshot: Prisma.Decimal;
  deliveryTargetQuantitySnapshot: Prisma.Decimal;
  completedQuantitySnapshot: Prisma.Decimal;
  previouslyApprovedLoadedQuantitySnapshot: Prisma.Decimal;
  loadedQuantity: Prisma.Decimal;
  cumulativeApprovedLoadedQuantitySnapshot: Prisma.Decimal;
  warehouseRetainedQuantitySnapshot: Prisma.Decimal;
};

export class FactoryPurchaseLoadingSnapshotError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "FactoryPurchaseLoadingSnapshotError";
    this.code = code;
  }
}

export function factoryPurchaseLoadingDecimal(value: DecimalValue, label: string) {
  try {
    const parsed = Prisma.Decimal.isDecimal(value)
      ? value
      : new Prisma.Decimal(value.toString());
    if (!parsed.isFinite() || parsed.decimalPlaces() > 4) throw new Error("invalid precision");
    return parsed;
  } catch {
    throw new FactoryPurchaseLoadingSnapshotError(
      `${label}格式错误，最多保留四位小数`,
      "FACTORY_PURCHASE_LOADING_QUANTITY_INVALID",
    );
  }
}

function uniqueByItemId<T extends { purchaseOrderItemId: string }>(rows: T[], code: string) {
  const result = new Map<string, T>();
  for (const row of rows) {
    const id = String(row.purchaseOrderItemId || "").trim();
    if (!id || result.has(id)) {
      throw new FactoryPurchaseLoadingSnapshotError("装柜结果包含无效或重复的采购明细", code);
    }
    result.set(id, row);
  }
  return result;
}

export function buildFactoryPurchaseOrderLoadingSnapshot({
  reason,
  targetItems,
  loadedItems,
}: {
  reason: FactoryPurchaseLoadingReasonValue;
  targetItems: FactoryPurchaseLoadingTargetItem[];
  loadedItems: FactoryPurchaseLoadedItemInput[];
}) {
  if (!FACTORY_PURCHASE_LOADING_REASONS.includes(reason)) {
    throw new FactoryPurchaseLoadingSnapshotError(
      "请选择有效的装柜结果原因",
      "FACTORY_PURCHASE_LOADING_REASON_INVALID",
    );
  }
  if (!targetItems.length || targetItems.length > 500 || loadedItems.length !== targetItems.length) {
    throw new FactoryPurchaseLoadingSnapshotError(
      "请完整填写本集装箱分配给该采购单的全部产品",
      "FACTORY_PURCHASE_LOADING_ITEMS_REQUIRED",
    );
  }
  const targets = uniqueByItemId(
    targetItems,
    "FACTORY_PURCHASE_LOADING_TARGET_ITEM_DUPLICATE",
  );
  const loaded = uniqueByItemId(
    loadedItems,
    "FACTORY_PURCHASE_LOADING_ITEM_DUPLICATE",
  );
  if (targets.size !== loaded.size) {
    throw new FactoryPurchaseLoadingSnapshotError(
      "请完整填写本集装箱分配给该采购单的全部产品",
      "FACTORY_PURCHASE_LOADING_ITEMS_REQUIRED",
    );
  }

  let totalPlanned = new Prisma.Decimal(0);
  let totalLoaded = new Prisma.Decimal(0);
  let hasPlannedDifference = false;
  const items: FactoryPurchaseLoadingSnapshotItem[] = targetItems.map((target, index) => {
    const purchaseOrderItemId = String(target.purchaseOrderItemId || "").trim();
    const loadedRow = loaded.get(purchaseOrderItemId);
    if (!loadedRow) {
      throw new FactoryPurchaseLoadingSnapshotError(
        "装柜结果包含未分配给该集装箱的采购明细",
        "FACTORY_PURCHASE_LOADING_ITEM_NOT_FOUND",
      );
    }
    loaded.delete(purchaseOrderItemId);
    const planned = factoryPurchaseLoadingDecimal(target.plannedQuantity, `第 ${index + 1} 行本柜计划数量`);
    const deliveryTarget = factoryPurchaseLoadingDecimal(target.deliveryTargetQuantity, `第 ${index + 1} 行交付目标数量`);
    const completed = factoryPurchaseLoadingDecimal(target.completedQuantity, `第 ${index + 1} 行生产完成数量`);
    const previous = factoryPurchaseLoadingDecimal(
      target.previouslyApprovedLoadedQuantity,
      `第 ${index + 1} 行此前累计装柜数量`,
    );
    const current = factoryPurchaseLoadingDecimal(loadedRow.loadedQuantity, `第 ${index + 1} 行本柜实装数量`);
    if (!planned.gt(0) || !deliveryTarget.gt(0) || !completed.gt(0) || previous.lt(0) || current.lt(0)) {
      throw new FactoryPurchaseLoadingSnapshotError(
        `第 ${index + 1} 行数量不能为负，计划、交付目标和生产完成数量必须大于 0`,
        "FACTORY_PURCHASE_LOADING_QUANTITY_INVALID",
      );
    }
    if (completed.lt(deliveryTarget)) {
      throw new FactoryPurchaseLoadingSnapshotError(
        `第 ${index + 1} 行生产完成数量尚未达到交付目标`,
        "FACTORY_PURCHASE_LOADING_PRODUCTION_INCOMPLETE",
      );
    }
    if (previous.gt(deliveryTarget) || previous.gt(completed)) {
      throw new FactoryPurchaseLoadingSnapshotError(
        `第 ${index + 1} 行此前累计装柜数量超过允许上限`,
        "FACTORY_PURCHASE_LOADING_PREVIOUS_EXCEEDS_LIMIT",
      );
    }
    if (planned.gt(deliveryTarget.sub(previous))) {
      throw new FactoryPurchaseLoadingSnapshotError(
        `第 ${index + 1} 行本柜计划数量超过交付目标剩余数量`,
        "FACTORY_PURCHASE_LOADING_PLAN_EXCEEDS_REMAINING",
      );
    }
    const cumulative = previous.add(current);
    if (cumulative.gt(deliveryTarget) || cumulative.gt(completed)) {
      throw new FactoryPurchaseLoadingSnapshotError(
        `第 ${index + 1} 行批准后累计装柜数量不能超过交付目标或生产完成数量`,
        "FACTORY_PURCHASE_LOADING_CUMULATIVE_EXCEEDS_LIMIT",
      );
    }
    if (!current.eq(planned)) hasPlannedDifference = true;
    totalPlanned = totalPlanned.add(planned);
    totalLoaded = totalLoaded.add(current);
    return {
      purchaseOrderItemId,
      plannedQuantitySnapshot: planned,
      deliveryTargetQuantitySnapshot: deliveryTarget,
      completedQuantitySnapshot: completed,
      previouslyApprovedLoadedQuantitySnapshot: previous,
      loadedQuantity: current,
      cumulativeApprovedLoadedQuantitySnapshot: cumulative,
      warehouseRetainedQuantitySnapshot: completed.sub(cumulative),
    };
  });

  if (loaded.size) {
    throw new FactoryPurchaseLoadingSnapshotError(
      "装柜结果包含未分配给该集装箱的采购明细",
      "FACTORY_PURCHASE_LOADING_ITEM_NOT_FOUND",
    );
  }
  if (reason === "EXACT" && hasPlannedDifference) {
    throw new FactoryPurchaseLoadingSnapshotError(
      "无差异装柜时，每项本柜实装数量必须等于本柜计划数量",
      "FACTORY_PURCHASE_LOADING_EXACT_MISMATCH",
    );
  }
  if (reason !== "EXACT" && !hasPlannedDifference) {
    throw new FactoryPurchaseLoadingSnapshotError(
      "本柜实装数量与计划完全一致，请选择无差异装柜",
      "FACTORY_PURCHASE_LOADING_DIFFERENCE_REQUIRED",
    );
  }
  return {
    reason,
    hasPlannedDifference,
    totalPlannedQuantity: totalPlanned,
    totalLoadedQuantity: totalLoaded,
    totalWarehouseRetainedQuantity: items.reduce(
      (sum, item) => sum.add(item.warehouseRetainedQuantitySnapshot),
      new Prisma.Decimal(0),
    ),
    items,
  };
}

export function approvedFactoryPurchaseOrderLoadingResults<T extends { status: string }>(
  results: T[] | null | undefined,
) {
  return (results || []).filter((result) => result.status === "APPROVED");
}

/**
 * Kept as a compatibility helper for callers that render one container/PO slot.
 * Cross-container callers must use approvedFactoryPurchaseOrderLoadingResults.
 */
export function approvedFactoryPurchaseOrderLoadingResult<T extends { status: string }>(
  results: T[] | null | undefined,
) {
  return approvedFactoryPurchaseOrderLoadingResults(results)[0] || null;
}

export function approvedLoadingQuantityByPurchaseOrderItem(results: Array<{
  status: string;
  items: Array<{ purchaseOrderItemId: string; loadedQuantity: DecimalValue }>;
}> | null | undefined) {
  const quantities = new Map<string, Prisma.Decimal>();
  for (const result of approvedFactoryPurchaseOrderLoadingResults(results)) {
    for (const item of result.items) {
      const quantity = factoryPurchaseLoadingDecimal(item.loadedQuantity, "批准装柜数量");
      quantities.set(
        item.purchaseOrderItemId,
        (quantities.get(item.purchaseOrderItemId) || new Prisma.Decimal(0)).add(quantity),
      );
    }
  }
  return quantities;
}

export function serializeFactoryPurchaseLoadingSnapshotItem(
  item: FactoryPurchaseLoadingSnapshotItem,
) {
  return {
    purchaseOrderItemId: item.purchaseOrderItemId,
    plannedQuantitySnapshot: item.plannedQuantitySnapshot.toFixed(4),
    deliveryTargetQuantitySnapshot: item.deliveryTargetQuantitySnapshot.toFixed(4),
    completedQuantitySnapshot: item.completedQuantitySnapshot.toFixed(4),
    previouslyApprovedLoadedQuantitySnapshot:
      item.previouslyApprovedLoadedQuantitySnapshot.toFixed(4),
    loadedQuantity: item.loadedQuantity.toFixed(4),
    cumulativeApprovedLoadedQuantitySnapshot:
      item.cumulativeApprovedLoadedQuantitySnapshot.toFixed(4),
    warehouseRetainedQuantitySnapshot:
      item.warehouseRetainedQuantitySnapshot.toFixed(4),
  };
}
