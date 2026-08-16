import { Prisma } from "../generated/prisma/client.js";
import { codedError, isPlainRecord } from "./shared-base-errors";

type QuantityValue = Prisma.Decimal | { toString(): string } | string | number;

export type ProductionProgressTarget = {
  id: string;
  allocatedQuantity: QuantityValue;
  targetQuantity?: QuantityValue;
  previousCompletedQuantity?: QuantityValue;
};

export type NormalizedProductionProgressItem = {
  purchaseOrderItemId: string;
  completedQuantity: Prisma.Decimal;
};

function expectedRevision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw codedError(
      "采购单版本号无效，请刷新后重试",
      400,
      "SUPPLIER_PURCHASE_ORDER_REVISION_INVALID",
    );
  }
  return value;
}

function completedQuantity(value: unknown, lineNumber: number) {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(text)) {
    throw codedError(
      `第 ${lineNumber} 行完成数量格式错误，最多 14 位整数和 4 位小数`,
      400,
      "FACTORY_PRODUCTION_PROGRESS_QUANTITY_INVALID",
    );
  }
  return new Prisma.Decimal(text);
}

export function normalizeSupplierProductionProgressInput(
  input: unknown,
  targets: ProductionProgressTarget[],
) {
  if (!isPlainRecord(input) || !Array.isArray(input.items)) {
    throw codedError(
      "生产进度内容格式错误",
      400,
      "FACTORY_PRODUCTION_PROGRESS_INPUT_INVALID",
    );
  }
  if (!targets.length || targets.length > 500 || input.items.length !== targets.length) {
    throw codedError(
      "请完整填写本采购单全部产品的累计完成数量",
      400,
      "FACTORY_PRODUCTION_PROGRESS_ITEMS_REQUIRED",
    );
  }
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const seen = new Set<string>();
  const items = input.items.map((raw, index): NormalizedProductionProgressItem => {
    if (!isPlainRecord(raw)) {
      throw codedError(
        `第 ${index + 1} 行生产进度格式错误`,
        400,
        "FACTORY_PRODUCTION_PROGRESS_ITEM_INVALID",
      );
    }
    const purchaseOrderItemId = typeof raw.purchaseOrderItemId === "string"
      ? raw.purchaseOrderItemId.trim()
      : "";
    const target = targetById.get(purchaseOrderItemId);
    if (!target) {
      throw codedError(
        "生产进度包含无效采购明细",
        400,
        "FACTORY_PRODUCTION_PROGRESS_ITEM_NOT_FOUND",
      );
    }
    if (seen.has(purchaseOrderItemId)) {
      throw codedError(
        "同一采购明细不能重复填写生产进度",
        400,
        "FACTORY_PRODUCTION_PROGRESS_ITEM_DUPLICATE",
      );
    }
    seen.add(purchaseOrderItemId);
    const quantity = completedQuantity(raw.completedQuantity, index + 1);
    const deliveryTarget = new Prisma.Decimal(
      (target.targetQuantity ?? target.allocatedQuantity).toString(),
    );
    const previousCompleted = new Prisma.Decimal(
      (target.previousCompletedQuantity ?? 0).toString(),
    );
    const limit = Prisma.Decimal.max(deliveryTarget, previousCompleted);
    if (quantity.gt(limit)) {
      throw codedError(
        `第 ${index + 1} 行累计完成数量不能超过当前允许上限`,
        400,
        "FACTORY_PRODUCTION_PROGRESS_QUANTITY_EXCEEDED",
      );
    }
    return { purchaseOrderItemId, completedQuantity: quantity };
  });
  const remark = typeof input.remark === "string" ? input.remark.trim() : "";
  if (remark.length > 2_000) {
    throw codedError(
      "生产进度说明不能超过 2000 个字符",
      400,
      "FACTORY_PRODUCTION_PROGRESS_REMARK_TOO_LONG",
    );
  }
  return {
    expectedRevision: expectedRevision(input.expectedRevision),
    items,
    remark,
  };
}

export function productionProgressPercent(
  items: Array<{ allocatedQuantity: QuantityValue; completedQuantity: QuantityValue }>,
) {
  if (!items.length) return 0;
  const ratioTotal = items.reduce((sum, item) => {
    const allocated = new Prisma.Decimal(item.allocatedQuantity.toString());
    const completed = new Prisma.Decimal(item.completedQuantity.toString());
    return sum.add(allocated.gt(0) ? completed.div(allocated) : 0);
  }, new Prisma.Decimal(0));
  return ratioTotal.div(items.length).mul(100).toDecimalPlaces(2).toNumber();
}

export function productionProgressIsComplete(
  items: Array<{ allocatedQuantity: QuantityValue; completedQuantity: QuantityValue }>,
) {
  return Boolean(items.length) && items.every((item) => (
    new Prisma.Decimal(item.completedQuantity.toString())
      .gte(new Prisma.Decimal(item.allocatedQuantity.toString()))
  ));
}
