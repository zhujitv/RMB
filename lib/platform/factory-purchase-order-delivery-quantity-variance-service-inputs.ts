import { codedError, isPlainRecord } from "./shared-base-errors";
import {
  normalizeDeliveryQuantityVarianceInput,
  type DeliveryQuantityVarianceTarget,
} from "./factory-purchase-order-delivery-quantity-variance-inputs";

const OFFLINE_CHANNELS = ["WECHAT", "PHONE", "EMAIL", "PAPER", "OTHER"] as const;
type OfflineChannel = (typeof OFFLINE_CHANNELS)[number];

function requiredText(value: unknown, maximum: number, message: string, code: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maximum) throw codedError(message, 400, code);
  return text;
}

function explicitInstant(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw codedError(
      "供应商实际申请时间格式无效，请重新选择",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_REQUESTED_AT_INVALID",
    );
  }
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) {
    throw codedError(
      "供应商实际申请时间格式无效，请重新选择",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_REQUESTED_AT_INVALID",
    );
  }
  return instant;
}

export function normalizeOfflineDeliveryQuantityVarianceInput(
  input: unknown,
  targets: DeliveryQuantityVarianceTarget[],
  toleranceRatio: string | number | { toString(): string },
) {
  if (!isPlainRecord(input)) {
    throw codedError(
      "线下交付数量差异申请格式错误",
      400,
      "FACTORY_OFFLINE_DELIVERY_QUANTITY_VARIANCE_INVALID",
    );
  }
  const normalized = normalizeDeliveryQuantityVarianceInput(input, targets, toleranceRatio);
  const channel = String(input.channel || "").trim().toUpperCase();
  if (!OFFLINE_CHANNELS.includes(channel as OfflineChannel)) {
    throw codedError("请选择有效的线下确认渠道", 400, "FACTORY_CONFIRMATION_CHANNEL_INVALID");
  }
  return {
    ...normalized,
    attribution: {
      source: "INTERNAL_OFFLINE" as const,
      channel: channel as OfflineChannel,
      supplierContact: requiredText(
        input.supplierContact,
        100,
        "请填写供应商实际申请人，且不能超过 100 个字符",
        "FACTORY_CONFIRMATION_CONTACT_INVALID",
      ),
      supplierRequestedAt: explicitInstant(input.supplierRequestedAt),
    },
  };
}

function expectedRevision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw codedError(
      "采购单版本号无效，请刷新后重试",
      400,
      "FACTORY_PURCHASE_ORDER_REVISION_INVALID",
    );
  }
  return value;
}

export function normalizeDeliveryQuantityVarianceDecisionInput(input: unknown) {
  if (!isPlainRecord(input)) {
    throw codedError(
      "交付数量差异审批格式错误",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_DECISION_INVALID",
    );
  }
  const varianceId = requiredText(
    input.varianceId,
    191,
    "请选择需要审批的交付数量差异申请",
    "FACTORY_DELIVERY_QUANTITY_VARIANCE_ID_REQUIRED",
  );
  const decisionText = String(input.decision || "").trim().toUpperCase();
  const decision = decisionText === "APPROVE" || decisionText === "APPROVED"
    ? "APPROVED" as const
    : decisionText === "REJECT" || decisionText === "REJECTED"
      ? "REJECTED" as const
      : null;
  if (!decision) {
    throw codedError(
      "请选择批准或拒绝交付数量差异申请",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_DECISION_INVALID",
    );
  }
  const remark = typeof input.remark === "string" ? input.remark.trim() : "";
  if (remark.length > 2_000) {
    throw codedError(
      "交付数量差异审批备注不能超过 2000 个字符",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_DECISION_REMARK_TOO_LONG",
    );
  }
  if (decision === "REJECTED" && !remark) {
    throw codedError(
      "拒绝交付数量差异申请时必须填写原因",
      400,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_REJECTION_REASON_REQUIRED",
    );
  }
  return { varianceId, decision, remark, expectedRevision: expectedRevision(input.expectedRevision) };
}
