import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const mutationSource = readFileSync(new URL("../lib/platform/logistics-expense-access-mutations.ts", import.meta.url), "utf8");
const {
  logisticsExpenseCostFingerprintMismatches,
} = jiti("../lib/platform/logistics-expense-access-mutations.ts") as typeof import("../lib/platform/logistics-expense-access-mutations.ts");

const expense = {
  id: "expense-1",
  orderId: "order-1",
  supplierId: "supplier-1",
  costType: "报关费",
  currency: "CNY",
  amount: "173.49",
  amountCny: "173.49",
};

function matchingCost(overrides: Record<string, unknown> = {}) {
  return {
    id: "cost-1",
    sourceType: "LOGISTICS_EXPENSE",
    sourceId: expense.id,
    orderId: expense.orderId,
    supplierId: expense.supplierId,
    costType: expense.costType,
    currency: expense.currency,
    amount: "173.490",
    amountCny: "173.490",
    ...overrides,
  };
}

test("matching logistics payment cost fingerprint remains eligible after commission settlement", () => {
  assert.deepEqual(logisticsExpenseCostFingerprintMismatches(matchingCost(), expense), []);
});

test("logistics payment and reversal detect every material historical cost mismatch", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["来源", { sourceId: "other-expense" }],
    ["订单", { orderId: "other-order" }],
    ["供应商", { supplierId: "other-supplier" }],
    ["费用类型", { costType: "海运费" }],
    ["币种", { currency: "USD" }],
    ["原币金额", { amount: "173.48" }],
    ["人民币金额", { amountCny: "173.48" }],
  ];
  for (const [expected, overrides] of cases) {
    assert.deepEqual(logisticsExpenseCostFingerprintMismatches(matchingCost(overrides), expense), [expected]);
  }
});

test("preserve payment modes reject fingerprint mismatches before returning an existing cost", () => {
  assert.match(
    mutationSource,
    /settledCostMode === "preserve-existing" \|\| settledCostMode === "preserve-required"[\s\S]*assertLogisticsPaymentCostFingerprint\(existing, expense\)/,
  );
  assert.match(mutationSource, /409,[\s\S]*"LOGISTICS_PAYMENT_COST_FINGERPRINT_MISMATCH"/);
  assert.match(mutationSource, /请先修复历史关联，不能继续付款或冲销/);
});
