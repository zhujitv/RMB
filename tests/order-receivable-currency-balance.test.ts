import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import type { Prisma } from "../lib/generated/prisma/client.js";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const repairReceivableCliSource = readFileSync(
  new URL("../scripts/repair-receivable-collection-statuses.mjs", import.meta.url),
  "utf8",
);
const {
  deriveOrderCollectionStatus,
  summarizeOrder,
} = jiti("../lib/platform/shared-order-calculations.ts") as typeof import("../lib/platform/shared-order-calculations.ts");
const {
  analyzeReceivableCollectionStatus,
  repairReceivableCollectionStatuses,
  runReceivableRepairTransaction,
  scanReceivableCollectionStatusRepairs,
} = jiti("../lib/platform/repair-receivable-collection-statuses.ts") as typeof import("../lib/platform/repair-receivable-collection-statuses.ts");

function usdOrder({
  amount = 100,
  rate = 7,
  payments = [],
  depositRatio = null,
}: {
  amount?: number;
  rate?: number;
  payments?: Array<Record<string, unknown>>;
  depositRatio?: number | null;
} = {}) {
  return {
    currency: "USD",
    exchangeRate: rate,
    receivableAmount: amount,
    receivableAmountCny: Math.round(amount * rate * 100) / 100,
    estimatedReceivableAmount: amount,
    estimatedReceivableAmountCny: Math.round(amount * rate * 100) / 100,
    finalReceivableAmount: amount,
    finalReceivableAmountCny: Math.round(amount * rate * 100) / 100,
    depositRatio,
    dueDate: new Date("2020-01-01T00:00:00.000Z"),
    reminderDays: 7,
    salespersonCommissionRate: 0,
    payments,
    costs: [],
  };
}

test("full USD receipt clears the original-currency receivable and records exchange loss separately", () => {
  const summary = summarizeOrder(usdOrder({
    amount: 39929.86,
    rate: 6.7897,
    payments: [{
      status: "已到账",
      currency: "USD",
      amount: 39929.86,
      amountCny: 269933.84,
    }],
  }));

  assert.equal(summary.confirmedPaymentsAmount, 39929.86);
  assert.equal(summary.arrivedPaymentsAmount, 39929.86);
  assert.equal(summary.balanceAmount, 0);
  assert.equal(summary.outstandingAmount, 0);
  assert.equal(summary.outstandingCny, 0);
  assert.equal(summary.arrivedOutstandingAmount, 0);
  assert.equal(summary.arrivedOutstandingCny, 0);
  assert.equal(summary.overpaidAmount, 0);
  assert.equal(summary.exchangeDifferenceCny, -1177.93);
  assert.equal(summary.isUnderpaid, false);
  assert.equal(summary.isOverpaid, false);
  assert.equal(summary.reminderStatus, "已结清");
  assert.notEqual(summary.realizedGrossProfit, null);
  assert.equal(deriveOrderCollectionStatus({
    currentStatus: "部分收款",
    receivedAmount: summary.confirmedPaymentsAmount,
    outstandingAmount: summary.outstandingAmount,
    overpaidAmount: summary.overpaidAmount,
  }), "已收齐");
});

test("a high receipt rate cannot hide an original-currency short payment", () => {
  const summary = summarizeOrder(usdOrder({
    payments: [{ status: "已到账", currency: "USD", amount: 90, amountCny: 720 }],
  }));

  assert.equal(summary.outstandingAmount, 10);
  assert.equal(summary.outstandingCny, 70);
  assert.equal(summary.overpaidAmount, 0);
  assert.equal(summary.exchangeDifferenceCny, 90);
  assert.equal(summary.isUnderpaid, true);
  assert.equal(summary.reminderStatus, "已逾期");
  assert.equal(summary.realizedGrossProfit, null);
  assert.equal(deriveOrderCollectionStatus({
    currentStatus: "已收齐",
    receivedAmount: summary.confirmedPaymentsAmount,
    outstandingAmount: summary.outstandingAmount,
    overpaidAmount: summary.overpaidAmount,
  }), "部分收款");
});

