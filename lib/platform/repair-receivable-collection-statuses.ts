import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { nonEmpty } from "./shared-base-utils";
import {
  deriveOrderCollectionBalance,
  deriveOrderCollectionStatus,
  paymentAmountForOrderCurrency,
  roundMoney,
} from "./shared-order-calculations";
import { writeAudit } from "./shared-audit";

export type RepairInput = {
  orderNos?: string[];
  orderIds?: string[];
  /** Resume strictly after this order id, normally using the previous result's `nextCursor`. */
  startAfterId?: string;
  /** Legacy total-row limit. Kept for callers that already use `limit`. */
  limit?: number;
  /** Preferred total-row hard limit. Takes precedence over `limit`. */
  maxRows?: number;
  /** Query page size only; never expands the total-row hard limit. */
  batchSize?: number;
  dryRun?: boolean;
  source?: string;
};

const repairOrderSelect = Prisma.validator<Prisma.ReceivableOrderSelect>()({
  id: true,
  orderNo: true,
  currency: true,
  exchangeRate: true,
  finalReceivableAmount: true,
  finalReceivableAmountCny: true,
  actualShipmentAmount: true,
  status: true,
  commissionStatus: true,
  commissionSettledAt: true,
  updatedAt: true,
  payments: {
    where: { status: { in: ["待确认", "已到账"] }, deletedAt: null },
    select: {
      id: true,
      status: true,
      currency: true,
      amount: true,
      amountCny: true,
    },
  },
  _count: {
    select: {
      commissionSettlementRecords: {
        where: { status: "ACTIVE", reversedAt: null },
      },
    },
  },
});

type RepairOrder = Prisma.ReceivableOrderGetPayload<{ select: typeof repairOrderSelect }>;

type RepairOrderPageQuery = {
  where: Prisma.ReceivableOrderWhereInput;
  select: typeof repairOrderSelect;
  orderBy: Prisma.ReceivableOrderOrderByWithRelationInput[];
  take: number;
  cursor?: Prisma.ReceivableOrderWhereUniqueInput;
  skip?: number;
};

type RepairOrderPageLoader = (query: RepairOrderPageQuery) => Promise<RepairOrder[]>;

const RECEIVABLE_REPAIR_TRANSACTION_MAX_ATTEMPTS = 3;
const DEFAULT_RECEIVABLE_REPAIR_MAX_ROWS = 1000;
const MAX_RECEIVABLE_REPAIR_MAX_ROWS = 50000;
const DEFAULT_RECEIVABLE_REPAIR_BATCH_SIZE = 200;
const MAX_RECEIVABLE_REPAIR_BATCH_SIZE = 1000;

type ReceivableRepairTransactionOperation<T> = (tx: Prisma.TransactionClient) => Promise<T>;
export type ReceivableRepairTransactionExecutor = <T>(
  operation: ReceivableRepairTransactionOperation<T>,
) => Promise<T>;

type ReceivableRepairDependencies = {
  loadPage?: RepairOrderPageLoader;
  runTransaction?: <T>(operation: ReceivableRepairTransactionOperation<T>) => Promise<T>;
};

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(parsed), maximum));
}

function repairScanLimits(input: RepairInput) {
  const maxRows = boundedInteger(
    input.maxRows ?? input.limit,
    DEFAULT_RECEIVABLE_REPAIR_MAX_ROWS,
    0,
    MAX_RECEIVABLE_REPAIR_MAX_ROWS,
  );
  const defaultBatchSize = Math.min(DEFAULT_RECEIVABLE_REPAIR_BATCH_SIZE, Math.max(maxRows, 1));
  const batchSize = boundedInteger(
    input.batchSize,
    defaultBatchSize,
    1,
    MAX_RECEIVABLE_REPAIR_BATCH_SIZE,
  );
  return { maxRows, batchSize };
}

function isReceivableRepairSerializationConflict(error: unknown) {
  return String((error as { code?: string })?.code || "") === "P2034";
}

