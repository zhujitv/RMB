import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildFactoryPurchaseOrderLoadingSnapshot,
  approvedFactoryPurchaseOrderLoadingResults,
  approvedLoadingQuantityByPurchaseOrderItem,
  serializeFactoryPurchaseLoadingSnapshotItem,
  FactoryPurchaseLoadingSnapshotError,
} = jiti("../lib/platform/factory-purchase-order-loading-result-values.ts") as typeof import(
  "../lib/platform/factory-purchase-order-loading-result-values"
);

const schema = readFileSync("prisma/models/factory-purchase-order-loading-result.prisma", "utf8");
const purchaseSchema = readFileSync("prisma/models/sales-executions.prisma", "utf8");
const identitySchema = readFileSync("prisma/models/identity.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260816210000_factory_purchase_loading_result/migration.sql",
  "utf8",
);

function target(
  purchaseOrderItemId: string,
  plannedQuantity: string,
  deliveryTargetQuantity: string,
  completedQuantity: string,
  previouslyApprovedLoadedQuantity = "0",
) {
  return {
    purchaseOrderItemId,
    plannedQuantity,
    deliveryTargetQuantity,
    completedQuantity,
    previouslyApprovedLoadedQuantity,
  };
}

function loaded(purchaseOrderItemId: string, loadedQuantity: string) {
  return { purchaseOrderItemId, loadedQuantity };
}

test("container/PO snapshot separates plan, current load, cumulative load and unpaid retained stock", () => {
  const snapshot = buildFactoryPurchaseOrderLoadingSnapshot({
    reason: "WEIGHT_LIMIT",
    targetItems: [
      target("line-a", "55", "105", "110", "50"),
      target("line-b", "20", "20", "20"),
    ],
    loadedItems: [loaded("line-a", "50"), loaded("line-b", "20")],
  });
  assert.equal(snapshot.totalPlannedQuantity.toString(), "75");
  assert.equal(snapshot.totalLoadedQuantity.toString(), "70");
  assert.equal(snapshot.totalWarehouseRetainedQuantity.toString(), "10");
  assert.deepEqual(snapshot.items.map((item) => ({
    id: item.purchaseOrderItemId,
    plan: item.plannedQuantitySnapshot.toString(),
    previous: item.previouslyApprovedLoadedQuantitySnapshot.toString(),
    current: item.loadedQuantity.toString(),
    cumulative: item.cumulativeApprovedLoadedQuantitySnapshot.toString(),
    retained: item.warehouseRetainedQuantitySnapshot.toString(),
  })), [
    { id: "line-a", plan: "55", previous: "50", current: "50", cumulative: "100", retained: "10" },
    { id: "line-b", plan: "20", previous: "0", current: "20", cumulative: "20", retained: "0" },
  ]);
});

test("EXACT compares the current container contribution with its plan, not the whole PO target", () => {
  const snapshot = buildFactoryPurchaseOrderLoadingSnapshot({
    reason: "EXACT",
    targetItems: [target("line-a", "40", "100", "105", "60")],
    loadedItems: [loaded("line-a", "40")],
  });
  assert.equal(snapshot.hasPlannedDifference, false);
  assert.equal(snapshot.items[0]?.cumulativeApprovedLoadedQuantitySnapshot.toString(), "100");
  assert.equal(snapshot.items[0]?.warehouseRetainedQuantitySnapshot.toString(), "5");
});

test("a supplier slot may report zero for this container while another supplier makes the container positive", () => {
  const snapshot = buildFactoryPurchaseOrderLoadingSnapshot({
    reason: "VOLUME_LIMIT",
    targetItems: [target("line-a", "10", "10", "10")],
    loadedItems: [loaded("line-a", "0")],
  });
  assert.equal(snapshot.totalLoadedQuantity.toString(), "0");
  assert.equal(snapshot.items[0]?.warehouseRetainedQuantitySnapshot.toString(), "10");
});

test("cumulative quantity cannot exceed either approved delivery target or completed quantity", () => {
  assert.throws(() => buildFactoryPurchaseOrderLoadingSnapshot({
    reason: "VOLUME_LIMIT",
    targetItems: [target("line-a", "5", "100", "105", "95")],
    loadedItems: [loaded("line-a", "6")],
  }), (error: unknown) => (
    error instanceof FactoryPurchaseLoadingSnapshotError
      && error.code === "FACTORY_PURCHASE_LOADING_CUMULATIVE_EXCEEDS_LIMIT"
  ));
  assert.throws(() => buildFactoryPurchaseOrderLoadingSnapshot({
    reason: "EXACT",
    targetItems: [target("line-a", "6", "100", "105", "95")],
    loadedItems: [loaded("line-a", "6")],
  }), (error: unknown) => (
    error instanceof FactoryPurchaseLoadingSnapshotError
      && error.code === "FACTORY_PURCHASE_LOADING_PLAN_EXCEEDS_REMAINING"
  ));
});