test("original-currency overpayment remains overpaid even when its CNY value is lower", () => {
  const summary = summarizeOrder(usdOrder({
    payments: [{ status: "已到账", currency: "USD", amount: 100.01, amountCny: 600.06 }],
  }));

  assert.equal(summary.outstandingAmount, 0);
  assert.equal(summary.overpaidAmount, 0.01);
  assert.equal(summary.overpaidCny, 0.07);
  assert.equal(summary.isOverpaid, true);
  assert.equal(deriveOrderCollectionStatus({
    currentStatus: "部分收款",
    receivedAmount: summary.confirmedPaymentsAmount,
    outstandingAmount: summary.outstandingAmount,
    overpaidAmount: summary.overpaidAmount,
  }), "多收款");
});

test("pending and deleted receipts do not clear the receivable", () => {
  const summary = summarizeOrder(usdOrder({
    payments: [
      { status: "待确认", currency: "USD", amount: 100, amountCny: 700 },
      { status: "已到账", currency: "USD", amount: 100, amountCny: 700, deletedAt: new Date() },
      { status: "已到账", currency: "USD", amount: 40, amountCny: 280 },
    ],
  }));

  assert.equal(summary.confirmedPaymentsAmount, 40);
  assert.equal(summary.pendingPaymentsAmount, 100);
  assert.equal(summary.outstandingAmount, 60);
  assert.equal(summary.outstandingCny, 420);
});

test("CNY receipts retain the existing one-to-one settlement behavior", () => {
  const summary = summarizeOrder({
    currency: "CNY",
    exchangeRate: 1,
    receivableAmount: 100,
    receivableAmountCny: 100,
    finalReceivableAmount: 100,
    finalReceivableAmountCny: 100,
    payments: [{ status: "已到账", currency: "CNY", amount: 100, amountCny: 100 }],
    costs: [],
  });

  assert.equal(summary.outstandingAmount, 0);
  assert.equal(summary.outstandingCny, 0);
  assert.equal(summary.exchangeDifferenceCny, 0);
});

test("legacy cross-currency receipts keep the CNY-to-order-rate compatibility fallback", () => {
  const summary = summarizeOrder(usdOrder({
    payments: [{ status: "已到账", currency: "EUR", amount: 90, amountCny: 700 }],
  }));

  assert.equal(summary.confirmedPaymentsAmount, 100);
  assert.equal(summary.outstandingAmount, 0);
  assert.equal(summary.outstandingCny, 0);
});

test("deposit completion is also settled in the order currency", () => {
  const summary = summarizeOrder(usdOrder({
    depositRatio: 0.5,
    payments: [{
      status: "已到账",
      currency: "USD",
      paymentType: "预付款",
      amount: 50,
      amountCny: 340,
    }],
  }));

  assert.equal(summary.requiredDepositAmountCny, 350);
  assert.equal(summary.receivedDepositAmount, 50);
  assert.equal(summary.depositGapCny, 0);
  assert.equal(summary.depositOverpaidCny, 0);
});

test("historical status repair identifies the affected order without changing financial amounts", () => {
  const analysis = analyzeReceivableCollectionStatus({
    id: "order-b05",
    orderNo: "B05-2000098387",
    currency: "USD",
    exchangeRate: 6.7897,
    finalReceivableAmount: 39929.86,
    finalReceivableAmountCny: 271111.77,
    actualShipmentAmount: null,
    status: "部分收款",
    commissionStatus: "未结算",
    commissionSettledAt: null,
    updatedAt: new Date("2026-07-20T10:42:14.056Z"),
    payments: [{
      id: "payment-b05",
      currency: "USD",
      amount: 39929.86,
      amountCny: 269933.84,
    }],
    _count: { commissionSettlementRecords: 0 },
  } as unknown as Parameters<typeof analyzeReceivableCollectionStatus>[0]);

  assert.equal(analysis.issue, null);
  assert.equal(analysis.candidate?.previousStatus, "部分收款");
  assert.equal(analysis.candidate?.nextStatus, "已收齐");
  assert.equal(analysis.candidate?.outstandingAmount, 0);
  assert.equal(analysis.candidate?.exchangeDifferenceCny, -1177.93);
});