const executeReceivableRepairTransaction: ReceivableRepairTransactionExecutor = <T>(
  operation: ReceivableRepairTransactionOperation<T>,
) => prisma.$transaction(operation, {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10000,
  timeout: 15000,
});

export async function runReceivableRepairTransaction<T>(
  operation: ReceivableRepairTransactionOperation<T>,
  execute: ReceivableRepairTransactionExecutor = executeReceivableRepairTransaction,
) {
  for (let attempt = 1; attempt <= RECEIVABLE_REPAIR_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await execute(operation);
    } catch (error: unknown) {
      if (!isReceivableRepairSerializationConflict(error)
          || attempt === RECEIVABLE_REPAIR_TRANSACTION_MAX_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw new Error("应收状态修复事务重试次数已耗尽");
}

export type ReceivableCollectionStatusRepairCandidate = {
  orderId: string;
  orderNo: string;
  currency: string;
  previousStatus: string;
  nextStatus: string;
  finalReceivableAmount: number;
  receivedAmount: number;
  outstandingAmount: number;
  overpaidAmount: number;
  previousOutstandingCny: number;
  correctedOutstandingCny: number;
  exchangeDifferenceCny: number;
  paymentIds: string[];
  updatedAt: Date;
};

export type ReceivableCollectionStatusRepairIssue = {
  orderId: string;
  orderNo: string;
  previousStatus: string;
  proposedStatus: string;
  reason: "PAYMENT_CURRENCY_MISMATCH" | "COMMISSION_ALREADY_SETTLED";
  paymentIds: string[];
};

function repairWhere(input: RepairInput): Prisma.ReceivableOrderWhereInput {
  const orderIds = (input.orderIds || []).map(nonEmpty).filter(Boolean);
  const orderNos = (input.orderNos || []).map(nonEmpty).filter(Boolean);
  return {
    deletedAt: null,
    ...(orderIds.length || orderNos.length ? {
      OR: [
        ...(orderIds.length ? [{ id: { in: orderIds } }] : []),
        ...(orderNos.length ? [{ orderNo: { in: orderNos } }] : []),
      ],
    } : {}),
  };
}

export function analyzeReceivableCollectionStatus(order: RepairOrder): {
  candidate: ReceivableCollectionStatusRepairCandidate | null;
  issue: ReceivableCollectionStatusRepairIssue | null;
} {
  const orderCurrency = nonEmpty(order.currency || "CNY").toUpperCase();
  // Pending payments are loaded so historical cross-currency associations can
  // be reported before confirmation, but only arrived payments settle an order.
  // The missing-status fallback keeps direct legacy callers compatible; rows
  // loaded by Prisma always have an explicit status.
  const arrivedPayments = order.payments.filter((payment) => !payment.status || payment.status === "已到账");
  const receivedAmount = arrivedPayments.reduce((sum, payment) => (
    sum + paymentAmountForOrderCurrency(payment, orderCurrency, order.exchangeRate)
  ), 0);
  const receivedAmountCny = arrivedPayments.reduce((sum, payment) => sum + Number(payment.amountCny || 0), 0);
  const collection = deriveOrderCollectionBalance({
    receivableAmount: order.finalReceivableAmount,
    receivedAmount,
    receivedAmountCny,
    orderExchangeRate: order.exchangeRate,
  });
  const nextStatus = deriveOrderCollectionStatus({
    currentStatus: order.status,
    actualShipmentAmount: order.actualShipmentAmount,
    receivedAmount,
    outstandingAmount: collection.outstandingAmount,
    overpaidAmount: collection.overpaidAmount,
  });
  const arrivedPaymentIds = arrivedPayments.map((payment) => payment.id);
  const currencyMismatchPayments = order.payments.filter((payment) => (
    nonEmpty(payment.currency).toUpperCase() !== orderCurrency
  ));
  const commonIssue = {
    orderId: order.id,
    orderNo: order.orderNo,
    previousStatus: order.status,
    proposedStatus: nextStatus,
  };
  if (currencyMismatchPayments.length > 0) {
    return {
      candidate: null,
      issue: {
        ...commonIssue,
        reason: "PAYMENT_CURRENCY_MISMATCH",
        paymentIds: currencyMismatchPayments.map((payment) => payment.id),
      },
    };
  }
  if (nextStatus === order.status) return { candidate: null, issue: null };

  if (["已结算", "SETTLED"].includes(order.commissionStatus)
      || order.commissionSettledAt
      || order._count.commissionSettlementRecords > 0) {
    return {
      candidate: null,
      issue: { ...commonIssue, reason: "COMMISSION_ALREADY_SETTLED", paymentIds: arrivedPaymentIds },
    };
  }

  return {
    candidate: {
      orderId: order.id,
      orderNo: order.orderNo,
      currency: orderCurrency,
      previousStatus: order.status,
      nextStatus,
      finalReceivableAmount: Number(order.finalReceivableAmount || 0),
      receivedAmount: collection.receivedAmount,
      outstandingAmount: collection.outstandingAmount,
      overpaidAmount: collection.overpaidAmount,
      previousOutstandingCny: roundMoney(Math.max(Number(order.finalReceivableAmountCny || 0) - receivedAmountCny, 0)),
      correctedOutstandingCny: collection.outstandingCny,
      exchangeDifferenceCny: collection.exchangeDifferenceCny,
      paymentIds: arrivedPaymentIds,
      updatedAt: order.updatedAt,
    },
    issue: null,
  };
}

export async function scanReceivableCollectionStatusRepairs(
  input: RepairInput = {},
  loadPage: RepairOrderPageLoader = (query) => prisma.receivableOrder.findMany(query),
) {
  const { maxRows, batchSize } = repairScanLimits(input);
  const startAfterId = nonEmpty(input.startAfterId);
  const where = repairWhere(input);
  const orderBy: Prisma.ReceivableOrderOrderByWithRelationInput[] = [{ createdAt: "asc" }, { id: "asc" }];
  const candidates: ReceivableCollectionStatusRepairCandidate[] = [];
  const issues: ReceivableCollectionStatusRepairIssue[] = [];
  let scanned = 0;
  let pagesScanned = 0;
  let cursor: Prisma.ReceivableOrderWhereUniqueInput | undefined = startAfterId
    ? { id: startAfterId }
    : undefined;
  let truncated = false;
  let nextCursor: string | null = null;

  if (maxRows === 0) {
    const first = await loadPage({
      where,
      select: repairOrderSelect,
      orderBy,
      take: 1,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });
    truncated = first.length > 0;
    return {
      scanned,
      pagesScanned,
      startAfterId: startAfterId || null,
      maxRows,
      batchSize,
      truncated,
      hasMore: truncated,
      nextCursor: startAfterId || null,
      candidates,
      issues,
    };
  }

  while (scanned < maxRows) {
    const remaining = maxRows - scanned;
    const pageCapacity = Math.min(batchSize, remaining);
    const shouldDetectOverflow = remaining <= batchSize;
    const orders = await loadPage({
      where,
      select: repairOrderSelect,
      orderBy,
      take: pageCapacity + (shouldDetectOverflow ? 1 : 0),
      ...(cursor ? { cursor, skip: 1 } : {}),
    });
    if (orders.length === 0) break;

    pagesScanned += 1;
    const allowedOrders = orders.slice(0, pageCapacity);
    scanned += allowedOrders.length;
    for (const order of allowedOrders) {
      const analysis = analyzeReceivableCollectionStatus(order);
      if (analysis.candidate) candidates.push(analysis.candidate);
      if (analysis.issue) issues.push(analysis.issue);
    }

    const lastAllowedOrder = allowedOrders[allowedOrders.length - 1];
    if (orders.length > allowedOrders.length) {
      truncated = true;
      nextCursor = lastAllowedOrder?.id || null;
      break;
    }
    if (allowedOrders.length < pageCapacity) break;
    cursor = lastAllowedOrder ? { id: lastAllowedOrder.id } : undefined;
  }

  return {
    scanned,
    pagesScanned,
    startAfterId: startAfterId || null,
    maxRows,
    batchSize,
    truncated,
    hasMore: truncated,
    nextCursor,
    candidates,
    issues,
  };
}

export async function repairReceivableCollectionStatuses(
  input: RepairInput = {},
  dependencies: ReceivableRepairDependencies = {},
) {
  const dryRun = input.dryRun !== false;
  const source = nonEmpty(input.source || "repair-script");
  const scan = await scanReceivableCollectionStatusRepairs(input, dependencies.loadPage);
  const { candidates, issues } = scan;
  const runTransaction = dependencies.runTransaction || runReceivableRepairTransaction;

  const repaired: ReceivableCollectionStatusRepairCandidate[] = [];
  const concurrentlyChanged: Array<{ orderId: string; orderNo: string; reason: string }> = [];
  if (!dryRun) {
    for (const candidate of candidates) {
      const result = await runTransaction(async (tx) => {
        const current = await tx.receivableOrder.findUnique({
          where: { id: candidate.orderId },
          select: repairOrderSelect,
        });
        if (!current) return { repaired: null, reason: "ORDER_NOT_FOUND" };
        const currentAnalysis = analyzeReceivableCollectionStatus(current);
        if (!currentAnalysis.candidate) return { repaired: null, reason: currentAnalysis.issue?.reason || "NO_LONGER_REQUIRES_REPAIR" };
        if (current.status !== candidate.previousStatus || current.updatedAt.getTime() !== candidate.updatedAt.getTime()) {
          return { repaired: null, reason: "ORDER_CHANGED_AFTER_SCAN" };
        }
        const update = await tx.receivableOrder.updateMany({
          where: {
            id: current.id,
            status: current.status,
            updatedAt: current.updatedAt,
          },
          data: { status: currentAnalysis.candidate.nextStatus },
        });
        if (update.count !== 1) return { repaired: null, reason: "CONCURRENT_UPDATE" };
        await writeAudit(
          null,
          null,
          "修正历史应收状态（原币口径）",
          "receivable_orders",
          current.id,
          {
            status: current.status,
            calculationVersion: "legacy-cny-balance",
          },
          {
            status: currentAnalysis.candidate.nextStatus,
            calculationVersion: "original-currency-v1",
            finalReceivableAmount: currentAnalysis.candidate.finalReceivableAmount,
            receivedAmount: currentAnalysis.candidate.receivedAmount,
            outstandingAmount: currentAnalysis.candidate.outstandingAmount,
            overpaidAmount: currentAnalysis.candidate.overpaidAmount,
            exchangeDifferenceCny: currentAnalysis.candidate.exchangeDifferenceCny,
            paymentIds: currentAnalysis.candidate.paymentIds,
            source,
          },
          tx,
        );
        return { repaired: currentAnalysis.candidate, reason: "" };
      });
      if (result.repaired) repaired.push(result.repaired);
      else concurrentlyChanged.push({ orderId: candidate.orderId, orderNo: candidate.orderNo, reason: result.reason });
    }
  }

  return {
    dryRun,
    scanned: scan.scanned,
    pagesScanned: scan.pagesScanned,
    startAfterId: scan.startAfterId,
    maxRows: scan.maxRows,
    batchSize: scan.batchSize,
    truncated: scan.truncated,
    hasMore: scan.hasMore,
    nextCursor: scan.nextCursor,
    candidateCount: candidates.length,
    issueCount: issues.length,
    repairedCount: repaired.length,
    concurrentlyChangedCount: concurrentlyChanged.length,
    candidates,
    issues,
    repaired,
    concurrentlyChanged,
  };
}
