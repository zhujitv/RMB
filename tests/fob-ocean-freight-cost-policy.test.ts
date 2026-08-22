import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const { summarizeOrder } = jiti("../lib/platform/shared-order-calculations.ts") as typeof import("../lib/platform/shared-order-calculations.ts");
const { assertOrderCostAllowedByTradeTerm } = jiti("../lib/platform/trade-term-cost-policy.ts") as typeof import("../lib/platform/trade-term-cost-policy.ts");

const accessInput = readFileSync("lib/platform/logistics-expense-access-input.ts", "utf8");
const batchUpdate = readFileSync("lib/platform/logistics-expense-workflow-batch.ts", "utf8");
const reviewSync = readFileSync("lib/platform/logistics-expense-review-cost-sync.ts", "utf8");
const costSummary = readFileSync("lib/platform/cost-records-shared.ts", "utf8");
const profitOverview = readFileSync("lib/platform/profit-overview.ts", "utf8");
const logisticsForm = readFileSync("app/modules/logistics-fees/use-logistics-expense-form-controller.ts", "utf8");
const costOrderDrawer = readFileSync("app/modules/costs/cost-order-summary-drawer.tsx", "utf8");

function financialOrder(tradeTerm: string) {
  return {
    tradeTerm,
    currency: "CNY",
    receivableAmount: 1000,
    receivableAmountCny: 1000,
    finalReceivableAmount: 1000,
    finalReceivableAmountCny: 1000,
    actualShipmentDate: new Date("2026-08-01T00:00:00.000Z"),
    exchangeRate: 1,
    payments: [{ status: "已到账", currency: "CNY", amount: 1000, amountCny: 1000 }],
    costs: [
      { costType: "工厂货款", amountCny: 100, costConfirmed: true, paymentStatus: "已支付" },
      { costType: "海运费", amountCny: 200, costConfirmed: true, paymentStatus: "已支付" },
    ],
  };
}

test("FOB ocean freight stays auditable but is excluded from every financial total", () => {
  const summary = summarizeOrder(financialOrder(" fob "));
  assert.equal(summary.totalCostCny, 100);
  assert.equal(summary.confirmedTotalCostCny, 100);
  assert.equal(summary.paidConfirmedCostCny, 100);
  assert.equal(summary.logisticsCostCny, 0);
  assert.equal(summary.excludedFobSeaFreightCostCny, 200);
  assert.equal(summary.expectedGrossProfit, 900);
  assert.equal(summary.netCashFlowCny, 900);
});

test("CIF ocean freight remains a normal order cost", () => {
  const summary = summarizeOrder(financialOrder("CIF"));
  assert.equal(summary.totalCostCny, 300);
  assert.equal(summary.confirmedTotalCostCny, 300);
  assert.equal(summary.paidConfirmedCostCny, 300);
  assert.equal(summary.logisticsCostCny, 200);
  assert.equal(summary.excludedFobSeaFreightCostCny, 0);
  assert.equal(summary.expectedGrossProfit, 700);
});

test("confirmed cost waiting for supplier refund remains paid for cash and commission calculations", () => {
  const order = financialOrder("CIF");
  order.costs[0]!.paymentStatus = "待退款";
  const summary = summarizeOrder(order);

  assert.equal(summary.paidConfirmedCostCny, 300);
  assert.equal(summary.netCashFlowCny, 700);
});

test("FOB ocean freight entry fails with a business-readable policy error", () => {
  assert.throws(() => assertOrderCostAllowedByTradeTerm("FOB", "海运费"), (error: unknown) => {
    const value = error as { code?: string; status?: number; message?: string };
    assert.equal(value.code, "FOB_OCEAN_FREIGHT_COST_NOT_ALLOWED");
    assert.equal(value.status, 400);
    assert.match(value.message || "", /FOB订单海运费由买方承担/);
    return true;
  });
  assert.doesNotThrow(() => assertOrderCostAllowedByTradeTerm("CFR", "海运费"));
  assert.doesNotThrow(() => assertOrderCostAllowedByTradeTerm("FOB", "拖车费"));
});

test("all logistics write paths enforce the FOB policy before cost synchronization", () => {
  assert.match(accessInput, /assertOrderCostAllowedByTradeTerm\(order\.tradeTerm, costType\)/);
  assert.match(batchUpdate, /assertOrderCostAllowedByTradeTerm\(before\.order\?\.tradeTerm, costType\)/);
  assert.match(reviewSync, /rows\.forEach\(\(row\) => assertOrderCostAllowedByTradeTerm\(row\.order\?\.tradeTerm, row\.costType\)\)/);
});

test("cost and profit views retain the row while excluding it from financial aggregates", () => {
  assert.match(costSummary, /const participatingCosts = summaryCosts\.filter/);
  assert.match(costSummary, /excludedFobSeaFreightCostCny/);
  assert.match(costSummary, /excludedFromOrderCost: isOrderCostExcludedByTradeTerm/);
  assert.match(profitOverview, /costParticipatesInOrderFinancials\(scoped, cost\)/);
  assert.match(logisticsForm, /costTypeOptionsForOrder/);
  assert.match(costOrderDrawer, /FOB海运费（不计成本）/);
  assert.match(costOrderDrawer, /cost\.excludedFromOrderCost[\s\S]*不计订单成本/);
});
