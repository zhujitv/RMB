import { Prisma } from "../generated/prisma/client.js";
import { nonEmpty, normalizedCostType } from "./shared";

export type RepairInput = {
  orderNos?: string[];
  orderIds?: string[];
  logisticsFeeIds?: string[];
  limit?: number;
  dryRun?: boolean;
  createMissing?: boolean;
  source?: string;
};

export type RepairIssue = {
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

export const repairExpenseSelect = Prisma.validator<Prisma.LogisticsExpenseSelect>()({
  id: true, billId: true, orderId: true, supplierId: true, costId: true, costType: true,
  currency: true, amount: true, amountCny: true, exchangeRate: true, exchangeRateDate: true,
  exchangeRateSource: true, exchangeRateType: true, supplierNameSnapshot: true, remark: true,
  invoiceStatus: true, invoiceDocumentId: true, createdAt: true, reviewedAt: true,
  bill: { select: {
    id: true, billOfLadingNo: true, auditStatus: true, invoiceStatus: true,
    paymentStatus: true, paymentDate: true, reviewedAt: true,
  } },
  order: { select: {
    id: true, orderNo: true, taxArchived: true, taxRefundStatus: true,
    taxRefundArchivedAt: true, taxSubmittedAt: true, commissionStatus: true, commissionSettledAt: true,
    _count: { select: { commissionSettlementRecords: { where: { status: "ACTIVE", reversedAt: null } } } },
  } },
  supplier: { select: { id: true, supplierName: true } },
});

export const repairCostSelect = Prisma.validator<Prisma.OrderCostSelect>()({
  id: true, orderId: true, supplierId: true, costType: true, currency: true,
  amount: true, amountCny: true, sourceType: true, sourceId: true, deletedAt: true, status: true,
});

export type RepairExpenseRow = Prisma.LogisticsExpenseGetPayload<{ select: typeof repairExpenseSelect }>;
export type RepairCostRow = Prisma.OrderCostGetPayload<{ select: typeof repairCostSelect }>;

export function logisticsInvoiceStatusForCost(expense: RepairExpenseRow) {
  const status = nonEmpty(expense.invoiceStatus || expense.bill?.invoiceStatus);
  if (expense.invoiceDocumentId || ["已上传", "已确认", "已上传发票", "已确认发票", "已收到"].includes(status)) return "已收到";
  return "未收到";
}

export function orderScopeWhere(input: RepairInput): Prisma.LogisticsExpenseWhereInput {
  const logisticsFeeIds = (input.logisticsFeeIds || []).map(nonEmpty).filter(Boolean);
  if (logisticsFeeIds.length) return { id: { in: logisticsFeeIds } };
  const orderIds = (input.orderIds || []).map(nonEmpty).filter(Boolean);
  const orderNos = (input.orderNos || []).map(nonEmpty).filter(Boolean);
  if (!orderIds.length && !orderNos.length) return {};
  return { OR: [
    ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
    ...(orderNos.length ? [{ order: { is: { orderNo: { in: orderNos } } } }] : []),
  ] };
}

export function uniqueCandidateCosts(costs: RepairCostRow[], expense: RepairExpenseRow) {
  const direct = costs.filter((cost) => nonEmpty(cost.sourceId) === expense.id);
  if (direct.length) return direct;
  return costs.filter((cost) => cost.orderId === expense.orderId && cost.supplierId === expense.supplierId
    && normalizedCostType(nonEmpty(cost.costType)) === normalizedCostType(nonEmpty(expense.costType))
    && nonEmpty(cost.currency || "CNY").toUpperCase() === nonEmpty(expense.currency || "CNY").toUpperCase()
    && amountKey(cost.amount) === amountKey(expense.amount) && amountKey(cost.amountCny) === amountKey(expense.amountCny));
}

export function repairIssue(expense: RepairExpenseRow, reason: string, candidateCosts: RepairCostRow[] = []): RepairIssue {
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
