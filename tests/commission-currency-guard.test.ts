import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const { summarizeOrder } = jiti("../lib/platform/shared-order-calculations.ts") as typeof import("../lib/platform/shared-order-calculations.ts");
const settlementSource = readFileSync("lib/platform/tax-refunds-actions.ts", "utf8");

function commissionReadyOrder(paymentCurrency: string) {
  return {
    currency: "USD",
    exchangeRate: 7,
    status: "部分收款",
    commissionStatus: "未结算",
    salespersonUserId: "salesperson-1",
    salesperson: { name: "业务员甲", email: "salesperson@example.com" },
    salespersonCommissionRate: 1,
    finalReceivableAmount: 100,
    finalReceivableAmountCny: 700,
    payments: [{
      status: "已到账",
      currency: paymentCurrency,
      amount: 100,
      amountCny: 700,
    }],
    costs: [{
      status: "已确认",
      paymentStatus: "已支付",
      costType: "海运费",
      costConfirmed: true,
      amountCny: 100,
    }],
  };
}

test("same-currency arrived payments remain eligible for commission settlement", () => {
  const summary = summarizeOrder(commissionReadyOrder("USD"));

  assert.equal(summary.hasArrivedPaymentCurrencyMismatch, false);
  assert.equal(summary.arrivedOutstandingAmount, 0);
  assert.equal(summary.commissionStatus, "可结算");
  assert.equal(summary.commissionCanSettle, true);
});

test("legacy cross-currency arrived payments require review before commission settlement", () => {
  const summary = summarizeOrder(commissionReadyOrder("EUR"));

  assert.equal(summary.hasArrivedPaymentCurrencyMismatch, true);
  assert.equal(summary.arrivedOutstandingAmount, 0, "compatibility conversion still supports read-only display");
  assert.equal(summary.commissionStatus, "不可结算：收款币种异常");
  assert.equal(summary.commissionCanSettle, false);
});

test("commission settlement revalidates and audits inside one serializable transaction", () => {
  const settlement = settlementSource.match(
    /export async function settleCommission[\s\S]*?\n}\n/,
  );

  assert.ok(settlement);
  assert.match(settlement[0], /tx\.systemSetting\.findUnique/);
  assert.match(settlement[0], /COMMISSION_FORMULA_SETTING_KEY/);
  assert.match(settlement[0], /normalizeCommissionFormulaSettings/);
  assert.match(settlement[0], /tx\.receivableOrder\.findFirst/);
  assert.match(settlement[0], /assertCommissionCanSettle\(before, commissionFormulaSettings\)/);
  assert.match(settlement[0], /tx\.receivableOrder\.updateMany/);
  assert.match(settlement[0], /await writeAudit\([\s\S]*?tx\)/);
  assert.match(settlement[0], /COMMISSION_SETTLEMENT_TRANSACTION_OPTIONS/);
  assert.match(settlementSource, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.ok(
    settlement[0].indexOf("tx.systemSetting.findUnique") < settlement[0].indexOf("assertCommissionCanSettle"),
    "commission formula must be read in the settlement transaction before eligibility is calculated",
  );
});
