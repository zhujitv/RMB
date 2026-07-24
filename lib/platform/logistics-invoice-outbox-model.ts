import { Prisma } from "../generated/prisma/client.js";
import { includeLogisticsExpenseRelations } from "./logistics-expense-access-relations";
import type { LogisticsExpenseLike } from "./logistics-expense-invoice-shared";
import { DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS } from "./shared-constants";
import {
  nonEmpty,
  normalizeEmail,
  validEmail,
} from "./shared-base-utils";

export const LOGISTICS_INVOICE_OUTBOX_MAX_ATTEMPTS = 5;
export const LOGISTICS_INVOICE_OUTBOX_LEASE_MS = 10 * 60 * 1000;
export const LOGISTICS_INVOICE_APPROVAL_OUTBOX_PREFIX = "logistics-invoice-approval:";

export type ApprovalIntentRow = LogisticsExpenseLike & {
  billId?: string | null;
  bill?: { id?: string | null } | null;
};

export type LoadedLogisticsExpense = Prisma.LogisticsExpenseGetPayload<{
  include: ReturnType<typeof includeLogisticsExpenseRelations>;
}>;

export type ApprovalOutboxContext = {
  billId: string;
  orderId: string;
  approvedAt: string;
  approvedById: string;
  phase: string;
  expenseIds?: string[];
};

export type ProcessOutboxOptions = {
  idempotencyKeys?: string[];
  limit?: number;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(nonEmpty).filter(Boolean) : [];
}

export function resolveApprovalInvoiceRecipients(
  supplier: Record<string, unknown> = {},
  recipientEmailFields = DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS,
) {
  const selected = new Set((Array.isArray(recipientEmailFields) && recipientEmailFields.length
    ? recipientEmailFields
    : DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS
  ).map((item) => nonEmpty(item)));
  const candidates = [
    { key: "email", field: "supplier.email", value: supplier.email },
    ...(Array.isArray(supplier.operatorUsers) ? supplier.operatorUsers : [])
      .filter((user) => asRecord(user).isActive !== false)
      .map((user) => ({ key: "operatorUsers.email", field: "supplier.operatorUsers.email", value: asRecord(user).email })),
  ].filter((candidate) => selected.has(candidate.key));
  const emails = candidates
    .map((candidate) => normalizeEmail(candidate.value || ""))
    .filter((email) => email && validEmail(email))
    .filter((email, index, values) => values.indexOf(email) === index);
  const checkedText = candidates.map((candidate) => candidate.field).join("、") || "supplier.email";
  return {
    emails,
    error: emails.length ? "" : `物流供应商未配置有效邮箱（已检查：${checkedText}），`,
  };
}

export function rowBillId(row: ApprovalIntentRow) {
  return nonEmpty(row.billId || row.bill?.id);
}

export function logisticsInvoiceApprovalOutboxKey(billId: unknown, approvedAt: Date | string) {
  const approvedAtIso = approvedAt instanceof Date ? approvedAt.toISOString() : new Date(approvedAt).toISOString();
  return `${LOGISTICS_INVOICE_APPROVAL_OUTBOX_PREFIX}${nonEmpty(billId)}:${approvedAtIso}`;
}
