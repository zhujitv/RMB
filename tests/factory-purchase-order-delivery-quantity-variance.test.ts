import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  DEFAULT_FACTORY_DELIVERY_QUANTITY_TOLERANCE_RATIO,
  MAX_FACTORY_DELIVERY_QUANTITY_TOLERANCE_RATIO,
  normalizeDeliveryQuantityToleranceRatio,
  normalizeDeliveryQuantityVarianceInput,
} = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-delivery-quantity-variance-inputs.ts")
>("../lib/platform/factory-purchase-order-delivery-quantity-variance-inputs.ts");
const {
  deliveryQuantityTarget,
  productionProgressMeetsDeliveryTarget,
  resolveDeliveryQuantityTargets,
} = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-delivery-quantity-variance-values.ts")
>("../lib/platform/factory-purchase-order-delivery-quantity-variance-values.ts");

const schema = readPrismaSchemaSource();
const migration = readFileSync(
  "prisma/migrations/20260816190000_factory_purchase_delivery_quantity_variance/migration.sql",
  "utf8",
);
const inputSource = readFileSync(
  "lib/platform/factory-purchase-order-delivery-quantity-variance-inputs.ts",
  "utf8",
);
const valuesSource = readFileSync(
  "lib/platform/factory-purchase-order-delivery-quantity-variance-values.ts",
  "utf8",
);

const targets = [
  { id: "line-a", allocatedQuantity: "100" },
  { id: "line-b", allocatedQuantity: "10" },
];

function errorCode(error: unknown) {
  return String((error as { code?: string } | null)?.code || "");
}

test("supplier and purchase-order delivery tolerance defaults to an exact capped five percent", () => {
  assert.equal(DEFAULT_FACTORY_DELIVERY_QUANTITY_TOLERANCE_RATIO.toString(), "0.05");
  assert.equal(MAX_FACTORY_DELIVERY_QUANTITY_TOLERANCE_RATIO.toString(), "0.05");
  assert.equal(normalizeDeliveryQuantityToleranceRatio(undefined).toString(), "0.05");
  assert.equal(normalizeDeliveryQuantityToleranceRatio("0").toString(), "0");
  assert.equal(normalizeDeliveryQuantityToleranceRatio("0.025000").toString(), "0.025");
  assert.equal(normalizeDeliveryQuantityToleranceRatio("0.05").toString(), "0.05");

  for (const value of ["-0.01", "0.050001", "0.0000001", "5", "1e-2"]) {
    assert.throws(
      () => normalizeDeliveryQuantityToleranceRatio(value),
      (error: unknown) => errorCode(error) === "FACTORY_DELIVERY_QUANTITY_TOLERANCE_INVALID",
    );
  }
});

test("variance input requires a reason and every purchase-order line exactly once", () => {
  const normalized = normalizeDeliveryQuantityVarianceInput({
    expectedRevision: 8,
    reason: "  工厂最终装箱数量调整  ",
    items: [
      { purchaseOrderItemId: "line-b", proposedQuantity: "10.5000" },
      { purchaseOrderItemId: "line-a", proposedQuantity: "95.0000" },
    ],
  }, targets, "0.05");

  assert.equal(normalized.expectedRevision, 8);
  assert.equal(normalized.reason, "工厂最终装箱数量调整");
  assert.equal(normalized.toleranceRatio.toString(), "0.05");
  assert.deepEqual(normalized.items.map((item) => ({
    id: item.purchaseOrderItemId,
    ordered: item.orderedQuantitySnapshot.toString(),
    proposed: item.proposedQuantity.toString(),
  })), [
    { id: "line-b", ordered: "10", proposed: "10.5" },
    { id: "line-a", ordered: "100", proposed: "95" },
  ]);

  assert.throws(
    () => normalizeDeliveryQuantityVarianceInput({
      expectedRevision: 8,
      reason: " ",
      items: [
        { purchaseOrderItemId: "line-a", proposedQuantity: "99" },
        { purchaseOrderItemId: "line-b", proposedQuantity: "10" },
      ],
    }, targets),
    (error: unknown) => errorCode(error) === "FACTORY_DELIVERY_QUANTITY_VARIANCE_REASON_REQUIRED",
  );
  assert.throws(
    () => normalizeDeliveryQuantityVarianceInput({
      expectedRevision: 8,
      reason: "x".repeat(2_001),
      items: [
        { purchaseOrderItemId: "line-a", proposedQuantity: "99" },
        { purchaseOrderItemId: "line-b", proposedQuantity: "10" },
      ],
    }, targets),
    (error: unknown) => errorCode(error) === "FACTORY_DELIVERY_QUANTITY_VARIANCE_REASON_TOO_LONG",
  );
});

