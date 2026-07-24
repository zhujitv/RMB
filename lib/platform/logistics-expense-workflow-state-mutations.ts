import { prisma } from "../prisma";
import {
  codedError,
  LOGISTICS_BILL_STATUS_VOIDED,
  permissionError,
  runNonCriticalTask,
  writeAudit,
} from "./shared";
import {
  assertCanWriteLogisticsExpense,
  aggregateLogisticsExpenseStatus,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { canSubmitLogisticsBill, canWithdrawLogisticsBill } from "./logistics-bill-state-machine";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  loadLogisticsExpenseBillRowsForAction,
  loadLogisticsExpenseBillRowsForSubmit,
  lockLogisticsBillForWorkflow,
  rowAuditStatus,
  rowBillId,
  rowBillStatus,
  rowBillSubmittedAt,
  type ActorContext,
  type AuditRequestLike,
} from "./logistics-expense-workflow-core";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";

export async function withdrawLogisticsExpenseBill(request: AuditRequestLike, actor: ActorContext, identifier: unknown) {
  assertCanWriteLogisticsExpense(actor);
  const rows = await loadLogisticsExpenseBillRowsForSubmit(identifier, actor);
  if (!rows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  const billAuditStatus = aggregateLogisticsExpenseStatus(rows, "auditStatus");
  const billInvoiceStatus = aggregateLogisticsExpenseStatus(rows, "invoiceStatus");
  const billStatus = rowBillStatus(rows[0]);
  const billId = rowBillId(rows[0]);
  const canWithdraw = canWithdrawLogisticsBill({ auditStatus: billAuditStatus, status: billStatus });
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
  const orderId = String(rows[0]?.orderId || "");
  if (!rows[0]?.billId) throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
  await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      orderId,
      "该订单已提交退税并归档，不能撤回物流费用账单。",
    );
    await lockLogisticsBillForWorkflow(tx, billId);
    const billUpdate = await tx.logisticsBill.updateMany({
      where: {
        id: billId,
        deletedAt: null,
        status: { not: LOGISTICS_BILL_STATUS_VOIDED },
        auditStatus: "待审核",
      },
      data: {
        auditStatus: "草稿",
        submittedAt: null,
        submittedById: null,
        updatedById: actorId(actor),
      },
    });
    if (billUpdate.count !== 1) {
      throw codedError("账单状态已变化，撤回已取消，请刷新后重试。", 409, "LOGISTICS_EXPENSE_WITHDRAW_STATE_CHANGED");
    }
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
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
    const blocked = rows.find((row) => !canSubmitLogisticsBill({ auditStatus: rowAuditStatus(row), status: rowBillStatus(row) }));
    if (blocked) throw codedError("只有草稿或已驳回费用可以提交审核。", 400, "LOGISTICS_EXPENSE_SUBMIT_NOT_ALLOWED");
    const submittedAt = new Date();
    const ids = rows.map((row) => row.id).filter(Boolean);
    const orderId = String(rows[0]?.orderId || "");
    if (!rows[0]?.billId) throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
    await prisma.$transaction(async (tx) => {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能提交物流费用审核。",
      );
      await lockLogisticsBillForWorkflow(tx, billId);
      const billUpdate = await tx.logisticsBill.updateMany({
        where: {
          id: billId,
          deletedAt: null,
          status: { not: LOGISTICS_BILL_STATUS_VOIDED },
          auditStatus: { in: ["草稿", "已驳回"] },
          paymentStatus: { in: ["待开票", "未付款"] },
        },
        data: {
          auditStatus: "待审核",
          submittedAt,
          submittedById: actorId(actor) || null,
          rejectReason: null,
          invoiceNotificationError: null,
          updatedById: actorId(actor),
        },
      });
      if (billUpdate.count !== 1) {
        throw codedError("账单状态已变化，提交审核已取消，请刷新后重试。", 409, "LOGISTICS_EXPENSE_SUBMIT_STATE_CHANGED");
      }
    }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
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
