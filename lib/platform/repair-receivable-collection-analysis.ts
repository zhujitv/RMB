import { Prisma } from "../generated/prisma/client.js";
import { nonEmpty } from "./shared-base-utils";
import {
  deriveOrderCollectionBalance,
  deriveOrderCollectionStatus,
  paymentAmountForOrderCurrency,
  roundMoney,
} from "./shared-order-calculations";

export type RepairInput = {
  orderNos?: string[]; orderIds?: string[]; startAfterId?: string; limit?: number; maxRows?: number;
  batchSize?: number; dryRun?: boolean; source?: string;
};

export const repairOrderSelect = Prisma.validator<Prisma.ReceivableOrderSelect>()({
  id: true, orderNo: true, currency: true, exchangeRate: true, finalReceivableAmount: true,
  finalReceivableAmountCny: true, actualShipmentAmount: true, status: true, commissionStatus: true,
  commissionSettledAt: true, updatedAt: true,
  payments: {
    where: { status: { in: ["待确认", "已到账"] }, deletedAt: null },
    select: { id: true, status: true, currency: true, amount: true, amountCny: true },
  },
  _count: { select: { commissionSettlementRecords: { where: { status: "ACTIVE", reversedAt: null } } } },
});

export type RepairOrder = Prisma.ReceivableOrderGetPayload<{ select: typeof repairOrderSelect }>;
type RepairOrderPageQuery = {
  where: Prisma.ReceivableOrderWhereInput; select: typeof repairOrderSelect;
  orderBy: Prisma.ReceivableOrderOrderByWithRelationInput[]; take: number;
  cursor?: Prisma.ReceivableOrderWhereUniqueInput; skip?: number;
};
export type RepairOrderPageLoader = (query: RepairOrderPageQuery) => Promise<RepairOrder[]>;

export type ReceivableCollectionStatusRepairCandidate = {
  orderId: string; orderNo: string; currency: string; previousStatus: string; nextStatus: string;
  finalReceivableAmount: number; receivedAmount: number; outstandingAmount: number; overpaidAmount: number;
  previousOutstandingCny: number; correctedOutstandingCny: number; exchangeDifferenceCny: number;
  paymentIds: string[]; updatedAt: Date;
};
export type ReceivableCollectionStatusRepairIssue = {
  orderId: string; orderNo: string; previousStatus: string; proposedStatus: string;
  reason: "PAYMENT_CURRENCY_MISMATCH" | "COMMISSION_ALREADY_SETTLED"; paymentIds: string[];
};

export function repairWhere(input: RepairInput): Prisma.ReceivableOrderWhereInput {
  const orderIds = (input.orderIds || []).map(nonEmpty).filter(Boolean);
  const orderNos = (input.orderNos || []).map(nonEmpty).filter(Boolean);
  return { deletedAt: null, ...(orderIds.length || orderNos.length ? { OR: [
    ...(orderIds.length ? [{ id: { in: orderIds } }] : []),
    ...(orderNos.length ? [{ orderNo: { in: orderNos } }] : []),
  ] } : {}) };
}

export function analyzeReceivableCollectionStatus(order: RepairOrder): {
  candidate: ReceivableCollectionStatusRepairCandidate | null;
  issue: ReceivableCollectionStatusRepairIssue | null;
} {
  const orderCurrency = nonEmpty(order.currency || "CNY").toUpperCase();
  const arrivedPayments = order.payments.filter((payment) => !payment.status || payment.status === "已到账");
  const receivedAmount = arrivedPayments.reduce((sum, payment) => sum + paymentAmountForOrderCurrency(payment, orderCurrency, order.exchangeRate), 0);
  const receivedAmountCny = arrivedPayments.reduce((sum, payment) => sum + Number(payment.amountCny || 0), 0);
  const collection = deriveOrderCollectionBalance({ receivableAmount: order.finalReceivableAmount, receivedAmount,
    receivedAmountCny, orderExchangeRate: order.exchangeRate });
  const nextStatus = deriveOrderCollectionStatus({ currentStatus: order.status, actualShipmentAmount: order.actualShipmentAmount,
    receivedAmount, outstandingAmount: collection.outstandingAmount, overpaidAmount: collection.overpaidAmount });
  const arrivedPaymentIds = arrivedPayments.map((payment) => payment.id);
  const commonIssue = { orderId: order.id, orderNo: order.orderNo, previousStatus: order.status, proposedStatus: nextStatus };
  const currencyMismatchPayments = order.payments.filter((payment) => nonEmpty(payment.currency).toUpperCase() !== orderCurrency);
  if (currencyMismatchPayments.length > 0) {
    return { candidate: null, issue: { ...commonIssue, reason: "PAYMENT_CURRENCY_MISMATCH",
      paymentIds: currencyMismatchPayments.map((payment) => payment.id) } };
  }
  if (nextStatus === order.status) return { candidate: null, issue: null };
  if (["已结算", "SETTLED"].includes(order.commissionStatus) || order.commissionSettledAt || order._count.commissionSettlementRecords > 0) {
    return { candidate: null, issue: { ...commonIssue, reason: "COMMISSION_ALREADY_SETTLED", paymentIds: arrivedPaymentIds } };
  }
  return { candidate: {
    orderId: order.id, orderNo: order.orderNo, currency: orderCurrency, previousStatus: order.status, nextStatus,
    finalReceivableAmount: Number(order.finalReceivableAmount || 0), receivedAmount: collection.receivedAmount,
    outstandingAmount: collection.outstandingAmount, overpaidAmount: collection.overpaidAmount,
    previousOutstandingCny: roundMoney(Math.max(Number(order.finalReceivableAmountCny || 0) - receivedAmountCny, 0)),
    correctedOutstandingCny: collection.outstandingCny, exchangeDifferenceCny: collection.exchangeDifferenceCny,
    paymentIds: arrivedPaymentIds, updatedAt: order.updatedAt,
  }, issue: null };
}
