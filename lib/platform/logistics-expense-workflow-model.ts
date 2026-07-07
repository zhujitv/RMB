import { Prisma } from "../generated/prisma/client.js";
import { nonEmpty, permissionError, writeAudit } from "./shared";
import { includeLogisticsExpenseRelations, logisticsExpenseBillId } from "./logistics-expense-shared";

export const LOGISTICS_EXPENSE_BILLING_METHODS = ["按柜", "按票", "按次", "按重量", "按金额比例", "手工输入"];

export const DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD = "按柜";

export const LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS = { timeout: 15000, maxWait: 10000 };

export const LOGISTICS_BILL_DETAIL_SCAN_LIMIT = 500;

export type UnknownRecord = Record<string, unknown>;

export type AuditRequestLike = Parameters<typeof writeAudit>[0];

export type WorkflowActor = { id?: string | null; role?: string | null; supplierId?: string | null } & UnknownRecord;

export type ActorContext = WorkflowActor | null | undefined;

export type FormDataLike = { get(name: string): unknown };

export type LogisticsExpenseRow = Prisma.LogisticsExpenseGetPayload<{ include: ReturnType<typeof includeLogisticsExpenseRelations> }> & UnknownRecord;

export type LogisticsExpenseStateSnapshot = {
  costId?: string | null;
  costSyncStatus?: string | null;
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
  invoiceDocumentId?: string | null;
};

export type LogisticsExpenseCreateData = Prisma.LogisticsExpenseUncheckedCreateInput;

export type LogisticsExpenseUpdateData = Prisma.LogisticsExpenseUncheckedUpdateInput;

export type CostLink = { expenseId: string; costId: string; invoiceDocumentId?: string | null };

export type ReviewBill = { billId: string; rows: LogisticsExpenseRow[] };

export type ReviewResult = {
  billId: string;
  orderNo: string;
  blNo: string;
  auditStatus: string;
  notificationStatus: string;
  errorMessage: string;
};

export type EmailResult = {
  supplierId?: string;
  supplierName?: string;
  sent?: boolean;
  skipped?: boolean;
  error?: string;
  expenseIds?: string[];
};

export type PreparedUpdate = { index?: number; before: LogisticsExpenseRow; data: LogisticsExpenseUpdateData };

export type PreparedCreate = { data: LogisticsExpenseCreateData };

export type DeleteBlock = { message: string; code: string } | null;

export type BatchExchangeSnapshot = {
  currency: string;
  exchangeRate: number;
  exchangeRateDate: Date | null;
  exchangeRateSource: string;
  exchangeRateType: string;
};

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

export function errorMessage(error: unknown, fallback = "") {
  if (error instanceof Error) return error.message;
  const message = asRecord(error).message;
  return typeof message === "string" && message ? message : fallback;
}

export function actorId(actor: ActorContext): string {
  return nonEmpty(actor?.id);
}

export function actorRole(actor: ActorContext): string {
  return nonEmpty(actor?.role);
}

export function rowBillRecord(row: UnknownRecord = {}) {
  return asRecord(row.bill);
}

export function rowAuditStatus(row: UnknownRecord = {}) {
  return nonEmpty(rowBillRecord(row).auditStatus || "草稿");
}

export function rowBillSubmittedAt(row: UnknownRecord = {}) {
  return rowBillRecord(row).submittedAt || row.submittedAt || null;
}

export function rowBillReviewedAt(row: UnknownRecord = {}) {
  return rowBillRecord(row).reviewedAt || row.reviewedAt || null;
}

export function rowBillId(row: UnknownRecord = {}) {
  return nonEmpty(row.billId || rowBillRecord(row).id || logisticsExpenseBillId(row));
}

export function groupLogisticsExpenseRowsByBillId(rows: LogisticsExpenseRow[] = []) {
  const groups = new Map<string, LogisticsExpenseRow[]>();
  for (const row of rows) {
    const billId = rowBillId(row);
    if (!billId) continue;
    if (!groups.has(billId)) groups.set(billId, []);
    groups.get(billId)!.push(row);
  }
  return groups;
}

export function exchangeActor(actor: ActorContext): { role?: string } | null {
  const role = actorRole(actor);
  return role ? { role } : null;
}

export function assertWorkflowActor(actor: ActorContext): asserts actor is WorkflowActor {
  if (!actor) throw permissionError("请先登录", 401);
}

export function batchSaveLogisticsExpenseBillIdentifier(input: UnknownRecord = {}, updates: UnknownRecord[] = [], deletes: unknown[] = []) {
  const update = updates.find((item) => nonEmpty(item?.groupKey || item?.billId || item?.id)) || {};
  return nonEmpty(input.groupKey || input.billId || input.id || update.groupKey || update.billId || update.id || deletes[0]);
}
