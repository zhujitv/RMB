import { codedError, isPlainRecord } from "./shared-base-errors";
import type { FactoryConfirmationChannel } from "./factory-purchase-order-response-core";

const OFFLINE_CHANNELS = ["WECHAT", "PHONE", "EMAIL", "PAPER", "OTHER"] as const;

function boundedText(
  value: unknown,
  maximum: number,
  message: string,
  code: string,
  required = false,
) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw codedError(message, 400, code);
  if (text.length > maximum) throw codedError(message, 400, code);
  return text;
}

function offlineChannel(value: unknown): Exclude<FactoryConfirmationChannel, "PORTAL"> {
  const channel = String(value || "").trim().toUpperCase();
  if (!OFFLINE_CHANNELS.includes(channel as (typeof OFFLINE_CHANNELS)[number])) {
    throw codedError("请选择有效的线下确认渠道", 400, "FACTORY_CONFIRMATION_CHANNEL_INVALID");
  }
  return channel as Exclude<FactoryConfirmationChannel, "PORTAL">;
}

function explicitInstant(value: unknown, label: string, code: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw codedError(`${label}格式无效，请重新选择`, 400, code);
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw codedError(`${label}格式无效，请重新选择`, 400, code);
  return date;
}

function expectedRevision(input: Record<string, unknown>) {
  const revision = input.expectedRevision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
    throw codedError("采购单版本号无效，请刷新后重试", 400, "SUPPLIER_PURCHASE_ORDER_REVISION_INVALID");
  }
  return revision;
}

function offlineAttribution(input: Record<string, unknown>, occurredAtKey: string, occurredAtLabel: string) {
  return {
    channel: offlineChannel(input.channel),
    supplierContact: boundedText(
      input.supplierContact,
      100,
      "请填写供应商实际回复人，且不能超过 100 个字符",
      "FACTORY_CONFIRMATION_CONTACT_INVALID",
      true,
    ),
    occurredAt: explicitInstant(
      input[occurredAtKey],
      occurredAtLabel,
      "FACTORY_CONFIRMATION_OCCURRED_AT_INVALID",
    ),
    evidenceNote: boundedText(
      input.evidenceNote ?? input.evidence,
      2_000,
      "线下确认依据不能超过 2000 个字符",
      "FACTORY_CONFIRMATION_EVIDENCE_TOO_LONG",
    ),
  };
}

export function normalizeOfflineFactoryResponseInput(input: unknown) {
  if (!isPlainRecord(input)) {
    throw codedError("线下回复内容格式错误", 400, "FACTORY_OFFLINE_RESPONSE_INVALID");
  }
  const attribution = offlineAttribution(input, "supplierRespondedAt", "供应商实际回复时间");
  return {
    expectedRevision: expectedRevision(input),
    attribution: {
      source: "INTERNAL_OFFLINE" as const,
      channel: attribution.channel,
      supplierContact: attribution.supplierContact,
      supplierRespondedAt: attribution.occurredAt,
      evidenceNote: attribution.evidenceNote,
    },
  };
}

export function normalizeOfflineProductionCompletionInput(input: unknown) {
  if (!isPlainRecord(input)) {
    throw codedError("线下完工内容格式错误", 400, "FACTORY_OFFLINE_COMPLETION_INVALID");
  }
  const attribution = offlineAttribution(input, "productionCompletedAt", "供应商实际完工时间");
  return {
    expectedRevision: expectedRevision(input),
    attribution: {
      source: "INTERNAL_OFFLINE" as const,
      channel: attribution.channel,
      supplierContact: attribution.supplierContact,
      productionCompletedAt: attribution.occurredAt,
      remark: boundedText(
        input.completionRemark ?? input.remark,
        2_000,
        "完工备注不能超过 2000 个字符",
        "FACTORY_COMPLETION_REMARK_TOO_LONG",
      ),
      evidenceNote: attribution.evidenceNote,
    },
  };
}

export function normalizePortalProductionCompletionInput(input: unknown) {
  if (!isPlainRecord(input)) {
    throw codedError("生产完成确认内容格式错误", 400, "SUPPLIER_PRODUCTION_COMPLETION_INVALID");
  }
  return { expectedRevision: expectedRevision(input) };
}
