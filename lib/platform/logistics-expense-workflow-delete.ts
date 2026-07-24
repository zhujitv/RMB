import { prisma } from "../prisma";
import {
  codedError,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  writeAudit,
} from "./shared";
import {
  assertCanWriteLogisticsExpense,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  logisticsExpenseAccessWhere,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  loadLogisticsExpenseBillRowsForAction,
  logisticsExpenseDeleteBlock,
  lockLogisticsBillForWorkflow,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
} from "./logistics-expense-workflow-core";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";

export async function deleteLogisticsExpense(request: AuditRequestLike, actor: ActorContext, id: string) {
  assertCanWriteLogisticsExpense(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  const billId = rowBillId(before);
  const block = logisticsExpenseDeleteBlock(before);
  if (block) throw codedError(block.message, 400, block.code);
  const mutation = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      before.orderId,
      "该订单已提交退税并归档，不能删除物流费用明细。",
    );
    await assertCommissionOrderWritableInTransaction(tx, before.orderId);
    await lockLogisticsBillForWorkflow(tx, billId);
    const current = await tx.logisticsExpense.findFirst({
      where: { id, billId, deletedAt: null, ...logisticsExpenseAccessWhere(actor) },
      include: includeLogisticsExpenseRelations(),
    });
    if (!current) throw codedError("物流费用不存在或已删除。", 404, "LOGISTICS_EXPENSE_NOT_FOUND");
    const currentBlock = logisticsExpenseDeleteBlock(current);
    if (currentBlock) throw codedError(currentBlock.message, 400, currentBlock.code);
    const deletedAt = new Date();
    const deleted = await tx.logisticsExpense.updateMany({
      where: {
        id,
        billId,
        deletedAt: null,
        bill: { is: { auditStatus: { in: ["草稿", "已驳回"] }, status: { not: "voided" } } },
      },
      data: { deletedAt, updatedById: actorId(actor) },
    });
    if (deleted.count !== 1) {
      throw codedError("账单状态已变化，费用删除已取消，请刷新后重试。", 409, "LOGISTICS_EXPENSE_DELETE_STATE_CHANGED");
    }
    const saved = await tx.logisticsExpense.findUnique({ where: { id }, include: includeLogisticsExpenseRelations() });
    if (!saved) throw codedError("物流费用不存在或已删除。", 404, "LOGISTICS_EXPENSE_NOT_FOUND");
    const remainingCount = await tx.logisticsExpense.count({ where: { billId, deletedAt: null } });
    if (!remainingCount) {
      await tx.logisticsBill.update({
        where: { id: billId },
        data: { deletedAt, updatedById: actorId(actor) || null },
      });
    } else {
      await tx.logisticsBill.update({
        where: { id: billId },
        data: { invoiceStatus: "待开票", paymentStatus: "待开票", updatedById: actorId(actor) || null },
      });
    }
    return saved;
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  const saved = mutation;
  scheduleTaxRefundCompletenessRefresh(saved.orderId);
  const billRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  let serializedBill: ReturnType<typeof serializeLogisticsExpenseBill> | null = null;
  if (billRows.length) serializedBill = serializeLogisticsExpenseBill(billRows);
  const serializedExpense = serializeLogisticsExpense(saved);
  await runNonCriticalTask("物流费用删除日志写入", () => writeAudit(request, actor, "删除物流费用明细", "logistics_expenses", id, {
    ...before,
    deleteSnapshot: {
      costType: before.costType || "",
      amount: Number(before.amount || 0),
      currency: before.currency || "CNY",
    },
  }, {
    ...saved,
    deletedItem: {
      deletedById: actorId(actor) || "",
      deletedAt: saved.deletedAt,
      costType: before.costType || "",
      amount: Number(before.amount || 0),
      currency: before.currency || "CNY",
    },
    bill: serializedBill,
  }));
  invalidateWorkbenchTodosCache();
  return {
    expense: serializedExpense,
    bill: serializedBill,
    deletedId: id,
    totalAmount: serializedBill?.amount || 0,
    totalAmountCny: serializedBill?.amountCny || 0,
  };
}
