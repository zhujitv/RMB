import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const { calculateFactorySettlementAmounts } = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-settlement.ts")
>("../lib/platform/factory-purchase-order-settlement.ts");

const service = [
  "lib/platform/factory-purchase-order-settlement.ts",
  "lib/platform/factory-purchase-order-settlement-values.ts",
  "lib/platform/factory-purchase-order-settlement-query.ts",
  "lib/platform/factory-purchase-order-settlement-cost.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
const paymentService = readFileSync("lib/platform/factory-purchase-order-execution.ts", "utf8");
const voidService = readFileSync("lib/platform/factory-purchase-order-ledger-void.ts", "utf8");
const executionPanel = readFileSync("app/modules/sales-execution/purchase-order-execution-panel.tsx", "utf8");
const route = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/settlement/route.ts",
  "utf8",
);
const schema = readPrismaSchemaSource();
const settlementAmountHardeningMigration = readFileSync(
  "prisma/migrations/20260810044000_factory_purchase_settlement_amount_hardening/migration.sql",
  "utf8",
);
const workflowStateHardeningMigration = readFileSync(
  "prisma/migrations/20260810045000_factory_purchase_workflow_state_hardening/migration.sql",
  "utf8",
);
const auditHardeningMigration = readFileSync(
  "prisma/migrations/20260810046000_factory_purchase_audit_hardening/migration.sql",
  "utf8",
);
const invariantCorrectionMigration = readFileSync(
  "prisma/migrations/20260812140000_procurement_database_invariant_corrections/migration.sql",
  "utf8",
);

const appliedMigrationChecksums = new Map<string, string>([
  ["20260809110000_sales_quotation_foundation", "3047ec10b93e72c45936d5a1e04b210ed2109ca6ba266525c11b110b7cf6dc66"],
  ["20260809183000_sales_quotation_delivery", "1e5e1ced08c04e451ecaa6d00dc4d926e2570d3eca64b00e3e8c2c4e83a29254"],
  ["20260809201500_quotation_legal_identity_integrity", "a04322ae8e7bf321b47665278f5e8c47d2f44f72dcf2f9b603adebbf2bcc59ef"],
  ["20260809230000_business_entity_currency_bank_accounts", "ba00ba41cd4e0eafed9ab423aa82a2e7ae1316ee4710bc542fd01fbe7a896c42"],
  ["20260809233000_clear_legacy_business_entity_bank_account", "4c137c5cb9412bb682fe1e3f5008a42ff823a2aab16251487b6923bfa6e46f43"],
  ["20260809234000_business_entity_pi_header_visibility", "a3851f649b38b6d82add80ddea5b25b71fbb61514fcf0615e8c02d3aca914e68"],
  ["20260809235000_pi_invoice_numbers", "78c6c2a63977d51b1ba8b0a85640cd29c3c549c60813d7c0c198d2048ca57580"],
  ["20260810000000_sales_quotation_draft_hard_delete", "b791c7a21e0cd2133e7230c31ada6f95dc1a454b2bf7673c58c193a41aed8a79"],
  ["20260810001000_harden_sales_quotation_draft_hard_delete_triggers", "0b0f655ccbe42d53cf2352f04b7cf473dc2e4577bb5205961f3a884cd9cc3ba4"],
  ["20260810010000_sales_execution_drafts", "e9c8f563e16311b82afb9506948b00be9ef21f54764f0310f8508926a4021aff"],
  ["20260810013000_required_sales_execution_order_fields", "fb9814030590b662fbe41ba3676ef905b57a8496d5291066956ec3e73a62e639"],
  ["20260810020000_quotation_manual_confirmations", "909a28c786a5e8b6d9df087728fe98ee2452bf9d06b0473601a946f1905380b6"],
  ["20260810021000_quotation_manual_confirmation_only", "ca4b1464ee2420abab2c0282d62f5f9e02569cfb5c2b596b02f424f3d23256c5"],
  ["20260810022000_sales_execution_weights_nullable_purchase_prices", "434992f454f93eaeb5b9cfea7d0fc04fafff12d9dce6409b99e40ee72607c3ef"],
  ["20260810023000_factory_purchase_dispatch", "50e19f87fa1fd72aae104bc17ceb56e4c1ecb75e317f28740c71ae3f5c6906e6"],
  ["20260810024000_factory_purchase_response_guard", "1646bbd92ab666557bab7be9a83793bbe59229ec8b022ae42a4d39a102211a19"],
  ["20260810025000_dispatch_immutability_hardening", "2fbbffea16578abeaf4508e111cf9a743297a2ffa074f8c88b668ea06bfe5be5"],
  ["20260810030000_dispatch_lock_concurrency", "1e75c4381da726714baacf3032302c23ba610431ebc207664809a7aee27598fc"],
  ["20260810031000_dispatch_queue_serialization", "3fb5bcc9e2e06e3f8c163054ee2c90a5884b272c7cb581090826ef95103fbdf2"],
  ["20260810032000_supplier_purchase_confirmations", "69e6cbe0ad9604f60685b5fdbd7e3179bcb278bd7770c00ba3e304b783390781"],
  ["20260810033000_factory_purchase_execution_finance", "9f612790850284036802763292ee7a816b6c55f2252ff771eff765c76a0610b2"],
  ["20260810034000_factory_purchase_execution_hardening", "4a8e44593069f3b04c6e045ce7d1800ba7af04a49bfe7b39d932c4d761954010"],
  ["20260810040000_sales_execution_shipping_handoff", "3b5c6a49625953e7e4f05227e9c173842382ae2115a640b3943817f70eef891e"],
  ["20260810041000_sales_execution_shipping_handoff_hardening", "9da420921ca0c6ba92991c773d63da6d1736d74ef7f4f36a3262d0c4f4aac1c1"],
  ["20260810042000_supplier_production_completion_confirmation", "b62b7f23450b1743931a1b6700f7b2cdaf32bfeed58a386f28706bc7ee02b3ba"],
  ["20260810043000_factory_purchase_workflow_closure", "4ee2393d6ba9a1117a799670614155a04c9e7d22c5fae3914bd9514da6f085ad"],
  ["20260810044000_factory_purchase_settlement_amount_hardening", "4c0fd4c45d7a37673f00520cf52ae749c711a10c89d6dbbf2c16d0518d50137b"],
  ["20260810045000_factory_purchase_workflow_state_hardening", "74bf07c61a0bb0169e86754e453695a6c82b8595a1c987deba38c9b21067b11f"],
  ["20260810046000_factory_purchase_audit_hardening", "1dec7c48d0987421e030e210d8afa88dd6f0907902bb7980328b50e24d97aee7"],
]);

