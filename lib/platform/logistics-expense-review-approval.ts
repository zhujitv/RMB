import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { codedError, nonEmpty } from "./shared";
import {
  aggregateLogisticsExpenseInvoiceStatus,
  includeLogisticsExpenseRelations,
} from "./logistics-expense-shared";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  assertLogisticsBillRowsMatchHeader,
  assertWorkflowActor,
  groupLogisticsExpenseRowsByBillId,
  lockLogisticsBillForWorkflow,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
  type LogisticsExpenseRow,
} from "./logistics-expense-workflow-core";
import { createLogisticsInvoiceApprovalOutboxIntents } from "./logistics-invoice-notification-outbox";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import {
  syncApprovedLogisticsBillWorkflowStates,
  syncApprovedLogisticsExpenseCosts,
} from "./logistics-expense-review-cost-sync";

export type LogisticsExpenseApprovalAuditEntry = {
  billId: string;
  before: { auditStatus: string };
  after: Record<string, unknown>;
};

export async function approveLogisticsExpenseBillsInTransaction(
  _request: AuditRequestLike,
  billIds: string[] = [],
  actor: ActorContext,
  reviewRemark: string | null | undefined,
  now = new Date(),
) {
  assertWorkflowActor(actor);
  const ids = [...new Set(billIds.map(nonEmpty).filter(Boolean))].sort();
  if (!ids.length) return;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '5s'`);
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '12s'`);
    const orderRows = await tx.logisticsExpense.findMany({
      where: { billId: { in: ids }, deletedAt: null },
      select: { orderId: true },
      distinct: ["orderId"],
    });
    const orderIds = [...new Set(orderRows.map((row) => nonEmpty(row.orderId)).filter(Boolean))].sort();
    for (const orderId of orderIds) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能审核物流费用。",
      );
      await assertCommissionOrderWritableInTransaction(tx, orderId);
    }
    for (const billId of ids) {
      await lockLogisticsBillForWorkflow(tx, billId);
    }
    const billUpdate = await tx.logisticsBill.updateMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        status: { not: "voided" },
        auditStatus: "待审核",
        paymentStatus: { notIn: ["已付款", "部分付款", "部分已付款"] },
      },
      data: {
        auditStatus: "审核通过",
        reviewedById: actor.id,
        reviewedAt: now,
        reviewRemark,
        rejectReason: null,
        invoiceNotificationError: null,
        paymentStatus: "待开票",
        invoiceStatus: "待开票",
        updatedById: actorId(actor),
      },
    });
    if (billUpdate.count !== ids.length) {
      throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_BILL_STATUS_CHANGED");
    }
    const rows = await tx.logisticsExpense.findMany({
      where: {
        billId: { in: ids },
        deletedAt: null,
      },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ billId: "asc" }, { createdAt: "asc" }],
      take: ids.length * 500,
    });
    const expectedRowCount = await tx.logisticsExpense.count({
      where: { billId: { in: ids }, deletedAt: null },
    });
    const rowsByBillId = groupLogisticsExpenseRowsByBillId(rows);
    if (
      rows.length !== expectedRowCount
      || rowsByBillId.size !== ids.length
      || ids.some((billId) => !rowsByBillId.has(billId))
    ) {
      throw codedError("物流费用账单明细不完整，审核已取消，请刷新后重试。", 409, "LOGISTICS_BILL_ROWS_INCOMPLETE");
    }
    for (const [billId, billRows] of rowsByBillId) {
      await assertLogisticsBillRowsMatchHeader(tx, billId, billRows);
    }
    const costLinks = await syncApprovedLogisticsExpenseCosts(tx, rows, actor, {
      orderLocksAlreadyHeld: true,
      expectedOrderIds: orderIds,
    });
    await syncApprovedLogisticsBillWorkflowStates(tx, rows, actor);
    const outboxIntents = await createLogisticsInvoiceApprovalOutboxIntents(tx, rows, actorId(actor), now);
    if (outboxIntents.length !== ids.length) {
      throw codedError("物流开票通知任务未完整入队，审核已取消。", 409, "LOGISTICS_INVOICE_OUTBOX_INCOMPLETE");
    }
    const auditEntries: LogisticsExpenseApprovalAuditEntry[] = [];
    for (const [billId, billRows] of rowsByBillId) {
      auditEntries.push({ billId, before: { auditStatus: "待审核" }, after: {
        auditStatus: "审核通过",
        invoiceStatus: aggregateLogisticsExpenseInvoiceStatus(billRows),
        paymentStatus: "待开票",
        reviewedAt: now,
        reviewRemark: reviewRemark || "",
        notificationOutboxId: outboxIntents.find((item) => item.idempotencyKey.includes(`:${billId}:`))?.id || "",
      } });
    }
    return { outboxIntents, costLinks, auditEntries };
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
}

