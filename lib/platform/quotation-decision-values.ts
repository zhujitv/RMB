import { quotationDate, todayInChina } from "./quotation-date-values";
import { codedError } from "./shared-base-utils";

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

export const QUOTATION_DECISION_CHANNELS = [
  "SYSTEM_EMAIL",
  "EXTERNAL_EMAIL",
  "WECHAT",
  "WHATSAPP",
  "PHONE",
  "OTHER",
] as const;

export type QuotationDecisionChannel = typeof QUOTATION_DECISION_CHANNELS[number];
export type ManualQuotationDecisionChannel = Exclude<QuotationDecisionChannel, "SYSTEM_EMAIL">;

export function quotationManualConfirmationChannel(value: unknown): ManualQuotationDecisionChannel {
  const channel = String(value || "").trim().toUpperCase();
  if (!channel) {
    throw codedError("请选择客户确认渠道", 400, "QUOTATION_CONFIRMATION_CHANNEL_REQUIRED");
  }
  if (channel === "SYSTEM_EMAIL" || !QUOTATION_DECISION_CHANNELS.includes(channel as QuotationDecisionChannel)) {
    throw codedError("客户确认渠道无效", 400, "QUOTATION_CONFIRMATION_CHANNEL_INVALID");
  }
  return channel as ManualQuotationDecisionChannel;
}

export function requiredQuotationConfirmationDate(
  value: unknown,
  quoteDate: Date | null | undefined,
  today = todayInChina(),
) {
  const confirmationDate = quotationDate(value, "客户确认日期");
  if (!confirmationDate) {
    throw codedError("客户确认日期不能为空", 400, "QUOTATION_CONFIRMATION_DATE_REQUIRED");
  }
  if (confirmationDate.getTime() > today.getTime()) {
    throw codedError("客户确认日期不能晚于今天", 400, "QUOTATION_CONFIRMATION_DATE_FUTURE");
  }
  if (quoteDate && confirmationDate.getTime() < quoteDate.getTime()) {
    throw codedError("客户确认日期不能早于报价日期", 400, "QUOTATION_CONFIRMATION_DATE_BEFORE_QUOTE");
  }
  return confirmationDate;
}

export function serializeQuotationDecision(value: unknown) {
  const decision = asRecord(value);
  const recordedBy = asRecord(decision.recordedBy);
  return {
    id: String(decision.id || ""),
    quotationId: String(decision.quotationId || ""),
    quotationVersionId: String(decision.quotationVersionId || ""),
    deliveryId: decision.deliveryId ? String(decision.deliveryId) : null,
    channel: String(decision.channel || ""),
    decision: String(decision.decision || ""),
    respondedAt: decision.respondedAt,
    confirmationDate: decision.respondedAt,
    note: String(decision.note || ""),
    recordedBy: recordedBy.id ? {
      id: String(recordedBy.id),
      name: String(recordedBy.name || ""),
    } : null,
    createdAt: decision.createdAt,
  };
}
