import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { codedError, nonEmpty, permissionError, requireText } from "./shared";
import {
  aggregateLogisticsExpenseInvoiceStatus,
  logisticsExpenseAccessWhere,
} from "./logistics-expense-shared";
import { assertBusinessNotArchived } from "./business-archive";
import {
  LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
  actorId,
  asRecord,
  rowBillId,
  type ActorContext,
  type LogisticsExpenseRow,
  type UnknownRecord,
} from "./logistics-expense-workflow-model";

export type LogisticsExpenseSubmitRow = Prisma.LogisticsExpenseGetPayload<{ select: ReturnType<typeof logisticsExpenseSubmitSelect> }> & UnknownRecord;

export function assertRowsAreWritable(rows: Array<{ order?: unknown }> = []) {
  for (const row of rows) {
    assertBusinessNotArchived(row.order as Parameters<typeof assertBusinessNotArchived>[0], "该订单已提交退税并归档，物流费用只允许查看和下载。");
  }
}

export async function refreshLogisticsBillWorkflowStatus(rows: LogisticsExpenseRow[] = [], actor: ActorContext, overrides: Prisma.LogisticsBillUncheckedUpdateInput = {}) {
  if (!rows.length || !rows[0]?.billId) return;
  await prisma.logisticsBill.update({
    where: { id: rowBillId(rows[0]) },
    data: {
      invoiceStatus: aggregateLogisticsExpenseInvoiceStatus(rows),
      updatedById: actorId(actor) || null,
      ...overrides,
    },
  });
}