test("historical status repair sends settled commission and cross-currency records to review", () => {
  const base = {
    id: "order-review",
    orderNo: "ORDER-REVIEW",
    currency: "USD",
    exchangeRate: 7,
    finalReceivableAmount: 100,
    finalReceivableAmountCny: 700,
    actualShipmentAmount: null,
    status: "部分收款",
    commissionStatus: "未结算",
    commissionSettledAt: null,
    updatedAt: new Date(),
    payments: [{ id: "payment-review", currency: "USD", amount: 100, amountCny: 690 }],
    _count: { commissionSettlementRecords: 0 },
  };

  const settled = analyzeReceivableCollectionStatus({
    ...base,
    commissionStatus: "已结算",
    _count: { commissionSettlementRecords: 1 },
  } as unknown as Parameters<typeof analyzeReceivableCollectionStatus>[0]);
  assert.equal(settled.candidate, null);
  assert.equal(settled.issue?.reason, "COMMISSION_ALREADY_SETTLED");

  const crossCurrency = analyzeReceivableCollectionStatus({
    ...base,
    payments: [{ id: "payment-review", currency: "EUR", amount: 90, amountCny: 700 }],
  } as unknown as Parameters<typeof analyzeReceivableCollectionStatus>[0]);
  assert.equal(crossCurrency.candidate, null);
  assert.equal(crossCurrency.issue?.reason, "PAYMENT_CURRENCY_MISMATCH");
});

test("historical status repair reports arrived currency mismatches even when the stored status already matches", () => {
  const analysis = analyzeReceivableCollectionStatus({
    id: "order-arrived-mismatch",
    orderNo: "ORDER-ARRIVED-MISMATCH",
    currency: "USD",
    exchangeRate: 7,
    finalReceivableAmount: 100,
    finalReceivableAmountCny: 700,
    actualShipmentAmount: null,
    status: "已收齐",
    commissionStatus: "未结算",
    commissionSettledAt: null,
    updatedAt: new Date(),
    payments: [{
      id: "payment-arrived-mismatch",
      status: "已到账",
      currency: "EUR",
      amount: 100,
      amountCny: 700,
    }],
    _count: { commissionSettlementRecords: 0 },
  } as unknown as Parameters<typeof analyzeReceivableCollectionStatus>[0]);

  assert.equal(analysis.candidate, null);
  assert.equal(analysis.issue?.reason, "PAYMENT_CURRENCY_MISMATCH");
  assert.equal(analysis.issue?.proposedStatus, "已收齐");
  assert.deepEqual(analysis.issue?.paymentIds, ["payment-arrived-mismatch"]);
});

test("historical status repair reports pending currency mismatches without counting them as receipts", () => {
  const analysis = analyzeReceivableCollectionStatus({
    id: "order-pending-mismatch",
    orderNo: "ORDER-PENDING-MISMATCH",
    currency: "USD",
    exchangeRate: 7,
    finalReceivableAmount: 100,
    finalReceivableAmountCny: 700,
    actualShipmentAmount: null,
    status: "已确认",
    commissionStatus: "未结算",
    commissionSettledAt: null,
    updatedAt: new Date(),
    payments: [{
      id: "payment-pending-mismatch",
      status: "待确认",
      currency: "EUR",
      amount: 100,
      amountCny: 700,
    }],
    _count: { commissionSettlementRecords: 0 },
  } as unknown as Parameters<typeof analyzeReceivableCollectionStatus>[0]);

  assert.equal(analysis.candidate, null);
  assert.equal(analysis.issue?.reason, "PAYMENT_CURRENCY_MISMATCH");
  assert.equal(analysis.issue?.proposedStatus, "已确认");
  assert.deepEqual(analysis.issue?.paymentIds, ["payment-pending-mismatch"]);
});

