import { prisma } from "../prisma";
import {
  codedError,
  permissionError,
  runNonCriticalTask,
  writeAudit,
} from "./shared";
import {
  assertCanWriteLogisticsExpense,
  assertLogisticsExpenseOrder,
  assertLogisticsExpenseSupplier,
  aggregateLogisticsExpenseStatus,
  buildLogisticsExpenseData,
  ensureLogisticsExpenseBill,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  logisticsExpenseRequestedAuditStatus,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { canSubmitLogisticsBill, canWithdrawLogisticsBill } from "./logistics-bill-state-machine";
import {
  actorId,
  asRecord,
  loadLogisticsExpenseBillRowsForAction,
  loadLogisticsExpenseBillRowsForSubmit,
  logisticsExpenseBillEditBlockReason,
  logisticsExpenseUpdateBlockReason,
  rowAuditStatus,
  rowBillId,
  rowBillSubmittedAt,
  type ActorContext,
  type AuditRequestLike,
  type LogisticsExpenseCreateData,
  type LogisticsExpenseRow,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";

export async function saveLogisticsExpenses(request: AuditRequestLike, actor: ActorContext, input: UnknownRecord = {}) {
  assertCanWriteLogisticsExpense(actor);
  const order = await assertLogisticsExpenseOrder(input, actor);
  const items = Array.isArray(input.items) && input.items.length ? input.items.map(asRecord) : [input];
  const rows: LogisticsExpenseCreateData[] = [];
  for (const item of items) {
    const supplier = await assertLogisticsExpenseSupplier(actor, order, { ...input, ...item });
    const auditStatus = logisticsExpenseRequestedAuditStatus({ ...input, ...item });
    const data = await buildLogisticsExpenseData(order, supplier, actor, { ...input, ...item });
    const bill = await ensureLogisticsExpenseBill(order, supplier, actor, {
      auditStatus,
      submittedAt: auditStatus === "待审核" ? new Date() : null,
    });
    rows.push({ ...data, billId: bill.id });
  }
  const expenses: LogisticsExpenseRow[] = [];
  for (const data of rows) {
    const expense = await prisma.logisticsExpense.create({ data, include: includeLogisticsExpenseRelations() });
    expenses.push(expense);
    await runNonCriticalTask("物流费用提交日志写入", () => writeAudit(request, actor, rowAuditStatus(expense) === "草稿" ? "保存物流费用草稿" : "提交物流费用审核", "logistics_expenses", expense.id, null, expense));
  }
  invalidateWorkbenchTodosCache();
  return {
    rows: expenses.map(serializeLogisticsExpense),
    totalAmountCny: expenses.reduce((sum, row) => sum + Number(row.amountCny || 0), 0),
  };
}

export async function updateLogisticsExpense(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanWriteLogisticsExpense(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (input.action === "withdraw") return withdrawLogisticsExpenseBill(request, actor, rowBillId(before));
  if (input.action === "submit") return submitLogisticsExpenseBill(request, actor, rowBillId(before));
  const order = await assertLogisticsExpenseOrder({ orderId: before.orderId }, actor);
  const supplier = await assertLogisticsExpenseSupplier(actor, order, { supplierId: before.supplierId });
  const billBlockReason = await logisticsExpenseBillEditBlockReason(before, actor);
  if (billBlockReason) throw codedError(billBlockReason, 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
  const blockReason = logisticsExpenseUpdateBlockReason(before);
  if (blockReason) throw codedError(blockReason, 400, "LOGISTICS_EXPENSE_STATUS_BLOCKED");
  const data = await buildLogisticsExpenseData(order, supplier, actor, { ...input, supplierId: before.supplierId }, before);
  const saved = await prisma.logisticsExpense.update({ where: { id }, data, include: includeLogisticsExpenseRelations() });
  invalidateWorkbenchTodosCache();
  await runNonCriticalTask("物流费用修改日志写入", () => writeAudit(request, actor, "修改物流费用", "logistics_expenses", id, before, saved));
  return serializeLogisticsExpense(saved);
}

export async function withdrawLogisticsExpenseBill(request: AuditRequestLike, actor: ActorContext, identifier: unknown) {
  assertCanWriteLogisticsExpense(actor);
  const rows = await loadLogisticsExpenseBillRowsForSubmit(identifier, actor);
  if (!rows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  const billAuditStatus = aggregateLogisticsExpenseStatus(rows, "auditStatus");
  const billInvoiceStatus = aggregateLogisticsExpenseStatus(rows, "invoiceStatus");
  const billId = rowBillId(rows[0]);
  const canWithdraw = canWithdrawLogisticsBill({ auditStatus: billAuditStatus });
  console.info("[logistics-expense.withdraw]", {
    billId,
    identifier,
    status: billAuditStatus,
    auditStatus: billAuditStatus,
    invoiceStatus: billInvoiceStatus,
    userId: actor?.id || "",
    userRole: actor?.role || "",
    canWithdraw,
    reason: canWithdraw ? "账单主状态为待审核，允许撤回" : `账单主状态为${billAuditStatus || "未知"}，不能撤回`,
  });
  if (!canWithdraw) {
    throw codedError(`只有待审核账单可以撤回。当前账单状态：${billAuditStatus || "未知"}。`, 400, "LOGISTICS_EXPENSE_WITHDRAW_NOT_ALLOWED");
  }
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!rows[0]?.billId) throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
  await prisma.logisticsBill.update({
    where: { id: billId },
    data: {
      auditStatus: "草稿",
      submittedAt: null,
      submittedById: null,
      updatedById: actorId(actor),
    },
  });
  const savedRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  invalidateWorkbenchTodosCache();
  void runNonCriticalTask("物流费用账单撤回日志写入", () => writeAudit(request, actor, "撤回物流费用账单", "logistics_bills", billId, rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(savedRows),
    updatedIds: ids,
  }));
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
  };
}

export async function submitLogisticsExpenseBill(request: AuditRequestLike, actor: ActorContext, identifier: unknown) {
  const startedAt = Date.now();
  let billId = "";
  let rowCount = 0;
  let success = false;
  assertCanWriteLogisticsExpense(actor);
  try {
    const rows = await loadLogisticsExpenseBillRowsForSubmit(identifier, actor);
    if (!rows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
    billId = rowBillId(rows[0]);
    rowCount = rows.length;
    const blocked = rows.find((row) => !canSubmitLogisticsBill({ auditStatus: rowAuditStatus(row) }));
    if (blocked) throw codedError("只有草稿或已驳回费用可以提交审核。", 400, "LOGISTICS_EXPENSE_SUBMIT_NOT_ALLOWED");
    const submittedAt = new Date();
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (!rows[0]?.billId) throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
    await prisma.logisticsBill.update({
      where: { id: billId },
      data: {
        auditStatus: "待审核",
        submittedAt,
        submittedById: actorId(actor) || null,
        rejectReason: null,
        invoiceNotificationError: null,
        updatedById: actorId(actor),
      },
    });
    const submittedAtIso = submittedAt.toISOString();
    void runNonCriticalTask("物流费用提交审核日志写入", () => writeAudit(request, actor, "提交物流费用审核", "logistics_bills", billId, rows.map((row) => ({
      id: row.id,
      auditStatus: rowAuditStatus(row),
      invoiceStatus: row.invoiceStatus,
      paymentStatus: row.paymentStatus,
      submittedAt: rowBillSubmittedAt(row),
    })), {
      billId,
      updatedIds: ids,
      auditStatus: "待审核",
      submittedAt,
      submittedById: actorId(actor),
    }));
    success = true;
    invalidateWorkbenchTodosCache();
    return { billId, updatedIds: ids, auditStatus: "待审核", submittedAt: submittedAtIso };
  } finally {
    const durationMs = Date.now() - startedAt;
    const payload = {
      billId: billId || identifier,
      rowCount,
      userId: actor?.id || "",
      userRole: actor?.role || "",
      success,
      durationMs,
    };
    if (durationMs > 1000) console.warn("submit-audit-slow-log", payload);
    else console.info("[logistics-expense.submit-audit]", payload);
  }
}
