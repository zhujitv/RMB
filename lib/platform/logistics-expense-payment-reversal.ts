import { prisma } from "../prisma";
import {
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  ORDER_COST_STATUS_VOID,
  codedError,
  nonEmpty,
  optional,
  permissionError,
  writeAudit,
} from "./shared";
import {
  aggregateLogisticsExpenseStatus,
  assertCanReverseLogisticsPayment,
  includeLogisticsExpenseRelations,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { canReverseLogisticsBillPayment } from "./logistics-bill-state-machine";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  assertLogisticsBillRowsMatchHeader,
  loadLogisticsExpenseBillRowsForAction,
  lockLogisticsBillForWorkflow,
  rowBillId,
  rowBillStatus,
  type ActorContext,
  type AuditRequestLike,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { syncApprovedLogisticsExpenseCosts } from "./logistics-expense-workflow-review-helpers";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import {
  assertLogisticsBillNotVoided,
} from "./logistics-expense-invoice-guards";

export async function reverseLogisticsExpensePayment(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanReverseLogisticsPayment(actor);
  const reason = optional(input.reason || input.correctionReason || input.reversalReason);
  if (!reason) {
    throw codedError("付款更正必须填写冲销原因。", 400, "LOGISTICS_PAYMENT_REVERSAL_REASON_REQUIRED");
  }
  const billRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  if (!billRows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  assertLogisticsBillNotVoided(billRows);
  const billId = rowBillId(billRows[0]);
  const orderId = nonEmpty(billRows[0]?.orderId);
  const reversedAt = new Date();
  const savedRows = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      orderId,
      "该订单已提交退税并归档，不能冲销物流费用付款。",
    );
    await lockLogisticsBillForWorkflow(tx, billId);
    const currentRows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (!currentRows.length) {
      throw codedError("物流费用账单缺少费用明细，不能冲销付款。", 409, "LOGISTICS_PAYMENT_REVERSAL_ROWS_EMPTY");
    }
    await assertLogisticsBillRowsMatchHeader(tx, billId, currentRows);
    assertLogisticsBillNotVoided(currentRows);
    const auditStatus = aggregateLogisticsExpenseStatus(currentRows, "auditStatus");
    const paymentStatus = aggregateLogisticsExpenseStatus(currentRows, "paymentStatus");
    if (!canReverseLogisticsBillPayment({
      auditStatus,
      paymentStatus,
      status: rowBillStatus(currentRows[0]),
    })) {
      throw codedError("只有审核通过且已付款的物流费用账单可以冲销付款。", 409, "LOGISTICS_PAYMENT_REVERSAL_STATE_INVALID");
    }
    const costLinks = await syncApprovedLogisticsExpenseCosts(tx, currentRows, actor, {
      settledCostMode: "preserve-required",
      allowCommissionSettled: true,
      orderLocksAlreadyHeld: true,
      expectedOrderIds: [orderId],
    });
    const costIds = [...new Set(costLinks.map((link) => nonEmpty(link.costId)).filter(Boolean))];
    if (costIds.length !== currentRows.length) {
      throw codedError("物流费用未完整关联成本，付款冲销已取消。", 409, "LOGISTICS_PAYMENT_REVERSAL_COST_LINK_INCOMPLETE");
    }
    const billUpdate = await tx.logisticsBill.updateMany({
      where: {
        id: billId,
        deletedAt: null,
        status: { not: "voided" },
        paymentStatus: "已付款",
      },
      data: {
        paymentStatus: "待付款",
        paymentDate: null,
        updatedById: actorId(actor) || null,
      },
    });
    if (billUpdate.count !== 1) {
      throw codedError("物流费用付款状态已变化，冲销已取消，请刷新后重试。", 409, "LOGISTICS_PAYMENT_REVERSAL_BILL_CHANGED");
    }
    const costUpdate = await tx.orderCost.updateMany({
      where: {
        id: { in: costIds },
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
        sourceType: { in: LOGISTICS_GENERATED_COST_SOURCE_TYPES },
      },
      data: {
        paymentStatus: "待支付",
        paid: false,
        paidAt: null,
        paymentDate: null,
        updatedById: actorId(actor) || null,
      },
    });
    if (costUpdate.count !== costIds.length) {
      throw codedError("成本付款冲销不完整，物流付款冲销已取消。", 409, "LOGISTICS_PAYMENT_REVERSAL_COST_SYNC_INCOMPLETE");
    }
    await writeAudit(
      request,
      actor,
      "冲销物流费用付款",
      "logistics_bills",
      billId,
      {
        paymentStatus,
        paymentDate: currentRows[0]?.bill?.paymentDate || null,
        costs: currentRows.map((row) => ({ id: row.costId || row.cost?.id || null, paymentStatus: row.cost?.paymentStatus || null })),
      },
      {
        paymentStatus: "待付款",
        paymentDate: null,
        costIds,
        costPaymentStatus: "待支付",
        reason,
        reversedAt,
      },
      tx,
    );
    const rows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (rows.length !== currentRows.length) {
      throw codedError("物流费用明细状态已变化，付款冲销已取消。", 409, "LOGISTICS_PAYMENT_REVERSAL_ROWS_CHANGED");
    }
    return rows;
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  invalidateWorkbenchTodosCache();
  const serializedExpenses = savedRows.map(serializeLogisticsExpense);
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: serializedExpenses,
    expense: serializedExpenses.find((row) => row.id === billRows[0]?.id) || serializedExpenses[0] || null,
  };
}
