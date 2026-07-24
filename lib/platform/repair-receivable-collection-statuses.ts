import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { nonEmpty } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import {
  analyzeReceivableCollectionStatus,
  repairOrderSelect,
  repairWhere,
  type ReceivableCollectionStatusRepairCandidate,
  type ReceivableCollectionStatusRepairIssue,
  type RepairInput,
  type RepairOrderPageLoader,
} from "./repair-receivable-collection-analysis";

export { analyzeReceivableCollectionStatus } from "./repair-receivable-collection-analysis";
export type {
  ReceivableCollectionStatusRepairCandidate,
  ReceivableCollectionStatusRepairIssue,
  RepairInput,
} from "./repair-receivable-collection-analysis";

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
