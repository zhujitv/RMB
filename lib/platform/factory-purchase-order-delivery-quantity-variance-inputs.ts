import { Prisma } from "../generated/prisma/client.js";
import { codedError, isPlainRecord } from "./shared-base-errors";

type DecimalValue = Prisma.Decimal | { toString(): string } | string | number;

export const DEFAULT_FACTORY_DELIVERY_QUANTITY_TOLERANCE_RATIO = new Prisma.Decimal("0.05");
export const MAX_FACTORY_DELIVERY_QUANTITY_TOLERANCE_RATIO = new Prisma.Decimal("0.05");

export type DeliveryQuantityVarianceTarget = {
  id: string;
  allocatedQuantity: DecimalValue;
};

export type NormalizedDeliveryQuantityVarianceItem = {
  purchaseOrderItemId: string;
  orderedQuantitySnapshot: Prisma.Decimal;
  proposedQuantity: Prisma.Decimal;
};

function normalizeExpectedRevision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw codedError(
      "采购单版本号无效，请刷新后重试",
      400,
      "FACTORY_PURCHASE_ORDER_REVISION_INVALID",
    );
  }
  return value;
}

function exactQuantity(value: unknown, lineNumber: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(text)) {
    throw codedError(
      `第 ${lineNumber} 行交付数量格式错误，最多 14 位整数和 4 位小数`,
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_QUANTITY_INVALID",
    );
  }
  const quantity = new Prisma.Decimal(text);
  if (!quantity.gt(0)) {
    throw codedError(
      `第 ${lineNumber} 行交付数量必须大于 0`,
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_QUANTITY_INVALID",
    );
  }
  return quantity;
}

function targetQuantity(value: DecimalValue, lineNumber: number) {
  const text = value == null ? "" : value.toString().trim();
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(text)) {
    throw codedError(
      `第 ${lineNumber} 行采购数量无效`,
      409,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_TARGET_INVALID",
    );
  }
  const quantity = new Prisma.Decimal(text);
  if (!quantity.gt(0)) {
    throw codedError(
      `第 ${lineNumber} 行采购数量必须大于 0`,
      409,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_TARGET_INVALID",
    );
  }
  return quantity;
}

export function normalizeDeliveryQuantityToleranceRatio(
  value: DecimalValue | null | undefined,
) {
  const text = value == null || String(value).trim() === ""
    ? DEFAULT_FACTORY_DELIVERY_QUANTITY_TOLERANCE_RATIO.toString()
    : value.toString().trim();
  if (!/^(?:0|0\.\d{1,6})$/.test(text)) {
    throw codedError(
      "交付数量公差比例无效",
      409,
      "FACTORY_DELIVERY_QUANTITY_TOLERANCE_INVALID",
    );
  }
  const ratio = new Prisma.Decimal(text);
  if (ratio.lt(0) || ratio.gt(MAX_FACTORY_DELIVERY_QUANTITY_TOLERANCE_RATIO)) {
    throw codedError(
      "交付数量公差比例必须在 0% 到 5% 之间",
      409,
      "FACTORY_DELIVERY_QUANTITY_TOLERANCE_INVALID",
    );
  }
  return ratio.toDecimalPlaces(6);
}

export function normalizeDeliveryQuantityVarianceInput(
  input: unknown,
  targets: DeliveryQuantityVarianceTarget[],
  toleranceRatio: DecimalValue | null | undefined = DEFAULT_FACTORY_DELIVERY_QUANTITY_TOLERANCE_RATIO,
) {
  if (!isPlainRecord(input) || !Array.isArray(input.items)) {
    throw codedError(
      "交付数量差异申请格式错误",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_INPUT_INVALID",
    );
  }
  if (!targets.length || targets.length > 500 || input.items.length !== targets.length) {
    throw codedError(
      "请完整填写本采购单全部产品的实际交付数量",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_ITEMS_REQUIRED",
    );
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) {
    throw codedError(
      "交付数量与采购数量不一致时必须填写申请原因",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_REASON_REQUIRED",
    );
  }
  if (reason.length > 2_000) {
    throw codedError(
      "交付数量差异申请原因不能超过 2000 个字符",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_REASON_TOO_LONG",
    );
  }

  const normalizedTolerance = normalizeDeliveryQuantityToleranceRatio(toleranceRatio);
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const seen = new Set<string>();
  let hasDifference = false;
  const items = input.items.map((raw, index): NormalizedDeliveryQuantityVarianceItem => {
    if (!isPlainRecord(raw)) {
      throw codedError(
        `第 ${index + 1} 行交付数量格式错误`,
        400,
        "FACTORY_DELIVERY_QUANTITY_VARIANCE_ITEM_INVALID",
      );
    }
    const purchaseOrderItemId = typeof raw.purchaseOrderItemId === "string"
      ? raw.purchaseOrderItemId.trim()
      : "";
    const target = targetById.get(purchaseOrderItemId);
    if (!target) {
      throw codedError(
        "交付数量差异申请包含无效采购明细",
        400,
        "FACTORY_DELIVERY_QUANTITY_VARIANCE_ITEM_NOT_FOUND",
      );
    }
    if (seen.has(purchaseOrderItemId)) {
      throw codedError(
        "同一采购明细不能重复填写交付数量",
        400,
        "FACTORY_DELIVERY_QUANTITY_VARIANCE_ITEM_DUPLICATE",
      );
    }
    seen.add(purchaseOrderItemId);

    const orderedQuantitySnapshot = targetQuantity(target.allocatedQuantity, index + 1);
    const proposedQuantity = exactQuantity(raw.proposedQuantity, index + 1);
    const absoluteDifference = proposedQuantity.sub(orderedQuantitySnapshot).abs();
    if (absoluteDifference.gt(orderedQuantitySnapshot.mul(normalizedTolerance))) {
      throw codedError(
        `第 ${index + 1} 行交付数量差异超过允许的 ±${normalizedTolerance.mul(100).toString()}%`,
        400,
        "FACTORY_DELIVERY_QUANTITY_VARIANCE_TOLERANCE_EXCEEDED",
      );
    }
    hasDifference ||= !proposedQuantity.eq(orderedQuantitySnapshot);
    return { purchaseOrderItemId, orderedQuantitySnapshot, proposedQuantity };
  });

  if (!hasDifference) {
    throw codedError(
      "实际交付数量与采购数量完全一致，无需提交差异申请",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_NOT_REQUIRED",
    );
  }
  return {
    expectedRevision: normalizeExpectedRevision(input.expectedRevision),
    reason,
    toleranceRatio: normalizedTolerance,
    items,
  };
}
