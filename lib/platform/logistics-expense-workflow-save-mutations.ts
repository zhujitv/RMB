import { prisma } from "../prisma";
import {
  codedError,
  LOGISTICS_BILL_STATUS_VOIDED,
  runNonCriticalTask,
  writeAudit,
} from "./shared";
import {
  assertCanWriteLogisticsExpense,
  assertLogisticsExpenseOrder,
  assertLogisticsExpenseSupplier,
  buildLogisticsExpenseData,
  ensureLogisticsExpenseBill,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  logisticsExpenseRequestedAuditStatus,
  serializeLogisticsExpense,
} from "./logistics-expense-shared";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  asRecord,
  logisticsExpenseBillEditBlockReason,
  logisticsExpenseUpdateBlockReason,
  lockLogisticsBillForWorkflow,
  rowAuditStatus,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
  type LogisticsExpenseCreateData,
  type LogisticsExpenseRow,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import {
  submitLogisticsExpenseBill,
  withdrawLogisticsExpenseBill,
} from "./logistics-expense-workflow-state-mutations";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";

export async function saveLogisticsExpenses(request: AuditRequestLike, actor: ActorContext, input: UnknownRecord = {}) {
  assertCanWriteLogisticsExpense(actor);
  const order = await assertLogisticsExpenseOrder(input, actor);
  const items = Array.isArray(input.items) && input.items.length ? input.items.map(asRecord) : [input];
  const prepared: Array<{
    supplier: NonNullable<Awaited<ReturnType<typeof assertLogisticsExpenseSupplier>>>;
    auditStatus: string;
    data: LogisticsExpenseCreateData;
  }> = [];
  for (const item of items) {
    const supplier = await assertLogisticsExpenseSupplier(actor, order, { ...input, ...item });
    const auditStatus = logisticsExpenseRequestedAuditStatus({ ...input, ...item });
    const data = await buildLogisticsExpenseData(order, supplier, actor, { ...input, ...item });
    prepared.push({ supplier, auditStatus, data });
  }
  const groups = new Map<string, typeof prepared>();
  for (const item of prepared) {
    const supplierId = String(item.supplier.id || "").trim();
    if (!groups.has(supplierId)) groups.set(supplierId, []);
    groups.get(supplierId)!.push(item);
  }
  const expenses = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      order.id,
      "该订单已提交退税并归档，不能新增物流费用。",
    );
    await assertCommissionOrderWritableInTransaction(tx, order.id);
    const created: LogisticsExpenseRow[] = [];
    for (const [, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const auditStatus = group.some((item) => item.auditStatus === "待审核") ? "待审核" : "草稿";
      const submittedAt = auditStatus === "待审核" ? new Date() : null;
      const bill = await ensureLogisticsExpenseBill(order, group[0].supplier, actor, {
        auditStatus,
        submittedAt,
      }, tx);
      for (const item of group) {
        created.push(await tx.logisticsExpense.create({
          data: { ...item.data, billId: bill.id },
          include: includeLogisticsExpenseRelations(),
        }));
      }
    }
    return created;
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  for (const expense of expenses) {
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
  const billId = rowBillId(before);
  const saved = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      before.orderId,
      "该订单已提交退税并归档，不能修改物流费用。",
    );
    await assertCommissionOrderWritableInTransaction(tx, before.orderId);
    await lockLogisticsBillForWorkflow(tx, billId);
    const updated = await tx.logisticsExpense.updateMany({
      where: {
        id,
        billId,
        deletedAt: null,
        bill: { is: { auditStatus: { in: ["草稿", "已驳回"] }, status: { not: LOGISTICS_BILL_STATUS_VOIDED } } },
      },
      data,
    });
    if (updated.count !== 1) {
      throw codedError("账单状态已变化，费用修改已取消，请刷新后重试。", 409, "LOGISTICS_EXPENSE_UPDATE_STATE_CHANGED");
    }
    const row = await tx.logisticsExpense.findUnique({ where: { id }, include: includeLogisticsExpenseRelations() });
    if (!row) throw codedError("物流费用不存在或已删除。", 404, "LOGISTICS_EXPENSE_NOT_FOUND");
    return row;
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  invalidateWorkbenchTodosCache();
  await runNonCriticalTask("物流费用修改日志写入", () => writeAudit(request, actor, "修改物流费用", "logistics_expenses", id, before, saved));
  return serializeLogisticsExpense(saved);
}
