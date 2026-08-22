import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const schema = readPrismaSchemaSource();
const requestService = readFileSync(
  "lib/platform/factory-purchase-order-price-correction-batch-request.ts",
  "utf8",
);
const reviewService = readFileSync(
  "lib/platform/factory-purchase-order-price-correction-batch-review.ts",
  "utf8",
);
const settlementService = readFileSync(
  "lib/platform/factory-purchase-order-price-correction-batch-settlement.ts",
  "utf8",
);
const legacyService = readFileSync(
  "lib/platform/factory-purchase-order-price-correction.ts",
  "utf8",
);
const batchDispatch = readFileSync(
  "lib/platform/factory-purchase-order-price-correction-batch-dispatch.ts",
  "utf8",
);
const requestRoute = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/price-corrections/route.ts",
  "utf8",
);
const reviewRoute = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/price-corrections/[correctionId]/route.ts",
  "utf8",
);
const serializer = readFileSync(
  "lib/platform/sales-execution-purchase-order-relations.ts",
  "utf8",
);
const component = readFileSync(
  "app/modules/sales-execution/purchase-order-price-correction.tsx",
  "utf8",
);
const componentHelpers = readFileSync(
  "app/modules/sales-execution/purchase-order-price-correction-helpers.ts",
  "utf8",
);
const componentStyles = readFileSync(
  "app/modules/sales-execution/purchase-order-actions.module.css",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20260822180000_supplier_ocr_and_factory_price_correction_batch/migration.sql",
  "utf8",
);

function prismaModel(name: string) {
  return schema.match(new RegExp(`model ${name}\\b[\\s\\S]*?\\n\\}`))?.[0] || "";
}

test("price correction lines carry an immutable batch identity and position", () => {
  const model = prismaModel("FactoryPurchaseOrderPriceCorrection");
  assert.match(model, /batchId\s+String\?/);
  assert.match(model, /batchLineNo\s+Int\?/);
  assert.match(model, /batchLineCount\s+Int\?/);
  assert.match(model, /fpo_price_corrections_po_batch_line_key/);
  assert.match(migration, /fpo_price_corrections_batch_shape_check/);
  assert.match(migration, /batch_line_no" <= "batch_line_count/);
});

test("batch request is exact, serializable and rejects duplicate product rows", () => {
  assert.match(requestService, /Array\.isArray\(input\.items\)/);
  assert.match(requestService, /FACTORY_PRICE_CORRECTION_BATCH_ITEM_DUPLICATE/);
  assert.match(requestService, /assertBatchReplay\(existing, lines, reason\)/);
  assert.match(requestService, /batchLineNo:\s*index \+ 1/);
  assert.match(requestService, /batchLineCount:\s*prepared\.length/);
  assert.match(requestService, /TransactionIsolationLevel\.Serializable/);
  assert.match(requestRoute, /requestFactoryPurchaseOrderPriceCorrectionBatch/);
  assert.match(requestRoute, /Array\.isArray/);
});

test("one review action applies every batch line and advances settlement once", () => {
  assert.match(legacyService, /reviewPriceCorrectionAsBatchWhenNeeded/);
  assert.match(batchDispatch, /batchHint\?\.batchId/);
  assert.doesNotMatch(batchDispatch, /batchLineCount \|\| 0\) <= 1/);
  assert.match(reviewService, /expectedCount >= 1/);
  assert.match(reviewService, /for \(const \{ correction, item \} of rows\)/);
  assert.match(reviewService, /factoryPurchaseOrderAdjustment\.create/);
  assert.match(reviewService, /for \(const correction of corrections\)/);
  assert.match(reviewService, /applyPriceCorrectionBatchSettlement/);
  assert.match(settlementService, /factoryPurchaseOrderSettlement\.update/);
  assert.match(settlementService, /revision:\s*\{ increment: 1 \}/);
  assert.match(settlementService, /remainsSettled \? settlementBefore\.settledAt : reviewedAt/);
  assert.match(settlementService, /remainsSettled \? settlementBefore\.settledById : actorId/);
  assert.match(reviewRoute, /corrections\.find\(\(row\) => row\.id === correctionId\)/);
});

test("database permits mixed and net-zero batches but only one leader owns snapshots", () => {
  assert.match(migration, /COUNT\(DISTINCT COALESCE\(price_correction\."batch_id", price_correction\."id"\)\)/);
  assert.match(migration, /batch_increase/);
  assert.match(migration, /batch_decrease/);
  assert.match(migration, /batch_increase - batch_decrease/);
  assert.match(migration, /only the batch leader may carry settlement snapshots/);
  assert.match(migration, /batch_line_no" = 1/);
  assert.match(migration, /purchase price correction batch must commit as one complete immutable set/);
  assert.match(migration, /factory_purchase_price_corrections_commit_consistency/);
});

test("batch audit metadata is serialized for review and downstream history", () => {
  assert.match(serializer, /batchId/);
  assert.match(serializer, /batchLineNo/);
  assert.match(serializer, /batchLineCount/);
});

test("purchase order UI submits selected price corrections as one review batch", () => {
  assert.match(component, /type="checkbox"/);
  assert.match(component, /items: selectedRows\.map/);
  assert.match(component, /统一更正原因/);
  assert.match(component, /增加合计/);
  assert.match(component, /扣减合计/);
  assert.match(component, /净差额/);
  assert.match(component, /groupCorrections\(corrections\)/);
  assert.match(component, /整批通过/);
  assert.match(component, /整批驳回/);
  assert.match(componentHelpers, /toFixed\(3\)/);
  assert.match(componentHelpers, /roundedProductCents/);
  assert.match(componentHelpers, /newAmount - oldAmount/);
  assert.match(component, /setPriceDrafts\(\{\}\)/);
  assert.doesNotMatch(component, /setPriceDrafts\(Object\.fromEntries/);
  assert.match(componentStyles, /overflow-x:\s*auto/);
  assert.match(componentStyles, /min-width:\s*760px/);
});