test("snapshot rejects missing/duplicate allocations and production below the target", () => {
  assert.throws(() => buildFactoryPurchaseOrderLoadingSnapshot({
    reason: "WEIGHT_LIMIT",
    targetItems: [target("line-a", "10", "10", "10"), target("line-b", "5", "5", "5")],
    loadedItems: [loaded("line-a", "9")],
  }), /全部产品/);
  assert.throws(() => buildFactoryPurchaseOrderLoadingSnapshot({
    reason: "WEIGHT_LIMIT",
    targetItems: [target("line-a", "10", "10", "10"), target("line-a", "5", "5", "5")],
    loadedItems: [loaded("line-a", "9"), loaded("line-b", "1")],
  }), /重复/);
  assert.throws(() => buildFactoryPurchaseOrderLoadingSnapshot({
    reason: "EXACT",
    targetItems: [target("line-a", "9", "10", "9")],
    loadedItems: [loaded("line-a", "9")],
  }), (error: unknown) => (
    error instanceof FactoryPurchaseLoadingSnapshotError
      && error.code === "FACTORY_PURCHASE_LOADING_PRODUCTION_INCOMPLETE"
  ));
});

test("reason agrees with plan variance and serializer keeps fixed four-place quantity strings", () => {
  assert.throws(() => buildFactoryPurchaseOrderLoadingSnapshot({
    reason: "EXACT",
    targetItems: [target("line-a", "10", "10", "10")],
    loadedItems: [loaded("line-a", "9")],
  }), (error: unknown) => (
    error instanceof FactoryPurchaseLoadingSnapshotError
      && error.code === "FACTORY_PURCHASE_LOADING_EXACT_MISMATCH"
  ));
  const snapshot = buildFactoryPurchaseOrderLoadingSnapshot({
    reason: "EXACT",
    targetItems: [target("line-a", "2.5", "10", "12", "5")],
    loadedItems: [loaded("line-a", "2.5")],
  });
  assert.deepEqual(serializeFactoryPurchaseLoadingSnapshotItem(snapshot.items[0]!), {
    purchaseOrderItemId: "line-a",
    plannedQuantitySnapshot: "2.5000",
    deliveryTargetQuantitySnapshot: "10.0000",
    completedQuantitySnapshot: "12.0000",
    previouslyApprovedLoadedQuantitySnapshot: "5.0000",
    loadedQuantity: "2.5000",
    cumulativeApprovedLoadedQuantitySnapshot: "7.5000",
    warehouseRetainedQuantitySnapshot: "4.5000",
  });
});

test("approved helper sums multiple container contributions instead of selecting one final PO result", () => {
  const results = [
    { status: "REJECTED", items: [{ purchaseOrderItemId: "line-a", loadedQuantity: "30" }] },
    { status: "APPROVED", items: [{ purchaseOrderItemId: "line-a", loadedQuantity: "60" }] },
    { status: "APPROVED", items: [{ purchaseOrderItemId: "line-a", loadedQuantity: "35" }] },
  ];
  assert.equal(approvedFactoryPurchaseOrderLoadingResults(results).length, 2);
  assert.equal(approvedLoadingQuantityByPurchaseOrderItem(results).get("line-a")?.toString(), "95");
});