const settlementBusinessFiles = [
  "lib/platform/factory-purchase-order-settlement.ts",
  "lib/platform/factory-purchase-order-settlement-values.ts",
  "lib/platform/factory-purchase-order-settlement-query.ts",
  "lib/platform/factory-purchase-order-settlement-cost.ts",
  "lib/platform/factory-purchase-order-execution.ts",
  "lib/platform/factory-purchase-order-execution-shared.ts",
  "lib/platform/factory-purchase-order-ledger-void.ts",
];

function exportedFunctionSource(name: string, source: string) {
  return source.match(
    new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport (?:async )?function|$)`),
  )?.[0] || "";
}

function prismaModel(name: string) {
  return schema.match(new RegExp(`model ${name}\\b[\\s\\S]*?\\n\\}`))?.[0] || "";
}

function migrationFunction(name: string, migration: string) {
  return migration.match(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION "${name}"\\(\\) RETURNS trigger AS \\$\\$[\\s\\S]*?\\$\\$ LANGUAGE plpgsql;`),
  )?.[0] || "";
}

test("applied migration history remains byte-for-byte immutable", () => {
  assert.equal(appliedMigrationChecksums.size, 29);
  for (const [directory, expected] of appliedMigrationChecksums) {
    const body = readFileSync(`prisma/migrations/${directory}/migration.sql`);
    assert.equal(createHash("sha256").update(body).digest("hex"), expected, directory);
  }
  assert.match(invariantCorrectionMigration, /forward-only correction/);
});

test("factory settlement business modules stay within the 300-line quality gate", () => {
  for (const file of settlementBusinessFiles) {
    const lineCount = readFileSync(file, "utf8").trimEnd().split("\n").length;
    assert.ok(lineCount <= 300, `${file} has ${lineCount} lines`);
  }
});

