import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const jiti = createJiti(import.meta.url);
const {
  calculateFactoryDelayPenalty,
  factoryPrepaymentRequiredAmount,
} = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-financials.ts")
>("../lib/platform/factory-purchase-order-financials.ts");
const { requiredFactoryLedgerDate } = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-ledger-values.ts")
>("../lib/platform/factory-purchase-order-ledger-values.ts");

const schema = readPrismaSchemaSource();
const migration = readFileSync(
  "prisma/migrations/20260810033000_factory_purchase_execution_finance/migration.sql",
  "utf8",
);
const supplierConfirmationMigration = readFileSync(
  "prisma/migrations/20260810032000_supplier_purchase_confirmations/migration.sql",
  "utf8",
);
const workflowClosureMigration = readFileSync(
  "prisma/migrations/20260810043000_factory_purchase_workflow_closure/migration.sql",
  "utf8",
);
const invariantCorrectionMigration = readFileSync(
  "prisma/migrations/20260812140000_procurement_database_invariant_corrections/migration.sql",
  "utf8",
);
const supplierResponseCore = readFileSync(
  "lib/platform/factory-purchase-order-response-core.ts",
  "utf8",
);
const deliveryDecisionService = readFileSync(
  "lib/platform/factory-purchase-order-delivery.ts",
  "utf8",
);
const executionService = readFileSync(
  "lib/platform/factory-purchase-order-execution.ts",
  "utf8",
);
const voidService = readFileSync(
  "lib/platform/factory-purchase-order-ledger-void.ts",
  "utf8",
);

function sourceFilesUnder(root: string): Array<{ path: string; source: string }> {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(path);
    return entry.isFile() ? [{ path, source: readFileSync(path, "utf8") }] : [];
  });
}

