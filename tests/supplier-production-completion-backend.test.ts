import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const completionService = readFileSync(
  "lib/platform/supplier-purchase-order-production.ts",
  "utf8",
);
const completionCore = readFileSync(
  "lib/platform/factory-purchase-order-production-completion-core.ts",
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
const offlineCompletionService = readFileSync(
  "lib/platform/factory-purchase-order-offline-production.ts",
  "utf8",
);
const offlineCompletionRoute = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/offline-production-completion/route.ts",
  "utf8",
);
const completionMigration = readFileSync(
  "prisma/migrations/20260815090000_factory_offline_confirmations/migration.sql",
  "utf8",
);

function exportedFunctionSource(name: string, source: string) {
  return source.match(
    new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function|$)`),
  )?.[0] || "";
}

test("supplier production completion remains permissioned, supplier-scoped, and account-bound", () => {
  const mutation = exportedFunctionSource(
    "completeSupplierPurchaseOrderProduction",
    completionService,
  );

  assert.match(mutation, /assertWrite\(actor, "supplierPurchaseOrders"\)/);
  assert.match(mutation, /supplierId\s*=\s*nonEmpty\(actor\?\.supplierId\)/);
  assert.match(mutation, /SUPPLIER_ACCOUNT_NOT_BOUND/);
  assert.match(mutation, /assertActiveSupplierPurchaseOrderActor\(tx, actorId, supplierId\)/);
  assert.match(completionService, /supplierPurchaseOrderScope\(actor\)/);
});

test("portal and offline completion share one locked CAS state transition", () => {
  const portalMutation = exportedFunctionSource(
    "completeSupplierPurchaseOrderProduction",
    completionService,
  );

  assert.match(portalMutation, /FOR UPDATE/);
  assert.match(offlineCompletionService, /FOR UPDATE/);
  assert.match(completionCore, /before\.status !== "ACCEPTED"/);
  assert.doesNotMatch(completionCore, /before\.status === "ACCEPTED" \|\| before\.status === "DELIVERY_PROPOSED"/);
  assert.match(completionCore, /before\.productionStatus !== "IN_PRODUCTION"/);
  assert.match(completionCore, /before\.revision !== expectedRevision/);
  assert.match(
    completionCore,
    /factoryPurchaseOrder\.updateMany\([\s\S]*?supplierId: before\.supplierId,[\s\S]*?status: "ACCEPTED",[\s\S]*?productionStatus: "IN_PRODUCTION",[\s\S]*?revision: expectedRevision/,
  );
  assert.match(completionCore, /changed\.count !== 1/);
  assert.match(portalMutation, /TransactionIsolationLevel\.Serializable/);
  assert.match(offlineCompletionService, /TransactionIsolationLevel\.Serializable/);
});

test("completion attribution is server-owned and only same-source completion remains idempotent", () => {
  const idempotentReturn = completionCore.indexOf('before.productionStatus === "COMPLETED"');
  const revisionConflict = completionCore.indexOf("before.revision !== expectedRevision");

  assert.ok(idempotentReturn >= 0 && idempotentReturn < revisionConflict);
  assert.match(
    completionCore,
    /before\.productionStatus === "COMPLETED"[\s\S]*?before\.productionCompletionSource !== attribution\.source[\s\S]*?409,[\s\S]*?FACTORY_PRODUCTION_ALREADY_COMPLETED_BY_OTHER_SOURCE[\s\S]*?return \{ changed: false/,
  );
  assert.match(completionCore, /const recordedAt = new Date\(\)/);
  assert.match(
    completionCore,
    /data: \{[\s\S]*?productionStatus: "COMPLETED",[\s\S]*?productionCompletedAt,[\s\S]*?productionCompletedById: actorId,[\s\S]*?productionCompletionSource: attribution\.source,[\s\S]*?revision: \{ increment: 1 \}/,
  );
  assert.match(completionService, /source: "SUPPLIER_PORTAL"[\s\S]*?channel: "PORTAL"/);
  assert.match(offlineCompletionService, /attribution: normalized\.attribution/);
  assert.match(completionService, /writeAudit\([\s\S]*?"factory_purchase_orders"[\s\S]*?tx,/);
  assert.match(offlineCompletionService, /writeAudit\([\s\S]*?"factory_purchase_orders"[\s\S]*?tx,/);
  assert.doesNotMatch(completionCore, /input\.productionCompletedAt|input\.productionCompletedBy|productionCompletionSource:\s*input\./);
});

test("supplier completion route is a write endpoint returning the established safe DTO contract", () => {
  assert.match(completionRoute, /type RouteContext = \{ params: Promise<\{ id: string \}> \}/);
  assert.match(completionRoute, /requireApiWrite\(request, "supplierPurchaseOrders"\)/);
  assert.match(completionRoute, /const \{ id \} = await params/);
  assert.match(completionRoute, /completeSupplierPurchaseOrderProduction\(request, actor, id, body\)/);
  assert.match(completionRoute, /purchaseOrder,[\s\S]*?data: purchaseOrder/);
});

test("legacy internal production endpoint stays start-only while the offline endpoint records completion", () => {
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

  assert.match(offlineCompletionService, /recordOfflineFactoryProductionCompletion/);
  assert.match(offlineCompletionService, /requireActiveInternalConfirmationActor/);
  assert.match(offlineCompletionService, /applyFactoryPurchaseOrderProductionCompletion/);
  assert.match(offlineCompletionRoute, /requireApiWrite\(request, "salesExecution"\)/);
  assert.match(offlineCompletionRoute, /recordOfflineFactoryProductionCompletion/);
  assert.doesNotMatch(offlineCompletionRoute, /source\s*:/);
});

test("database guard separates active portal operators from active internal recorders", () => {
  assert.match(
    completionMigration,
    /NEW\."production_status" = 'COMPLETED'[\s\S]*?OLD\."production_status" IS DISTINCT FROM 'IN_PRODUCTION'/,
  );
  assert.match(completionMigration, /completion_user\."id" = NEW\."production_completed_by"/);
  assert.match(completionMigration, /completion_user\."supplier_id" = NEW\."supplier_id"/);
  assert.match(completionMigration, /completion_user\."is_active" = TRUE/);
  assert.match(completionMigration, /completion_user\."approval_status" = 'APPROVED'/);
  assert.match(completionMigration, /completion_user\."deleted_at" IS NULL/);
  assert.match(completionMigration, /completion_user\."role" IN \('产品供应商', '产品供应商账号', '工厂供应商账号'\)/);
  assert.match(completionMigration, /completion_supplier\."allow_factory_document_upload" = TRUE/);
  assert.match(completionMigration, /NEW\."production_completion_source" = 'INTERNAL_OFFLINE'/);
  assert.match(completionMigration, /completion_user\."supplier_id" IS NULL/);
  assert.match(completionMigration, /NEW\."production_completion_channel" <> 'PORTAL'/);
  assert.match(completionMigration, /NEW\."production_completed_at" < OLD\."production_started_at"/);
  assert.match(completionMigration, /production start audit is immutable/);
  assert.match(completionMigration, /FOR SHARE/);
});

test("database guard preserves history while freezing completed status, time, actor, and source", () => {
  const completedGuard = completionMigration.match(
    /IF OLD\."production_status" = 'COMPLETED'[\s\S]*?END IF;/,
  )?.[0] || "";

  assert.match(completedGuard, /NEW\."production_status" IS DISTINCT FROM OLD\."production_status"/);
  assert.match(completedGuard, /NEW\."production_completed_at" IS DISTINCT FROM OLD\."production_completed_at"/);
  assert.match(completedGuard, /NEW\."production_completed_by" IS DISTINCT FROM OLD\."production_completed_by"/);
  assert.match(completedGuard, /NEW\."production_completion_source" IS DISTINCT FROM OLD\."production_completion_source"/);
  assert.match(completedGuard, /NEW\."production_completion_channel" IS DISTINCT FROM OLD\."production_completion_channel"/);
  assert.match(completionMigration, /CREATE OR REPLACE FUNCTION "protect_supplier_factory_purchase_order_completion"/);
});