test("historical status repair follows a stable cursor through every matching page", async () => {
  const makeOrder = (index: number) => ({
    id: `order-${index}`,
    orderNo: `ORDER-${index}`,
    currency: "USD",
    exchangeRate: 7,
    finalReceivableAmount: 100,
    finalReceivableAmountCny: 700,
    actualShipmentAmount: null,
    status: "部分收款",
    commissionStatus: "未结算",
    commissionSettledAt: null,
    updatedAt: new Date(`2026-07-${String(index).padStart(2, "0")}T00:00:00.000Z`),
    payments: [{ id: `payment-${index}`, currency: "USD", amount: 100, amountCny: 690 }],
    _count: { commissionSettlementRecords: 0 },
  }) as unknown as Parameters<typeof analyzeReceivableCollectionStatus>[0];
  const pages = [
    [makeOrder(1), makeOrder(2)],
    [makeOrder(3), makeOrder(4)],
    [makeOrder(5)],
  ];
  const queries: Array<{
    take: number;
    cursor?: { id?: string };
    skip?: number;
    orderBy: unknown;
    where: unknown;
  }> = [];

  const result = await scanReceivableCollectionStatusRepairs(
    {
      orderNos: ["ORDER-1", "ORDER-2", "ORDER-3", "ORDER-4", "ORDER-5"],
      maxRows: 5,
      batchSize: 2,
    },
    async (query) => {
      queries.push(query);
      return pages.shift() || [];
    },
  );

  assert.equal(result.scanned, 5);
  assert.equal(result.pagesScanned, 3);
  assert.equal(result.maxRows, 5);
  assert.equal(result.batchSize, 2);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.candidates.map((candidate) => candidate.orderId), [
    "order-1",
    "order-2",
    "order-3",
    "order-4",
    "order-5",
  ]);
  assert.equal(queries.length, 3);
  assert.deepEqual(queries.map((query) => query.take), [2, 2, 2]);
  assert.deepEqual(queries.map((query) => query.cursor?.id || null), [null, "order-2", "order-4"]);
  assert.deepEqual(queries.map((query) => query.skip || 0), [0, 1, 1]);
  assert.deepEqual(queries[0].orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  assert.deepEqual(queries[0].where, {
    deletedAt: null,
    OR: [{ orderNo: { in: ["ORDER-1", "ORDER-2", "ORDER-3", "ORDER-4", "ORDER-5"] } }],
  });
});

test("legacy limit remains a hard total-row boundary independent from batch size", async () => {
  const orders = Array.from({ length: 5 }, (_, offset) => {
    const index = offset + 1;
    return {
      id: `bounded-order-${index}`,
      orderNo: `BOUNDED-${index}`,
      currency: "USD",
      exchangeRate: 7,
      finalReceivableAmount: 100,
      finalReceivableAmountCny: 700,
      actualShipmentAmount: null,
      status: "部分收款",
      commissionStatus: "未结算",
      commissionSettledAt: null,
      updatedAt: new Date(`2026-06-${String(index).padStart(2, "0")}T00:00:00.000Z`),
      payments: [{ id: `bounded-payment-${index}`, currency: "USD", amount: 100, amountCny: 690 }],
      _count: { commissionSettlementRecords: 0 },
    } as unknown as Parameters<typeof analyzeReceivableCollectionStatus>[0];
  });
  const queries: Array<{ take: number; cursor?: { id?: string } }> = [];

  const result = await scanReceivableCollectionStatusRepairs(
    { limit: 3, batchSize: 2 },
    async (query) => {
      queries.push(query);
      const cursorId = query.cursor?.id;
      const start = cursorId ? orders.findIndex((order) => order.id === cursorId) + 1 : 0;
      return orders.slice(start, start + query.take);
    },
  );

  assert.equal(result.scanned, 3);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.maxRows, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, "bounded-order-3");
  assert.deepEqual(queries.map((query) => query.take), [2, 2]);
});

