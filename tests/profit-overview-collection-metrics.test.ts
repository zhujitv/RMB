import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  overviewCollectionMetrics,
  overviewOrderMetrics,
  serializeProfitAnalysisSummary,
} = jiti("../lib/platform/profit-overview.ts") as typeof import("../lib/platform/profit-overview.ts");
const { summarizeOrder } = jiti("../lib/platform/shared-order-calculations.ts") as typeof import("../lib/platform/shared-order-calculations.ts");
const { orderToCommission, orderToProfit } = jiti("../lib/report-service-mappers.ts") as typeof import("../lib/report-service-mappers.ts");
const { columnsFor } = jiti("../lib/report-service-shared.ts") as typeof import("../lib/report-service-shared.ts");

test("overview keeps displayed receipts at actual CNY while FX differences stay out of unpaid and collection rate", () => {
  const metrics = overviewCollectionMetrics({
    receivableCny: 271111.77,
    arrivedPaymentsCny: 269933.84,
    confirmedPaymentsCny: 269933.84,
    arrivedBalanceCny: 0,
    arrivedOutstandingCny: 0,
    outstandingCny: 0,
    exchangeDifferenceCny: -1177.93,
  });

  assert.deepEqual(metrics, {
    receivable: 271111.77,
    paid: 269933.84,
    unpaid: 0,
    collectionBasisPaid: 271111.77,
    exchangeDifference: -1177.93,
  });
  assert.equal(metrics.collectionBasisPaid / metrics.receivable, 1);
  assert.ok(Math.abs((metrics.paid + metrics.unpaid - metrics.receivable) - metrics.exchangeDifference) < 0.001);
});

test("overview collection rate follows original-currency settlement instead of a favorable receipt rate", () => {
  const metrics = overviewCollectionMetrics({
    receivableCny: 700,
    arrivedPaymentsCny: 720,
    confirmedPaymentsCny: 720,
    arrivedBalanceCny: 70,
    arrivedOutstandingCny: 70,
    outstandingCny: 70,
    exchangeDifferenceCny: 90,
  });

  assert.equal(metrics.paid, 720);
  assert.equal(metrics.unpaid, 70);
  assert.equal(metrics.collectionBasisPaid, 630);
  assert.equal(metrics.exchangeDifference, 90);
  assert.equal(metrics.collectionBasisPaid / metrics.receivable, 0.9);
});

test("overview remains compatible with summaries created before original-currency balance fields", () => {
  const metrics = overviewCollectionMetrics({
    receivableCny: 700,
    arrivedPaymentsCny: 690,
    confirmedPaymentsCny: 690,
    outstandingCny: 10,
  });

  assert.deepEqual(metrics, {
    receivable: 700,
    paid: 690,
    unpaid: 10,
    collectionBasisPaid: 690,
    exchangeDifference: 0,
  });
});

test("profit report exposes exchange difference without shifting existing columns", () => {
  const columns = columnsFor("profits");
  assert.equal(columns.at(-1)?.key, "exchangeDifferenceCny");
  assert.equal(columns.at(-1)?.label, "汇兑差额（收益正/损失负）");
  assert.deepEqual(columns.slice(0, 3).map((column) => column.key), [
    "orderNo",
    "customerName",
    "businessEntityName",
  ]);
});

test("profit report carries original-currency outstanding through calculation, serialization, and mapping", () => {
  const summary = summarizeOrder({
    currency: "USD",
    exchangeRate: 7,
    receivableAmount: 100,
    receivableAmountCny: 700,
    estimatedReceivableAmount: 100,
    estimatedReceivableAmountCny: 700,
    finalReceivableAmount: 100,
    finalReceivableAmountCny: 700,
    payments: [{ status: "已到账", currency: "USD", amount: 50, amountCny: 340 }],
    costs: [],
  });
  const serializedSummary = serializeProfitAnalysisSummary(summary);
  const report = orderToProfit({
    id: "partial-order",
    orderNo: "PARTIAL-ORDER",
    currency: "USD",
    summary: serializedSummary,
  });

  assert.equal(serializedSummary.outstandingCny, 350);
  assert.deepEqual({
    receivableCny: report.receivableCny,
    receivedAmountCny: report.receivedAmountCny,
    outstandingCny: report.outstandingCny,
    exchangeDifferenceCny: report.exchangeDifferenceCny,
  }, {
    receivableCny: 700,
    receivedAmountCny: 340,
    outstandingCny: 350,
    exchangeDifferenceCny: -10,
  });
});

test("commission report reads the serialized summary commission rate", () => {
  const report = orderToCommission({
    id: "commission-order",
    orderNo: "COMMISSION-ORDER",
    summary: {
      commissionRate: 1.5,
      commissionAmountCny: 123.45,
    },
  });

  assert.equal(report.commissionRate, "1.50%");
  assert.equal(report.commissionAmountCny, 123.45);
});

test("legacy settled orders without a snapshot never masquerade as current commission totals", () => {
  const summary = {
    receivableCny: 1000,
    estimatedCommissionCny: 50,
    settleableCommissionCny: 50,
    commissionStatus: "已结算（缺少历史快照）",
    commissionSnapshotMissing: true,
    commissionFormulaLabel: "历史结算（缺少金额快照）",
    commissionFormulaVersion: "legacy-unsnapshotted",
  };
  const metrics = overviewOrderMetrics({
    id: "legacy-settled-order",
    orderNo: "LEGACY-SETTLED",
    commissionStatus: "SETTLED",
    createdAt: "2026-07-01T00:00:00.000Z",
    summary,
  } as never, new URLSearchParams({ month: "2026-07" }));
  const report = orderToCommission({
    id: "legacy-settled-order",
    orderNo: "LEGACY-SETTLED",
    commissionStatus: "SETTLED",
    summary,
  });

  assert.equal(metrics.commissionPending, 0);
  assert.equal(metrics.commissionSettled, 0);
  assert.equal(metrics.commissionMonth, 0);
  assert.equal(metrics.commissionSnapshotMissing, true);
  assert.equal(report.commissionBaseCny, "");
  assert.equal(report.commissionAmountCny, "");
  assert.equal(report.commissionRate, "");
  assert.equal(report.commissionStatus, "已结算（缺少历史快照）");
});
