import { prisma } from "../prisma";
import {
  codedError,
  LOGISTICS_BILL_STATUS_VOIDED,
  ORDER_COST_STATUS_VOID,
  permissionError,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  writeAudit,
} from "./shared";
import {
  aggregateLogisticsExpenseStatus,
  includeLogisticsExpenseRelations,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { isVoidedLogisticsBill } from "./logistics-bill-state-machine";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  loadLogisticsExpenseBillRowsForAction,
  rowBillId,
  rowBillStatus,
  type ActorContext,
  type AuditRequestLike,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";

export async function voidLogisticsExpenseBill(request: AuditRequestLike, actor: ActorContext, identifier: unknown, input: UnknownRecord = {}) {
  if (actor?.role !== "管理员") throw permissionError("只有管理员可以作废物流费用账单。", 403);
  const reason = String(input.reason || input.voidReason || "").trim();
  if (!reason) throw codedError("作废原因不能为空。", 400, "LOGISTICS_BILL_VOID_REASON_REQUIRED");
  const remark = String(input.remark || input.voidRemark || "").trim();
  const rows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  if (!rows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  const billId = rowBillId(rows[0]);
  if (isVoidedLogisticsBill({ status: rowBillStatus(rows[0]) })) {
    throw codedError("该物流费用账单已作废，不能重复作废。", 400, "LOGISTICS_BILL_ALREADY_VOIDED");
  }
  const now = new Date();
  const orderId = String(rows[0]?.orderId || "");
  const voided = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      orderId,
      "该订单已提交退税并归档，不能作废物流费用账单。",
    );
    await assertCommissionOrderWritableInTransaction(tx, orderId);
    const currentRows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (!currentRows.length) throw codedError("物流费用账单缺少费用明细，不能作废。", 409, "LOGISTICS_BILL_VOID_ROWS_EMPTY");
    if (currentRows.some((row) => isVoidedLogisticsBill({ status: rowBillStatus(row) }))) {
      throw codedError("该物流费用账单已作废，不能重复作废。", 400, "LOGISTICS_BILL_ALREADY_VOIDED");
    }
    const billPaymentStatus = aggregateLogisticsExpenseStatus(currentRows, "paymentStatus");
    if (String(billPaymentStatus || "").includes("已付款")) {
      throw codedError("已付款账单不能直接作废，请先取消付款或走红冲流程。", 400, "LOGISTICS_BILL_VOID_PAID_BLOCKED");
    }
    const linkedCosts = currentRows.map((row) => row.cost).filter(Boolean);
    const paidCost = linkedCosts.find((cost) =>
      ["已支付", "部分支付"].includes(String(cost?.paymentStatus || "")) ||
      Boolean(cost?.paid || cost?.paidAt || cost?.paymentDate),
    );
    if (paidCost) {
      throw codedError("已同步成本存在付款记录，不能直接作废，请先取消付款或走红冲流程。", 400, "LOGISTICS_BILL_VOID_COST_PAID_BLOCKED");
    }
    const costIds = [...new Set(currentRows.map((row) => row.costId || row.cost?.id || "").filter(Boolean))];
    const billAuditStatus = aggregateLogisticsExpenseStatus(currentRows, "auditStatus");
    if (billAuditStatus === "审核通过" && costIds.length !== currentRows.length) {
      throw codedError("物流费用未完整关联成本，不能作废，请先修复成本关联。", 409, "LOGISTICS_BILL_VOID_COST_LINK_INCOMPLETE");
    }
    const billUpdate = await tx.logisticsBill.updateMany({
      where: {
        id: billId,
        deletedAt: null,
        status: { not: LOGISTICS_BILL_STATUS_VOIDED },
        paymentStatus: { notIn: ["已付款", "部分付款", "部分已付款"] },
      },
      data: {
        status: LOGISTICS_BILL_STATUS_VOIDED,
        voidedAt: now,
        voidedById: actor.id || null,
        voidReason: reason,
        voidRemark: remark || null,
        updatedById: actor.id || null,
      },
    });
    if (billUpdate.count !== 1) {
      throw codedError("物流费用账单状态已变化，作废已取消，请刷新后重试。", 409, "LOGISTICS_BILL_VOID_STATE_CHANGED");
    }
    if (costIds.length) {
      const costUpdate = await tx.orderCost.updateMany({
        where: {
          id: { in: costIds },
          deletedAt: null,
          status: { not: ORDER_COST_STATUS_VOID },
          paymentStatus: { notIn: ["已支付", "部分支付"] },
          paid: false,
          paidAt: null,
          paymentDate: null,
        },
        data: {
          status: ORDER_COST_STATUS_VOID,
          voidedAt: now,
          voidedById: actor.id || null,
          voidReason: `物流费用账单作废：${reason}`,
          updatedById: actor.id || null,
        },
      });
      if (costUpdate.count !== costIds.length) {
        throw codedError("关联成本状态已变化，物流费用账单作废已取消。", 409, "LOGISTICS_BILL_VOID_COST_CHANGED");
      }
    }
    return { rows: currentRows, costIds };
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  const savedRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  for (const affectedOrderId of [...new Set(voided.rows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(affectedOrderId);
  }
  invalidateWorkbenchTodosCache();
  await runNonCriticalTask("物流费用账单作废日志写入", () => writeAudit(request, actor, "作废物流费用账单", "logistics_bills", billId, {
    bill: serializeLogisticsExpenseBill(voided.rows),
    expenses: voided.rows.map(serializeLogisticsExpense),
  }, {
    bill: serializeLogisticsExpenseBill(savedRows),
    voidReason: reason,
    voidRemark: remark,
    originalOrderNo: voided.rows[0]?.order?.orderNo || voided.rows[0]?.orderId || "",
    originalAmountCny: voided.rows.reduce((sum, row) => sum + Number(row.amountCny || 0), 0),
    voidedCostIds: voided.costIds,
    voidedAt: now.toISOString(),
  }));
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
    voidedBillId: billId,
    voidedCostIds: voided.costIds,
  };
}