test("historical status repair resumes strictly after the previous next cursor", async () => {
  const orders = Array.from({ length: 5 }, (_, offset) => {
    const index = offset + 1;
    return {
      id: `resume-order-${index}`,
      orderNo: `RESUME-${index}`,
      currency: "USD",
      exchangeRate: 7,
      finalReceivableAmount: 100,
      finalReceivableAmountCny: 700,
      actualShipmentAmount: null,
      status: "部分收款",
      commissionStatus: "未结算",
      commissionSettledAt: null,
      updatedAt: new Date(`2026-05-${String(index).padStart(2, "0")}T00:00:00.000Z`),
      payments: [{ id: `resume-payment-${index}`, currency: "USD", amount: 100, amountCny: 690 }],
      _count: { commissionSettlementRecords: 0 },
    } as unknown as Parameters<typeof analyzeReceivableCollectionStatus>[0];
  });
  const queries: Array<{ take: number; cursor?: { id?: string }; skip?: number }> = [];
  const loadPage = async (query: { take: number; cursor?: { id?: string }; skip?: number }) => {
    queries.push(query);
    const cursorId = query.cursor?.id;
    const cursorIndex = cursorId ? orders.findIndex((order) => order.id === cursorId) : -1;
    const start = cursorId ? cursorIndex + (query.skip || 0) : 0;
    return orders.slice(start, start + query.take);
  };

  const first = await scanReceivableCollectionStatusRepairs(
    { maxRows: 2, batchSize: 1 },
    loadPage,
  );
  const second = await scanReceivableCollectionStatusRepairs(
    { startAfterId: first.nextCursor || undefined, maxRows: 2, batchSize: 1 },
    loadPage,
  );
  const third = await scanReceivableCollectionStatusRepairs(
    { startAfterId: second.nextCursor || undefined, maxRows: 2, batchSize: 1 },
    loadPage,
  );

  assert.deepEqual(first.candidates.map((candidate) => candidate.orderId), ["resume-order-1", "resume-order-2"]);
  assert.equal(first.truncated, true);
  assert.equal(first.nextCursor, "resume-order-2");
  assert.equal(second.startAfterId, "resume-order-2");
  assert.deepEqual(second.candidates.map((candidate) => candidate.orderId), ["resume-order-3", "resume-order-4"]);
  assert.equal(second.truncated, true);
  assert.equal(second.nextCursor, "resume-order-4");
  assert.equal(queries[2].cursor?.id, "resume-order-2");
  assert.equal(queries[2].skip, 1);
  assert.deepEqual(third.candidates.map((candidate) => candidate.orderId), ["resume-order-5"]);
  assert.equal(third.truncated, false);
  assert.equal(third.nextCursor, null);
});

test("historical status repair CLI forwards its resume cursor environment setting", () => {
  assert.match(repairReceivableCliSource, /REPAIR_RECEIVABLE_COLLECTION_START_AFTER_ID/);
  assert.match(repairReceivableCliSource, /startAfterId,/);
});

