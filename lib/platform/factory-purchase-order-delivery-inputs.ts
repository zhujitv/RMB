import { Prisma } from "../generated/prisma/client.js";
import { codedError, isPlainRecord } from "./shared-base-errors";
import {
  resolveDeliveryQuantityTargets,
  type ApprovedDeliveryQuantityVariance,
  type DeliveryQuantityTargetItem,
} from "./factory-purchase-order-delivery-quantity-variance-values";

type InternalDecision = "ACCEPTED" | "REJECTED";

function inputRecord(input: unknown, label: string) {
  if (!isPlainRecord(input)) throw codedError(`${label}格式错误`, 400, "FACTORY_DELIVERY_INPUT_INVALID");
  return input;
}

function expectedRevision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw codedError("采购单版本号无效，请刷新后重试", 400, "FACTORY_PURCHASE_ORDER_REVISION_INVALID");
  }
  return value;
}

function boundedRemark(value: unknown) {
  const remark = typeof value === "string" ? value.trim() : "";
  if (remark.length > 2_000) {
    throw codedError("内部决定备注不能超过 2000 个字符", 400, "FACTORY_DELIVERY_DECISION_REMARK_TOO_LONG");
  }
  return remark;
}

export function normalizeDeliveryProposalDecisionInput(input: unknown) {
  const body = inputRecord(input, "交期决定");
  const rawDecision = String(body.decision ?? body.action ?? "").trim().toUpperCase();
  const decision: InternalDecision | null = rawDecision === "ACCEPT" || rawDecision === "ACCEPTED"
    ? "ACCEPTED"
    : rawDecision === "REJECT" || rawDecision === "REJECTED" ? "REJECTED" : null;
  if (!decision) {
    throw codedError("请选择接受或拒绝供应商新交期", 400, "FACTORY_DELIVERY_DECISION_INVALID");
  }
  const remark = boundedRemark(body.remark ?? body.internalDecisionRemark);
  if (decision === "REJECTED" && !remark) {
    throw codedError("拒绝供应商新交期时必须填写原因", 400, "FACTORY_DELIVERY_DECISION_REMARK_REQUIRED");
  }
  return { decision, remark, expectedRevision: expectedRevision(body.expectedRevision) };
}

function requiredDate(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw codedError("实际交付日期格式错误", 400, "FACTORY_ACTUAL_DELIVERY_DATE_INVALID");
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw codedError("实际交付日期格式错误", 400, "FACTORY_ACTUAL_DELIVERY_DATE_INVALID");
  }
  return { date, text };
}

function normalizeActualDeliveryItems(
  value: unknown,
  targets: DeliveryQuantityTargetItem[],
  approvedVariance?: ApprovedDeliveryQuantityVariance,
) {
  if (!Array.isArray(value) || !targets.length || value.length !== targets.length) {
    throw codedError(
      "请完整填写本采购单全部产品的实际交付数量",
      400,
      "FACTORY_ACTUAL_DELIVERY_ITEMS_REQUIRED",
    );
  }
  const expectedById = new Map(resolveDeliveryQuantityTargets(targets, approvedVariance)
    .map((item) => [item.purchaseOrderItemId, item.targetQuantity]));
  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (!isPlainRecord(raw)) {
      throw codedError(
        `第 ${index + 1} 行实际交付数量格式错误`,
        400,
        "FACTORY_ACTUAL_DELIVERY_ITEM_INVALID",
      );
    }
    const purchaseOrderItemId = typeof raw.purchaseOrderItemId === "string"
      ? raw.purchaseOrderItemId.trim()
      : "";
    const expected = expectedById.get(purchaseOrderItemId);
    if (!expected) {
      throw codedError(
        "实际交付数量包含无效采购明细",
        400,
        "FACTORY_ACTUAL_DELIVERY_ITEM_NOT_FOUND",
      );
    }
    if (seen.has(purchaseOrderItemId)) {
      throw codedError(
        "同一采购明细不能重复填写实际交付数量",
        400,
        "FACTORY_ACTUAL_DELIVERY_ITEM_DUPLICATE",
      );
    }
    seen.add(purchaseOrderItemId);
    const text = typeof raw.actualDeliveredQuantity === "string"
      ? raw.actualDeliveredQuantity.trim()
      : "";
    if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(text)) {
      throw codedError(
        `第 ${index + 1} 行实际交付数量格式错误，最多 14 位整数和 4 位小数`,
        400,
        "FACTORY_ACTUAL_DELIVERY_QUANTITY_INVALID",
      );
    }
    const quantity = new Prisma.Decimal(text);
    if (!quantity.gt(0)) {
      throw codedError(
        `第 ${index + 1} 行实际交付数量必须大于 0`,
        400,
        "FACTORY_ACTUAL_DELIVERY_QUANTITY_INVALID",
      );
    }
    if (!quantity.eq(expected)) {
      throw codedError(
        `第 ${index + 1} 行实际交付数量必须与批准的交付目标一致`,
        409,
        "FACTORY_ACTUAL_DELIVERY_QUANTITY_MISMATCH",
      );
    }
    return { purchaseOrderItemId, actualDeliveredQuantity: quantity };
  });
}

export function normalizeActualDeliveryInput(
  input: unknown,
  targets?: DeliveryQuantityTargetItem[],
  approvedVariance?: ApprovedDeliveryQuantityVariance,
) {
  const body = inputRecord(input, "实际交付登记");
  const actualDelivery = requiredDate(body.actualDeliveryDate ?? body.deliveryDate);
  return {
    ...actualDelivery,
    expectedRevision: expectedRevision(body.expectedRevision),
    items: targets
      ? normalizeActualDeliveryItems(body.items, targets, approvedVariance)
      : [],
  };
}

export function shanghaiDateText(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
