import { prisma } from "../prisma";
import {
  LOGISTICS_FEE_COST_SOURCE_TYPE,
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  ORDER_COST_STATUS_VOID,
} from "./shared";
import { createOrUpdateCostFromLogisticsExpense } from "./logistics-expense-access-mutations";
import { logisticsCostPaymentDataFromExpense } from "./logistics-expense-cost-payment";
import { linkLogisticsExpenseInvoiceDocumentsToCosts } from "./logistics-expense-workflow-review-helpers";
import {
  assertCommissionOrderWritableInTransaction,
  isCommissionSettled,
} from "./commission-settlement-lock";
import {
  assertBusinessOrderWritableInTransaction,
  isBusinessArchived,
} from "./business-archive";
import {
  logisticsInvoiceStatusForCost,
  orderScopeWhere,
  repairCostSelect,
  repairExpenseSelect,
  repairIssue,
  uniqueCandidateCosts,
  type RepairInput,
  type RepairIssue,
} from "./repair-logistics-cost-links-support";

export async function repairLogisticsCostLinks(input: RepairInput = {}) {
  const dryRun = input.dryRun !== false;
  const createMissing = input.createMissing === true;
  const limit = Math.max(1, Math.min(Number(input.limit || 1000), 5000));
  const expenses = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      OR: [
        { bill: { is: { auditStatus: "审核通过", deletedAt: null } } },
        { auditStatus: "审核通过" },
      ],
      ...orderScopeWhere(input),
    },
    select: repairExpenseSelect,
    orderBy: [{ createdAt: "asc" }],
    take: limit,
  });

  const orderIds = [...new Set(expenses.map((row) => row.orderId).filter(Boolean))];
  const supplierIds = [...new Set(expenses.map((row) => row.supplierId).filter(Boolean))];
  const costs = orderIds.length && supplierIds.length
    ? await prisma.orderCost.findMany({
      where: {
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
        orderId: { in: orderIds },
        supplierId: { in: supplierIds },
        sourceType: { in: LOGISTICS_GENERATED_COST_SOURCE_TYPES },
      },
      select: repairCostSelect,
      take: limit * 5,
    })
    : [];

  const issues: RepairIssue[] = [];
  const repaired: Array<{ logisticsFeeId: string; costId: string }> = [];
  const createdMissing: Array<{ logisticsFeeId: string; costId: string }> = [];
  const syncedPayment: Array<{ logisticsFeeId: string; costId: string; paymentStatus: string }> = [];
  const skipped: Array<{ logisticsFeeId: string; costId: string; reason: string }> = [];
  const usedCostIds = new Set<string>();

  for (const expense of expenses) {
    if (isCommissionSettled(expense.order)) {
      issues.push(repairIssue(expense, "业务员提成已结算，未修改正式成本；如需调整请先走撤销结算流程。"));
      continue;
    }
    if (isBusinessArchived(expense.order)) {
      issues.push(repairIssue(expense, "订单已提交退税并归档，未修改正式成本；如需调整请先取消归档。"));
      continue;
    }
    const linkedCost = expense.costId ? costs.find((cost) => cost.id === expense.costId) : null;
    if (linkedCost && linkedCost.sourceType === LOGISTICS_FEE_COST_SOURCE_TYPE && linkedCost.sourceId === expense.id) {
      skipped.push({ logisticsFeeId: expense.id, costId: linkedCost.id, reason: "already-linked" });
      if (!dryRun) {
        const paymentData = logisticsCostPaymentDataFromExpense(expense);
        await prisma.$transaction(async (tx) => {
          await assertBusinessOrderWritableInTransaction(
            tx,
            expense.orderId,
            "该订单已提交退税并归档，不能运行物流成本关联修复。",
          );
          await assertCommissionOrderWritableInTransaction(tx, expense.orderId);
          await tx.orderCost.update({
            where: { id: linkedCost.id },
            data: {
              invoiceStatus: logisticsInvoiceStatusForCost(expense),
              paymentStatus: paymentData.paymentStatus,
              paid: paymentData.paid,
              paidAt: paymentData.paidAt,
              paymentDate: paymentData.paymentDate,
            },
          });
        });
        syncedPayment.push({ logisticsFeeId: expense.id, costId: linkedCost.id, paymentStatus: paymentData.paymentStatus });
      }
      continue;
    }

    const candidates = linkedCost ? [linkedCost] : uniqueCandidateCosts(costs, expense)
      .filter((cost) => !usedCostIds.has(cost.id) || cost.id === expense.costId);
    if (candidates.length !== 1) {
      if (!candidates.length && createMissing) {
        if (dryRun) {
          createdMissing.push({ logisticsFeeId: expense.id, costId: "__would_create__" });
          continue;
        }
        const cost = await prisma.$transaction(async (tx) => {
          const createdCost = await createOrUpdateCostFromLogisticsExpense(tx, expense, { id: null, role: "系统修复" });
          await tx.logisticsExpense.update({
            where: { id: expense.id },
            data: { costId: createdCost.id },
          });
          await linkLogisticsExpenseInvoiceDocumentsToCosts(tx, [{
            expenseId: expense.id,
            costId: createdCost.id,
            invoiceDocumentId: expense.invoiceDocumentId || null,
          }]);
          return createdCost;
        });
        createdMissing.push({ logisticsFeeId: expense.id, costId: cost.id });
        continue;
      }
      issues.push(repairIssue(expense, candidates.length ? "匹配到多条成本，未自动修复。" : "未找到唯一成本，未自动修复。", candidates));
      continue;
    }

    const cost = candidates[0];
    usedCostIds.add(cost.id);
    repaired.push({ logisticsFeeId: expense.id, costId: cost.id });
    if (dryRun) continue;

    await prisma.$transaction(async (tx) => {
      await assertBusinessOrderWritableInTransaction(
        tx,
        expense.orderId,
        "该订单已提交退税并归档，不能运行物流成本关联修复。",
      );
      await assertCommissionOrderWritableInTransaction(tx, expense.orderId);
      await tx.orderCost.update({
        where: { id: cost.id },
        data: {
          sourceType: LOGISTICS_FEE_COST_SOURCE_TYPE,
          sourceId: expense.id,
          invoiceStatus: logisticsInvoiceStatusForCost(expense),
          ...logisticsCostPaymentDataFromExpense(expense),
        },
      });
      await tx.logisticsExpense.update({
        where: { id: expense.id },
        data: { costId: cost.id },
      });
      await linkLogisticsExpenseInvoiceDocumentsToCosts(tx, [{
        expenseId: expense.id,
        costId: cost.id,
        invoiceDocumentId: expense.invoiceDocumentId || null,
      }]);
    });
  }

  return {
    source: input.source || "repair-logistics-cost-links",
    dryRun,
    createMissing,
    scanned: expenses.length,
    repaired: repaired.length,
    createdMissing: createdMissing.length,
    syncedPayment: syncedPayment.length,
    skipped: skipped.length,
    issues,
    repairedLinks: repaired,
    createdMissingLinks: createdMissing,
    syncedPaymentLinks: syncedPayment,
    skippedLinks: skipped,
  };
}