function exportedFunctionSource(name: string, source = executionService) {
  return source.match(
    new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function|$)`),
  )?.[0] || "";
}

const laterMigrationSources = readdirSync("prisma/migrations", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name > "20260810033000_factory_purchase_execution_finance")
  .map((entry) => ({
    name: entry.name,
    source: readFileSync(join("prisma/migrations", entry.name, "migration.sql"), "utf8"),
  }));
const correctiveMigration = laterMigrationSources.find(({ source }) => (
  /penalty_base_amount/.test(source)
  && /protect_factory_purchase_order_adjustment/.test(source)
))?.source || "";

const factoryPurchaseOrderRouteSources = sourceFilesUnder("app/api/factory-purchase-orders")
  .filter(({ path }) => path.endsWith("route.ts"));
const salesExecutionRouteSources = sourceFilesUnder("app/api/sales-executions")
  .filter(({ path }) => path.endsWith("route.ts"));
const paymentVoidRoute = factoryPurchaseOrderRouteSources.find(({ source }) => (
  /voidFactoryPurchaseOrderPayment/.test(source)
))?.source || "";
const adjustmentVoidRoute = salesExecutionRouteSources.find(({ source }) => (
  /voidFactoryPurchaseOrderAdjustment/.test(source)
))?.source || "";

function prismaModel(name: string) {
  return schema.match(new RegExp(`model ${name}\\b[\\s\\S]*?\\n\\}`))?.[0] || "";
}

test("factory delay penalty starts on day eleven from the immutable first delivery promise", () => {
  const input = {
    initialDeliveryDate: "2026-08-10",
    penaltyBaseAmount: "100000",
  };
  const graceEnd = calculateFactoryDelayPenalty({ ...input, actualDeliveryDate: "2026-08-20" });
  const firstPenaltyDay = calculateFactoryDelayPenalty({ ...input, actualDeliveryDate: "2026-08-21" });
  const fifthPenaltyDay = calculateFactoryDelayPenalty({ ...input, actualDeliveryDate: "2026-08-25" });

  assert.equal(graceEnd.lateCalendarDays, 10);
  assert.equal(graceEnd.delayDays, 0);
  assert.equal(graceEnd.amount.toFixed(2), "0.00");
  assert.equal(firstPenaltyDay.delayDays, 1);
  assert.equal(firstPenaltyDay.amount.toFixed(2), "3.00");
  assert.equal(fifthPenaltyDay.delayDays, 5);
  assert.equal(fifthPenaltyDay.amount.toFixed(2), "15.00");
});

test("later delivery proposals do not change the penalty anchor and the default rule is uncapped", () => {
  type PenaltyInput = Parameters<typeof calculateFactoryDelayPenalty>[0];
  const withCurrentDelivery = (currentDeliveryDate: string) => calculateFactoryDelayPenalty({
    initialDeliveryDate: "2026-08-10",
    actualDeliveryDate: "2026-08-25",
    currentDeliveryDate,
    penaltyBaseAmount: "100000",
  } as unknown as PenaltyInput);

  assert.equal(withCurrentDelivery("2026-08-11").amount.toFixed(2), "15.00");
  assert.equal(withCurrentDelivery("2026-12-31").amount.toFixed(2), "15.00");

  const uncapped = calculateFactoryDelayPenalty({
    initialDeliveryDate: "2026-08-10",
    actualDeliveryDate: "2026-08-25",
    penaltyBaseAmount: "100000",
    graceDays: 10,
    ratePerDay: "1",
    capRatio: null,
  });
  assert.equal(uncapped.delayDays, 5);
  assert.equal(uncapped.amount.toFixed(2), "500000.00");
});

test("factory prepayment supports no prepayment, partial prepayment, and full prepayment", () => {
  assert.equal(factoryPrepaymentRequiredAmount("100000", 0).toFixed(2), "0.00");
  assert.equal(factoryPrepaymentRequiredAmount("100000", "0.30").toFixed(2), "30000.00");
  assert.equal(factoryPrepaymentRequiredAmount("100000", 1).toFixed(2), "100000.00");
});

test("supplier defaults and each factory purchase order keep independent execution snapshots", () => {
  const supplier = prismaModel("Supplier");
  const purchaseOrder = prismaModel("FactoryPurchaseOrder");

  assert.match(supplier, /purchasePrepaymentRatio\s+Decimal/);
  assert.match(supplier, /purchasePrepaymentRequiredBeforeProduction\s+Boolean/);
  assert.match(purchaseOrder, /initialSupplierDeliveryDate\s+DateTime\?/);
  assert.match(purchaseOrder, /penaltyBaseAmount\s+Decimal\?/);
  assert.match(purchaseOrder, /delayGraceDays\s+Int\s+@default\(10\)/);
  assert.match(purchaseOrder, /delayPenaltyRatePerDay\s+Decimal\s+@default\(0\.00003\)/);
  assert.match(purchaseOrder, /delayPenaltyCapRatio\s+Decimal\?/);
  assert.match(purchaseOrder, /productionStatus\s+FactoryPurchaseOrderProductionStatus/);
  assert.match(purchaseOrder, /payments\s+FactoryPurchaseOrderPayment\[\]/);
  assert.match(purchaseOrder, /adjustments\s+FactoryPurchaseOrderAdjustment\[\]/);
  assert.doesNotMatch(prismaModel("SalesExecution"), /productionStatus/);
});

test("payments and adjustments belong to one factory purchase order with auditable identities", () => {
  const payment = prismaModel("FactoryPurchaseOrderPayment");
  const adjustment = prismaModel("FactoryPurchaseOrderAdjustment");
  const adjustmentDirection = schema.match(
    /enum FactoryPurchaseAdjustmentDirection\s+\{[\s\S]*?\n\}/,
  )?.[0] || "";

  assert.match(payment, /purchaseOrderId\s+String/);
  assert.match(payment, /idempotencyKey\s+String/);
  assert.match(payment, /@@unique\(\[purchaseOrderId, idempotencyKey\]\)/);
  assert.match(payment, /@relation\(fields: \[purchaseOrderId, currency\], references: \[id, purchaseCurrency\]/);
  assert.doesNotMatch(payment, /executionId/);

  assert.match(adjustment, /purchaseOrderId\s+String/);
  assert.match(adjustment, /direction\s+FactoryPurchaseAdjustmentDirection/);
  assert.match(adjustment, /@relation\(fields: \[purchaseOrderId, currency\], references: \[id, purchaseCurrency\]/);
  assert.doesNotMatch(adjustment, /executionId/);
  assert.match(adjustmentDirection, /INCREASE/);
  assert.match(adjustmentDirection, /DECREASE/);
});

test("migration freezes the first delivery anchor and prevents duplicate or cross-order ledger rows", () => {
  assert.match(migration, /initial_supplier_delivery_date[\s\S]*delay_grace_days[^\n]*DEFAULT 10/);
  assert.match(migration, /delay_penalty_rate_per_day[^\n]*DEFAULT 0\.00003000/);
  assert.match(migration, /delay_penalty_cap_ratio[^\n]*DECIMAL\(8,6\)(?![^\n]*DEFAULT)/);
  assert.match(migration, /protect_factory_purchase_order_execution_anchors/);
  assert.match(migration, /initial supplier delivery date is immutable/);
  assert.match(migration, /ORDER BY "purchase_order_id", "response_sequence" ASC/);

  assert.match(migration, /factory_purchase_order_payments_purchase_order_id_idempotency_key_key/);
  assert.match(migration, /FOREIGN KEY \("purchase_order_id", "currency"\)[\s\S]*REFERENCES "factory_purchase_orders"\("id", "purchase_currency"\) ON DELETE RESTRICT/);
  assert.match(migration, /factory purchase order payment records cannot be deleted/);
  assert.match(migration, /FactoryPurchaseAdjustmentDirection[^\n]*'INCREASE', 'DECREASE'/);
  assert.match(migration, /WHERE "action" <> 'REJECTED' AND "delivery_date" IS NOT NULL/);
});

test("supplier prices can only accompany the current response and its real actor", () => {
  assert.doesNotMatch(supplierConfirmationMigration, /response_sequence <> parent_response_sequence \+ 1/);
  assert.match(invariantCorrectionMigration, /purchase_order\."supplier_response_sequence"/);
  assert.match(invariantCorrectionMigration, /response\."response_sequence"/);
  assert.match(invariantCorrectionMigration, /response\."responded_by"/);
  assert.match(invariantCorrectionMigration, /response\."responded_at"/);
  assert.match(invariantCorrectionMigration, /response_sequence <> parent_response_sequence \+ 1/);
  assert.match(invariantCorrectionMigration, /NEW\."confirmed_by" IS DISTINCT FROM response_actor_id/);
  assert.match(invariantCorrectionMigration, /NEW\."confirmed_at" IS DISTINCT FROM response_time/);
  assert.match(invariantCorrectionMigration, /item\."purchase_unit_price" IS NOT NULL/);
  assert.match(invariantCorrectionMigration, /price\."amount" IS DISTINCT FROM ROUND\(item\."allocated_quantity" \* price\."unit_price", 2\)/);
});

test("production start is accepted-order only and attributed to an active internal operator", () => {
  const productionGuard = invariantCorrectionMigration.match(
    /CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_production_start_actor"\(\) RETURNS trigger AS \$\$[\s\S]*?\$\$ LANGUAGE plpgsql;/,
  )?.[0] || "";

  assert.match(productionGuard, /NEW\."production_status" = 'IN_PRODUCTION'/);
  assert.match(productionGuard, /NEW\."status" <> 'ACCEPTED'/);
  assert.match(productionGuard, /actor\."supplier_id" IS NULL/);
  assert.match(productionGuard, /actor\."is_active" = TRUE/);
  assert.match(productionGuard, /actor\."approval_status" = 'APPROVED'/);
  assert.match(productionGuard, /NEW\."production_started_at" > CURRENT_TIMESTAMP/);
});

test("historical production start accepts an earlier confirmed response despite a later delivery proposal", () => {
  const preflight = invariantCorrectionMigration.match(
    /DO \$\$[\s\S]*?started purchase order % has an invalid production-start audit[\s\S]*?\$\$;/,
  )?.[0] || "";

  assert.match(preflight, /purchase_order\."status" NOT IN \('ACCEPTED', 'DELIVERY_PROPOSED'\)/);
  assert.match(preflight, /accepted_response\."action" = 'ACCEPTED'/);
  assert.match(preflight, /accepted_response\."responded_at" <= purchase_order\."production_started_at"/);
  assert.match(preflight, /accepted_response\."action" = 'DELIVERY_PROPOSED'/);
  assert.match(preflight, /accepted_response\."internal_decision" = 'ACCEPTED'/);
  assert.match(preflight, /accepted_response\."internal_decided_at" <= purchase_order\."production_started_at"/);
  assert.doesNotMatch(preflight, /purchase_order\."production_started_at" < purchase_order\."responded_at"/);
});

test("a direct acceptance freezes the first promise while later delivery changes await internal approval", () => {
  assert.match(
    supplierResponseCore,
    /firstAcceptedResponse\s*=\s*response\.action === "ACCEPTED" && !before\.initialSupplierDeliveryDate/,
  );
  assert.match(
    supplierResponseCore,
    /before\.status === "DELIVERY_PROPOSED"[\s\S]*?SUPPLIER_PURCHASE_ORDER_PROPOSAL_PENDING/,
  );
  assert.match(deliveryDecisionService, /firstConfirmation = input\.decision === "ACCEPTED" && !before\.confirmedSupplierDeliveryDate/);
  assert.match(deliveryDecisionService, /\.\.\.\(firstConfirmation \? \{[\s\S]*?initialSupplierDeliveryDate: proposal\.deliveryDate/);
  assert.equal(
    supplierResponseCore.match(/initialSupplierDeliveryDate: response\.deliveryDate/g)?.length,
    1,
  );
  assert.equal(
    deliveryDecisionService.match(/initialSupplierDeliveryDate: proposal\.deliveryDate/g)?.length,
    1,
  );
});

test("direct or internally approved first acceptance freezes the penalty base without moving the first promise later", () => {
  assert.match(
    supplierResponseCore,
    /freezePenaltyBase\s*=\s*response\.action === "ACCEPTED" && before\.penaltyBaseAmount === null/,
  );
  assert.match(
    supplierResponseCore,
    /penaltyBaseAmount\s*=\s*freezePenaltyBase\s*\?[\s\S]*?effectiveFactoryPurchaseOrderAmount\(effectiveItems\)[\s\S]*?:\s*before\.penaltyBaseAmount/,
  );
  assert.match(
    supplierResponseCore,
    /\.\.\.\(freezePenaltyBase \? \{\s*penaltyBaseAmount[,\s]/,
  );
  assert.match(deliveryDecisionService, /penaltyBaseAmount = firstConfirmation \? effectiveFactoryPurchaseOrderAmount\(before\.items\) : before\.penaltyBaseAmount/);
  assert.match(deliveryDecisionService, /\.\.\.\(firstConfirmation \? \{[\s\S]*?penaltyBaseAmount,/);
  assert.match(deliveryDecisionService, /input\.decision === "ACCEPTED" \? \{ confirmedSupplierDeliveryDate: proposal\.deliveryDate \}/);
});

test("production starts independently for one factory without waiting for any other factory", () => {
  const productionMutation = executionService.match(
    /export async function updateFactoryPurchaseOrderProduction[\s\S]*?\n\}\n\nexport async function/,
  )?.[0] || "";

  assert.match(productionMutation, /lockFactoryPurchaseOrder\(tx, purchaseOrderId\)/);
  assert.match(
    productionMutation,
    /loadPurchaseOrderForSales\(tx, executionId, purchaseOrderId, actor\)/,
  );
  assert.match(productionMutation, /where: \{ id: before\.id \}/);
  assert.match(productionMutation, /before\.productionStatus !== "READY"/);
  assert.doesNotMatch(productionMutation, /factoryPurchaseOrder\.(?:findMany|count)/);
  assert.doesNotMatch(productionMutation, /purchaseOrders|\.every\(|\.some\(/);
  assert.doesNotMatch(productionMutation, /execution\.status|SalesExecutionStatus/);
});

test("procurement payments and adjustments stay on the factory order and never write receivables or costs", () => {
  assert.match(
    executionService,
    /before\.payments\.find\(\(payment\) => payment\.idempotencyKey === idempotencyKey\)/,
  );
  assert.match(
    executionService,
    /factoryPurchaseOrderPayment\.create\(\{[\s\S]*?purchaseOrderId: before\.id,[\s\S]*?idempotencyKey/,
  );
  assert.match(
    executionService,
    /factoryPurchaseOrderAdjustment\.create\(\{[\s\S]*?purchaseOrderId: before\.id,[\s\S]*?direction/,
  );
  assert.doesNotMatch(
    executionService,
    /(?:prisma|tx)\.(?:receivableOrder|orderCost)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)/,
  );
});

test("finance payment reads inside the write transaction keep the sales-execution data scope", () => {
  const financeLoader = executionService.match(
    /async function loadPurchaseOrderForFinance[\s\S]*?(?=\nfunction paymentSummary)/,
  )?.[0] || "";
  const paymentMutation = exportedFunctionSource("recordFactoryPurchaseOrderPayment");

  assert.match(financeLoader, /actor:\s*SalesExecutionActor/);
  assert.match(financeLoader, /factoryPurchaseOrder\.findFirst\(/);
  assert.doesNotMatch(financeLoader, /factoryPurchaseOrder\.findUnique\(/);
  assert.match(financeLoader, /execution:\s*\{\s*is:\s*salesExecutionAccessWhere\(actor\)\s*\}/);
  assert.match(
    paymentMutation,
    /loadPurchaseOrderForFinance\(tx,\s*purchaseOrderId,\s*actor\)/,
  );
  assert.match(
    paymentMutation,
    /loadPurchaseOrderForFinance\(tx,\s*before\.id,\s*actor\)/,
  );
});

test("factory payment dates cannot be later than today", () => {
  const paymentMutation = exportedFunctionSource("recordFactoryPurchaseOrderPayment");

  assert.match(
    paymentMutation,
    /paidAt\s*=\s*requiredFactoryLedgerDate\(input\.paidAt,\s*"付款日期",\s*false\)/,
  );
  assert.throws(
    () => requiredFactoryLedgerDate("2999-01-01", "付款日期", false),
    (error: unknown) => (error as { code?: string }).code === "FACTORY_LEDGER_DATE_FUTURE",
  );
});

test("idempotency conflicts compare every accepted payment and adjustment input field", () => {
  const paymentMutation = exportedFunctionSource("recordFactoryPurchaseOrderPayment");
  const adjustmentMutation = exportedFunctionSource("addFactoryPurchaseOrderAdjustment");

  for (const field of ["kind", "amount", "paidAt", "bankReference", "remark"]) {
    assert.match(paymentMutation, new RegExp(`existing\\.${field}\\b`));
  }
  assert.match(paymentMutation, /FACTORY_PAYMENT_IDEMPOTENCY_CONFLICT/);

  for (const field of ["kind", "direction", "amount", "description", "occurredAt"]) {
    assert.match(adjustmentMutation, new RegExp(`existing\\.${field}\\b`));
  }
  assert.match(adjustmentMutation, /FACTORY_ADJUSTMENT_IDEMPOTENCY_CONFLICT/);
});

test("payment and adjustment void operations are explicit audited state transitions with routes", () => {
  const paymentVoid = exportedFunctionSource("voidFactoryPurchaseOrderPayment", voidService);
  const adjustmentVoid = exportedFunctionSource("voidFactoryPurchaseOrderAdjustment", voidService);

  assert.match(paymentVoid, /assertWrite\(actor,\s*"payments"\)/);
  assert.match(paymentVoid, /status:\s*"VOIDED"/);
  assert.match(paymentVoid, /voidedById:\s*actorId/);
  assert.match(paymentVoid, /data:\s*\{[\s\S]*?\bvoidedAt\b/);
  assert.match(paymentVoid, /voidReason:/);
  assert.match(paymentVoid, /writeAudit\(/);

  assert.match(adjustmentVoid, /assertWrite\(actor,\s*"costs"\)/);
  assert.match(adjustmentVoid, /status:\s*"VOIDED"/);
  assert.match(adjustmentVoid, /voidedById:\s*actorId/);
  assert.match(adjustmentVoid, /data:\s*\{[\s\S]*?\bvoidedAt\b/);
  assert.match(adjustmentVoid, /voidReason:/);
  assert.match(adjustmentVoid, /writeAudit\(/);

  assert.match(paymentVoidRoute, /export async function DELETE/);
  assert.match(paymentVoidRoute, /requireApiActor\(request\)/);
  assert.match(paymentVoidRoute, /voidFactoryPurchaseOrderPayment\(/);
  assert.match(adjustmentVoidRoute, /export async function DELETE/);
  assert.match(adjustmentVoidRoute, /requireApiActor\(request\)/);
  assert.match(adjustmentVoidRoute, /voidFactoryPurchaseOrderAdjustment\(/);
});

test("voiding a prepayment relocks only a not-yet-started order whose threshold is no longer met", () => {
  const paymentVoid = exportedFunctionSource("voidFactoryPurchaseOrderPayment", voidService);

  assert.match(voidService, /kind === "PREPAYMENT"/);
  assert.match(paymentVoid, /productionStatus === "READY"/);
  assert.match(paymentVoid, /\.lt\(required\)|!\w+\.gte\(required\)/);
  assert.match(paymentVoid, /productionStatus:\s*"WAITING_PREPAYMENT"/);
  assert.doesNotMatch(
    paymentVoid,
    /productionStatus:\s*\{\s*in:\s*\[\s*"IN_PRODUCTION"|before\.productionStatus === "IN_PRODUCTION"/,
  );
});

test("corrective migration repairs and enforces execution anchors before production can be active", () => {
  assert.ok(correctiveMigration, "expected a later corrective factory-execution migration");
  assert.match(
    correctiveMigration,
    /UPDATE\s+"factory_purchase_orders"[\s\S]*?SET[\s\S]*?"penalty_base_amount"[\s\S]*?WHERE[\s\S]*?"penalty_base_amount"\s+IS\s+NULL/i,
  );
  assert.match(correctiveMigration, /'ACCEPTED'[\s\S]*?'DELIVERY_PROPOSED'/);

  const anchorConstraint = correctiveMigration.match(
    /ADD CONSTRAINT\s+"[^"]+"\s+CHECK\s*\([\s\S]*?"production_status"[\s\S]*?\);/i,
  )?.[0] || "";
  for (const status of ["READY", "IN_PRODUCTION", "COMPLETED"]) {
    assert.match(anchorConstraint, new RegExp(`'${status}'`));
  }
  assert.match(anchorConstraint, /"initial_supplier_delivery_date"\s+IS\s+NOT\s+NULL/i);
  assert.match(anchorConstraint, /"penalty_base_amount"\s+IS\s+NOT\s+NULL/i);
});

test("corrective migration permits confirmed adjustments to be voided but keeps voided rows immutable", () => {
  const adjustmentGuard = correctiveMigration.match(
    /CREATE OR REPLACE FUNCTION\s+"protect_factory_purchase_order_adjustment"\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/,
  )?.[0] || "";

  assert.match(adjustmentGuard, /OLD\."status"\s*=\s*'VOIDED'/);
  assert.match(
    adjustmentGuard,
    /OLD\."status"\s*=\s*'CONFIRMED'[\s\S]*?NEW\."status"\s*<>\s*'VOIDED'/,
  );
  assert.doesNotMatch(
    adjustmentGuard,
    /OLD\."status"\s+IN\s*\([^)]*'CONFIRMED'[^)]*'VOIDED'[^)]*\)/,
  );
});
