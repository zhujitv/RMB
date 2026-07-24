import { prisma } from "../prisma";
import { codedError, nonEmpty, permissionError, requireText } from "./shared";
import {
  aggregateLogisticsExpenseStatus,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  logisticsExpenseAccessWhere,
} from "./logistics-expense-shared";
import { logisticsBillEditBlockReason as logisticsBillStateEditBlockReason } from "./logistics-bill-state-machine";
import {
  LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
  rowBillId,
  rowBillStatus,
  type ActorContext,
  type LogisticsExpenseRow,
  type LogisticsExpenseStateSnapshot,
  type UnknownRecord,
} from "./logistics-expense-workflow-model";
import {
  assertRowsAreWritable,
  logisticsExpenseSubmitSelect,
  parseLogisticsExpenseGroupKey,
  rowMatchesLegacyBillKey,
} from "./logistics-expense-workflow-loader-core";

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