test("historical status repair dry-run does not write and apply commits status with its audit", async () => {
  const current = {
    id: "apply-order",
    orderNo: "APPLY-ORDER",
    currency: "USD",
    exchangeRate: 7,
    finalReceivableAmount: 100,
    finalReceivableAmountCny: 700,
    actualShipmentAmount: null,
    status: "部分收款",
    commissionStatus: "未结算",
    commissionSettledAt: null,
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    payments: [{ id: "apply-payment", currency: "USD", amount: 100, amountCny: 690 }],
    _count: { commissionSettlementRecords: 0 },
  } as unknown as Parameters<typeof analyzeReceivableCollectionStatus>[0];
  const beyondLimit = {
    ...current,
    id: "apply-order-beyond-limit",
    orderNo: "APPLY-ORDER-BEYOND-LIMIT",
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    payments: [{ id: "apply-payment-beyond-limit", currency: "USD", amount: 100, amountCny: 690 }],
  } as unknown as Parameters<typeof analyzeReceivableCollectionStatus>[0];
  const updates: Array<{ where: unknown; data: { status?: string } }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const fakeTx = {
    receivableOrder: {
      findUnique: async () => current,
      updateMany: async (args: { where: unknown; data: { status?: string } }) => {
        updates.push(args);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        audits.push(args.data);
        return args.data;
      },
    },
  } as unknown as Prisma.TransactionClient;
  let transactionRuns = 0;
  const runTransaction = async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
    transactionRuns += 1;
    return operation(fakeTx);
  };
  const loadPage = async (query: { take: number }) => [current, beyondLimit].slice(0, query.take);

  const dryRun = await repairReceivableCollectionStatuses(
    { dryRun: true, maxRows: 1, batchSize: 2 },
    { loadPage, runTransaction },
  );
  assert.equal(dryRun.candidateCount, 1);
  assert.equal(dryRun.scanned, 1);
  assert.equal(dryRun.truncated, true);
  assert.equal(dryRun.repairedCount, 0);
  assert.equal(transactionRuns, 0);
  assert.equal(updates.length, 0);
  assert.equal(audits.length, 0);

  const applied = await repairReceivableCollectionStatuses(
    { dryRun: false, maxRows: 1, batchSize: 2, source: "behavior-test" },
    { loadPage, runTransaction },
  );
  assert.equal(applied.repairedCount, 1);
  assert.equal(applied.scanned, 1);
  assert.equal(applied.truncated, true);
  assert.equal(applied.concurrentlyChangedCount, 0);
  assert.equal(transactionRuns, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.status, "已收齐");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "修正历史应收状态（原币口径）");
  assert.equal((audits[0].afterData as Record<string, unknown>).source, "behavior-test");
});

test("historical status repair leaves status unchanged when its transactional audit fails", async () => {
  const current = {
    id: "rollback-order",
    orderNo: "ROLLBACK-ORDER",
    currency: "USD",
    exchangeRate: 7,
    finalReceivableAmount: 100,
    finalReceivableAmountCny: 700,
    actualShipmentAmount: null,
    status: "部分收款",
    commissionStatus: "未结算",
    commissionSettledAt: null,
    updatedAt: new Date("2026-07-03T00:00:00.000Z"),
    payments: [{ id: "rollback-payment", currency: "USD", amount: 100, amountCny: 690 }],
    _count: { commissionSettlementRecords: 0 },
  } as unknown as Parameters<typeof analyzeReceivableCollectionStatus>[0];
  let committedStatus = current.status;
  const committedAudits: unknown[] = [];

  const runTransaction = async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
    let stagedStatus = committedStatus;
    const stagedAudits: unknown[] = [];
    const fakeTx = {
      receivableOrder: {
        findUnique: async () => ({ ...current, status: committedStatus }),
        updateMany: async (args: { data: { status?: string } }) => {
          stagedStatus = args.data.status || stagedStatus;
          return { count: 1 };
        },
      },
      auditLog: {
        create: async (args: unknown) => {
          stagedAudits.push(args);
          throw new Error("audit unavailable");
        },
      },
    } as unknown as Prisma.TransactionClient;
    const result = await operation(fakeTx);
    committedStatus = stagedStatus;
    committedAudits.push(...stagedAudits);
    return result;
  };

  await assert.rejects(
    repairReceivableCollectionStatuses(
      { dryRun: false, maxRows: 1, batchSize: 1 },
      { loadPage: async () => [current], runTransaction },
    ),
    /audit unavailable/,
  );
  assert.equal(committedStatus, "部分收款");
  assert.equal(committedAudits.length, 0);
});

test("historical status repair retries only serialization conflicts and stops after success", async () => {
  let attempts = 0;
  const execute = async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error("serialization conflict"), { code: "P2034" });
    return operation({} as Prisma.TransactionClient);
  };

  const result = await runReceivableRepairTransaction(async () => "completed", execute);
  assert.equal(result, "completed");
  assert.equal(attempts, 3);
});
