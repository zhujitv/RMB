import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  assertCommissionNotSettled,
  assertCommissionOrderWritableInTransaction,
  isCommissionSettled,
} = jiti("../lib/platform/commission-settlement-lock.ts") as typeof import("../lib/platform/commission-settlement-lock.ts");
const { summarizeOrderWithCommissionSnapshot } = jiti("../lib/platform/shared-commission-summary.ts") as typeof import("../lib/platform/shared-commission-summary.ts");

const ordersSource = readFileSync("lib/platform/orders-module-mutations.ts", "utf8");
const paymentsSource = readFileSync("lib/platform/payments-module.ts", "utf8");
const supplierCostsSource = readFileSync("lib/platform/cost-records-supplier-mutations.ts", "utf8");
const logisticsCostsSource = readFileSync("lib/platform/cost-records-logistics-mutations.ts", "utf8");
const costPaymentSource = readFileSync("lib/platform/cost-records-payment-mutations.ts", "utf8");
const costTypeSource = readFileSync("lib/platform/cost-records-mutation-cost-type.ts", "utf8");
const logisticsExpenseSource = readFileSync("lib/platform/logistics-expense-access-mutations.ts", "utf8");
const logisticsBasicSource = readFileSync("lib/platform/logistics-expense-workflow-basic-mutations.ts", "utf8");
const settlementSource = readFileSync("lib/platform/tax-refunds-actions.ts", "utf8");
const settlementRouteSource = readFileSync("app/api/commissions/[orderId]/settle/route.ts", "utf8");
const profitModuleSource = readFileSync("app/modules/ProfitModule.tsx", "utf8");
const schemaSource = readFileSync("prisma/schema.prisma", "utf8");
const migrationSource = readFileSync("prisma/migrations/20260721110000_commission_settlement_reversal_snapshot/migration.sql", "utf8");

test("commission settlement evidence makes the order immutable for commission-affecting writes", () => {
  assert.equal(isCommissionSettled({ commissionStatus: "未结算" }), false);
  assert.equal(isCommissionSettled({ commissionStatus: "SETTLED" }), true);
  assert.equal(isCommissionSettled({ commissionSettledAt: new Date() }), true);
  assert.equal(isCommissionSettled({ commissionSettlementRecords: [{ id: "settlement-1" }] }), true);
  assert.equal(isCommissionSettled({ commissionSettlementRecords: [{ id: "settlement-1", status: "BROKEN" }] }), false);
  assert.equal(isCommissionSettled({ commissionSettlementRecords: [{ id: "settlement-1", status: "REVERSED", reversedAt: new Date() }] }), false);
  assert.equal(isCommissionSettled({ _count: { commissionSettlementRecords: 1 } }), true);

  assert.throws(
    () => assertCommissionNotSettled({ commissionStatus: "已结算" }),
    (error: unknown) => {
      const typed = error as { status?: number; code?: string; message?: string };
      assert.equal(typed.status, 409);
      assert.equal(typed.code, "COMMISSION_SETTLEMENT_LOCKED");
      assert.match(typed.message || "", /撤销结算流程/);
      return true;
    },
  );
});

test("transaction guard locks and reloads the parent order before allowing a write", async () => {
  const events: string[] = [];
  let nextOrder: Record<string, unknown> = {
    id: "order-1",
    deletedAt: null,
    commissionStatus: "未结算",
    commissionSettledAt: null,
    _count: { commissionSettlementRecords: 0 },
  };
  const tx = {
    $queryRaw: async () => {
      events.push("lock");
      return [{ id: "order-1" }];
    },
    receivableOrder: {
      findUnique: async () => {
        events.push("reload");
        return nextOrder;
      },
    },
  };

  await assertCommissionOrderWritableInTransaction(tx as never, "order-1");
  assert.deepEqual(events, ["lock", "reload"]);

  nextOrder = {
    id: "order-1",
    deletedAt: null,
    commissionStatus: "SETTLED",
    commissionSettledAt: new Date(),
    _count: { commissionSettlementRecords: 1 },
  };
  await assert.rejects(
    () => assertCommissionOrderWritableInTransaction(tx as never, "order-1"),
    (error: unknown) => (error as { code?: string }).code === "COMMISSION_SETTLEMENT_LOCKED",
  );
});