test("variance input rejects missing, duplicate, and foreign purchase-order lines", () => {
  for (const [items, code] of [
    [[
      { purchaseOrderItemId: "line-a", proposedQuantity: "99" },
    ], "FACTORY_DELIVERY_QUANTITY_VARIANCE_ITEMS_REQUIRED"],
    [[
      { purchaseOrderItemId: "line-a", proposedQuantity: "99" },
      { purchaseOrderItemId: "line-a", proposedQuantity: "99" },
    ], "FACTORY_DELIVERY_QUANTITY_VARIANCE_ITEM_DUPLICATE"],
    [[
      { purchaseOrderItemId: "line-a", proposedQuantity: "99" },
      { purchaseOrderItemId: "foreign-line", proposedQuantity: "10" },
    ], "FACTORY_DELIVERY_QUANTITY_VARIANCE_ITEM_NOT_FOUND"],
  ] as const) {
    assert.throws(
      () => normalizeDeliveryQuantityVarianceInput({
        expectedRevision: 1,
        reason: "数量调整",
        items,
      }, targets),
      (error: unknown) => errorCode(error) === code,
    );
  }
});

test("variance quantities are positive exact decimals and any difference requires approval", () => {
  for (const proposedQuantity of [0, 1, "0", "-1", "1e2", "1.00001", "100000000000000.0000"]) {
    assert.throws(
      () => normalizeDeliveryQuantityVarianceInput({
        expectedRevision: 1,
        reason: "数量调整",
        items: [
          { purchaseOrderItemId: "line-a", proposedQuantity },
          { purchaseOrderItemId: "line-b", proposedQuantity: "10" },
        ],
      }, targets),
      (error: unknown) => errorCode(error) === "FACTORY_DELIVERY_QUANTITY_VARIANCE_QUANTITY_INVALID",
    );
  }
  assert.throws(
    () => normalizeDeliveryQuantityVarianceInput({
      expectedRevision: 1,
      reason: "没有差异",
      items: [
        { purchaseOrderItemId: "line-a", proposedQuantity: "100" },
        { purchaseOrderItemId: "line-b", proposedQuantity: "10.0000" },
      ],
    }, targets),
    (error: unknown) => errorCode(error) === "FACTORY_DELIVERY_QUANTITY_VARIANCE_NOT_REQUIRED",
  );
});

test("both shortage and overage are accepted only at or inside the snapshotted tolerance", () => {
  for (const proposedQuantity of ["95", "105"]) {
    const normalized = normalizeDeliveryQuantityVarianceInput({
      expectedRevision: 1,
      reason: "边界差异",
      items: [
        { purchaseOrderItemId: "line-a", proposedQuantity },
        { purchaseOrderItemId: "line-b", proposedQuantity: "10" },
      ],
    }, targets, "0.05");
    assert.equal(normalized.items[0].proposedQuantity.toString(), proposedQuantity);
  }
  for (const proposedQuantity of ["94.9999", "105.0001"]) {
    assert.throws(
      () => normalizeDeliveryQuantityVarianceInput({
        expectedRevision: 1,
        reason: "超公差",
        items: [
          { purchaseOrderItemId: "line-a", proposedQuantity },
          { purchaseOrderItemId: "line-b", proposedQuantity: "10" },
        ],
      }, targets, "0.05"),
      (error: unknown) => errorCode(error) === "FACTORY_DELIVERY_QUANTITY_VARIANCE_TOLERANCE_EXCEEDED",
    );
  }
  assert.doesNotThrow(() => normalizeDeliveryQuantityVarianceInput({
    expectedRevision: 1,
    reason: "供应商公差更严格",
    items: [
      { purchaseOrderItemId: "line-a", proposedQuantity: "98" },
      { purchaseOrderItemId: "line-b", proposedQuantity: "10" },
    ],
  }, targets, "0.02"));
  assert.throws(
    () => normalizeDeliveryQuantityVarianceInput({
      expectedRevision: 1,
      reason: "超过供应商快照公差",
      items: [
        { purchaseOrderItemId: "line-a", proposedQuantity: "97.9999" },
        { purchaseOrderItemId: "line-b", proposedQuantity: "10" },
      ],
    }, targets, "0.02"),
    (error: unknown) => errorCode(error) === "FACTORY_DELIVERY_QUANTITY_VARIANCE_TOLERANCE_EXCEEDED",
  );
});

