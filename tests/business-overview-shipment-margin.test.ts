import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  groupOverviewRows,
  overviewOrderMetrics,
} = jiti("../lib/platform/business-overview-metrics.ts") as typeof import("../lib/platform/business-overview-metrics.ts");
const { overviewPeriodActivity } = jiti("../lib/platform/business-overview.ts") as typeof import("../lib/platform/business-overview.ts");

function metric({
  id,
  status,
  receivable,
  profit,
  profitMarginEligible,
}: {
  id: string;
  status: string;
  receivable: number;
  profit: number;
  profitMarginEligible?: boolean;
}) {
  return overviewOrderMetrics({
    id,
    orderNo: id,
    status,
    createdAt: "2026-08-10T00:00:00.000Z",
    summary: {
      receivableCny: receivable,
      outstandingCny: receivable,
      confirmedTotalCostCny: receivable - profit,
      expectedGrossProfit: profit,
      expectedGrossMargin: receivable > 0 ? profit / receivable : null,
      ...(profitMarginEligible == null ? {} : { profitMarginEligible }),
    },
  } as never);
}

test("overview suppresses margin when the shared summary marks an order ineligible", () => {
  const unshipped = metric({
    id: "UNSHIPPED",
    status: "已发货",
    receivable: 100,
    profit: 98,
    profitMarginEligible: false,
  });

  assert.equal(unshipped.profitMarginEligible, false);
  assert.equal(unshipped.expectedGrossProfit, 98);
  assert.equal(unshipped.expectedGrossMargin, null);
});

test("overview fallback requires an actual shipment date or amount when the summary flag is absent", () => {
  const statusOnly = metric({ id: "STATUS-ONLY", status: "已收齐", receivable: 100, profit: 20 });
  const actualAmount = overviewOrderMetrics({
    id: "ACTUAL-AMOUNT",
    orderNo: "ACTUAL-AMOUNT",
    status: "已确认",
    createdAt: "2026-08-10T00:00:00.000Z",
    summary: {
      receivableCny: 100,
      outstandingCny: 100,
      actualShipmentAmount: 100,
      expectedGrossProfit: 20,
      expectedGrossMargin: 0.2,
    },
  } as never);

  assert.equal(statusOnly.profitMarginEligible, false);
  assert.equal(statusOnly.expectedGrossMargin, null);
  assert.equal(actualAmount.profitMarginEligible, true);
  assert.equal(actualAmount.expectedGrossMargin, 0.2);
});

test("period and salesperson margin bases exclude unshipped orders while amounts remain complete", () => {
  const shipped = metric({ id: "SHIPPED", status: "已发货", receivable: 100, profit: 20, profitMarginEligible: true });
  const unshipped = metric({ id: "UNSHIPPED", status: "生产中", receivable: 900, profit: 810, profitMarginEligible: false });
  const period = overviewPeriodActivity("2026-08", [shipped, unshipped], [], []);
  const [group] = groupOverviewRows([shipped, unshipped], () => "Alice");

  assert.equal(period.receivable, 1000);
  assert.equal(period.expectedProfit, 830);
  assert.equal(period.expectedGrossMargin, 0.2);
  assert.equal(period.profitMarginEligibleOrders, 1);
  assert.equal(group.receivable, 1000);
  assert.equal(group.expectedProfit, 830);
  assert.equal(group.marginEligibleReceivable, 100);
  assert.equal(group.marginEligibleProfit, 20);
});
