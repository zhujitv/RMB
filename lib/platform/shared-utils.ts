export {
  addDays,
  amountCny,
  apiError,
  assertInputSchema,
  assertJsonObject,
  codedError,
  dateFromInput,
  dateToInput,
  logSecurityEvent,
  logServerError,
  nonEmpty,
  normalizeCreditDays,
  normalizeDateText,
  normalizeEmail,
  normalizeInstallments,
  num,
  ok,
  optional,
  parseEmailList,
  requirePositive,
  requireText,
  requireValidEmail,
  requireValidEmailList,
  sanitizeForLog,
  todayInputInChina,
  validEmail,
} from "./shared-base-utils";
export type { InputSchema } from "./shared-base-utils";
import { PAYMENT_TERM_LABELS, PAYMENT_TERM_TYPES } from "./shared-constants";
import { optional } from "./shared-base-utils";

export const PAYMENT_TERM_TYPE_BY_LABEL = Object.fromEntries(
  Object.entries(PAYMENT_TERM_LABELS).map(([type, label]) => [label, type]),
) as Record<string, string>;

export function paymentTermLabel(type: string | null | undefined, fallback = "") {
  return (type ? PAYMENT_TERM_LABELS[type as keyof typeof PAYMENT_TERM_LABELS] : undefined) || fallback || "";
}

export function validPaymentTermType(type: string | null | undefined) {
  return typeof type === "string" && PAYMENT_TERM_TYPES.includes(type);
}

type PaymentTermInput = {
  paymentTermType?: unknown;
  paymentTerm?: unknown;
};

type PaymentTermSnapshot = {
  paymentTermType?: string | null;
  paymentTerm?: string | null;
} | null | undefined;

export function resolvePaymentTerm(input: PaymentTermInput, before: PaymentTermSnapshot) {
  const rawType = optional(input.paymentTermType);
  const rawLabel = optional(input.paymentTerm);
  const fromLabel = rawLabel ? PAYMENT_TERM_TYPE_BY_LABEL[rawLabel] : null;
  const type = validPaymentTermType(rawType) ? rawType : fromLabel;
  if (type) return { type, label: paymentTermLabel(type) };
  if (before) {
    return {
      type: before.paymentTermType || null,
      label: before.paymentTerm || paymentTermLabel(before.paymentTermType, "OA账期"),
    };
  }
  const error = new Error("请选择有效付款条款") as Error & { status?: number };
  error.status = 400;
  throw error;
}
