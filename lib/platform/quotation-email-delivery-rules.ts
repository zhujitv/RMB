import { codedError } from "./shared-base-utils";
import { todayInChina } from "./quotation-values";

export const QUOTATION_EMAIL_LEASE_MS = 15 * 60 * 1000;
export const QUOTATION_EMAIL_USER_MINUTE_LIMIT = 5;
export const QUOTATION_EMAIL_QUOTE_DAY_LIMIT = 25;

export type QuotationEmailDeliveryPayload = {
  quotationId: string;
  quotationVersionId: string;
  versionNumber: number;
  idempotencyKey: string;
  recipientEmails: string[];
  ccEmails: string[];
  subject: string;
  body: string;
  attachmentFileAssetId: string;
  attachmentFileName: string;
  sentById: string;
};

export type QuotationEmailDeliverySnapshot = {
  id: string;
  quotationId: string;
  quotationVersionId: string;
  idempotencyKey: string;
  status: "PENDING" | "SENT" | "FAILED";
  recipientEmails: unknown;
  ccEmails: unknown;
  subject: string;
  body: string;
  attachmentFileAssetId: string | null;
  attachmentFileName: string | null;
  sentById: string | null;
  outboxId: string | null;
  attempts: number;
  sentAt: Date | null;
  updatedAt: Date;
};

export type QuotationEmailOutboxSnapshot = {
  id: string;
  status: string;
  sentAt: Date | null;
  updatedAt: Date;
} | null;

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean).sort()
    : [];
}

export function quotationEmailPayloadMatches(
  delivery: QuotationEmailDeliverySnapshot,
  payload: QuotationEmailDeliveryPayload,
) {
  return delivery.quotationId === payload.quotationId
    && delivery.quotationVersionId === payload.quotationVersionId
    && delivery.idempotencyKey === payload.idempotencyKey
    && JSON.stringify(stringList(delivery.recipientEmails)) === JSON.stringify(stringList(payload.recipientEmails))
    && JSON.stringify(stringList(delivery.ccEmails)) === JSON.stringify(stringList(payload.ccEmails))
    && delivery.subject === payload.subject
    && delivery.body === payload.body
    && delivery.attachmentFileAssetId === payload.attachmentFileAssetId
    && delivery.attachmentFileName === payload.attachmentFileName
    && delivery.sentById === payload.sentById;
}

function assertPayloadMatches(delivery: QuotationEmailDeliverySnapshot, payload: QuotationEmailDeliveryPayload) {
  if (!quotationEmailPayloadMatches(delivery, payload)) {
    throw codedError(
      "相同发送请求标识不能用于不同的收件人、正文或附件，请重新打开发送窗口",
      409,
      "QUOTATION_EMAIL_IDEMPOTENCY_PAYLOAD_MISMATCH",
    );
  }
}

function recent(value: Date, now: Date) {
  return now.getTime() - value.getTime() < QUOTATION_EMAIL_LEASE_MS;
}

export function quotationEmailClaimDisposition(
  delivery: QuotationEmailDeliverySnapshot,
  outbox: QuotationEmailOutboxSnapshot,
  payload: QuotationEmailDeliveryPayload,
  now = new Date(),
) {
  assertPayloadMatches(delivery, payload);
  if (delivery.status === "SENT" || outbox?.status === "sent") return "FINALIZE" as const;
  if (outbox && ["pending", "sending"].includes(outbox.status) && recent(outbox.updatedAt, now)) {
    return "IN_PROGRESS" as const;
  }
  if (delivery.status === "PENDING" && recent(delivery.updatedAt, now)) return "IN_PROGRESS" as const;
  return "RETRY" as const;
}

export function assertQuotationEmailRecipientLimits(recipientEmails: string[], ccEmails: string[]) {
  if (recipientEmails.length > 5) {
    throw codedError("报价邮件收件人最多 5 个", 400, "QUOTATION_EMAIL_RECIPIENT_LIMIT");
  }
  if (ccEmails.length > 10) {
    throw codedError("报价邮件抄送人最多 10 个", 400, "QUOTATION_EMAIL_CC_LIMIT");
  }
  if (recipientEmails.length + ccEmails.length > 15) {
    throw codedError("报价邮件收件人与抄送人合计最多 15 个", 400, "QUOTATION_EMAIL_TOTAL_RECIPIENT_LIMIT");
  }
}

export function assertQuotationEmailRecipientsAuthorized(
  recipientEmails: string[],
  ccEmails: string[],
  approvedEmails: string[],
) {
  const approved = new Set(approvedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  if (!approved.size) {
    throw codedError(
      "客户资料未配置可用的报价收件邮箱，请先完善客户资料",
      409,
      "QUOTATION_EMAIL_APPROVED_RECIPIENT_REQUIRED",
    );
  }
  const unauthorized = [...recipientEmails, ...ccEmails]
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email && !approved.has(email));
  if (unauthorized.length) {
    throw codedError(
      "收件或抄送邮箱未列入当前客户资料，不能发送报价附件",
      403,
      "QUOTATION_EMAIL_RECIPIENT_NOT_AUTHORIZED",
    );
  }
}

export function isQuotationVersionExpired(validUntil: Date | null | undefined, today = todayInChina()) {
  return Boolean(validUntil && validUntil.getTime() < today.getTime());
}

export function assertQuotationVersionNotExpired(validUntil: Date | null | undefined) {
  if (isQuotationVersionExpired(validUntil)) {
    throw codedError("报价已超过有效期，请先更新报价后再继续", 409, "QUOTATION_EXPIRED");
  }
}

export function startOfChinaDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00+08:00`);
}