test("Prisma schema models execution containers, multi-supplier allocations and per-slot report history", () => {
  assert.match(schema, /enum SalesExecutionContainerLoadStatus \{[\s\S]*?DRAFT[\s\S]*?OPEN[\s\S]*?RELEASED[\s\S]*?VOIDED/);
  assert.match(schema, /model SalesExecutionContainerLoad \{/);
  assert.match(schema, /allocations\s+ContainerLoadAllocation\[\]/);
  assert.match(schema, /model ContainerLoadAllocation \{/);
  assert.match(schema, /plannedQuantity\s+Decimal/);
  assert.match(schema, /@@unique\(\[containerLoadId, purchaseOrderItemId\]/);
  assert.match(schema, /containerLoadId\s+String/);
  assert.match(schema, /executionId\s+String/);
  assert.match(schema, /plannedQuantitySnapshot\s+Decimal/);
  assert.match(schema, /previouslyApprovedLoadedQuantitySnapshot\s+Decimal/);
  assert.match(schema, /cumulativeApprovedLoadedQuantitySnapshot\s+Decimal/);
  assert.match(schema, /warehouseRetainedQuantitySnapshot\s+Decimal/);
  assert.match(purchaseSchema, /containerLoads\s+SalesExecutionContainerLoad\[\]/);
  assert.match(purchaseSchema, /containerLoadAllocations\s+ContainerLoadAllocation\[\]/);
  assert.match(identitySchema, /releasedSalesExecutionContainerLoads/);
  assert.match(identitySchema, /voidedSalesExecutionContainerLoads/);
});

test("migration enforces slot uniqueness, cumulative bounds, release completeness and frozen history", () => {
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /SET LOCAL lock_timeout = '10s'/);
  assert.match(migration, /SET LOCAL statement_timeout = '15min'/);
  assert.match(migration, /LOCK TABLE "sales_executions"[\s\S]*?IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(migration, /fpo_loading_result_one_pending_per_po_key[\s\S]*?WHERE "status" = 'PENDING'/);
  assert.match(migration, /fpo_loading_result_one_approved_per_slot_key[\s\S]*?WHERE "status" = 'APPROVED'/);
  assert.doesNotMatch(migration, /one_approved_key[\s\S]*?\("purchase_order_id"\)/);
  assert.match(migration, /cumulative_approved_loaded_quantity_snapshot"[\s\S]*?previously_approved_loaded_quantity_snapshot" \+ "loaded_quantity"/);
  assert.match(migration, /cumulative_approved_loaded_quantity_snapshot" <= "delivery_target_quantity_snapshot"/);
  assert.match(migration, /warehouse_retained_quantity_snapshot"[\s\S]*?completed_quantity_snapshot" - "cumulative_approved_loaded_quantity_snapshot"/);
  assert.match(migration, /exact loading result must match every container allocation/);
  assert.doesNotMatch(migration, /loading result total loaded quantity must be positive/);
  assert.match(migration, /total_loaded <= 0/);
  assert.match(migration, /approved_slot_count <> slot_count/);
  assert.match(migration, /released or voided container load is immutable/);
  assert.match(migration, /container allocations may only change while the load is draft/);
  assert.match(migration, /loading result history is append-only/);
  assert.match(migration, /loading result item history is append-only/);
});

test("container header freezes at OPEN while revision-only reporting and audited terminal transitions remain valid", () => {
  const guard = migration.match(
    /CREATE OR REPLACE FUNCTION "guard_sales_execution_container_load_update"\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/,
  )?.[1] || "";
  assert.ok(guard, "container update guard must exist");
  assert.match(guard, /OLD\."status" = 'DRAFT' AND NEW\."status" = 'OPEN'/);
  assert.match(guard, /NULLIF\(BTRIM\(NEW\."container_no"\), ''\) IS NULL[\s\S]*?NEW\."loading_date" IS NULL[\s\S]*?allocation_count = 0/);
  assert.match(guard, /OLD\."status" = 'OPEN' AND NEW\."status" = 'OPEN'[\s\S]*?ARRAY\['revision', 'updated_at'\]/);
  assert.match(guard, /open container header is frozen; only revision may advance/);
  assert.match(guard, /OLD\."status" = 'OPEN' AND NEW\."status" = 'RELEASED'[\s\S]*?'released_at', 'released_by', 'release_remark'/);
  assert.match(guard, /OLD\."status" IN \('DRAFT', 'OPEN'\) AND NEW\."status" = 'VOIDED'[\s\S]*?'voided_at', 'voided_by', 'void_reason'/);
  assert.match(guard, /NEW\."released_at" IS NULL[\s\S]*?NEW\."released_at" > clock_timestamp\(\)/);
  assert.match(guard, /NEW\."voided_at" IS NULL[\s\S]*?NEW\."voided_at" > clock_timestamp\(\)/);
  assert.match(guard, /NEW\."updated_at" > clock_timestamp\(\)/);
  assert.doesNotMatch(guard, /NEW\."(?:updated_at|released_at|voided_at)" > CURRENT_TIMESTAMP/);
});

test("audit timestamps use wall-clock time instead of the transaction-start timestamp", () => {
  for (const field of [
    "requested_at",
    "decided_at",
    "updated_at",
    "voided_at",
    "released_at",
    "production_completed_at",
    "production_completion_recorded_at",
  ]) {
    assert.match(migration, new RegExp(`NEW\\."${field}" > clock_timestamp\\(\\)`));
    assert.doesNotMatch(migration, new RegExp(`NEW\\."${field}" > CURRENT_TIMESTAMP`));
  }
  assert.match(migration, /NEW\."loading_date" > \(clock_timestamp\(\) AT TIME ZONE 'Asia\/Shanghai'\)::DATE/);
  assert.match(migration, /NEW\."actual_delivery_date" > \(clock_timestamp\(\) AT TIME ZONE 'Asia\/Shanghai'\)::DATE/);
});

test("releasing one container ignores another container pending for the same purchase order", () => {
  const guard = migration.match(
    /CREATE OR REPLACE FUNCTION "guard_sales_execution_container_load_update"\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/,
  )?.[1] || "";
  const pendingQuery = guard.match(
    /SELECT COUNT\(\*\) INTO pending_count([\s\S]*?);/,
  )?.[1] || "";
  assert.match(pendingQuery, /pending\."container_load_id" = NEW\."id"/);
  assert.doesNotMatch(pendingQuery, /pending\."purchase_order_id" IN/);
});

test("approved occupancy uses actual contribution so plan 100/approved 95 leaves capacity for a later plan 5", () => {
  assert.match(migration, /CASE WHEN approved_result\."id" IS NOT NULL THEN COALESCE\(approved_item\."loaded_quantity", 0\)[\s\S]*?ELSE allocation\."planned_quantity" END/);
  assert.match(migration, /reserved_quantity \+ NEW\."planned_quantity" > target_quantity/);
  assert.match(migration, /reserved_by_other_loads \+ NEW\."loaded_quantity" > expected_target/);
});

test("legacy backfill preserves known actuals without asserting historical retained stock", () => {
  assert.match(migration, /one released legacy load[\s\S]*?known actual quantity/);
  assert.match(migration, /legacy-container-load-/);
  assert.match(migration, /legacy-loading-result-/);
  assert.match(migration, /item\."actual_delivered_quantity", item\."actual_delivered_quantity", item\."actual_delivered_quantity"/);
  assert.match(migration, /未推断真实柜号或留仓数量/);
  assert.match(migration, /未推断真实留仓数量/);
  assert.match(migration, /legacy container backfill did not preserve every unshipped actual-delivery fact/);
  assert.match(migration, /UPDATE "factory_purchase_order_items" AS item[\s\S]*?SET "actual_delivered_quantity" = NULL[\s\S]*?execution\."shipping_started_at" IS NULL/);
  assert.match(migration, /UPDATE "factory_purchase_orders" AS purchase_order[\s\S]*?"actual_delivery_date" = NULL[\s\S]*?execution\."shipping_started_at" IS NULL/);
  assert.match(migration, /Already-shipped executions remain[\s\S]*?byte-for-byte unchanged/);
});

test("actual delivery cache remains empty until shipping and is then derived from released contributions", () => {
  assert.match(migration, /assert_factory_purchase_order_released_load_cache/);
  assert.match(migration, /load\."status" = 'RELEASED'/);
  assert.match(migration, /SUM\(result_item\."loaded_quantity"\)/);
  assert.match(migration, /actual delivered quantities must equal cumulative approved contributions from released containers/);
  assert.match(migration, /actual delivery cache may only be written by the shipping handoff/);
  assert.match(migration, /actual delivery cache must use the latest released loading date and shipping actor/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER "factory_purchase_order_actual_delivery_quantity_parent_guard"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER "factory_purchase_order_actual_delivery_quantity_item_guard"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER "sales_execution_shipping_load_materialization_guard"/);
  assert.match(migration, /purchase_order\."status" NOT IN \('REJECTED', 'VOIDED'\)/);
  assert.doesNotMatch(migration, /sales_execution_container_load_materialization_guard/);
  assert.match(migration, /COMMIT;\s*$/);
});

test("forward shipping guard excludes both rejected and voided purchase orders", () => {
  const guard = migration.match(
    /CREATE OR REPLACE FUNCTION "protect_sales_execution_shipping_anchor"\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/,
  )?.[1] || "";
  assert.ok(guard, "shipping anchor guard must be forward-replaced");
  assert.equal(
    [...guard.matchAll(/purchase_order\."status" NOT IN \('REJECTED', 'VOIDED'\)/g)].length,
    6,
  );
  assert.doesNotMatch(guard, /purchase_order\."status" <> 'VOIDED'/);
  assert.match(
    guard,
    /unreleased_active_container_count[\s\S]*?load\."status" NOT IN \('RELEASED', 'VOIDED'\)[\s\S]*?allocation\."container_load_id" = load\."id"[\s\S]*?purchase_order\."status" NOT IN \('REJECTED', 'VOIDED'\)/,
  );
  assert.match(guard, /shipping requires every non-void container with active purchase-order allocations to be released/);
});