test("future production target helper uses approved proposed quantities and completed greater-than-or-equal", () => {
  assert.equal(deliveryQuantityTarget("10").toString(), "10");
  assert.equal(deliveryQuantityTarget("10", "9.5").toString(), "9.5");
  const approved = {
    status: "APPROVED",
    items: [
      { purchaseOrderItemId: "line-a", proposedQuantity: "95" },
      { purchaseOrderItemId: "line-b", proposedQuantity: "10.5" },
    ],
  };
  assert.deepEqual(
    resolveDeliveryQuantityTargets(targets, approved).map((item) => item.targetQuantity.toString()),
    ["95", "10.5"],
  );
  assert.deepEqual(
    resolveDeliveryQuantityTargets(targets, { ...approved, status: "PENDING" })
      .map((item) => item.targetQuantity.toString()),
    ["100", "10"],
  );
  assert.equal(productionProgressMeetsDeliveryTarget([
    { purchaseOrderItemId: "line-a", completedQuantity: "95" },
    { purchaseOrderItemId: "line-b", completedQuantity: "10.5" },
  ], targets, approved), true);
  assert.equal(productionProgressMeetsDeliveryTarget([
    { purchaseOrderItemId: "line-a", completedQuantity: "100" },
    { purchaseOrderItemId: "line-b", completedQuantity: "10.4999" },
  ], targets, approved), false);
  assert.equal(productionProgressMeetsDeliveryTarget([
    { purchaseOrderItemId: "line-a", completedQuantity: "96" },
    { purchaseOrderItemId: "line-b", completedQuantity: "11" },
  ], targets, approved), true);
});

test("approved target helper rejects incomplete, duplicate, and foreign snapshots", () => {
  assert.throws(() => resolveDeliveryQuantityTargets(targets, {
    status: "APPROVED",
    items: [{ purchaseOrderItemId: "line-a", proposedQuantity: "95" }],
  }), /not a complete purchase-order snapshot/);
  assert.throws(() => resolveDeliveryQuantityTargets(targets, {
    status: "APPROVED",
    items: [
      { purchaseOrderItemId: "line-a", proposedQuantity: "95" },
      { purchaseOrderItemId: "line-a", proposedQuantity: "96" },
    ],
  }), /duplicate purchase-order items/);
  assert.throws(() => resolveDeliveryQuantityTargets(targets, {
    status: "APPROVED",
    items: [
      { purchaseOrderItemId: "line-a", proposedQuantity: "95" },
      { purchaseOrderItemId: "foreign-line", proposedQuantity: "10" },
    ],
  }), /not a complete purchase-order snapshot/);
});

test("schema stores supplier policy, purchase-order snapshot, actual facts, and request history", () => {
  const supplier = schema.match(/model Supplier\b[\s\S]*?\n\}/)?.[0] || "";
  const purchaseOrder = schema.match(/model FactoryPurchaseOrder\b[\s\S]*?\n\}/)?.[0] || "";
  const purchaseItem = schema.match(/model FactoryPurchaseOrderItem\b[\s\S]*?\n\}/)?.[0] || "";
  const variance = schema.match(/model FactoryPurchaseOrderDeliveryQuantityVariance\b[\s\S]*?\n\}/)?.[0] || "";
  const varianceItem = schema.match(/model FactoryPurchaseOrderDeliveryQuantityVarianceItem\b[\s\S]*?\n\}/)?.[0] || "";

  assert.match(supplier, /purchaseQuantityToleranceRatio\s+Decimal\s+@default\(0\.05\)[\s\S]*@db\.Decimal\(8, 6\)/);
  assert.match(purchaseOrder, /deliveryQuantityToleranceRatio\s+Decimal\s+@default\(0\.05\)[\s\S]*@db\.Decimal\(8, 6\)/);
  assert.match(purchaseItem, /actualDeliveredQuantity\s+Decimal\?[\s\S]*@db\.Decimal\(18, 4\)/);
  assert.match(schema, /enum FactoryDeliveryQuantityVarianceStatus\s*\{\s*PENDING\s+APPROVED\s+REJECTED\s*\}/);
  for (const field of [
    "purchaseOrderId", "sequenceNo", "status", "source", "channel", "supplierContact",
    "supplierRequestedAt", "requestedAt", "requestedById", "reason", "decidedAt",
    "decidedById", "decisionRemark",
  ]) assert.match(variance, new RegExp(`\\b${field}\\b`));
  assert.match(varianceItem, /orderedQuantitySnapshot\s+Decimal[\s\S]*@db\.Decimal\(18, 4\)/);
  assert.match(varianceItem, /proposedQuantity\s+Decimal[\s\S]*@db\.Decimal\(18, 4\)/);
  assert.match(varianceItem, /fields: \[purchaseOrderItemId, purchaseOrderId\][\s\S]*references: \[id, purchaseOrderId\]/);
});