test("factory settlement freezes day-eleven penalty and ordinary adjustments into one final payable", () => {
  const result = calculateFactorySettlementAmounts({
    baseAmount: "100000",
    initialDeliveryDate: "2026-08-10",
    actualDeliveryDate: "2026-08-25",
    adjustments: [
      { kind: "TEMPORARY_FEE", direction: "INCREASE", amount: "1000" },
      { kind: "OTHER", direction: "DECREASE", amount: "200" },
      { kind: "DELAY_PENALTY", direction: "DECREASE", amount: "999" },
    ],
  });

  assert.equal(result.delayDays, 5);
  assert.equal(result.delayPenaltyAmount.toString(), "15");
  assert.equal(result.increaseAmount.toString(), "1000");
  assert.equal(result.decreaseAmount.toString(), "200");
  assert.equal(result.finalPayableAmount.toString(), "100785");
});

test("factory settlement honors each purchase order's frozen grace, rate and cap terms", () => {
  const result = calculateFactorySettlementAmounts({
    baseAmount: "100000",
    initialDeliveryDate: "2026-08-10",
    actualDeliveryDate: "2026-08-20",
    adjustments: [],
    graceDays: 2,
    ratePerDay: "0.001",
    capRatio: "0.005",
  });

  assert.equal(result.delayDays, 8);
  assert.equal(result.delayPenaltyAmount.toString(), "500");
  assert.equal(result.finalPayableAmount.toString(), "99500");
});

test("factory settlement model is one immutable purchase-order snapshot with payment closure state", () => {
  const settlement = prismaModel("FactoryPurchaseOrderSettlement");
  const purchaseOrder = prismaModel("FactoryPurchaseOrder");

  assert.match(settlement, /purchaseOrderId\s+String\s+@unique/);
  assert.match(settlement, /baseAmount\s+Decimal/);
  assert.match(settlement, /increaseAmount\s+Decimal/);
  assert.match(settlement, /decreaseAmount\s+Decimal/);
  assert.match(settlement, /delayPenaltyAmount\s+Decimal/);
  assert.match(settlement, /finalPayableAmount\s+Decimal/);
  assert.match(settlement, /paidAmountAtSettlement\s+Decimal/);
  assert.match(settlement, /status\s+FactoryPurchaseSettlementStatus/);
  assert.match(settlement, /settledAt\s+DateTime\?/);
  assert.match(settlement, /settledById\s+String\?/);
  assert.match(purchaseOrder, /actualDeliveryDate\s+DateTime\?/);
  assert.match(purchaseOrder, /settlement\s+FactoryPurchaseOrderSettlement\?/);
});

