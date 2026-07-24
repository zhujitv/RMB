import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  codedError,
  nonEmpty,
  optional,
  runNonCriticalTask,
  writeAudit,
} from "./shared";
import {
  assertCanReviewLogisticsExpense,
  aggregateLogisticsExpenseStatus,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  groupLogisticsExpenseRowsByBillId,
  loadLogisticsExpenseBillRowsForAction,
  reloadLogisticsExpenseRowsForBillIds,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { rejectLogisticsExpenseBill } from "./logistics-expense-review-reject";
import { reviewLogisticsExpenseBills } from "./logistics-expense-review-batch";
import type { LogisticsExpenseReviewExecutionOptions } from "./logistics-expense-review-types";

export async function getLogisticsExpenseReviewStatuses(
  actor: ActorContext,
  billIds: unknown[] = [],
) {
  assertCanReviewLogisticsExpense(actor);
  const ids = [...new Set(billIds.map(nonEmpty).filter(Boolean))];
  if (!ids.length) {
    throw codedError("请选择需要核验的物流费用账单。", 400, "LOGISTICS_EXPENSE_REVIEW_STATUS_EMPTY");
  }
  if (ids.length > 100) {
    throw codedError("单次最多核验 100 票物流费用账单。", 400, "LOGISTICS_EXPENSE_REVIEW_STATUS_LIMIT");
  }

  const rows = await reloadLogisticsExpenseRowsForBillIds(ids, actor);
  const rowsByBillId = groupLogisticsExpenseRowsByBillId(rows);
  const missingIds = ids.filter((billId) => !rowsByBillId.get(billId)?.length);
  if (missingIds.length) {
    throw codedError(
      "部分物流费用账单不存在或已不可访问，请刷新后确认。",
      404,
      "LOGISTICS_EXPENSE_REVIEW_STATUS_NOT_FOUND",
    );
  }

  return {
    results: ids.map((billId) => ({
      billId,
      auditStatus: aggregateLogisticsExpenseStatus(rowsByBillId.get(billId) || [], "auditStatus"),
    })),
    bills: ids.map((billId) => serializeLogisticsExpenseBill(rowsByBillId.get(billId) || [])),
  };
}

export async function reviewLogisticsExpense(
  request: AuditRequestLike,
  actor: ActorContext,
  id: string,
  input: UnknownRecord = {},
  options: LogisticsExpenseReviewExecutionOptions = {},
) {
  assertCanReviewLogisticsExpense(actor);
  const action = nonEmpty(input.action || input.reviewAction || input.auditAction);
  if (!["approve", "reject", "reopen"].includes(action)) throw codedError("请选择有效审核动作。", 400, "LOGISTICS_EXPENSE_ACTION_REQUIRED");
  if (action === "reject" && !nonEmpty(input.rejectReason || input.reason)) {
    throw codedError("驳回物流费用必须填写原因。", 400, "LOGISTICS_EXPENSE_REJECT_REASON_REQUIRED");
  }
  if (action === "approve") {
    const result = await reviewLogisticsExpenseBills(request, actor, { ...input, action, ids: [id] }, options);
    if (result.success === false) {
      throw codedError(result.message || "审核物流费用失败。", 400, "LOGISTICS_EXPENSE_REVIEW_FAILED");
    }
    const firstExpense = result.expenses[0] || result.bills[0]?.items?.[0] || null;
    return {
      expense: firstExpense || null,
      bill: result.bills[0] || null,
      emailNotified: result.emailNotified,
      emailError: result.emailError,
      emailResults: result.emailResults,
      notificationQueued: result.notificationQueued,
    };
  }
  if (action === "reject") {
    const result = await rejectLogisticsExpenseBill(request, actor, id, input);
    const firstExpense = result.expenses[0] || result.bill?.items?.[0] || null;
    return {
      expense: firstExpense || null,
      bill: result.bill || null,
      expenses: result.expenses,
      emailNotified: false,
      emailError: "",
    };
  }
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  if (!rows.length) throw codedError("未找到可重新打开的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  const billId = rowBillId(rows[0]);
  const orderId = nonEmpty(rows[0]?.orderId);
  const reviewRemark = optional(input.reviewRemark || input.remark);
  if (rows[0]?.billId) {
    await prisma.$transaction(async (tx) => {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能重新打开物流费用账单。",
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
      const currentBill = await tx.logisticsBill.findUnique({ where: { id: billId } });
      const paymentCanReopen = ["待开票", "未付款"].includes(nonEmpty(currentBill?.paymentStatus));
      if (currentBill?.auditStatus !== "已驳回" || !paymentCanReopen) {
        throw codedError("只有已驳回且未进入付款流程的账单可以重新打开；已付款账单请先执行付款冲销。", 409, "LOGISTICS_EXPENSE_REOPEN_STATE_INVALID");
      }
      const billUpdate = await tx.logisticsBill.updateMany({
        where: {
          id: billId,
          deletedAt: null,
          status: { not: "voided" },
          auditStatus: "已驳回",
          paymentStatus: { in: ["待开票", "未付款"] },
        },
        data: {
          auditStatus: "待审核",
          reviewedById: null,
          reviewedAt: null,
          rejectReason: null,
          reviewRemark,
          updatedById: actorId(actor),
        },
      });
      if (billUpdate.count !== 1) {
        throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_EXPENSE_REOPEN_STATE_CHANGED");
      }
    }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  } else {
    throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
  }
  const savedRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  invalidateWorkbenchTodosCache();
  await runNonCriticalTask("物流费用审核日志写入", () => writeAudit(request, actor, "重新打开物流费用账单", "logistics_bills", billId, rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(savedRows),
  }));
  return {
    expense: savedRows[0] ? serializeLogisticsExpense(savedRows[0]) : null,
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
    emailNotified: false,
    emailError: "",
  };
}
