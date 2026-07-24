import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  codedError,
  nonEmpty,
  optional,
  requireText,
  runNonCriticalTask,
  writeAudit,
} from "./shared";
import {
  assertCanReviewLogisticsExpense,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { canRejectLogisticsBill } from "./logistics-bill-state-machine";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  assertWorkflowActor,
  loadLogisticsExpenseBillRowsForAction,
  rowAuditStatus,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";

export async function rejectLogisticsExpenseBill(request: AuditRequestLike, actor: ActorContext, identifier: unknown, input: UnknownRecord = {}) {
  assertCanReviewLogisticsExpense(actor);
  assertWorkflowActor(actor);
  const rejectReason = requireText(input.rejectReason || input.reason, "驳回原因");
  const reviewRemark = optional(input.reviewRemark || input.remark);
  const rows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  if (!rows.length) throw codedError("未找到可驳回的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  for (const row of rows) {
    if (!canRejectLogisticsBill({ auditStatus: rowAuditStatus(row) })) {
      throw codedError(`账单 ${row.order?.orderNo || row.orderId || ""}/${row.order?.blNo || "-"} 中存在非待审核费用，不能驳回。`, 400, "LOGISTICS_EXPENSE_BILL_STATUS_INVALID");
    }
  }
  const now = new Date();
  const billId = rowBillId(rows[0]);
  const orderId = nonEmpty(rows[0]?.orderId);
  if (rows[0]?.billId) {
    await prisma.$transaction(async (tx) => {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能驳回物流费用账单。",
      );
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "logistics_bills"
        WHERE "id" = ${billId}
          AND "deleted_at" IS NULL
          AND "status" <> 'voided'
        FOR UPDATE
      `);
      if (locked.length !== 1) {
        throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_BILL_WORKFLOW_LOCK_FAILED");
      }
      const billUpdate = await tx.logisticsBill.updateMany({
        where: {
          id: billId,
          deletedAt: null,
          status: { not: "voided" },
          auditStatus: "待审核",
          paymentStatus: { in: ["待开票", "未付款"] },
        },
        data: {
          auditStatus: "已驳回",
          reviewedById: actor.id,
          reviewedAt: now,
          reviewRemark,
          rejectReason,
          invoiceNotifiedAt: null,
          invoiceNotificationError: null,
          updatedById: actorId(actor),
        },
      });
      if (billUpdate.count !== 1) {
        throw codedError("账单状态已变化，驳回已取消，请刷新后重试。", 409, "LOGISTICS_EXPENSE_REJECT_STATE_CHANGED");
      }
    }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  } else {
    throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
  }
  const savedRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  invalidateWorkbenchTodosCache();
  await runNonCriticalTask("物流费用账单驳回日志写入", () => writeAudit(request, actor, "驳回物流费用账单", "logistics_bills", billId, rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(savedRows),
    rejectReason,
    rejectedById: actorId(actor),
    rejectedAt: now,
  }));
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
  };
}