test("database settlement insert guard reconstructs the locked purchase-ledger amount snapshot", () => {
  const migration = settlementAmountHardeningMigration;
  const insertGuard = migrationFunction("validate_factory_purchase_order_settlement_insert", migration);
  const executionLock = insertGuard.indexOf('FROM "sales_executions" execution');
  const purchaseOrderLock = insertGuard.indexOf('FOR UPDATE OF purchase_order_row');
  const paymentLock = insertGuard.indexOf('FROM "factory_purchase_order_payments" payment');
  const adjustmentLock = insertGuard.indexOf('FROM "factory_purchase_order_adjustments" adjustment');

  assert.match(migration, /CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_settlement_insert"/);
  assert.ok(executionLock >= 0 && executionLock < purchaseOrderLock);
  assert.ok(purchaseOrderLock < paymentLock && purchaseOrderLock < adjustmentLock);
  assert.match(migration, /NEW\."currency" IS DISTINCT FROM purchase_order\."purchase_currency"/);
  assert.match(migration, /NEW\."base_amount" IS DISTINCT FROM purchase_order\."penalty_base_amount"/);
  assert.match(migration, /adjustment\."status" = 'PROVISIONAL'/);
  assert.match(migration, /adjustment\."kind" <> 'DELAY_PENALTY'/);
  assert.match(migration, /purchase_order\."delay_grace_days"/);
  assert.match(migration, /purchase_order\."delay_penalty_rate_per_day"/);
  assert.match(migration, /purchase_order\."delay_penalty_cap_ratio"/);
  assert.match(migration, /delay_adjustment_count <> 1/);
  assert.match(migration, /NEW\."final_payable_amount" IS DISTINCT FROM expected_final_payable/);
  assert.match(migration, /payment\."status" = 'CONFIRMED'/);
  assert.match(migration, /NEW\."paid_amount_at_settlement" IS DISTINCT FROM confirmed_paid/);
  assert.match(migration, /NEW\."currency" = 'CNY' AND NEW\."exchange_rate" <> 1/);
});

test("database settlement close guard recomputes confirmed payments and audits existing snapshots safely", () => {
  const migration = settlementAmountHardeningMigration;
  const closeGuard = migrationFunction("protect_factory_purchase_order_settlement", migration);

  assert.match(migration, /settlement\."status" = 'SETTLED'[\s\S]*?"paid_amount_at_settlement" IS DISTINCT FROM ledger\.confirmed_paid/);
  assert.match(migration, /settlement\."status" = 'PENDING_PAYMENT'[\s\S]*?"paid_amount_at_settlement" > ledger\.confirmed_paid/);
  assert.match(migration, /ledger\.confirmed_paid >= settlement\."final_payable_amount"/);
  assert.match(closeGuard, /payment\."status" = 'CONFIRMED'/);
  assert.match(closeGuard, /confirmed_paid IS DISTINCT FROM NEW\."final_payable_amount"/);
  assert.match(closeGuard, /NEW\."paid_amount_at_settlement" IS DISTINCT FROM confirmed_paid/);
  assert.match(closeGuard, /NEW\."settled_at" IS NULL/);
  assert.match(closeGuard, /NEW\."settled_by" IS NULL/);
});

test("workflow hardening restores only genuinely confirmed delivery dates and closes frozen pending proposals", () => {
  const migration = workflowStateHardeningMigration;
  const productionActor = migration.indexOf('purchase_order."production_started_by"');
  const dispatchActor = migration.indexOf('purchase_order."dispatched_by"', productionActor + 1);

  assert.match(migration, /response\."response_sequence" < purchase_order\."supplier_response_sequence"/);
  assert.match(migration, /response\."action" = 'ACCEPTED'[\s\S]*?response\."action" = 'DELIVERY_PROPOSED'[\s\S]*?response\."internal_decision" = 'ACCEPTED'/);
  assert.match(migration, /repair\.delivery_frozen[\s\S]*?repair\.latest_internal_decision IS NULL[\s\S]*?repair\.prior_confirmed_delivery_date IS NULL/);
  assert.ok(productionActor >= 0 && dispatchActor > productionActor, "repair actor must prefer production starter over dispatcher");
  assert.match(migration, /actor\."supplier_id" IS NULL/);
  assert.match(migration, /actor\."is_active" = TRUE/);
  assert.match(migration, /actor\."approval_status" = 'APPROVED'/);
  assert.match(migration, /actor\."deleted_at" IS NULL/);
  assert.match(migration, /SET "internal_decision" = 'REJECTED'/);
  assert.match(migration, /"confirmed_supplier_delivery_date" = CASE[\s\S]*?repair\.prior_confirmed_delivery_date/);
  assert.match(migration, /"supplier_delivery_date" = CASE[\s\S]*?repair\.prior_confirmed_delivery_date/);
});

test("workflow hardening backfills a legacy acceptance only from exact production-start evidence", () => {
  const migration = workflowStateHardeningMigration;
  const disableGuard = migration.indexOf(
    'DISABLE TRIGGER "factory_purchase_order_supplier_responses_immutability_guard"',
  );
  const legacyBackfill = migration.indexOf("WITH legacy_production_acceptance AS");
  const enableGuard = migration.indexOf(
    'ENABLE TRIGGER "factory_purchase_order_supplier_responses_immutability_guard"',
  );
  const legacySection = migration.slice(legacyBackfill, enableGuard);

  assert.ok(disableGuard >= 0 && disableGuard < legacyBackfill && legacyBackfill < enableGuard);
  assert.match(legacySection, /production_actor\."role" IN \('管理员', '业务员'\)/);
  assert.match(legacySection, /production_actor\."supplier_id" IS NULL/);
  assert.match(legacySection, /production_actor\."is_active" = TRUE/);
  assert.match(legacySection, /production_actor\."approval_status" = 'APPROVED'/);
  assert.match(legacySection, /production_actor\."deleted_at" IS NULL/);
  assert.match(legacySection, /response\."delivery_date" IS NOT DISTINCT FROM purchase_order\."initial_supplier_delivery_date"/);
  assert.match(legacySection, /response\."responded_at" <= purchase_order\."production_started_at"/);
  assert.match(legacySection, /NOT EXISTS[\s\S]*?confirmed_response\."action" = 'ACCEPTED'/);
  assert.match(legacySection, /ORDER BY purchase_order\."id", response\."response_sequence" DESC/);
  assert.match(legacySection, /SET "internal_decision" = 'ACCEPTED'/);
  assert.match(legacySection, /"internal_decided_at" = legacy\.decided_at/);
  assert.match(legacySection, /"internal_decided_by" = legacy\.decided_by/);
});

test("workflow trigger maps the latest audited internal decision to the effective purchase-order state", () => {
  const statusGuard = migrationFunction("validate_factory_purchase_order_status_transition", workflowStateHardeningMigration);
  const responseGuard = migrationFunction("protect_factory_purchase_order_supplier_response", workflowStateHardeningMigration);

  assert.match(statusGuard, /ORDER BY response\."response_sequence" DESC/);
  assert.match(statusGuard, /latest_response\."internal_decision" = 'ACCEPTED'/);
  assert.match(statusGuard, /NEW\."confirmed_supplier_delivery_date" IS DISTINCT FROM latest_response\."delivery_date"/);
  assert.match(statusGuard, /latest_response\."internal_decision" = 'REJECTED'/);
  assert.match(statusGuard, /NEW\."supplier_delivery_date" IS DISTINCT FROM OLD\."confirmed_supplier_delivery_date"/);
  assert.match(statusGuard, /NEW\."status" <> 'DISPATCHED'/);
  assert.match(responseGuard, /actor\."supplier_id" IS NULL/);
  assert.match(responseGuard, /actor\."is_active" = TRUE/);
  assert.match(responseGuard, /actor\."approval_status" = 'APPROVED'/);
  assert.match(responseGuard, /parent\."production_status" = 'COMPLETED'/);
  assert.match(responseGuard, /parent\."actual_delivery_date" IS NOT NULL/);
  assert.match(responseGuard, /parent\."shipping_started_at" IS NOT NULL/);
  assert.match(workflowStateHardeningMigration, /DEFERRABLE INITIALLY DEFERRED/);
});

test("supplier response and parent purchase-order state must close in one transaction", () => {
  const responseConsistency = migrationFunction(
    "validate_factory_purchase_order_supplier_response_consistency",
    invariantCorrectionMigration,
  );

  assert.match(responseConsistency, /purchase_order\."supplier_response_sequence" <> NEW\."response_sequence"/);
  assert.match(responseConsistency, /purchase_order\."status"::TEXT IS DISTINCT FROM NEW\."action"/);
  assert.match(responseConsistency, /purchase_order\."supplier_response_remark" IS DISTINCT FROM NEW\."remark"/);
  assert.match(responseConsistency, /purchase_order\."responded_at" IS DISTINCT FROM NEW\."responded_at"/);
  assert.match(responseConsistency, /purchase_order\."responded_by" IS DISTINCT FROM NEW\."responded_by"/);
  assert.match(
    invariantCorrectionMigration,
    /CREATE CONSTRAINT TRIGGER "factory_purchase_order_supplier_response_consistency_check"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/,
  );
  assert.match(invariantCorrectionMigration, /response\."response_sequence" = purchase_order\."supplier_response_sequence"/);
  assert.match(invariantCorrectionMigration, /response\."responded_by" IS DISTINCT FROM purchase_order\."responded_by"/);
});

test("workflow hardening permits replacements only from complete void audits and guards shipping at the database", () => {
  const parentGuard = migrationFunction("validate_factory_purchase_order_execution_parent", workflowStateHardeningMigration);
  const shippingGuard = migrationFunction("protect_sales_execution_shipping_anchor", workflowStateHardeningMigration);

  assert.match(parentGuard, /original\."status" = 'VOIDED'/);
  assert.match(parentGuard, /original\."voided_at" IS NOT NULL/);
  assert.match(parentGuard, /original\."voided_by" IS NOT NULL/);
  assert.match(parentGuard, /NULLIF\(BTRIM\(original\."void_reason"\), ''\) IS NOT NULL/);
  assert.doesNotMatch(parentGuard, /original\."status" IN \('REJECTED', 'VOIDED'\)/);
  assert.match(workflowStateHardeningMigration, /UPDATE OF "execution_id", "replacement_for_id"/);
  assert.match(shippingGuard, /actor\."supplier_id" IS NULL/);
  assert.match(shippingGuard, /purchase_order\."status" <> 'ACCEPTED'/);
  assert.match(shippingGuard, /purchase_order\."production_status" <> 'COMPLETED'/);
  assert.match(shippingGuard, /purchase_order\."actual_delivery_date" IS NULL/);
});

test("audit hardening reconstructs history and enforces settlement consistency at commit", () => {
  assert.match(auditHardeningMigration, /CREATE TEMP TABLE "_factory_settlement_integrity_audit"/);
  assert.match(auditHardeningMigration, /payment\."created_at" <= settlement\."created_at"/);
  assert.match(auditHardeningMigration, /payment\."voided_at" > settlement\."created_at"/);
  assert.match(auditHardeningMigration, /ordinary adjustment totals do not match the ledger/);
  assert.match(auditHardeningMigration, /delay calculation does not match the frozen terms/);
  assert.match(auditHardeningMigration, /settlement cost financial snapshot does not match/);
  assert.match(auditHardeningMigration, /guard_factory_purchase_order_void_after_commitment/);
  assert.match(auditHardeningMigration, /has_settlement[\s\S]*shipping_started_at IS NOT NULL[\s\S]*OLD\."actual_delivery_date" IS NOT NULL/);
  assert.match(auditHardeningMigration, /guard_factory_purchase_financial_dates/);
  assert.match(auditHardeningMigration, /AT TIME ZONE 'Asia\/Shanghai'/);
  assert.match(auditHardeningMigration, /CREATE CONSTRAINT TRIGGER "factory_purchase_payments_commit_consistency"/);
  assert.match(auditHardeningMigration, /CREATE CONSTRAINT TRIGGER "factory_purchase_settlements_commit_consistency"/);
  assert.match(auditHardeningMigration, /CREATE CONSTRAINT TRIGGER "factory_purchase_costs_commit_consistency"/);
  assert.match(auditHardeningMigration, /fully paid factory settlement must be closed in the same transaction/);
  assert.match(auditHardeningMigration, /factory settlement requires one active settlement cost/);
});

test("database blocks ledgers before internal acceptance and voiding committed procurement", () => {
  const ledgerGuard = migrationFunction(
    "validate_factory_purchase_order_ledger_parent",
    invariantCorrectionMigration,
  );
  const voidGuard = migrationFunction(
    "guard_factory_purchase_order_void_after_commitment",
    invariantCorrectionMigration,
  );

  assert.match(ledgerGuard, /confirmed_supplier_delivery_date/);
  assert.match(ledgerGuard, /initial_supplier_delivery_date/);
  assert.match(ledgerGuard, /penalty_base_amount/);
  assert.match(ledgerGuard, /FOR UPDATE/);
  assert.match(invariantCorrectionMigration, /voided purchase order % retains production or active financial commitments/);
  assert.match(voidGuard, /payment\."status" = 'CONFIRMED'/);
  assert.match(voidGuard, /adjustment\."status" <> 'VOIDED'/);
  assert.match(voidGuard, /OLD\."production_started_at" IS NOT NULL/);
  assert.match(invariantCorrectionMigration, /factory settlement cost % has no matching immutable settlement/);
});

test("heavy workflow migrations use bounded locks without freezing shared cost tables", () => {
  assert.match(workflowStateHardeningMigration, /IN ACCESS EXCLUSIVE MODE/);
  assert.match(workflowStateHardeningMigration, /LOCK TABLE "users" IN SHARE MODE/);
  assert.match(invariantCorrectionMigration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(invariantCorrectionMigration, /SET LOCAL statement_timeout = '2min'/);
  assert.doesNotMatch(invariantCorrectionMigration, /IN ACCESS EXCLUSIVE MODE/);
  assert.doesNotMatch(invariantCorrectionMigration, /LOCK TABLE "users"/);
  const correctiveLock = invariantCorrectionMigration.slice(
    invariantCorrectionMigration.indexOf("LOCK TABLE"),
    invariantCorrectionMigration.indexOf("IN SHARE ROW EXCLUSIVE MODE") + 28,
  );
  assert.doesNotMatch(correctiveLock, /"receivable_orders"|"order_costs"/);
});

test("settlement is permissioned, scoped, locked, versioned and requires the shipping-complete delivery gates", () => {
  const mutation = exportedFunctionSource("settleFactoryPurchaseOrder", service);

  assert.match(mutation, /assertWrite\(actor, "payments"\)/);
  assert.doesNotMatch(mutation, /assertWrite\(actor, "costs"\)/);
  assert.match(executionPanel, /canSettle=\{canRecordPayment\}/);
  assert.doesNotMatch(executionPanel, /canSettle=\{canRecordPayment && canAddAdjustment\}/);
  assert.match(mutation, /lockSalesExecution\(tx, executionId\)/);
  assert.match(mutation, /lockFactoryPurchaseOrder\(tx, purchaseOrderId\)/);
  assert.match(service, /salesExecutionAccessWhere\(actor\)/);
  assert.match(mutation, /execution\.shippingStartedAt/);
  assert.match(mutation, /execution\.receivableOrder/);
  assert.match(mutation, /purchaseOrder\.status !== "ACCEPTED"/);
  assert.match(mutation, /productionStatus !== "COMPLETED"/);
  assert.match(mutation, /actualDeliveryDate/);
  assert.match(mutation, /purchaseOrder\.revision !== expectedRevision/);
  assert.match(mutation, /factoryPurchaseOrder\.updateMany\([\s\S]*?revision: expectedRevision/);
  assert.match(mutation, /assertBusinessOrderWritableInTransaction/);
  assert.match(mutation, /assertCommissionOrderWritableInTransaction/);
  assert.match(mutation, /TransactionIsolationLevel\.Serializable/);
});

test("settlement calculates penalties from the frozen purchase-order contract terms", () => {
  const mutation = exportedFunctionSource("settleFactoryPurchaseOrder", service);

  assert.match(service, /delayGraceDays: true/);
  assert.match(service, /delayPenaltyRatePerDay: true/);
  assert.match(service, /delayPenaltyCapRatio: true/);
  assert.match(mutation, /graceDays: purchaseOrder\.delayGraceDays/);
  assert.match(mutation, /ratePerDay: purchaseOrder\.delayPenaltyRatePerDay/);
  assert.match(mutation, /capRatio: purchaseOrder\.delayPenaltyCapRatio/);
  assert.doesNotMatch(mutation, /0\.003%\/\u5929/);
});

test("settlement confirms provisional adjustments and creates or reuses one confirmed delay deduction", () => {
  const mutation = exportedFunctionSource("settleFactoryPurchaseOrder", service);

  assert.match(mutation, /kind === "DELAY_PENALTY"/);
  assert.match(mutation, /activePenaltyRows\.length > 1/);
  assert.match(mutation, /kind: "DELAY_PENALTY"/);
  assert.match(mutation, /direction: "DECREASE"/);
  assert.match(mutation, /status: "CONFIRMED"/);
  assert.match(mutation, /FACTORY_PURCHASE_SETTLEMENT_PENALTY_SOURCE_TYPE/);
  assert.match(mutation, /status === "PROVISIONAL"/);
  assert.match(mutation, /factoryPurchaseOrderAdjustment\.updateMany/);
  assert.match(mutation, /confirmedById: actorId/);
  assert.match(mutation, /confirmedAt: now/);
});

test("settlement blocks overpayment and atomically creates the snapshot plus the existing-system factory cost", () => {
  const mutation = exportedFunctionSource("settleFactoryPurchaseOrder", service);

  assert.match(mutation, /paidAmount\.gt\(finalPayableAmount\)/);
  assert.match(mutation, /FACTORY_SETTLEMENT_PAYMENT_EXCEEDS_PAYABLE/);
  assert.match(mutation, /factoryPurchaseOrderSettlement\.create/);
  assert.match(mutation, /paidAmountAtSettlement: paidAmount/);
  assert.match(mutation, /status: fullyPaid \? "SETTLED" : "PENDING_PAYMENT"/);
  assert.match(service, /sourceType: FACTORY_PURCHASE_SETTLEMENT_SOURCE_TYPE/);
  assert.match(service, /costType: "工厂货款"/);
  assert.match(service, /costConfirmed: true/);
  assert.match(service, /amountCny: finalPayableAmount\.mul\(exchangeRate\)/);
  assert.match(service, /sourceType_sourceId/);
  assert.match(service, /writeAudit\([\s\S]*?factory_purchase_order_settlements/);
  assert.match(service, /writeAudit\([\s\S]*?order_costs/);
});

test("post-settlement payments remain archive-independent, balance-only, and capped", () => {
  const paymentMutation = exportedFunctionSource("recordFactoryPurchaseOrderPayment", paymentService);

  assert.match(paymentMutation, /before\.settlement\?\.status === "SETTLED"/);
  assert.match(paymentMutation, /kind !== "BALANCE"/);
  assert.match(paymentMutation, /amount\.gt\(remaining\)/);
  assert.doesNotMatch(paymentMutation, /assertBusinessOrderWritableInTransaction/);
  assert.doesNotMatch(paymentMutation, /assertCommissionOrderWritableInTransaction/);
  assert.match(paymentMutation, /finalizeFactorySettlementAfterPayment/);
  assert.match(service, /factoryPurchaseOrderSettlement\.updateMany\([\s\S]*?paidAmountAtSettlement: paidAmount,[\s\S]*?status: "SETTLED"/);
  assert.match(service, /syncFactorySettlementCostPayment/);
  assert.match(service, /paymentStatus: fullyPaid \? "已支付" : partiallyPaid \? "部分支付" : "待支付"/);
});

test("payment, adjustment and production writes require an internally accepted purchase order", () => {
  const executionShared = readFileSync(
    "lib/platform/factory-purchase-order-execution-shared.ts",
    "utf8",
  );

  assert.match(executionShared, /activeSupplierStatuses = \["ACCEPTED"\]/);
  assert.doesNotMatch(executionShared, /DELIVERY_PROPOSED/);
  assert.match(paymentService, /activeSupplierStatuses/);
});

test("settlement freezes fees while payment reversals remain archive-independent", () => {
  const adjustmentMutation = exportedFunctionSource("addFactoryPurchaseOrderAdjustment", paymentService);
  const paymentVoid = exportedFunctionSource("voidFactoryPurchaseOrderPayment", voidService);
  const adjustmentVoid = exportedFunctionSource("voidFactoryPurchaseOrderAdjustment", voidService);

  assert.match(adjustmentMutation, /if \(before\.settlement\)/);
  assert.match(adjustmentMutation, /FACTORY_SETTLEMENT_ADJUSTMENTS_FROZEN/);
  assert.match(adjustmentMutation, /assertBusinessOrderWritableInTransaction/);
  assert.match(paymentVoid, /settlement\?\.status === "SETTLED"/);
  assert.match(paymentVoid, /payment\.kind !== "BALANCE"/);
  assert.doesNotMatch(paymentVoid, /assertBusinessOrderWritableInTransaction/);
  assert.doesNotMatch(paymentVoid, /assertCommissionOrderWritableInTransaction/);
  assert.match(paymentVoid, /syncFactorySettlementCostPayment/);
  assert.match(adjustmentVoid, /adjustment\.purchaseOrder\.settlement/);
  assert.match(adjustmentVoid, /FACTORY_SETTLEMENT_ADJUSTMENTS_FROZEN/);
  assert.match(adjustmentVoid, /assertBusinessOrderWritableInTransaction/);
});

test("settlement route exposes one authenticated audited POST under the purchase order", () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /requireApiActor\(request\)/);
  assert.match(route, /settleFactoryPurchaseOrder\(/);
  assert.match(route, /await parseJsonBody\(request\)/);
  assert.match(route, /settlement\.status === "SETTLED"/);
});
