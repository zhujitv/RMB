import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  normalizeSupplierProductionProgressInput,
  productionProgressIsComplete,
  productionProgressPercent,
} = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-production-progress-inputs.ts")
>("../lib/platform/factory-purchase-order-production-progress-inputs.ts");
const { normalizeOfflineProductionProgressInput } = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-offline-production-progress-inputs.ts")
>("../lib/platform/factory-purchase-order-offline-production-progress-inputs.ts");
const {
  PRODUCTION_PROGRESS_HISTORY_LIMIT,
  PRODUCTION_PROGRESS_REPORT_QUERY_LIMIT,
  serializeProductionProgress,
} = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-production-progress-values.ts")
>("../lib/platform/factory-purchase-order-production-progress-values.ts");
const { serializePurchaseOrderRelations } = await jiti.import<
  typeof import("../lib/platform/sales-execution-purchase-order-relations.ts")
>("../lib/platform/sales-execution-purchase-order-relations.ts");

const schema = readPrismaSchemaSource();
const migration = readFileSync(
  "prisma/migrations/20260816160000_factory_purchase_production_progress/migration.sql",
  "utf8",
);
const inputService = readFileSync(
  "lib/platform/factory-purchase-order-production-progress-inputs.ts",
  "utf8",
);
const progressService = readFileSync(
  "lib/platform/supplier-purchase-order-production-progress.ts",
  "utf8",
);
const progressRoute = readFileSync(
  "app/api/supplier-purchase-orders/[id]/production-progress/route.ts",
  "utf8",
);
const offlineProgressInput = readFileSync(
  "lib/platform/factory-purchase-order-offline-production-progress-inputs.ts",
  "utf8",
);
const offlineProgressService = readFileSync(
  "lib/platform/factory-purchase-order-offline-production-progress.ts",
  "utf8",
);
const offlineProgressRoute = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/offline-production-progress/route.ts",
  "utf8",
);
const completionCore = readFileSync(
  "lib/platform/factory-purchase-order-production-completion-core.ts",
  "utf8",
);
const supplierCompletionService = readFileSync(
  "lib/platform/supplier-purchase-order-production.ts",
  "utf8",
);
const offlineCompletionService = readFileSync(
  "lib/platform/factory-purchase-order-offline-production.ts",
  "utf8",
);
const shippingHandoff = readFileSync(
  "lib/platform/sales-execution-shipping-handoff.ts",
  "utf8",
);
const supplierQuery = readFileSync(
  "lib/platform/supplier-purchase-orders-query.ts",
  "utf8",
);
const internalQuery = readFileSync(
  "lib/platform/sales-execution-query-service.ts",
  "utf8",
);
const supplierValues = readFileSync(
  "lib/platform/supplier-purchase-orders-values.ts",
  "utf8",
);
const progressValues = readFileSync(
  "lib/platform/factory-purchase-order-production-progress-values.ts",
  "utf8",
);

const targets = [
  { id: "line-a", allocatedQuantity: "10.5000" },
  { id: "line-b", allocatedQuantity: "3" },
];

function errorCode(error: unknown) {
  return String((error as { code?: string } | null)?.code || "");
}