test("all direct order, payment, cost, and logistics amount paths use the settlement guard", () => {
  assert.match(ordersSource, /if \(id\) \{[\s\S]*assertCommissionOrderWritableInTransaction\(tx, id\)/);
  assert.match(ordersSource, /export async function deleteOrder[\s\S]*assertCommissionOrderWritableInTransaction\(tx, id\)/);
  assert.match(paymentsSource, /affectedOrderIds[\s\S]*\.sort\(\)[\s\S]*assertCommissionOrderWritableInTransaction\(tx, affectedOrderId\)/);
  assert.match(paymentsSource, /export async function deletePayment[\s\S]*assertCommissionOrderWritableInTransaction\(tx, transactionBefore\.orderId\)/);

  for (const source of [supplierCostsSource, logisticsCostsSource, costTypeSource]) {
    assert.match(source, /assertCommissionOrderWritableInTransaction/);
  }
  assert.doesNotMatch(costPaymentSource, /assertCommissionOrderWritableInTransaction/);
  assert.match(costPaymentSource, /assertBusinessOrderWritableInTransaction/);
  assert.match(logisticsExpenseSource, /createOrUpdateCostFromLogisticsExpense[\s\S]*assertCommissionOrderWritableInTransaction\(tx, expense\.orderId\)/);
  assert.match(logisticsBasicSource, /saveLogisticsExpenses[\s\S]*assertCommissionOrderWritableInTransaction\(tx, order\.id\)/);
  assert.match(logisticsBasicSource, /updateLogisticsExpense[\s\S]*assertCommissionOrderWritableInTransaction\(tx, before\.orderId\)/);
  assert.match(logisticsBasicSource, /voidLogisticsExpenseBill[\s\S]*assertCommissionOrderWritableInTransaction\(tx, orderId\)/);
});

test("commission settlement locks the parent order before reading formula and child data", () => {
  const block = settlementSource.slice(
    settlementSource.indexOf("export async function settleCommission"),
  );
  assert.ok(block.indexOf("lockBusinessOrderForUpdate(tx, orderId)") >= 0);
  assert.ok(
    block.indexOf("lockBusinessOrderForUpdate(tx, orderId)") < block.indexOf("tx.systemSetting.findUnique"),
    "the parent row must be locked before the settlement snapshot is calculated",
  );
  assert.match(block, /commissionSettledAt: null/);
  assert.match(block, /commissionSettlementRecords: \{ none: \{ status: "ACTIVE", reversedAt: null \} \}/);
  assert.match(block, /commissionFormulaFloorAtZero: summary\.commissionFormulaFloorAtZero/);
  assert.match(block, /commissionFormulaVersion: "v1"/);
});

test("settled commission reports use the immutable settlement snapshot", () => {
  const summary = summarizeOrderWithCommissionSnapshot({
    currency: "CNY",
    exchangeRate: 1,
    finalReceivableAmount: 1000,
    finalReceivableAmountCny: 1000,
    salespersonUserId: "sales-1",
    salesperson: { name: "Sales" },
    salespersonCommissionRate: 5,
    commissionStatus: "SETTLED",
    payments: [{ status: "已到账", currency: "CNY", amount: 1000, amountCny: 1000 }],
    costs: [{ status: "正常", paymentStatus: "待支付", costType: "海运费", costConfirmed: true, amountCny: 100 }],
    commissionSettlementRecords: [{
      status: "ACTIVE",
      paidAmountCny: 980,
      logisticsCostCny: 80,
      commissionBaseCny: 900,
      commissionAmountCny: 63,
      commissionRate: 7,
      commissionFormulaLabel: "结算时公式",
      commissionFormulaSource: "ARRIVED_PAYMENTS_CNY",
      commissionFormulaDeductions: ["LOGISTICS_COST_CNY"],
      commissionFormulaFloorAtZero: true,
      commissionFormulaVersion: "v1",
    }],
  });
  assert.equal(summary.commissionStatus, "已结算");
  assert.equal(summary.commissionBaseCny, 900);
  assert.equal(summary.commissionAmountCny, 63);
  assert.equal(summary.commissionRate, 7);
  assert.equal(summary.commissionFormulaVersion, "v1");

  const scalarMismatch = summarizeOrderWithCommissionSnapshot({
    currency: "CNY",
    exchangeRate: 1,
    finalReceivableAmount: 1000,
    finalReceivableAmountCny: 1000,
    commissionStatus: "未结算",
    commissionSettlementRecords: [{
      status: "ACTIVE",
      paidAmountCny: 980,
      logisticsCostCny: 80,
      commissionBaseCny: 900,
      commissionAmountCny: 63,
      commissionRate: 7,
      commissionFormulaVersion: "legacy",
    }],
  });
  assert.equal(scalarMismatch.commissionStatus, "已结算");
  assert.equal(scalarMismatch.commissionAmountCny, 63);

  const missingLegacySnapshot = summarizeOrderWithCommissionSnapshot({
    currency: "CNY",
    exchangeRate: 1,
    finalReceivableAmount: 1000,
    finalReceivableAmountCny: 1000,
    commissionStatus: "SETTLED",
    commissionSettledAt: new Date(),
    salespersonCommissionRate: 5,
    payments: [{ status: "已到账", currency: "CNY", amount: 1000, amountCny: 1000 }],
    commissionSettlementRecords: [],
  });
  assert.equal(missingLegacySnapshot.commissionStatus, "已结算（缺少历史快照）");
  assert.equal(missingLegacySnapshot.commissionAmountCny, undefined);
  assert.equal(missingLegacySnapshot.commissionBaseCny, undefined);
  assert.equal(missingLegacySnapshot.estimatedCommissionCny, undefined);
  assert.equal(missingLegacySnapshot.settleableCommissionCny, undefined);
  assert.equal(missingLegacySnapshot.currentCommissionEstimate.commissionAmountCny, 50);
  assert.equal(missingLegacySnapshot.commissionSnapshotMissing, true);
  assert.equal(missingLegacySnapshot.commissionFormulaVersion, "legacy-unsnapshotted");
});

test("commission reversal is admin audited and preserves append-only settlement history", () => {
  assert.match(settlementRouteSource, /export async function DELETE/);
  assert.match(settlementSource, /只有管理员可以撤销业务员提成结算/);
  assert.match(settlementSource, /COMMISSION_REVERSAL_REASON_REQUIRED/);
  assert.match(settlementSource, /commissionSettlement\.updateMany/);
  assert.match(settlementSource, /status: "REVERSED"/);
  assert.doesNotMatch(settlementSource, /commissionSettlement\.deleteMany/);
  assert.match(settlementSource, /撤销业务员提成结算[\s\S]*tx,/);
  assert.match(profitModuleSource, /撤销结算/);
  assert.match(profitModuleSource, /requireInput: true/);
  assert.match(profitModuleSource, /inputLabel: "撤销原因"/);
});

test("legacy settlement rows are labelled honestly while new rows default to v1", () => {
  assert.match(schemaSource, /commissionFormulaFloorAtZero\s+Boolean\?/);
  assert.match(schemaSource, /commissionFormulaVersion\s+String\s+@default\("v1"\)/);
  assert.match(migrationSource, /SET "commission_formula_version" = 'legacy'/);
  assert.match(migrationSource, /ALTER COLUMN "commission_formula_version" SET DEFAULT 'v1'/);
  assert.match(migrationSource, /commission_settlements_status_check/);
  assert.match(migrationSource, /CREATE UNIQUE INDEX "commission_settlements_one_active_per_order_idx"/);
  assert.match(migrationSource, /WHERE "status" = 'ACTIVE' AND "reversed_at" IS NULL/);
});
