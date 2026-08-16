import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { codedError, nonEmpty } from "./shared";
import {
  aggregateLogisticsExpenseInvoiceStatus,
  createOrUpdateCostFromLogisticsExpense,
} from "./logistics-expense-shared";
import {
  actorId,
  groupLogisticsExpenseRowsByBillId,
  type ActorContext,
  type CostLink,
  type LogisticsExpenseRow,
} from "./logistics-expense-workflow-core";
import { assertNoSettledLogisticsCostConflict } from "./logistics-expense-cost-safety";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import type { LogisticsExpenseReviewTransactionStep } from "./logistics-expense-review-diagnostics";
import { assertOrderCostAllowedByTradeTerm } from "./trade-term-cost-policy";

export async function syncApprovedLogisticsBillWorkflowStates(
  tx: Prisma.TransactionClient,
  rows: LogisticsExpenseRow[] = [],
  actor: ActorContext,
) {
  for (const [billId, billRows] of groupLogisticsExpenseRowsByBillId(rows)) {
    const invoiceStatus = aggregateLogisticsExpenseInvoiceStatus(billRows);
    const paymentStatus = ["已确认", "已确认发票"].includes(invoiceStatus) ? "待付款" : "待开票";
    const billUpdate = await tx.logisticsBill.updateMany({
      where: {
        id: billId,
        deletedAt: null,
        status: { not: "voided" },
        auditStatus: "审核通过",
        paymentStatus: { notIn: ["已付款", "部分付款", "部分已付款"] },
      },
      data: {
        invoiceStatus,
        paymentStatus,
        updatedById: actorId(actor) || null,
      },
    });
    if (billUpdate.count !== 1) {
      throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_BILL_WORKFLOW_STATE_CHANGED");
    }
  }
}

export async function updateLogisticsExpenseCostIds(tx: Prisma.TransactionClient | typeof prisma, costLinks: CostLink[] = []) {
  const links = costLinks.filter((item) => item.expenseId && item.costId);
  if (!links.length) return;
  const expenseIds = [...new Set(links.map((item) => item.expenseId))];
  const costIds = [...new Set(links.map((item) => item.costId))];
  if (expenseIds.length !== links.length || costIds.length !== links.length) {
    throw codedError("物流费用成本关联不唯一，已取消同步。", 409, "LOGISTICS_COST_LINK_CONFLICT");
  }
  const cases = links.map((item) => Prisma.sql`WHEN ${item.expenseId} THEN ${item.costId}`);
  const updatedCount = await tx.$executeRaw(Prisma.sql`
    UPDATE "logistics_expenses"
    SET "cost_id" = CASE "id" ${Prisma.join(cases, " ")} END
    WHERE "id" IN (${Prisma.join(expenseIds)})
      AND "deleted_at" IS NULL
  `);
  if (updatedCount !== links.length) {
    throw codedError("物流费用明细状态已变化，成本同步已取消，请刷新后重试。", 409, "LOGISTICS_COST_LINK_CHANGED");
  }
}

export async function syncApprovedLogisticsExpenseCosts(
  tx: Prisma.TransactionClient,
  rows: LogisticsExpenseRow[] = [],
  actor: ActorContext,
  options: {
    settledCostMode?: "reject" | "preserve-required" | "preserve-existing";
    allowCommissionSettled?: boolean;
    orderLocksAlreadyHeld?: boolean;
    expectedOrderIds?: string[];
    onStep?: (step: LogisticsExpenseReviewTransactionStep) => void;
  } = {},
) {
  if (!rows.length) throw codedError("物流费用账单缺少费用明细，不能同步成本。", 409, "LOGISTICS_COST_SYNC_ROWS_EMPTY");
  rows.forEach((row) => assertOrderCostAllowedByTradeTerm(row.order?.tradeTerm, row.costType));
  options.onStep?.("order-scope");
  const orderIds = [...new Set(rows.map((row) => nonEmpty(row.orderId)).filter(Boolean))].sort();
  if (options.orderLocksAlreadyHeld) {
    const expectedOrderIds = [...new Set((options.expectedOrderIds || []).map(nonEmpty).filter(Boolean))].sort();
    if (orderIds.join("\n") !== expectedOrderIds.join("\n")) {
      throw codedError("物流费用关联订单已变化，成本同步已取消，请刷新后重试。", 409, "LOGISTICS_COST_ORDER_SCOPE_CHANGED");
    }
  } else {
    options.onStep?.("archive-commission-check");
    for (const orderId of orderIds) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能同步物流费用成本。",
      );
      if (!options.allowCommissionSettled) {
        await assertCommissionOrderWritableInTransaction(tx, orderId);
      }
    }
  }
  const settledCostMode = options.settledCostMode || "reject";
  options.onStep?.("settled-cost");
  if (settledCostMode === "reject") {
    await assertNoSettledLogisticsCostConflict(tx, rows);
  }
  options.onStep?.("cost-sync");
  const links: CostLink[] = [];
  for (const row of rows) {
    const cost = await createOrUpdateCostFromLogisticsExpense(tx, row, actor, {
      settledCostMode,
      commissionLockAlreadyHeld: true,
    });
    links.push({ expenseId: row.id, costId: cost.id, invoiceDocumentId: row.invoiceDocumentId || null });
  }
  options.onStep?.("cost-link");
  await updateLogisticsExpenseCostIds(tx, links);
  await linkLogisticsExpenseInvoiceDocumentsToCosts(tx, links);
  return links;
}

export async function linkLogisticsExpenseInvoiceDocumentsToCosts(tx: Prisma.TransactionClient | typeof prisma, costLinks: CostLink[] = []) {
  const linksByDocumentId = new Map<string, CostLink>();
  for (const link of costLinks) {
    const documentId = nonEmpty(link.invoiceDocumentId);
    if (link.expenseId && link.costId && documentId && !linksByDocumentId.has(documentId)) {
      linksByDocumentId.set(documentId, { ...link, invoiceDocumentId: documentId });
    }
  }
  for (const link of linksByDocumentId.values()) {
    await tx.orderDocument.updateMany({
      where: {
        id: link.invoiceDocumentId || "",
        deletedAt: null,
      },
      data: { costId: link.costId },
    });
    await tx.fileAsset.updateMany({
      where: {
        isDeleted: false,
        OR: [
          { orderDocumentId: link.invoiceDocumentId || "" },
          { logisticsExpenseId: link.expenseId },
        ],
      },
      data: { costId: link.costId },
    });
  }
}
