import { codedError, isPlainRecord } from "./shared-base-errors";
import type { FactoryPurchaseLoadedItemInput } from "./factory-purchase-order-loading-result-values";

const DIFFERENCE_REASONS = ["WEIGHT_LIMIT", "VOLUME_LIMIT", "OTHER"] as const;
const OFFLINE_CHANNELS = ["WECHAT", "PHONE", "EMAIL", "PAPER", "OTHER"] as const;

type DifferenceReason = (typeof DIFFERENCE_REASONS)[number];
type OfflineChannel = (typeof OFFLINE_CHANNELS)[number];

function record(input: unknown, label: string) {
  if (!isPlainRecord(input)) {
    throw codedError(`${label}格式错误`, 400, "FACTORY_PURCHASE_LOADING_INPUT_INVALID");
  }
  return input;
}

function requiredText(value: unknown, maximum: number, message: string, code: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maximum) throw codedError(message, 400, code);
  return text;
}

function optionalText(value: unknown, maximum: number, message: string, code: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maximum) throw codedError(message, 400, code);
  return text;
}

function expectedRevision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw codedError(
      "集装箱版本号无效，请刷新后重试",
      400,
      "CONTAINER_LOAD_REVISION_INVALID",
    );
  }
  return value;
}

function loadingDate(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw codedError("装柜日期格式错误", 400, "FACTORY_PURCHASE_LOADING_DATE_INVALID");
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw codedError("装柜日期格式错误", 400, "FACTORY_PURCHASE_LOADING_DATE_INVALID");
  }
  return { date, text };
}

function loadedItems(value: unknown): FactoryPurchaseLoadedItemInput[] {
  if (!Array.isArray(value) || !value.length || value.length > 500) {
    throw codedError(
      "请完整填写本采购单全部产品的最终装柜数量",
      400,
      "FACTORY_PURCHASE_LOADING_ITEMS_REQUIRED",
    );
  }
  return value.map((raw, index) => {
    if (!isPlainRecord(raw)) {
      throw codedError(
        `第 ${index + 1} 行装柜数量格式错误`,
        400,
        "FACTORY_PURCHASE_LOADING_ITEM_INVALID",
      );
    }
    return {
      purchaseOrderItemId: requiredText(
        raw.purchaseOrderItemId,
        191,
        "装柜结果包含无效采购明细",
        "FACTORY_PURCHASE_LOADING_ITEM_NOT_FOUND",
      ),
      loadedQuantity: typeof raw.loadedQuantity === "number"
        ? String(raw.loadedQuantity)
        : typeof raw.loadedQuantity === "string" ? raw.loadedQuantity.trim() : "",
    };
  });
}

function reason(value: unknown) {
  const text = String(value || "").trim().toUpperCase();
  if (!text || text === "EXACT") return text === "EXACT" ? "EXACT" as const : null;
  if (!DIFFERENCE_REASONS.includes(text as DifferenceReason)) {
    throw codedError(
      "请选择有效的装柜差异原因",
      400,
      "FACTORY_PURCHASE_LOADING_REASON_INVALID",
    );
  }
  return text as DifferenceReason;
}

export function normalizeFactoryPurchaseLoadingSubmissionInput(input: unknown) {
  const body = record(input, "最终装柜结果");
  return {
    containerLoadId: requiredText(
      body.containerLoadId,
      191,
      "请选择需要填报的集装箱",
      "CONTAINER_LOAD_ID_REQUIRED",
    ),
    expectedRevision: expectedRevision(body.expectedRevision),
    ...loadingDate(body.loadingDate),
    reason: reason(body.reason),
    reasonDetail: optionalText(
      body.reasonDetail,
      2_000,
      "装柜差异说明不能超过 2000 个字符",
      "FACTORY_PURCHASE_LOADING_REASON_DETAIL_TOO_LONG",
    ),
    loadedItems: loadedItems(body.items),
  };
}

export function normalizeOfflineFactoryPurchaseLoadingSubmissionInput(input: unknown) {
  const body = record(input, "线下最终装柜结果");
  const normalized = normalizeFactoryPurchaseLoadingSubmissionInput(body);
  const channel = String(body.channel || "").trim().toUpperCase();
  if (!OFFLINE_CHANNELS.includes(channel as OfflineChannel)) {
    throw codedError("请选择有效的线下确认渠道", 400, "FACTORY_CONFIRMATION_CHANNEL_INVALID");
  }
  return {
    ...normalized,
    attribution: {
      source: "INTERNAL_OFFLINE" as const,
      channel: channel as OfflineChannel,
      supplierContact: requiredText(
        body.supplierContact,
        100,
        "请填写供应商实际确认人，且不能超过 100 个字符",
        "FACTORY_CONFIRMATION_CONTACT_INVALID",
      ),
    },
  };
}

export function normalizeFactoryPurchaseLoadingDecisionInput(input: unknown) {
  const body = record(input, "装柜差异审批");
  const loadingResultId = requiredText(
    body.loadingResultId,
    191,
    "请选择需要审批的装柜结果",
    "FACTORY_PURCHASE_LOADING_RESULT_ID_REQUIRED",
  );
  const rawDecision = String(body.decision || "").trim().toUpperCase();
  const decision = rawDecision === "APPROVE" || rawDecision === "APPROVED"
    ? "APPROVED" as const
    : rawDecision === "REJECT" || rawDecision === "REJECTED" ? "REJECTED" as const : null;
  if (!decision) {
    throw codedError("请选择批准或拒绝装柜差异", 400, "FACTORY_PURCHASE_LOADING_DECISION_INVALID");
  }
  const remark = optionalText(
    body.remark,
    2_000,
    "装柜差异审批备注不能超过 2000 个字符",
    "FACTORY_PURCHASE_LOADING_DECISION_REMARK_TOO_LONG",
  );
  if (decision === "REJECTED" && !remark) {
    throw codedError(
      "拒绝装柜差异时必须填写原因",
      400,
      "FACTORY_PURCHASE_LOADING_REJECTION_REASON_REQUIRED",
    );
  }
  return {
    loadingResultId,
    containerLoadId: requiredText(
      body.containerLoadId,
      191,
      "请选择需要审批的集装箱",
      "CONTAINER_LOAD_ID_REQUIRED",
    ),
    decision,
    remark,
    expectedRevision: expectedRevision(body.expectedRevision),
  };
}