test("migration is transactional and enforces tolerance, status, and relational uniqueness", () => {
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /CREATE TYPE "FactoryDeliveryQuantityVarianceStatus" AS ENUM/);
  assert.match(migration, /purchase_quantity_tolerance_ratio" DECIMAL\(8,6\) NOT NULL DEFAULT 0\.05/);
  assert.match(migration, /delivery_quantity_tolerance_ratio" DECIMAL\(8,6\) NOT NULL DEFAULT 0\.05/);
  assert.ok((migration.match(/BETWEEN 0 AND 0\.05/g) || []).length >= 2);
  assert.match(migration, /fpo_delivery_quantity_variance_one_pending_key[\s\S]*WHERE "status" = 'PENDING'/);
  assert.match(migration, /fpo_delivery_quantity_variance_one_approved_key[\s\S]*WHERE "status" = 'APPROVED'/);
  assert.match(migration, /fpo_delivery_quantity_variance_po_sequence_key/);
  assert.match(migration, /FOREIGN KEY \("variance_id", "purchase_order_id"\)[\s\S]*REFERENCES "factory_purchase_order_delivery_quantity_variances"/);
  assert.match(migration, /FOREIGN KEY \("purchase_order_item_id", "purchase_order_id"\)[\s\S]*REFERENCES "factory_purchase_order_items"/);
  assert.match(migration, /fpo_delivery_quantity_variance_decision_state_check/);
});

test("database accepts requests only for scoped in-production undelivered purchase orders", () => {
  assert.match(migration, /purchase_order_status <> 'ACCEPTED'/);
  assert.match(migration, /purchase_order_production_status <> 'IN_PRODUCTION'/);
  assert.match(migration, /actual_delivery_date IS NOT NULL/);
  assert.match(migration, /shipping_started_at IS NOT NULL/);
  assert.match(migration, /NEW\."status" <> 'PENDING'/);
  assert.match(migration, /requester\."supplier_id" = purchase_order_supplier_id/);
  assert.match(migration, /requester\."supplier_id" IS NULL/);
  assert.match(migration, /NEW\."source" = 'SUPPLIER_PORTAL'[\s\S]*NEW\."channel" <> 'PORTAL'/);
  assert.match(migration, /NEW\."source" = 'INTERNAL_OFFLINE'[\s\S]*NEW\."channel" = 'PORTAL'/);
  assert.match(migration, /NEW\."supplier_requested_at" < production_started_at/);
  assert.match(migration, /active_variance\."status" IN \('PENDING', 'APPROVED'\)/);
  assert.match(migration, /clock_timestamp\(\)/);
});

test("database snapshot is full, exact, inside tolerance, and immutable after one decision", () => {
  assert.match(migration, /NEW\."ordered_quantity_snapshot" <> allocated_quantity/);
  assert.match(migration, /ABS\(NEW\."proposed_quantity" - NEW\."ordered_quantity_snapshot"\)/);
  assert.match(migration, /NEW\."ordered_quantity_snapshot" \* tolerance_ratio/);
  assert.match(migration, /requested_item_count <> expected_item_count/);
  assert.match(migration, /proposed_quantity" <> variance_item\."ordered_quantity_snapshot/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /OLD\."status" <> 'PENDING'/);
  assert.match(migration, /NEW\."status" NOT IN \('APPROVED', 'REJECTED'\)/);
  assert.match(migration, /variance request history is immutable/);
  assert.match(migration, /variance items are immutable/);
  assert.match(migration, /decider\."supplier_id" IS NULL/);
});

test("historic delivered orders receive exact approved snapshots and actual quantities", () => {
  assert.match(migration, /SET "actual_delivered_quantity" = item\."allocated_quantity"/);
  assert.match(migration, /WHERE purchase_order\."actual_delivery_date" IS NOT NULL/);
  assert.match(migration, /'fpo-delivery-variance-' \|\| MD5\(purchase_order\."id"\)/);
  assert.match(migration, /'APPROVED',[\s\S]*'INTERNAL_OFFLINE',[\s\S]*'OTHER'/);
  assert.match(migration, /ordered_quantity_snapshot", "proposed_quantity"/);
  assert.match(migration, /item\."allocated_quantity",\s*item\."allocated_quantity"/);
});

test("actual delivered quantity is final, target-matched, full-line, and date-coupled", () => {
  assert.match(migration, /actual factory delivered quantity is immutable/);
  assert.match(migration, /variance\."status" = 'APPROVED'/);
  assert.match(migration, /expected_quantity := COALESCE\(approved_quantity, NEW\."allocated_quantity"\)/);
  assert.match(migration, /actual delivered quantity does not match the approved delivery target/);
  assert.match(migration, /actual_quantity_count <> item_count/);
  assert.match(migration, /actual delivered quantities require an actual delivery date/);
  assert.match(migration, /AFTER UPDATE OF "actual_delivery_date"/);
  assert.match(migration, /AFTER UPDATE OF "actual_delivered_quantity"/);
  assert.match(migration, /TO_JSONB\(NEW\) - 'actual_delivered_quantity'/);
});

test("database production ceiling follows the approved target without changing current services", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_production_report_item"/);
  assert.match(migration, /COALESCE\(approved_item\."proposed_quantity", item\."allocated_quantity"\)/);
  assert.match(migration, /approved\."status" = 'APPROVED'/);
  assert.match(migration, /NEW\."completed_quantity" > allowed_quantity/);
  assert.match(migration, /production completed quantity exceeds the approved delivery target/);
  assert.match(migration, /allowed_quantity := GREATEST\(target_quantity, COALESCE\(previous_completed_quantity, 0\)\)/);
  assert.match(migration, /factory_purchase_order_pending_variance_completion_guard/);
  assert.match(migration, /pending delivery quantity variance must be decided before production completion/);
  assert.match(migration, /pending delivery quantity variance must be decided before actual delivery/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION "protect_sales_execution_shipping_anchor"/);
  assert.match(migration, /missing_actual_quantity_count/);
  assert.match(migration, /SUM\(item\."actual_delivered_quantity"\)/);
  assert.match(migration, /delivered\.delivered_quantity, 0\) < execution_item\."quantity"/);
  assert.match(migration, /'历史交付记录'/);
  assert.doesNotMatch(migration, /BTRIM\(actor\."name"\)/);
  assert.doesNotMatch(migration, /UPDATE "factory_purchase_order_production_reports"/);
});

