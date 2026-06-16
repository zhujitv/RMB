import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";

export const SENSITIVE_AUDIT_KEY_PATTERN = /(password|passwordHash|token|secret|accessKey|authorization|cookie|session|storageKey|r2Key|r2Bucket|fileUrl)/i;

type AuditRequestLike = {
  headers?: {
    get(name: string): string | null;
  };
} | null | undefined;

type AuditUserLike = {
  id?: string | null;
} | null | undefined;

type FilterCost = {
  supplierName?: string | null;
  vendorName?: string | null;
};

type FilterRow = {
  createdAt?: Date | string | null;
  paymentDate?: Date | string | null;
  paymentDateText?: Date | string | null;
  orderNo?: string | null;
  blNo?: string | null;
  billOfLadingNo?: string | null;
  customerName?: string | null;
  customerFullName?: string | null;
  customerShortName?: string | null;
  supplierName?: string | null;
  vendorName?: string | null;
  salespersonName?: string | null;
  country?: string | null;
  currency?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  bankReference?: string | null;
  reminderStatus?: string | null;
  costType?: string | null;
  summary?: {
    reminderStatus?: string | null;
  } | null;
  costs?: FilterCost[] | null;
};

export function requestIp(request: AuditRequestLike) {
  return request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request?.headers?.get("x-real-ip")
    || null;
}

export function sanitizeAuditData(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 6) return "[TRUNCATED]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditData(item, depth + 1));
  if ("toJSON" in value && typeof value.toJSON === "function" && value.constructor?.name === "Decimal") return value.toJSON();
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_AUDIT_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeAuditData(item, depth + 1),
  ]));
}

export async function writeAudit(
  request: AuditRequestLike,
  user: AuditUserLike,
  action: string,
  entityType: string,
  entityId: string | null,
  beforeData: unknown,
  afterData: unknown,
) {
  const sanitizeJson = (value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => (
    value == null ? undefined : sanitizeAuditData(value) as Prisma.InputJsonValue
  );

  await prisma.auditLog.create({
    data: {
      userId: user?.id,
      action,
      entityType,
      entityId,
      beforeData: sanitizeJson(beforeData),
      afterData: sanitizeJson(afterData),
      ipAddress: requestIp(request),
    },
  });
}

export function applyCommonFilters(rows: FilterRow[], query: URLSearchParams) {
  const monthValue = (value: Date | string | null | undefined) => {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 7);
    return String(value).slice(0, 7);
  };
  const month = query.get("month") || "";
  const keyword = (query.get("keyword") || "").toLowerCase();
  const orderText = (query.get("order") || "").toLowerCase();
  const party = (query.get("party") || "").toLowerCase();
  const country = (query.get("country") || "").toLowerCase();
  const currency = query.get("currency") || "";
  const orderStatus = query.get("orderStatus") || "";
  const paymentStatus = query.get("paymentStatus") || "";
  const reminderStatus = query.get("reminderStatus") || "";
  const costType = query.get("costType") || "";

  return rows.filter((row) => {
    const createdMonth = monthValue(row.createdAt);
    const dateMonth = monthValue(row.paymentDate || row.paymentDateText || row.paymentDate || row.createdAt);
    const nestedSupplierText = (row.costs || []).map((cost) => `${cost.supplierName || ""} ${cost.vendorName || ""}`).join(" ");
    const keywordText = `${row.orderNo || ""} ${row.blNo || ""} ${row.billOfLadingNo || ""} ${row.customerName || ""} ${row.customerFullName || ""} ${row.customerShortName || ""} ${row.supplierName || ""} ${row.vendorName || ""} ${row.salespersonName || ""} ${row.country || ""} ${nestedSupplierText}`.toLowerCase();
    if (month && createdMonth !== month && dateMonth !== month) return false;
    if (keyword && !keywordText.includes(keyword)) return false;
    if (orderText && !`${row.orderNo || ""} ${row.blNo || ""}`.toLowerCase().includes(orderText)) return false;
    if (party && !`${row.customerName || ""} ${row.customerFullName || ""} ${row.customerShortName || ""} ${row.supplierName || row.vendorName || ""} ${row.salespersonName || ""}`.toLowerCase().includes(party)) return false;
    if (country && !String(row.country || "").toLowerCase().includes(country)) return false;
    if (currency && row.currency !== currency) return false;
    if (orderStatus && row.summary && row.status !== orderStatus) return false;
    if (paymentStatus && row.paymentStatus !== undefined && row.paymentStatus !== paymentStatus) return false;
    if (paymentStatus && row.paymentStatus === undefined && row.bankReference !== undefined && row.status !== paymentStatus) return false;
    if (reminderStatus && row.summary?.reminderStatus !== reminderStatus && row.reminderStatus !== reminderStatus) return false;
    if (costType && row.costType !== undefined && row.costType !== costType) return false;
    return true;
  });
}