export async function lockLogisticsBillForWorkflow(tx: Prisma.TransactionClient, billId: string) {
  let locked: Array<{ id: string }>;
  try {
    locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "logistics_bills"
      WHERE "id" = ${billId}
        AND "deleted_at" IS NULL
        AND "status" <> 'voided'
      FOR UPDATE NOWAIT
    `);
  } catch (error: unknown) {
    const message = String((error as { message?: string })?.message || "");
    if (/55P03|could not obtain lock|lock not available/i.test(message)) {
      throw codedError("该物流费用账单正在由其他人处理，请稍后刷新再试。", 409, "LOGISTICS_BILL_OPERATION_IN_PROGRESS");
    }
    throw error;
  }
  if (locked.length !== 1) {
    throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_BILL_WORKFLOW_LOCK_FAILED");
  }
}

export async function assertLogisticsBillRowsMatchHeader(
  tx: Prisma.TransactionClient,
  billId: string,
  rows: Array<{
    billId?: string | null;
    orderId?: string | null;
    supplierId?: string | null;
  }> = [],
) {
  const bill = await tx.logisticsBill.findUnique({
    where: { id: billId },
    select: { id: true, orderId: true, supplierId: true },
  });
  if (!bill || !rows.length) {
    throw codedError("物流费用账单缺少有效主表或费用明细。", 409, "LOGISTICS_BILL_SCOPE_MISSING");
  }
  const mismatched = rows.find((row) => (
    row.billId !== bill.id
    || row.orderId !== bill.orderId
    || !bill.supplierId
    || row.supplierId !== bill.supplierId
  ));
  if (mismatched) {
    throw codedError("物流费用账单存在跨订单或跨供应商异常关联，已阻止审核、发票或付款操作，请先修复历史数据。", 409, "LOGISTICS_BILL_SCOPE_MISMATCH");
  }
  return bill;
}

export function parseLogisticsExpenseGroupKey(groupKey: unknown) {
  const text = nonEmpty(groupKey);
  if (!text.startsWith("bill:")) return {};
  const rest = text.slice(5);
  const separator = rest.indexOf(":");
  if (separator < 0) return { orderId: rest };
  return {
    orderId: rest.slice(0, separator),
    billKey: rest.slice(separator + 1),
  };
}

export function rowMatchesLegacyBillKey(row: UnknownRecord = {}, legacyBillId: unknown) {
  const parsed = parseLogisticsExpenseGroupKey(legacyBillId);
  if (!parsed.orderId) return false;
  const order = asRecord(row.order);
  const rowOrderId = nonEmpty(row.orderId || order.id);
  const rowBillKey = nonEmpty(order.blNo || order.orderNo || "no-bl").toLowerCase();
  const rowSupplierBillKey = [rowBillKey, nonEmpty(row.supplierId)].filter(Boolean).join("::");
  const requestedBillKey = nonEmpty(parsed.billKey || "no-bl").toLowerCase();
  return rowOrderId === parsed.orderId
    && (rowBillKey === requestedBillKey || rowSupplierBillKey === requestedBillKey);
}

export function normalizeLogisticsExpenseReviewIdentifiers(input: UnknownRecord = {}) {
  const values = [
    ...(Array.isArray(input.billIds) ? input.billIds : []),
    ...(Array.isArray(input.groupKeys) ? input.groupKeys : []),
    ...(Array.isArray(input.ids) ? input.ids : []),
    ...(Array.isArray(input.expenseIds) ? input.expenseIds : []),
    input.billId,
    input.groupKey,
    input.id,
  ];
  return values.map(nonEmpty).filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
}

export function logisticsExpenseSubmitSelect() {
  return {
    id: true,
    orderId: true,
    supplierId: true,
    auditStatus: true,
    invoiceStatus: true,
    paymentStatus: true,
    submittedAt: true,
    billId: true,
    bill: {
      select: {
        id: true,
        auditStatus: true,
        invoiceStatus: true,
        paymentStatus: true,
        submittedAt: true,
        reviewedAt: true,
      },
    },
    order: {
      select: {
        id: true,
        orderNo: true,
        blNo: true,
        taxArchived: true,
        taxRefundStatus: true,
        taxRefundArchivedAt: true,
        taxSubmittedAt: true,
      },
    },
  };
}

export async function loadLogisticsExpenseBillRowsForSubmit(identifier: unknown, actor: ActorContext): Promise<LogisticsExpenseSubmitRow[]> {
  const text = requireText(identifier, "物流费用账单");
  if (!text.startsWith("bill:")) {
    const billRows = await prisma.logisticsExpense.findMany({
      where: {
        billId: text,
        deletedAt: null,
        ...logisticsExpenseAccessWhere(actor),
      },
      select: logisticsExpenseSubmitSelect(),
      orderBy: [{ createdAt: "asc" }],
      take: LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
    });
    if (billRows.length) {
      assertRowsAreWritable(billRows);
      return billRows;
    }
  }
  if (text.startsWith("bill:")) {
    const parsed = parseLogisticsExpenseGroupKey(text);
    if (!parsed.orderId) throw codedError("物流费用账单编号无效。", 400, "LOGISTICS_EXPENSE_BILL_ID_INVALID");
    const rows = await prisma.logisticsExpense.findMany({
      where: {
        deletedAt: null,
        orderId: parsed.orderId,
        ...logisticsExpenseAccessWhere(actor),
      },
      select: logisticsExpenseSubmitSelect(),
      orderBy: [{ createdAt: "asc" }],
      take: LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
    });
    const matchedRows = rows.filter((row) => rowMatchesLegacyBillKey(row, text));
    assertRowsAreWritable(matchedRows);
    return matchedRows;
  }
  const before = await prisma.logisticsExpense.findFirst({
    where: {
      id: text,
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    select: logisticsExpenseSubmitSelect(),
  });
  if (!before) throw permissionError("物流费用不存在或无权访问", 404);
  const billId = rowBillId(before);
  const rows = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      ...(before.billId ? { billId: before.billId } : { orderId: before.orderId }),
      ...logisticsExpenseAccessWhere(actor),
    },
    select: logisticsExpenseSubmitSelect(),
    orderBy: [{ createdAt: "asc" }],
    take: LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
  });
  const matchedRows = before.billId ? rows : rows.filter((row) => rowMatchesLegacyBillKey(row, billId));
  assertRowsAreWritable(matchedRows);
  return matchedRows;
}
