import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { codedError, nonEmpty, permissionError, requireText } from "./shared";
import {
  aggregateLogisticsExpenseInvoiceStatus,
  aggregateLogisticsExpenseStatus,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  logisticsExpenseAccessWhere,
} from "./logistics-expense-shared";
import { logisticsBillEditBlockReason as logisticsBillStateEditBlockReason } from "./logistics-bill-state-machine";
import { assertBusinessNotArchived } from "./business-archive";
import {
  LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
  actorId,
  asRecord,
  rowAuditStatus,
  rowBillId,
  rowBillStatus,
  type ActorContext,
  type LogisticsExpenseRow,
  type LogisticsExpenseStateSnapshot,
  type UnknownRecord,
} from "./logistics-expense-workflow-model";

export type LogisticsExpenseSubmitRow = Prisma.LogisticsExpenseGetPayload<{ select: ReturnType<typeof logisticsExpenseSubmitSelect> }> & UnknownRecord;

function assertRowsAreWritable(rows: Array<{ order?: unknown }> = []) {
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

export async function reloadLogisticsExpenseRowsForBillIds(billIds: string[] = [], actor: ActorContext) {
  const rows: LogisticsExpenseRow[] = [];
  const uniqueBillIds = [...new Set(billIds.map(nonEmpty).filter(Boolean))];
  const directBillIds = uniqueBillIds.filter((billId) => !billId.startsWith("bill:"));
  if (directBillIds.length) {
    const directRows = await prisma.logisticsExpense.findMany({
      where: {
        billId: { in: directBillIds },
        deletedAt: null,
        ...logisticsExpenseAccessWhere(actor),
      },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ billId: "asc" }, { createdAt: "asc" }],
      take: directBillIds.length * LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
    });
    assertRowsAreWritable(directRows);
    rows.push(...directRows);
  }
  for (const legacyBillId of uniqueBillIds.filter((billId) => billId.startsWith("bill:"))) {
    rows.push(...await loadLogisticsExpenseBillRowsForAction(legacyBillId, actor));
  }
  return rows;
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

export async function loadLogisticsExpenseBillRowsForAction(identifier: unknown, actor: ActorContext): Promise<LogisticsExpenseRow[]> {
  const text = requireText(identifier, "物流费用账单");
  if (!text.startsWith("bill:")) {
    const billRows = await prisma.logisticsExpense.findMany({
      where: {
        billId: text,
        deletedAt: null,
        ...logisticsExpenseAccessWhere(actor),
      },
      include: includeLogisticsExpenseRelations(),
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
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
      take: LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
    });
    const matchedRows = rows.filter((row) => rowMatchesLegacyBillKey(row, text));
    assertRowsAreWritable(matchedRows);
    return matchedRows;
  }
  const before = await loadLogisticsExpenseForAction(text, actor);
  const billId = rowBillId(before);
  const rows = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      ...(before.billId ? { billId: before.billId } : { orderId: before.orderId }),
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseRelations(),
    orderBy: [{ createdAt: "asc" }],
    take: LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
  });
  const matchedRows = before.billId ? rows : rows.filter((row) => rowMatchesLegacyBillKey(row, billId));
  assertRowsAreWritable(matchedRows);
  return matchedRows;
}

export async function logisticsExpenseBillEditBlockReason(expense: LogisticsExpenseStateSnapshot & UnknownRecord, actor: ActorContext) {
  const rows = await loadLogisticsExpenseBillRowsForAction(rowBillId(expense), actor);
  const billStatus = aggregateLogisticsExpenseStatus(rows, "auditStatus");
  const voidStatus = rows.map(rowBillStatus).find((status) => status === "voided") || "normal";
  const reason = logisticsBillStateEditBlockReason({ auditStatus: billStatus, status: voidStatus });
  if (!reason) return "";
  return voidStatus === "voided" ? reason : `账单${billStatus || "当前状态"}，不能修改明细，请先撤回为草稿。`;
}
