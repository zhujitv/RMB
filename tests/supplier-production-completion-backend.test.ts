import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const completionService = readFileSync(
  "lib/platform/supplier-purchase-order-production.ts",
  "utf8",
);
const completionRoute = readFileSync(
  "app/api/supplier-purchase-orders/[id]/production-completion/route.ts",
  "utf8",
);
const internalProductionService = readFileSync(
  "lib/platform/factory-purchase-order-execution.ts",
  "utf8",
);
const internalProductionRoute = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/production/route.ts",
  "utf8",
);
const completionMigration = readFileSync(
  "prisma/migrations/20260810042000_supplier_production_completion_confirmation/migration.sql",
  "utf8",
);

function exportedFunctionSource(name: string, source: string) {
  return source.match(
    new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function|$)`),
  )?.[0] || "";
}

test("supplier production completion is permissioned, supplier-scoped, and account-bound", () => {
  const mutation = exportedFunctionSource(
    "completeSupplierPurchaseOrderProduction",
    completionService,
  );

  assert.match(mutation, /assertWrite\(actor, "supplierPurchaseOrders"\)/);
  assert.match(mutation, /supplierId\s*=\s*nonEmpty\(actor\?\.supplierId\)/);
  assert.match(mutation, /SUPPLIER_ACCOUNT_NOT_BOUND/);
  assert.match(
    mutation,
    /tx\.user\.findFirst\([\s\S]*?supplierId,[\s\S]*?role: \{ in: \[\.\.\.PRODUCT_SUPPLIER_OPERATOR_ROLES\] \},[\s\S]*?isActive: true,[\s\S]*?approvalStatus: "APPROVED",[\s\S]*?deletedAt: null/,
  );
  assert.match(completionService, /supplierId,[\s\S]*?dispatchedAt: \{ not: null \}/);
  assert.match(
    completionService,
    /supplier:[\s\S]*?deletedAt: null,[\s\S]*?status: "启用",[\s\S]*?supplierType:/,
  );
});

test("supplier completion locks one active order and uses expectedRevision as a CAS", () => {
  const mutation = exportedFunctionSource(
    "completeSupplierPurchaseOrderProduction",
    completionService,
  );

  assert.match(mutation, /FOR UPDATE/);
  assert.match(mutation, /before\.status !== "ACCEPTED"/);
  assert.doesNotMatch(mutation, /before\.status === "ACCEPTED" \|\| before\.status === "DELIVERY_PROPOSED"/);
  assert.match(mutation, /before\.productionStatus !== "IN_PRODUCTION"/);
  assert.match(mutation, /before\.revision !== expectedRevision/);
  assert.match(
    mutation,
    /factoryPurchaseOrder\.updateMany\([\s\S]*?supplierId,[\s\S]*?status: "ACCEPTED",[\s\S]*?productionStatus: "IN_PRODUCTION",[\s\S]*?revision: expectedRevision/,
  );
  assert.match(mutation, /changed\.count !== 1/);
  assert.match(mutation, /TransactionIsolationLevel\.Serializable/);
});

test("supplier completion writes server-owned audit fields and repeated completion is idempotent", () => {
  const mutation = exportedFunctionSource(
    "completeSupplierPurchaseOrderProduction",
    completionService,
  );
  const idempotentReturn = mutation.indexOf('before.productionStatus === "COMPLETED"');
  const revisionConflict = mutation.indexOf("before.revision !== expectedRevision");

  assert.ok(idempotentReturn >= 0 && idempotentReturn < revisionConflict);
  assert.match(mutation, /productionCompletedAt\s*=\s*new Date\(\)/);
  assert.match(
    mutation,
    /data: \{[\s\S]*?productionStatus: "COMPLETED",[\s\S]*?productionCompletedAt,[\s\S]*?productionCompletedById: actorId,[\s\S]*?revision: \{ increment: 1 \}/,
  );
  assert.match(mutation, /writeAudit\([\s\S]*?"factory_purchase_orders"[\s\S]*?tx,/);
  assert.doesNotMatch(mutation, /input\.productionCompletedAt|input\.productionCompletedBy/);
});

test("supplier completion route is a write endpoint returning the established safe DTO contract", () => {
  assert.match(completionRoute, /type RouteContext = \{ params: Promise<\{ id: string \}> \}/);
  assert.match(completionRoute, /requireApiWrite\(request, "supplierPurchaseOrders"\)/);
  assert.match(completionRoute, /const \{ id \} = await params/);
  assert.match(completionRoute, /completeSupplierPurchaseOrderProduction\(request, actor, id, body\)/);
  assert.match(completionRoute, /purchaseOrder,[\s\S]*?data: purchaseOrder/);
});

test("internal production endpoint can start production but rejects completion", () => {
  const mutation = exportedFunctionSource(
    "updateFactoryPurchaseOrderProduction",
    internalProductionService,
  );

  assert.match(mutation, /normalizedAction === "COMPLETE"[\s\S]*?FACTORY_PRODUCTION_COMPLETION_SUPPLIER_REQUIRED/);
  assert.match(mutation, /normalizedAction !== "START"/);
  assert.match(mutation, /productionStatus: "IN_PRODUCTION"/);
  assert.doesNotMatch(mutation, /productionStatus: "COMPLETED"/);
  assert.doesNotMatch(mutation, /productionCompletedAt|productionCompletedById/);
  assert.doesNotMatch(internalProductionRoute, /body\.action === "COMPLETE"/);
  assert.match(internalProductionRoute, /message: "该工厂已进入生产"/);
});

test("database guard accepts only active approved operators from the purchase-order supplier", () => {
  assert.match(
    completionMigration,
    /NEW\."production_status" = 'COMPLETED'[\s\S]*?OLD\."production_status" IS DISTINCT FROM 'IN_PRODUCTION'/,
  );
  assert.match(completionMigration, /"id" = NEW\."production_completed_by"/);
  assert.match(completionMigration, /"supplier_id" = NEW\."supplier_id"/);
  assert.match(completionMigration, /"is_active" = TRUE/);
  assert.match(completionMigration, /"approval_status" = 'APPROVED'/);
  assert.match(completionMigration, /"deleted_at" IS NULL/);
  assert.match(completionMigration, /completion_user\."role" IN \('产品供应商', '产品供应商账号', '工厂供应商账号'\)/);
  assert.match(completionMigration, /completion_supplier\."allow_factory_document_upload" = TRUE/);
  assert.match(completionMigration, /NEW\."production_completed_at" < OLD\."production_started_at"/);
  assert.match(completionMigration, /production start audit is immutable/);
  assert.match(completionMigration, /FOR SHARE/);
});

test("database guard preserves history while freezing completed status, time, and actor", () => {
  const completedGuard = completionMigration.match(
    /IF OLD\."production_status" = 'COMPLETED'[\s\S]*?RETURN NEW;/,
  )?.[0] || "";

  assert.match(completedGuard, /NEW\."production_status" IS DISTINCT FROM OLD\."production_status"/);
  assert.match(completedGuard, /NEW\."production_completed_at" IS DISTINCT FROM OLD\."production_completed_at"/);
  assert.match(completedGuard, /NEW\."production_completed_by" IS DISTINCT FROM OLD\."production_completed_by"/);
  assert.doesNotMatch(completionMigration, /UPDATE\s+"factory_purchase_orders"/i);
  assert.match(completionMigration, /BEFORE UPDATE ON "factory_purchase_orders"/);
});
