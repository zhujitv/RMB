import { type PaymentTermType } from "../generated/prisma/client.js";
import {
  codedError,
  inputHasOwn,
  nonEmpty,
  normalizedStringArray,
  optional,
  requireText,
  writeAudit,
} from "./shared";

export type ActorLike = ({
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} & Record<string, unknown>) | null | undefined;
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type QueryLike = URLSearchParams;
export type OrderInput = Record<string, unknown>;

export const ORDER_UNPAGINATED_SCAN_LIMIT = 1000;
export const MAX_ORDER_NO_LENGTH = 80;
export const MAX_BL_NO_LENGTH = 80;
export const MAX_ORDER_REMARK_LENGTH = 2000;
export const MAX_ORDER_LOGISTICS_SUPPLIERS = 20;
export const MAX_ORDER_REMINDER_DAYS = 365;

export type PageResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function actorId(actor: ActorLike) {
  return requireText(actor?.id, "当前用户");
}

export function actorRole(actor: ActorLike) {
  return String(actor?.role || "");
}

export function requireLimitedText(value: unknown, label: string, maxLength: number) {
  const text = requireText(value, label);
  if (text.length > maxLength) throw codedError(`${label}不能超过 ${maxLength} 个字符`, 400, "VALIDATION_TEXT_TOO_LONG");
  return text;
}

export function optionalLimitedText(value: unknown, label: string, maxLength: number) {
  const text = optional(value);
  if (text && text.length > maxLength) throw codedError(`${label}不能超过 ${maxLength} 个字符`, 400, "VALIDATION_TEXT_TOO_LONG");
  return text;
}

export function normalizeReminderDaysInput(value: unknown) {
  const number = Math.round(Number(value ?? 7));
  if (!Number.isFinite(number) || number < 0 || number > MAX_ORDER_REMINDER_DAYS) {
    throw codedError(`提醒天数必须在 0-${MAX_ORDER_REMINDER_DAYS} 之间`, 400, "REMINDER_DAYS_INVALID");
  }
  return number;
}

export function normalizeOrderLogisticsSupplierIds(inputData: OrderInput) {
  const raw = inputHasOwn(inputData, "logisticsSupplierIds")
    ? inputData.logisticsSupplierIds
    : inputData.logisticsSuppliers;
  const ids = normalizedStringArray(raw).filter((item, index, arr) => arr.indexOf(item) === index);
  if (ids.length > MAX_ORDER_LOGISTICS_SUPPLIERS) {
    throw codedError(`订单物流供应商最多选择 ${MAX_ORDER_LOGISTICS_SUPPLIERS} 个`, 400, "LOGISTICS_SUPPLIER_LIMIT_EXCEEDED");
  }
  return ids;
}

export function resolveSalespersonCommissionRate(
  customer: { commissionStatus?: string | null; commissionRate?: unknown } | null | undefined,
) {
  return Math.max(0, Math.round(Number(customer?.commissionStatus === "停用" ? 0 : customer?.commissionRate || 0) * 100) / 100);
}

export function paymentTermTypeValue(paymentTermType: string | null | undefined): PaymentTermType | null {
  return paymentTermType ? paymentTermType as PaymentTermType : null;
}

export function orderModuleDateValue(value: unknown) {
  return value instanceof Date || typeof value === "string" || typeof value === "number" ? value : null;
}