function exportedFunctionSource(name: string, source = progressService) {
  return source.match(
    new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function|$)`),
  )?.[0] || "";
}

test("production progress input requires every purchase-order line exactly once", () => {
  const normalized = normalizeSupplierProductionProgressInput({
    expectedRevision: 7,
    remark: "  正常生产  ",
    items: [
      { purchaseOrderItemId: "line-b", completedQuantity: 1 },
      { purchaseOrderItemId: "line-a", completedQuantity: "2.2500" },
    ],
  }, targets);

  assert.equal(normalized.expectedRevision, 7);
  assert.equal(normalized.remark, "正常生产");
  assert.deepEqual(
    normalized.items.map((item) => [item.purchaseOrderItemId, item.completedQuantity.toString()]),
    [["line-b", "1"], ["line-a", "2.25"]],
  );

  for (const input of [
    { expectedRevision: 7, items: [{ purchaseOrderItemId: "line-a", completedQuantity: 1 }] },
    { expectedRevision: 7, items: [
      { purchaseOrderItemId: "line-a", completedQuantity: 1 },
      { purchaseOrderItemId: "line-a", completedQuantity: 2 },
    ] },
  ]) {
    assert.throws(
      () => normalizeSupplierProductionProgressInput(input, targets),
      (error: unknown) => [
        "FACTORY_PRODUCTION_PROGRESS_ITEMS_REQUIRED",
        "FACTORY_PRODUCTION_PROGRESS_ITEM_DUPLICATE",
      ].includes(errorCode(error)),
    );
  }
});

test("production progress quantities are exact decimals between zero and allocation", () => {
  for (const [completedQuantity, code] of [
    ["-1", "FACTORY_PRODUCTION_PROGRESS_QUANTITY_INVALID"],
    ["1.00001", "FACTORY_PRODUCTION_PROGRESS_QUANTITY_INVALID"],
    ["10.5001", "FACTORY_PRODUCTION_PROGRESS_QUANTITY_EXCEEDED"],
    ["1e2", "FACTORY_PRODUCTION_PROGRESS_QUANTITY_INVALID"],
  ] as const) {
    assert.throws(
      () => normalizeSupplierProductionProgressInput({
        expectedRevision: 1,
        items: [
          { purchaseOrderItemId: "line-a", completedQuantity },
          { purchaseOrderItemId: "line-b", completedQuantity: 0 },
        ],
      }, targets),
      (error: unknown) => errorCode(error) === code,
    );
  }

  assert.throws(
    () => normalizeSupplierProductionProgressInput({
      expectedRevision: 1,
      items: [
        { purchaseOrderItemId: "foreign-line", completedQuantity: 1 },
        { purchaseOrderItemId: "line-b", completedQuantity: 0 },
      ],
    }, targets),
    (error: unknown) => errorCode(error) === "FACTORY_PRODUCTION_PROGRESS_ITEM_NOT_FOUND",
  );
});

test("production progress revision and bounded remark are validated before mutation", () => {
  for (const expectedRevision of [undefined, "1", 0, 1.5]) {
    assert.throws(
      () => normalizeSupplierProductionProgressInput({
        expectedRevision,
        items: [
          { purchaseOrderItemId: "line-a", completedQuantity: 0 },
          { purchaseOrderItemId: "line-b", completedQuantity: 0 },
        ],
      }, targets),
      (error: unknown) => errorCode(error) === "SUPPLIER_PURCHASE_ORDER_REVISION_INVALID",
    );
  }
  assert.throws(
    () => normalizeSupplierProductionProgressInput({
      expectedRevision: 1,
      remark: "x".repeat(2_001),
      items: [
        { purchaseOrderItemId: "line-a", completedQuantity: 0 },
        { purchaseOrderItemId: "line-b", completedQuantity: 0 },
      ],
    }, targets),
    (error: unknown) => errorCode(error) === "FACTORY_PRODUCTION_PROGRESS_REMARK_TOO_LONG",
  );
});

test("offline progress input fixes its source and validates channel, contact, ISO time, and all decimals", () => {
  const normalized = normalizeOfflineProductionProgressInput({
    expectedRevision: 9,
    channel: " wechat ",
    supplierContact: "  张师傅  ",
    supplierReportedAt: "2026-08-16T10:20:30+08:00",
    remark: "  已完成第一批  ",
    items: [
      { purchaseOrderItemId: "line-a", completedQuantity: "5.2500" },
      { purchaseOrderItemId: "line-b", completedQuantity: "1" },
    ],
  }, targets);

  assert.equal(normalized.expectedRevision, 9);
  assert.equal(normalized.remark, "已完成第一批");
  assert.equal(normalized.attribution.source, "INTERNAL_OFFLINE");
  assert.equal(normalized.attribution.channel, "WECHAT");
  assert.equal(normalized.attribution.supplierContact, "张师傅");
  assert.equal(normalized.attribution.supplierReportedAt.toISOString(), "2026-08-16T02:20:30.000Z");
  assert.deepEqual(
    normalized.items.map((item) => item.completedQuantity.toString()),
    ["5.25", "1"],
  );

  for (const [override, code] of [
    [{ channel: "PORTAL" }, "FACTORY_CONFIRMATION_CHANNEL_INVALID"],
    [{ channel: "SMS" }, "FACTORY_CONFIRMATION_CHANNEL_INVALID"],
    [{ supplierContact: "" }, "FACTORY_CONFIRMATION_CONTACT_INVALID"],
    [{ supplierContact: "x".repeat(101) }, "FACTORY_CONFIRMATION_CONTACT_INVALID"],
    [{ supplierReportedAt: "2026-08-16T10:20" }, "FACTORY_PRODUCTION_PROGRESS_REPORTED_AT_INVALID"],
    [{ supplierReportedAt: "not-a-date" }, "FACTORY_PRODUCTION_PROGRESS_REPORTED_AT_INVALID"],
  ] as const) {
    assert.throws(
      () => normalizeOfflineProductionProgressInput({
        expectedRevision: 9,
        channel: "PHONE",
        supplierContact: "工厂联系人",
        supplierReportedAt: "2026-08-16T10:20:30+08:00",
        items: [
          { purchaseOrderItemId: "line-a", completedQuantity: "5" },
          { purchaseOrderItemId: "line-b", completedQuantity: "1" },
        ],
        ...override,
      }, targets),
      (error: unknown) => errorCode(error) === code,
    );
  }
});

test("completion and display helpers use every line instead of a summed mixed-unit quantity", () => {
  assert.equal(productionProgressIsComplete([
    { allocatedQuantity: "10.5", completedQuantity: "10.5" },
    { allocatedQuantity: "3", completedQuantity: "3" },
  ]), true);
  assert.equal(productionProgressIsComplete([
    { allocatedQuantity: "10.5", completedQuantity: "10.5" },
    { allocatedQuantity: "3", completedQuantity: "2.9999" },
  ]), false);
  assert.equal(productionProgressIsComplete([]), false);
  assert.equal(productionProgressPercent([
    { allocatedQuantity: "10", completedQuantity: "5" },
    { allocatedQuantity: "2", completedQuantity: "2" },
  ]), 75);
});

test("bounded progress history uses the extra preceding snapshot as its increment baseline", () => {
  const reports = Array.from({ length: 101 }, (_, index) => {
    const sequenceNo = index + 1;
    return {
      id: `report-${sequenceNo}`,
      sequenceNo,
      source: "INTERNAL_OFFLINE",
      channel: "PHONE",
      supplierContact: `contact-${sequenceNo}`,
      supplierReportedAt: new Date(Date.UTC(2026, 7, 1, 0, sequenceNo)),
      reportedAt: new Date(Date.UTC(2026, 7, 1, 0, sequenceNo)),
      remark: sequenceNo === 1 ? "hidden-baseline-remark" : null,
      reportedBy: {
        id: sequenceNo === 1 ? "secret-baseline-user" : `visible-user-${sequenceNo}`,
        name: sequenceNo === 1 ? "Secret Baseline User" : `User ${sequenceNo}`,
      },
      items: [{ purchaseOrderItemId: "line-a", completedQuantity: sequenceNo }],
    };
  });

  const progress = serializeProductionProgress(
    reports,
    [{ id: "line-a", allocatedQuantity: 101 }],
  );

  assert.equal(PRODUCTION_PROGRESS_HISTORY_LIMIT, 100);
  assert.equal(PRODUCTION_PROGRESS_REPORT_QUERY_LIMIT, 101);
  assert.equal(progress.history.length, 100);
  assert.equal(progress.history[0]?.sequence, 2);
  assert.equal(progress.history[0]?.items[0]?.completedQuantity, "2");
  assert.equal(progress.history[0]?.items[0]?.incrementQuantity, "1");
  assert.equal(progress.latestSequence, 101);
  assert.equal(progress.items[0]?.completedQuantity, "101");
  assert.equal(JSON.stringify(progress).includes("hidden-baseline-remark"), false);
  assert.equal(JSON.stringify(progress).includes("secret-baseline-user"), false);
});

test("internal purchase-order DTO keeps the same bounded baseline semantics", () => {
  const productionProgressReports = Array.from({ length: 101 }, (_, index) => {
    const sequenceNo = index + 1;
    return {
      id: `report-${sequenceNo}`,
      sequenceNo,
      source: "INTERNAL_OFFLINE",
      channel: "PHONE",
      supplierContact: sequenceNo === 1 ? "hidden-contact" : "工厂联系人",
      supplierReportedAt: new Date(Date.UTC(2026, 7, 1, 0, sequenceNo)),
      reportedAt: new Date(Date.UTC(2026, 7, 1, 0, sequenceNo)),
      remark: sequenceNo === 1 ? "hidden-internal-baseline" : null,
      reportedBy: {
        id: sequenceNo === 1 ? "secret-internal-baseline-user" : `internal-${sequenceNo}`,
        name: sequenceNo === 1 ? "隐藏基线员工" : `员工 ${sequenceNo}`,
      },
      items: [{ purchaseOrderItemId: "line-a", completedQuantity: sequenceNo }],
    };
  });
  const relations = serializePurchaseOrderRelations({
    id: "po-1",
    items: [{ id: "line-a", allocatedQuantity: 101 }],
    supplierResponses: [],
    payments: [],
    adjustments: [],
    deliveryQuantityVariances: [],
    productionProgressReports,
  });

  assert.equal(relations.productionProgress.history.length, 100);
  assert.equal(relations.productionProgress.history[0]?.sequence, 2);
  assert.equal(relations.productionProgress.history[0]?.items[0]?.incrementQuantity, "1");
  assert.equal(relations.productionProgress.history[0]?.reportedBy.id, "internal-2");
  assert.equal(JSON.stringify(relations).includes("hidden-internal-baseline"), false);
  assert.equal(JSON.stringify(relations).includes("secret-internal-baseline-user"), false);
});

test("a post-approval snapshot may carry historical overproduction but cannot increase it", () => {
  const adjustedTargets = [
    { id: "line-a", allocatedQuantity: "100", targetQuantity: "95", previousCompletedQuantity: "99" },
    { id: "line-b", allocatedQuantity: "100", targetQuantity: "105", previousCompletedQuantity: "90" },
  ];
  const accepted = normalizeSupplierProductionProgressInput({
    expectedRevision: 3,
    items: [
      { purchaseOrderItemId: "line-a", completedQuantity: "99" },
      { purchaseOrderItemId: "line-b", completedQuantity: "105" },
    ],
  }, adjustedTargets);
  assert.deepEqual(accepted.items.map((item) => item.completedQuantity.toString()), ["99", "105"]);
  assert.throws(() => normalizeSupplierProductionProgressInput({
    expectedRevision: 3,
    items: [
      { purchaseOrderItemId: "line-a", completedQuantity: "100" },
      { purchaseOrderItemId: "line-b", completedQuantity: "105" },
    ],
  }, adjustedTargets), (error: unknown) => errorCode(error) === "FACTORY_PRODUCTION_PROGRESS_QUANTITY_EXCEEDED");
});

test("progress is an append-only report ledger with line-level cumulative quantities", () => {
  const report = schema.match(/model FactoryPurchaseOrderProductionReport\s+\{[\s\S]*?\n\}/)?.[0] || "";
  const item = schema.match(/model FactoryPurchaseOrderProductionReportItem\s+\{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(report, /purchaseOrderId\s+String/);
  assert.match(report, /sequenceNo\s+Int/);
  assert.match(report, /reportedById\s+String/);
  assert.match(report, /@@unique\(\[purchaseOrderId, sequenceNo\]/);
  assert.match(report, /@relation\("FactoryPurchaseOrderProductionReports"[\s\S]*?onDelete: Restrict/);
  assert.match(item, /completedQuantity\s+Decimal[\s\S]*?@db\.Decimal\(18, 4\)/);
  assert.match(item, /@relation\(fields: \[reportId, purchaseOrderId\], references: \[id, purchaseOrderId\], onDelete: Restrict\)/);
  assert.match(item, /@relation\(fields: \[purchaseOrderItemId, purchaseOrderId\], references: \[id, purchaseOrderId\], onDelete: Restrict\)/);
  assert.doesNotMatch(report, /Json/);
  assert.doesNotMatch(item, /Json/);
});

test("migration enforces ownership, quantity bounds, ordering, and immutable history", () => {
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /SET LOCAL lock_timeout = '10s'/);
  assert.match(migration, /LOCK TABLE[\s\S]*?"factory_purchase_orders"[\s\S]*?IN SHARE ROW EXCLUSIVE MODE/);
  assert.ok(
    migration.indexOf("LOCK TABLE") < migration.indexOf('INSERT INTO "factory_purchase_order_production_reports"'),
    "the purchase-order write lock must be acquired before historical progress is backfilled",
  );
  assert.match(migration, /fpo_production_report_sequence_check[\s\S]*?"sequence_no" > 0/);
  assert.match(migration, /fpo_production_report_completed_quantity_check[\s\S]*?"completed_quantity" >= 0/);
  assert.match(migration, /FOREIGN KEY \("report_id", "purchase_order_id"\)[\s\S]*?ON DELETE RESTRICT/);
  assert.match(migration, /FOREIGN KEY \("purchase_order_item_id", "purchase_order_id"\)[\s\S]*?ON DELETE RESTRICT/);
  assert.match(migration, /NEW\."completed_quantity" > allocated_quantity/);
  assert.match(migration, /production completed quantity exceeds allocated quantity/);
  assert.match(migration, /guard_factory_purchase_order_production_report_insert/);
  assert.match(migration, /purchase_order_status <> 'ACCEPTED'/);
  assert.match(migration, /purchase_order_production_status <> 'IN_PRODUCTION'/);
  assert.match(migration, /reporter\."supplier_id" = purchase_order_supplier_id/);
  assert.match(migration, /NEW\."source" = 'SUPPLIER_PORTAL'[\s\S]*?NEW\."channel" <> 'PORTAL'/);
  assert.match(migration, /NEW\."source" = 'INTERNAL_OFFLINE'[\s\S]*?NEW\."channel" = 'PORTAL'/);
  assert.match(migration, /NEW\."sequence_no" <> expected_sequence/);
  assert.match(migration, /validate_factory_purchase_order_production_report_snapshot/);
  assert.match(migration, /reported_item_count <> expected_item_count/);
  assert.match(migration, /current_item\."completed_quantity" < previous_item\."completed_quantity"/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /factory_purchase_order_production_report_immutable_guard/);
  assert.match(migration, /factory_purchase_order_production_report_item_immutable_guard/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /COMMIT;\s*$/);

  const insertGuard = migration.match(
    /CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_production_report_insert"[\s\S]*?\$\$ LANGUAGE plpgsql;/,
  )?.[0] || "";
  assert.match(insertGuard, /NEW\."reported_at" > clock_timestamp\(\)/);
  assert.doesNotMatch(insertGuard, /NEW\."reported_at" > CURRENT_TIMESTAMP/);
});

test("supplier progress mutation is account-bound, locked, and revision-safe", () => {
  const mutation = exportedFunctionSource("recordSupplierPurchaseOrderProductionProgress");
  assert.ok(mutation, "recordSupplierPurchaseOrderProductionProgress must be exported");
  assert.match(mutation, /assertWrite\(actor, "supplierPurchaseOrders"\)/);
  assert.match(mutation, /supplierId\s*=\s*nonEmpty\(actor\?\.supplierId\)/);
  assert.match(mutation, /assertActiveSupplierPurchaseOrderActor\(tx, actorId, supplierId\)/);
  assert.match(progressService, /supplierPurchaseOrderScope\(actor\)/);
  assert.match(mutation, /FOR UPDATE/);
  assert.match(mutation, /status\s*!==\s*"ACCEPTED"|status:\s*"ACCEPTED"/);
  assert.match(mutation, /productionStatus\s*!==\s*"IN_PRODUCTION"|productionStatus:\s*"IN_PRODUCTION"/);
  assert.match(
    mutation,
    /(?:input|normalized)\.expectedRevision\s*!==\s*before\.revision|revision:\s*(?:input|normalized)\.expectedRevision/,
  );
  assert.match(mutation, /TransactionIsolationLevel\.Serializable/);
  assert.match(mutation, /P2034/);
});

test("supplier progress mutation rejects regressions and no-op snapshots before append", () => {
  const mutation = exportedFunctionSource("recordSupplierPurchaseOrderProductionProgress");
  assert.match(mutation, /productionReports|productionProgressReports/);
  assert.match(progressService + supplierQuery, /sequenceNo[\s\S]*?(?:\.sort\(|orderBy:)/);
  assert.match(mutation, /completedQuantity/);
  assert.match(mutation, /\.lt\(|lessThan|regress|倒退|不能小于/);
  assert.match(mutation, /changed|hasChange|noChange|没有变化|无变化/);
  assert.match(mutation, /FACTORY_PRODUCTION_PROGRESS_(?:REGRESSION|CANNOT_DECREASE)/);
  assert.match(mutation, /FACTORY_PRODUCTION_PROGRESS_(?:NO_CHANGE|UNCHANGED)/);
  assert.match(mutation, /factoryPurchaseOrderProductionReport\.create|productionProgressReport\.create/);
  assert.match(mutation, /items:\s*\{\s*create:/);
  assert.match(mutation, /purchaseOrder:\s*\{\s*connect:\s*\{\s*id:\s*before\.id/);
  assert.match(mutation, /reportedBy:\s*\{\s*connect:\s*\{\s*id:\s*actorId/);
  assert.doesNotMatch(mutation, /data:\s*\{\s*purchaseOrderId:/);
  assert.doesNotMatch(
    mutation,
    /create:\s*input\.items\.map\(\(item\)\s*=>\s*\(\{\s*purchaseOrderId:/,
  );
  assert.match(mutation, /revision:\s*\{\s*increment:\s*1\s*\}/);
  assert.match(mutation, /writeAudit\([\s\S]*?factory_purchase_order_production_reports[\s\S]*?tx,/);
});

test("progress route owns actor scope and returns only the established supplier DTO", () => {
  assert.match(progressRoute, /requireApiWrite\(request, "supplierPurchaseOrders"\)/);
  assert.match(progressRoute, /parseJsonBody\(request\)/);
  assert.match(
    progressRoute,
    /recordSupplierPurchaseOrderProductionProgress\(\s*request,\s*actor,\s*id,\s*body,?\s*\)/,
  );
  assert.doesNotMatch(progressRoute, /supplierId:\s*body|reportedById:\s*body|source:\s*body/);
  assert.match(progressService, /serializeSupplierPurchaseOrder/);
  assert.doesNotMatch(progressService, /return\s+\{\s*\.\.\.before|return\s+before\s*;/);
});

test("offline progress mutation is internally scoped, locked, revision-safe, and auditable", () => {
  const mutation = exportedFunctionSource(
    "recordOfflineFactoryProductionProgress",
    offlineProgressService,
  );
  assert.ok(mutation, "recordOfflineFactoryProductionProgress must be exported");
  assert.match(mutation, /assertWrite\(actor, "salesExecution"\)/);
  assert.match(mutation, /requireActiveInternalConfirmationActor\(tx, actor\)/);
  assert.match(mutation, /findScopedOrder\(tx, validActor, executionId, purchaseOrderId\)/);
  assert.match(mutation, /FOR UPDATE/);
  assert.match(mutation, /assertProgressCanBeRecorded\(before\)/);
  assert.match(
    offlineProgressService,
    /order\.status !== "ACCEPTED"[\s\S]*?order\.productionStatus !== "IN_PRODUCTION"/,
  );
  assert.match(
    mutation,
    /normalizeOfflineProductionProgressInput\([\s\S]*?resolveProductionProgressTargets\([\s\S]*?approvedDeliveryQuantityVariance\(before\.deliveryQuantityVariances\)/,
  );
  assert.match(mutation, /input\.expectedRevision !== before\.revision/);
  assert.match(mutation, /where:\s*\{[\s\S]*?executionId,[\s\S]*?revision:\s*before\.revision/);
  assert.match(mutation, /TransactionIsolationLevel\.Serializable/);
  assert.match(mutation, /P2034/);

  assert.match(mutation, /source:\s*input\.attribution\.source/);
  assert.match(mutation, /channel:\s*input\.attribution\.channel/);
  assert.match(mutation, /supplierContact:\s*input\.attribution\.supplierContact/);
  assert.match(mutation, /supplierReportedAt:\s*input\.attribution\.supplierReportedAt/);
  assert.match(mutation, /items:\s*\{\s*create:/);
  assert.match(mutation, /purchaseOrder:\s*\{\s*connect:\s*\{\s*id:\s*before\.id/);
  assert.match(mutation, /reportedBy:\s*\{\s*connect:\s*\{\s*id:\s*validActor\.id/);
  assert.doesNotMatch(mutation, /data:\s*\{\s*purchaseOrderId:/);
  assert.doesNotMatch(
    mutation,
    /create:\s*input\.items\.map\(\(item\)\s*=>\s*\(\{\s*purchaseOrderId:/,
  );
  assert.match(mutation, /writeAudit\([\s\S]*?factory_purchase_order_production_reports[\s\S]*?tx,/);
  assert.doesNotMatch(mutation, /source:\s*rawInput|channel:\s*rawInput|supplierContact:\s*rawInput/);
});

test("offline progress rejects quantity and actual-feedback-time regressions", () => {
  assert.match(offlineProgressService, /item\.completedQuantity\.lt\(previous\)/);
  assert.match(offlineProgressService, /FACTORY_PRODUCTION_PROGRESS_CANNOT_DECREASE/);
  assert.match(offlineProgressService, /FACTORY_PRODUCTION_PROGRESS_UNCHANGED/);
  assert.match(offlineProgressService, /supplierReportedAt\.getTime\(\) < productionStartedAt\.getTime\(\)/);
  assert.match(offlineProgressService, /supplierReportedAt\.getTime\(\) > recordedAt\.getTime\(\)/);
  assert.match(offlineProgressService, /supplierReportedAt\.getTime\(\) < previousInstant\.getTime\(\)/);
  assert.match(offlineProgressService, /FACTORY_PRODUCTION_PROGRESS_REPORTED_AT_DECREASED/);
  assert.match(offlineProgressInput, /source:\s*"INTERNAL_OFFLINE"/);
  assert.doesNotMatch(offlineProgressInput, /"PORTAL"[\s\S]*?as OfflineProgressChannel/);
});

test("offline progress route requires internal sales-execution write permission", () => {
  assert.match(offlineProgressRoute, /requireApiWrite\(request, "salesExecution"\)/);
  assert.match(offlineProgressRoute, /parseJsonBody\(request\)/);
  assert.match(offlineProgressRoute, /const \{ id, purchaseOrderId \} = await params/);
  assert.match(
    offlineProgressRoute,
    /recordOfflineFactoryProductionProgress\(\s*request,\s*actor,\s*id,\s*purchaseOrderId,\s*body,?\s*\)/,
  );
  assert.doesNotMatch(offlineProgressRoute, /source:\s*body|reportedById:\s*body/);
});

test("supplier progress DTO exposes quantities and history without internal commercial fields", () => {
  assert.match(supplierQuery, /productionProgressReports/);
  assert.match(supplierQuery, /take:\s*PRODUCTION_PROGRESS_REPORT_QUERY_LIMIT/);
  assert.match(internalQuery, /productionProgressReports/);
  assert.match(internalQuery, /take:\s*PRODUCTION_PROGRESS_REPORT_QUERY_LIMIT/);
  assert.match(supplierQuery, /sequenceNo:\s*true/);
  assert.match(supplierQuery, /completedQuantity:\s*true/);
  assert.match(supplierValues, /productionProgressReports/);
  assert.match(supplierValues, /serializeProductionProgress/);
  assert.match(progressValues, /completedQuantity/);
  assert.match(progressValues, /incrementQuantity/);

  const serializer = supplierValues.match(
    /export function serializeSupplierPurchaseOrder\b[\s\S]*?(?=\nexport |$)/,
  )?.[0] || "";
  assert.ok(serializer);
  assert.doesNotMatch(serializer, /\.\.\.row|Object\.assign\([^,]+,\s*row/);
  for (const forbidden of [
    "salesUnitPrice",
    "salesAmount",
    "productFingerprintSnapshot",
    "businessEntityNameSnapshot",
    "customerNameSnapshot",
  ]) {
    assert.doesNotMatch(serializer, new RegExp(`\\b${forbidden}\\b`));
  }
});

test("production completion requires the latest complete line snapshot", () => {
  assert.match(completionCore, /productionProgressReports|productionReports/);
  assert.match(completionCore, /serializeProductionProgress|productionProgressIsComplete/);
  assert.match(completionCore, /progress\.allCompleted/);
  assert.match(completionCore, /FACTORY_PRODUCTION_PROGRESS_INCOMPLETE/);
  assert.match(completionCore, /before\.productionStatus !== "IN_PRODUCTION"/);
  assert.match(completionCore, /before\.revision !== expectedRevision/);

  const completionCheck = completionCore.indexOf("if (!progress.allCompleted)");
  const completedUpdate = completionCore.indexOf('productionStatus: "COMPLETED"');
  assert.ok(completionCheck >= 0 && completedUpdate > completionCheck);

  assert.match(supplierCompletionService, /applyFactoryPurchaseOrderProductionCompletion/);
  assert.match(offlineCompletionService, /applyFactoryPurchaseOrderProductionCompletion/);
});

test("shipping handoff independently verifies every latest production snapshot is complete", () => {
  const readiness = shippingHandoff.match(
    /function assertReadyForReceivable\b[\s\S]*?(?=\n(?:async )?function|\nexport |$)/,
  )?.[0] || "";
  assert.ok(readiness);
  assert.match(readiness, /productionProgressReports/);
  assert.match(readiness, /serializeProductionProgress|productionProgressIsComplete/);
  assert.match(readiness, /allCompleted/);
  assert.match(readiness, /SHIPPING_PRODUCTION_PROGRESS_INCOMPLETE/);

  const progressGate = readiness.indexOf("SHIPPING_PRODUCTION_PROGRESS_INCOMPLETE");
  assert.ok(progressGate >= 0);
  assert.match(shippingHandoff, /assertReadyForLoadingFinalization[\s\S]*assertReadyForReceivable\(execution\)[\s\S]*releasedContainerMaterialization\(execution\)/);
});

test("input and mutation code never perform floating-point quantity arithmetic", () => {
  assert.match(inputService, /new Prisma\.Decimal/);
  assert.doesNotMatch(inputService, /parseFloat\(|Number\([^)]*completedQuantity/);
  assert.doesNotMatch(progressService, /parseFloat\(|Number\([^)]*completedQuantity/);
});
