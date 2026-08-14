import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const { summarizeOrder } = jiti("../lib/platform/shared-order-calculations.ts") as typeof import("../lib/platform/shared-order-calculations.ts");

function rounded(value: unknown) {
  return Math.round(Number(value) * 100) / 100;
}

function pv252LikeOrder(payments: Array<Record<string, unknown>> = [], shipped = true) {
  return {
    currency: "CNY",
    receivableAmount: 157191.79,
    receivableAmountCny: 157191.79,
    finalReceivableAmount: 157191.79,
    finalReceivableAmountCny: 157191.79,
    ...(shipped ? { actualShipmentDate: new Date("2026-08-01T00:00:00.000Z") } : {}),
    exchangeRate: 1,
    salespersonCommissionRate: 0,
    payments,
    costs: [
      {
        costType: "工厂货款",
        amountCny: 124218.32,
        costConfirmed: true,
        paymentStatus: "已支付",
      },
      {
        costType: "工厂货款",
        amountCny: 2368.63,
        costConfirmed: true,
        paymentStatus: "待支付",
      },
    ],
  };
}

test("unshipped orders keep forecast profit but do not calculate or realize margin", () => {
  const summary = summarizeOrder(pv252LikeOrder([
    {
      status: "已到账",
      currency: "CNY",
      amount: 157191.79,
      amountCny: 157191.79,
    },
  ], false));

  assert.equal(rounded(summary.expectedGrossProfit), 30604.84);
  assert.equal(summary.profitMarginEligible, false);
  assert.equal(summary.expectedGrossMargin, null);
  assert.equal(summary.realizedGrossProfit, null);
  assert.equal(summary.realizedGrossMargin, null);
});

test("legacy actual shipment amount makes an order eligible without a shipment date", () => {
  const summary = summarizeOrder({
    ...pv252LikeOrder([], false),
    actualShipmentAmount: 157191.79,
  });

  assert.equal(summary.profitMarginEligible, true);
  assert.equal((Number(summary.expectedGrossMargin) * 100).toFixed(2), "19.47");
});

test("realized gross profit is hidden until customer revenue is fully collected", () => {
  const summary = summarizeOrder(pv252LikeOrder());

  assert.equal(rounded(summary.expectedGrossProfit), 30604.84);
  assert.equal((Number(summary.expectedGrossMargin) * 100).toFixed(2), "19.47");
  assert.equal(summary.realizedGrossProfit, null);
  assert.equal(summary.realizedGrossMargin, null);
  assert.equal(rounded(summary.netCashFlowCny), -124218.32);
});

test("realized gross profit uses final receivable minus total cost after full collection", () => {
  const summary = summarizeOrder(pv252LikeOrder([
    {
      status: "已到账",
      currency: "CNY",
      amount: 157191.79,
      amountCny: 157191.79,
    },
  ]));

  assert.equal(rounded(summary.realizedGrossProfit), 30604.84);
  assert.equal((Number(summary.realizedGrossMargin) * 100).toFixed(2), "19.47");
  assert.equal(rounded(summary.netCashFlowCny), 32973.47);
});

test("removed tax refund calculation payload no longer affects profit summary", () => {
  const order = {
    ...pv252LikeOrder(),
    exportTaxRefundCalculations: [
      {
        calculationStatus: "退税金额已计算",
        estimatedRefundAmount: 8000,
      },
    ],
  };
  const summary = summarizeOrder(order);

  assert.equal(rounded(summary.receivableCny), 157191.79);
  assert.equal(rounded(summary.expectedTaxRefundIncomeCny), 0);
  assert.equal(rounded(summary.expectedGrossProfit), 30604.84);
});
