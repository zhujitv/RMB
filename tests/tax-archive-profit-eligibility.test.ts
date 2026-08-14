import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  deriveOrderCollectionStatus,
  orderStatusAfterShipment,
  summarizeOrder,
} = jiti("../lib/platform/shared-order-calculations.ts") as typeof import("../lib/platform/shared-order-calculations.ts");

function unshippedOrder(extra: Record<string, unknown> = {}) {
  return {
    currency: "CNY",
    receivableAmount: 1000,
    receivableAmountCny: 1000,
    finalReceivableAmount: 1000,
    finalReceivableAmountCny: 1000,
    exchangeRate: 1,
    payments: [],
    costs: [{ costType: "工厂货款", amountCny: 800, costConfirmed: true, paymentStatus: "待支付" }],
    ...extra,
  };
}

test("every canonical tax archive signal makes an unshipped order profit eligible", () => {
  const signals = [
    { taxArchived: true },
    { taxRefundArchivedAt: "2026-08-14T00:00:00.000Z" },
    { taxSubmittedAt: "2026-08-14T00:00:00.000Z" },
    ...["SUBMITTED", "REFUND_RECEIVED", "COMPLETED", "ARCHIVED"].map((taxRefundStatus) => ({ taxRefundStatus })),
  ];

  signals.forEach((signal) => {
    const summary = summarizeOrder(unshippedOrder(signal));
    assert.equal(summary.profitMarginEligible, true, JSON.stringify(signal));
    assert.equal(summary.confirmedTotalCostCny, 800, JSON.stringify(signal));
    assert.equal(summary.expectedGrossProfit, 200, JSON.stringify(signal));
    assert.equal(summary.expectedGrossMargin, 0.2, JSON.stringify(signal));
  });
});

test("ordinary tax workflow states remain ineligible after archive signals are cleared", () => {
  ["NOT_READY", "READY", "PROBLEM"].forEach((taxRefundStatus) => {
    const summary = summarizeOrder(unshippedOrder({
      taxRefundStatus,
      taxArchived: false,
      taxRefundArchivedAt: null,
      taxSubmittedAt: null,
    }));
    assert.equal(summary.profitMarginEligible, false, taxRefundStatus);
    assert.equal(summary.expectedGrossMargin, null, taxRefundStatus);
  });
});

test("tax archive advances early order states without downgrading collection or terminal states", () => {
  ["", "草稿", "已确认", "生产中"].forEach((status) => {
    assert.equal(orderStatusAfterShipment(status), "已发货", status);
  });
  ["已发货", "部分收款", "已收齐", "多收款", "已关闭", "已取消"].forEach((status) => {
    assert.equal(orderStatusAfterShipment(status), status);
  });
});

test("collection status repair preserves the shipped stage for archived orders", () => {
  assert.equal(deriveOrderCollectionStatus({
    currentStatus: "部分收款",
    actualShipmentAmount: null,
    shipmentCompleted: true,
    receivedAmount: 0,
    outstandingAmount: 1000,
    overpaidAmount: 0,
  }), "已发货");
});

test("tax submission and the data backfill both apply the shipped status rule", () => {
  const actionSource = readFileSync(new URL("../lib/platform/tax-refunds-status-actions.ts", import.meta.url), "utf8");
  const migrationSource = readFileSync(new URL("../prisma/migrations/20260814170000_tax_archive_marks_order_shipped/migration.sql", import.meta.url), "utf8");
  assert.match(actionSource, /status: orderStatusAfterShipment\(before\.status\)/);
  assert.match(migrationSource, /"tax_refund_status" IN \('SUBMITTED', 'REFUND_RECEIVED', 'COMPLETED', 'ARCHIVED'\)/);
  assert.match(migrationSource, /"status" NOT IN \('已发货', '部分收款', '已收齐', '多收款', '已关闭', '已取消'\)/);
});
