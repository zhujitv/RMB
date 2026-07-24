import { prisma } from "../prisma";
import {
  amountCny,
  codedError,
  nonEmpty,
  optional,
  scheduleTaxRefundCompletenessRefresh,
  writeAudit,
} from "./shared";
import {
  assertCanWriteLogisticsExpense,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  serializeLogisticsExpense,
} from "./logistics-expense-shared";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  asRecord,
  billingAmountFromUnit,
  legacyAppliedContainerCount,
  logisticsExpenseBillEditBlockReason,
  logisticsExpenseUpdateBlockReason,
  lockLogisticsBillForWorkflow,
  normalizeBatchBillingMethod,
  normalizeBatchBillingQuantity,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
  type LogisticsExpenseRow,
  type PreparedUpdate,
} from "./logistics-expense-workflow-core";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";

export async function batchUpdateLogisticsExpenses(request: AuditRequestLike, actor: ActorContext, input: unknown = {}) {
  assertCanWriteLogisticsExpense(actor);
  const inputRecord = asRecord(input);
  const items = Array.isArray(input)
    ? input.map(asRecord)
    : (Array.isArray(inputRecord.items) ? (inputRecord.items as unknown[]).map(asRecord) : (Array.isArray(inputRecord.rows) ? (inputRecord.rows as unknown[]).map(asRecord) : []));
  if (!items.length) throw codedError("请提供需要保存的物流费用明细。", 400, "LOGISTICS_EXPENSE_BATCH_EMPTY");
  const prepared: PreparedUpdate[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const id = nonEmpty(item.id);
    if (!id) throw codedError(`第 ${index + 1} 行保存失败：缺少物流费用ID。`, 400, "LOGISTICS_EXPENSE_BATCH_ID_REQUIRED");
    const before = await loadLogisticsExpenseForAction(id, actor);
    const costType = before.costType || "物流费用";
    const unitAmount = Number(item.amount);
    const billingMethod = normalizeBatchBillingMethod(item, before);
    const billingQuantity = normalizeBatchBillingQuantity(item, billingMethod, costType, index);
    const appliedContainerCount = legacyAppliedContainerCount(billingQuantity);
    if (!Number.isFinite(unitAmount) || unitAmount < 0) throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于或等于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_AMOUNT_INVALID");
    const billBlockReason = await logisticsExpenseBillEditBlockReason(before, actor);
    if (billBlockReason) throw codedError(`第 ${index + 1} 行${costType}保存失败：${billBlockReason}`, 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
    const blockReason = logisticsExpenseUpdateBlockReason(before);
    if (blockReason) throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_STATUS_BLOCKED");
    const amount = billingAmountFromUnit(unitAmount, billingQuantity, billingMethod);
    const hasContainerType = Object.prototype.hasOwnProperty.call(item, "containerType")
      || Object.prototype.hasOwnProperty.call(item, "container_type");
    prepared.push({
      index,
      before,
      data: {
        amount,
        amountCny: amountCny(amount, before.exchangeRate || 1),
        ...(hasContainerType ? { containerType: optional(item.containerType ?? item.container_type) } : {}),
        appliedContainerCount,
        billingMethod,
        billingQuantity,
        remark: optional(item.remark),
        updatedById: actorId(actor),
      },
    });
  }
  const savedRows = await prisma.$transaction(async (tx) => {
    const orderIds = [...new Set(prepared.map((item) => nonEmpty(item.before.orderId)).filter(Boolean))].sort();
    const billIds = [...new Set(prepared.map((item) => rowBillId(item.before)).filter(Boolean))].sort();
    for (const orderId of orderIds) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能修改物流费用明细。",
      );
      await assertCommissionOrderWritableInTransaction(tx, orderId);
    }
    for (const billId of billIds) {
      await lockLogisticsBillForWorkflow(tx, billId);
    }
    const saved: LogisticsExpenseRow[] = [];
    for (const item of prepared) {
      const billId = rowBillId(item.before);
      const updated = await tx.logisticsExpense.updateMany({
        where: {
          id: item.before.id,
          billId,
          deletedAt: null,
          updatedAt: item.before.updatedAt,
          bill: { is: { auditStatus: { in: ["草稿", "已驳回"] }, status: { not: "voided" } } },
        },
        data: item.data,
      });
      if (updated.count !== 1) {
        throw codedError("账单状态已变化，费用修改已取消，请刷新后重试。", 409, "LOGISTICS_EXPENSE_BATCH_UPDATE_STATE_CHANGED");
      }
      const row = await tx.logisticsExpense.findUnique({
        where: { id: item.before.id },
        include: includeLogisticsExpenseRelations(),
      });
      if (!row) throw codedError("物流费用不存在或已删除。", 404, "LOGISTICS_EXPENSE_NOT_FOUND");
      await writeAudit(request, actor, "批量修改物流费用明细", "logistics_expenses", item.before.id, item.before, row, tx);
      saved.push(row);
    }
    return saved;
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  for (const orderId of [...new Set(savedRows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(orderId);
  }
  invalidateWorkbenchTodosCache();
  return savedRows.map(serializeLogisticsExpense);
}
