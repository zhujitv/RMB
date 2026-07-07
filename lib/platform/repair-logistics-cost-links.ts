import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  LOGISTICS_FEE_COST_SOURCE_TYPE,
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  ORDER_COST_STATUS_VOID,
  nonEmpty,
  normalizedCostType,
} from "./shared";
import { createOrUpdateCostFromLogisticsExpense } from "./logistics-expense-access-mutations";
import { logisticsCostPaymentDataFromExpense } from "./logistics-expense-cost-payment";
import { linkLogisticsExpenseInvoiceDocumentsToCosts } from "./logistics-expense-workflow-review-helpers";

type RepairInput = {
  orderNos?: string[];
  orderIds?: string[];
  logisticsFeeIds?: string[];
  limit?: number;
  dryRun?: boolean;
  createMissing?: boolean;
  source?: string;
};

type RepairIssue = {
  logisticsFeeId: string;
  orderId: string;
  orderNo: string;
  supplierId: string;
  supplierName: string;
  feeType: string;
  amount: number;
  amountCny: number;
  shipmentId: string;
  reason: string;
  candidateCostIds: string[];
};

function amountKey(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function logisticsInvoiceStatusForCost(expense: RepairExpenseRow) {
  const status = nonEmpty(expense.invoiceStatus || expense.bill?.invoiceStatus);
  if (expense.invoiceDocumentId || ["已上传", "已确认", "已上传发票", "已确认发票", "已收到"].includes(status)) return "已收到";
  return "未收到";
}

function orderScopeWhere(input: RepairInput): Prisma.LogisticsExpenseWhereInput {
  const logisticsFeeIds = (input.logisticsFeeIds || []).map(nonEmpty).filter(Boolean);
  if (logisticsFeeIds.length) return { id: { in: logisticsFeeIds } };
  const orderIds = (input.orderIds || []).map(nonEmpty).filter(Boolean);
  const orderNos = (input.orderNos || []).map(nonEmpty).filter(Boolean);
  if (!orderIds.length && !orderNos.length) return {};
  return {
    OR: [
      ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
      ...(orderNos.length ? [{ order: { is: { orderNo: { in: orderNos } } } }] : []),
    ],
  };
}

function uniqueCandidateCosts(costs: RepairCostRow[], expense: RepairExpenseRow) {
  const direct = costs.filter((cost) => nonEmpty(cost.sourceId) === expense.id);
  if (direct.length) return direct;
  return costs.filter((cost) => (
    cost.orderId === expense.orderId
    && cost.supplierId === expense.supplierId
    && normalizedCostType(nonEmpty(cost.costType)) === normalizedCostType(nonEmpty(expense.costType))
    && nonEmpty(cost.currency || "CNY").toUpperCase() === nonEmpty(expense.currency || "CNY").toUpperCase()
    && amountKey(cost.amount) === amountKey(expense.amount)
    && amountKey(cost.amountCny) === amountKey(expense.amountCny)
  ));
}

const repairExpenseSelect = Prisma.validator<Prisma.LogisticsExpenseSelect>()({
  id: true,
  billId: true,
  orderId: true,
  supplierId: true,
  costId: true,
  costType: true,
  currency: true,
  amount: true,
  amountCny: true,
  exchangeRate: true,
  exchangeRateDate: true,
  exchangeRateSource: true,
  exchangeRateType: true,
  supplierNameSnapshot: true,
  remark: true,
  invoiceStatus: true,
  invoiceDocumentId: true,
  createdAt: true,
  reviewedAt: true,
  bill: {
    select: {
      id: true,
      billOfLadingNo: true,
      auditStatus: true,
      invoiceStatus: true,
      paymentStatus: true,
      paymentDate: true,
      reviewedAt: true,
    },
  },
  order: {
    select: {
      id: true,
      orderNo: true,
    },
  },
  supplier: {
    select: {
      id: true,
      supplierName: true,
    },
  },
});

const repairCostSelect = Prisma.validator<Prisma.OrderCostSelect>()({
  id: true,
  orderId: true,
  supplierId: true,
  costType: true,
  currency: true,
  amount: true,
  amountCny: true,
  sourceType: true,
  sourceId: true,
  deletedAt: true,
  status: true,
});

type RepairExpenseRow = Prisma.LogisticsExpenseGetPayload<{ select: typeof repairExpenseSelect }>;
type RepairCostRow = Prisma.OrderCostGetPayload<{ select: typeof repairCostSelect }>;

function repairIssue(expense: RepairExpenseRow, reason: string, candidateCosts: RepairCostRow[] = []): RepairIssue {
  return {
    logisticsFeeId: expense.id,
    orderId: expense.orderId,
    orderNo: expense.order?.orderNo || "",
    supplierId: expense.supplierId,
    supplierName: expense.supplier?.supplierName || "",
    feeType: normalizedCostType(nonEmpty(expense.costType)),
    amount: Number(expense.amount || 0),
    amountCny: Number(expense.amountCny || 0),
    shipmentId: nonEmpty(expense.billId || expense.bill?.billOfLadingNo),
    reason,
    candidateCostIds: candidateCosts.map((cost) => cost.id),
  };
}

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
    const linkedCost = expense.costId ? costs.find((cost) => cost.id === expense.costId) : null;
    if (linkedCost && linkedCost.sourceType === LOGISTICS_FEE_COST_SOURCE_TYPE && linkedCost.sourceId === expense.id) {
      skipped.push({ logisticsFeeId: expense.id, costId: linkedCost.id, reason: "already-linked" });
      if (!dryRun) {
        const paymentData = logisticsCostPaymentDataFromExpense(expense);
        await prisma.orderCost.update({
          where: { id: linkedCost.id },
          data: {
            invoiceStatus: logisticsInvoiceStatusForCost(expense),
            paymentStatus: paymentData.paymentStatus,
            paid: paymentData.paid,
            paidAt: paymentData.paidAt,
            paymentDate: paymentData.paymentDate,
          },
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
        const cost = await createOrUpdateCostFromLogisticsExpense(prisma, expense, { id: null, role: "系统修复" });
        await prisma.logisticsExpense.update({
          where: { id: expense.id },
          data: { costId: cost.id },
        });
        await linkLogisticsExpenseInvoiceDocumentsToCosts(prisma, [{
          expenseId: expense.id,
          costId: cost.id,
          invoiceDocumentId: expense.invoiceDocumentId || null,
        }]);
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

    await prisma.orderCost.update({
      where: { id: cost.id },
      data: {
        sourceType: LOGISTICS_FEE_COST_SOURCE_TYPE,
        sourceId: expense.id,
        invoiceStatus: logisticsInvoiceStatusForCost(expense),
        ...logisticsCostPaymentDataFromExpense(expense),
      },
    });
    await prisma.logisticsExpense.update({
      where: { id: expense.id },
      data: { costId: cost.id },
    });
    await linkLogisticsExpenseInvoiceDocumentsToCosts(prisma, [{
      expenseId: expense.id,
      costId: cost.id,
      invoiceDocumentId: expense.invoiceDocumentId || null,
    }]);
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
