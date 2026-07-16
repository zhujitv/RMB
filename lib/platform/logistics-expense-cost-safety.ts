import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  ORDER_COST_STATUS_VOID,
} from "./shared-constants";
import { codedError, nonEmpty } from "./shared";

type LogisticsCostSafetyRow = {
  id?: unknown;
  costId?: unknown;
  orderId?: unknown;
  supplierId?: unknown;
};

type LogisticsCostSettlementLike = {
  paid?: unknown;
  paymentStatus?: unknown;
  paidAt?: unknown;
  paymentDate?: unknown;
};

const SETTLED_COST_PAYMENT_STATUSES = ["已支付", "部分支付", "已付款", "部分付款"];

export function logisticsCostHasSettlementEvidence(cost: LogisticsCostSettlementLike | null | undefined) {
  return Boolean(cost?.paid)
    || SETTLED_COST_PAYMENT_STATUSES.includes(nonEmpty(cost?.paymentStatus))
    || Boolean(cost?.paidAt)
    || Boolean(cost?.paymentDate);
}

export async function findSettledLogisticsCostConflict(
  tx: Prisma.TransactionClient | typeof prisma,
  rows: LogisticsCostSafetyRow[] = [],
) {
  const expenseIds = [...new Set(rows.map((row) => nonEmpty(row.id)).filter(Boolean))];
  const costIds = [...new Set(rows.map((row) => nonEmpty(row.costId)).filter(Boolean))];
  const linkFilters: Prisma.OrderCostWhereInput[] = [];
  if (costIds.length) linkFilters.push({ id: { in: costIds } });
  if (expenseIds.length) {
    linkFilters.push({
      sourceType: { in: [...LOGISTICS_GENERATED_COST_SOURCE_TYPES] },
      sourceId: { in: expenseIds },
    });
  }
  if (!linkFilters.length) return null;
  return tx.orderCost.findFirst({
    where: {
      AND: [
        { OR: linkFilters },
        {
          OR: [
            { paid: true },
            { paymentStatus: { in: SETTLED_COST_PAYMENT_STATUSES } },
            { paidAt: { not: null } },
            { paymentDate: { not: null } },
          ],
        },
      ],
    },
    select: { id: true, sourceId: true, paymentStatus: true, paid: true, paidAt: true, paymentDate: true },
  });
}

export async function assertNoSettledLogisticsCostConflict(
  tx: Prisma.TransactionClient | typeof prisma,
  rows: LogisticsCostSafetyRow[] = [],
) {
  const conflict = await findSettledLogisticsCostConflict(tx, rows);
  if (conflict) {
    throw codedError(
      "关联正式成本已存在付款记录，已阻止自动覆盖，请先核对账单状态；如需更正请使用付款冲销。",
      409,
      "LOGISTICS_COST_PAYMENT_STATE_CONFLICT",
    );
  }
}

export async function syncLogisticsExpenseCostInvoiceStatus(
  tx: Prisma.TransactionClient | typeof prisma,
  rows: LogisticsCostSafetyRow[] = [],
  invoiceStatus: "已收到" | "未收到",
  updatedById?: string | null,
) {
  const expenseIds = [...new Set(rows.map((row) => nonEmpty(row.id)).filter(Boolean))];
  const directCostIds = [...new Set(rows.map((row) => nonEmpty(row.costId)).filter(Boolean))];
  if (!expenseIds.length) return [];
  const costs = await tx.orderCost.findMany({
    where: {
      deletedAt: null,
      status: { not: ORDER_COST_STATUS_VOID },
      OR: [
        ...(directCostIds.length ? [{ id: { in: directCostIds } }] : []),
        {
          sourceType: { in: [...LOGISTICS_GENERATED_COST_SOURCE_TYPES] },
          sourceId: { in: expenseIds },
        },
      ],
    },
  });
  const links: Array<{ expenseId: string; costId: string; needsBackfill: boolean }> = [];
  for (const row of rows) {
    const expenseId = nonEmpty(row.id);
    if (!expenseId) continue;
    const directCostId = nonEmpty(row.costId);
    const directCost = directCostId ? costs.find((cost) => cost.id === directCostId) : null;
    const sourceCosts = costs.filter((cost) => (
      LOGISTICS_GENERATED_COST_SOURCE_TYPES.includes(cost.sourceType)
      && cost.sourceId === expenseId
    ));
    const candidates = [...new Map(
      [...(directCost ? [directCost] : []), ...sourceCosts].map((cost) => [cost.id, cost]),
    ).values()];
    if (candidates.length > 1) {
      throw codedError("同一物流费用关联了多条有效成本，发票状态同步已取消。", 409, "LOGISTICS_COST_SOURCE_DUPLICATE");
    }
    const cost = candidates[0];
    if (!cost) continue;
    const sourceMatches = LOGISTICS_GENERATED_COST_SOURCE_TYPES.includes(cost.sourceType)
      && cost.sourceId === expenseId;
    const scopeMatches = cost.orderId === nonEmpty(row.orderId)
      && (!cost.supplierId || cost.supplierId === nonEmpty(row.supplierId));
    if (!sourceMatches || !scopeMatches) {
      throw codedError(
        "物流费用关联的成本来源、订单或供应商不一致，发票状态同步已取消。",
        409,
        "LOGISTICS_COST_LINK_SCOPE_MISMATCH",
      );
    }
    if (logisticsCostHasSettlementEvidence(cost)) {
      throw codedError(
        "关联正式成本已存在付款记录，已阻止修改发票状态，请先核对账单状态。",
        409,
        "LOGISTICS_COST_PAYMENT_STATE_CONFLICT",
      );
    }
    links.push({ expenseId, costId: cost.id, needsBackfill: directCostId !== cost.id });
  }
  const costIds = [...new Set(links.map((link) => link.costId))];
  if (costIds.length !== links.length) {
    throw codedError("多条物流费用错误关联到同一正式成本，发票状态同步已取消。", 409, "LOGISTICS_COST_LINK_CONFLICT");
  }
  if (costIds.length) {
    const updated = await tx.orderCost.updateMany({
      where: {
        id: { in: costIds },
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
        paid: false,
        paymentStatus: { notIn: SETTLED_COST_PAYMENT_STATUSES },
        paidAt: null,
        paymentDate: null,
      },
      data: { invoiceStatus, updatedById: updatedById || null },
    });
    if (updated.count !== costIds.length) {
      throw codedError("正式成本付款或发票状态已变化，请刷新后重试。", 409, "LOGISTICS_COST_INVOICE_STATE_CHANGED");
    }
  }
  for (const link of links.filter((item) => item.needsBackfill)) {
    const backfilled = await tx.logisticsExpense.updateMany({
      where: { id: link.expenseId, deletedAt: null, costId: null },
      data: { costId: link.costId, updatedById: updatedById || null },
    });
    if (backfilled.count !== 1) {
      throw codedError("物流费用成本关联已变化，请刷新后重试。", 409, "LOGISTICS_COST_LINK_CHANGED");
    }
  }
  return costIds;
}