export async function approveLogisticsExpenseBillRowsInTransaction(
  _request: AuditRequestLike,
  rows: LogisticsExpenseRow[] = [],
  actor: ActorContext,
  reviewRemark: string | null | undefined,
  now = new Date(),
) {
  assertWorkflowActor(actor);
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return;
  const billId = rowBillId(rows[0]);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '5s'`);
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '12s'`);
    if (rows[0]?.billId) {
      const orderIds = [...new Set(rows.map((row) => nonEmpty(row.orderId)).filter(Boolean))].sort();
      for (const orderId of orderIds) {
        await assertBusinessOrderWritableInTransaction(
          tx,
          orderId,
          "该订单已提交退税并归档，不能审核物流费用。",
        );
        await assertCommissionOrderWritableInTransaction(tx, orderId);
      }
      await lockLogisticsBillForWorkflow(tx, billId);
      const billUpdate = await tx.logisticsBill.updateMany({
        where: {
          id: billId,
          deletedAt: null,
          status: { not: "voided" },
          auditStatus: "待审核",
          paymentStatus: { notIn: ["已付款", "部分付款", "部分已付款"] },
        },
        data: {
          auditStatus: "审核通过",
          reviewedById: actor.id,
          reviewedAt: now,
          reviewRemark,
          rejectReason: null,
          invoiceNotificationError: null,
          paymentStatus: "待开票",
          invoiceStatus: "待开票",
          updatedById: actorId(actor),
        },
      });
      if (billUpdate.count !== 1) {
        throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_BILL_STATUS_CHANGED");
      }
      const savedRows = await tx.logisticsExpense.findMany({
        where: {
          id: { in: ids },
          deletedAt: null,
        },
        include: includeLogisticsExpenseRelations(),
        orderBy: [{ createdAt: "asc" }],
        take: ids.length,
      });
      const expectedRowCount = await tx.logisticsExpense.count({
        where: { billId, deletedAt: null },
      });
      if (savedRows.length !== expectedRowCount || savedRows.length !== ids.length) {
        throw codedError("物流费用账单明细不完整，审核已取消，请刷新后重试。", 409, "LOGISTICS_BILL_ROWS_INCOMPLETE");
      }
      await assertLogisticsBillRowsMatchHeader(tx, billId, savedRows);
      const costLinks = await syncApprovedLogisticsExpenseCosts(tx, savedRows, actor, {
        orderLocksAlreadyHeld: true,
        expectedOrderIds: orderIds,
      });
      await syncApprovedLogisticsBillWorkflowStates(tx, savedRows, actor);
      const outboxIntents = await createLogisticsInvoiceApprovalOutboxIntents(tx, savedRows, actorId(actor), now);
      if (outboxIntents.length !== 1) {
        throw codedError("物流开票通知任务未完整入队，审核已取消。", 409, "LOGISTICS_INVOICE_OUTBOX_INCOMPLETE");
      }
      const auditEntries: LogisticsExpenseApprovalAuditEntry[] = [{ billId, before: { auditStatus: "待审核" }, after: {
        auditStatus: "审核通过",
        invoiceStatus: aggregateLogisticsExpenseInvoiceStatus(savedRows),
        paymentStatus: "待开票",
        reviewedAt: now,
        reviewRemark: reviewRemark || "",
        notificationOutboxId: outboxIntents[0]?.id || "",
      } }];
      return { outboxIntents, costLinks, auditEntries };
    }
    throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
}