test("forward-only settlement guard prices actual delivered quantities per line", () => {
  const settlementGuard = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_settlement_insert"'),
    migration.lastIndexOf("COMMIT;"),
  );

  assert.match(settlementGuard, /item\."actual_delivered_quantity"/);
  assert.match(settlementGuard, /COALESCE\(supplier_price\."unit_price", item\."purchase_unit_price"\)/);
  assert.match(settlementGuard, /SUM\(ROUND\([\s\S]*item\."actual_delivered_quantity"[\s\S]*COALESCE\(supplier_price\."unit_price", item\."purchase_unit_price"\),[\s\S]*2[\s\S]*\)\)/);
  assert.match(settlementGuard, /missing_delivery_quantity_count <> 0/);
  assert.match(settlementGuard, /missing_effective_price_count <> 0/);
  assert.match(settlementGuard, /NEW\."base_amount" IS DISTINCT FROM expected_delivery_base/);
  assert.match(settlementGuard, /expected_final_payable := ROUND\(\s*expected_delivery_base/);
  assert.doesNotMatch(settlementGuard, /NEW\."base_amount" IS DISTINCT FROM purchase_order\."penalty_base_amount"/);
});

test("settlement delay penalty keeps the original contractual base and history is untouched", () => {
  const settlementGuard = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_settlement_insert"'),
    migration.lastIndexOf("COMMIT;"),
  );

  assert.match(settlementGuard, /uncapped_delay_penalty := ROUND\(\s*purchase_order\."penalty_base_amount"/);
  assert.match(settlementGuard, /ROUND\(purchase_order\."penalty_base_amount" \* purchase_order\."delay_penalty_cap_ratio", 2\)/);
  assert.doesNotMatch(migration, /ALTER TABLE "factory_purchase_order_settlements"/);
  assert.doesNotMatch(migration, /UPDATE "factory_purchase_order_settlements"/);
  assert.doesNotMatch(migration, /UPDATE "factory_purchase_orders"[\s\S]*"penalty_base_amount"/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_settlement_insert"/);
});

test("quantity and tolerance helpers never use floating-point arithmetic", () => {
  for (const source of [inputSource, valuesSource]) {
    assert.doesNotMatch(source, /parseFloat|parseInt|Number\(|Math\.(?:abs|round|floor|ceil)/);
  }
  assert.match(inputSource, /new Prisma\.Decimal/);
  assert.match(inputSource, /absoluteDifference\.gt\(orderedQuantitySnapshot\.mul\(normalizedTolerance\)\)/);
  assert.match(valuesSource, /completed\.gte\(target\.targetQuantity\)/);
});
