import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const schema = readPrismaSchemaSource();
const service = readFileSync("lib/platform/factory-purchase-order-price-correction.ts", "utf8");
const serializer = readFileSync("lib/platform/sales-execution-purchase-order-relations.ts", "utf8");
const panel = readFileSync("app/modules/sales-execution/purchase-order-execution-panel.tsx", "utf8");
const component = readFileSync("app/modules/sales-execution/purchase-order-price-correction.tsx", "utf8");
const route = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/price-corrections/route.ts",
  "utf8",
);
const reviewRoute = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/price-corrections/[correctionId]/route.ts",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20260822100000_factory_purchase_price_correction/migration.sql",
  "utf8",
);

function prismaModel(name: string) {
  return schema.match(new RegExp(`model ${name}\\b[\\s\\S]*?\\n\\}`))?.[0] || "";
}

function exportedFunctionSource(name: string) {
  return service.match(
    new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function|$)`),
  )?.[0] || "";
}

test("purchase price correction is an auditable request instead of overwriting the purchase price", () => {
  const correction = prismaModel("FactoryPurchaseOrderPriceCorrection");
  const purchaseOrder = prismaModel("FactoryPurchaseOrder");
  const item = prismaModel("FactoryPurchaseOrderItem");

  assert.match(schema, /enum FactoryPurchasePriceCorrectionStatus\s+\{[\s\S]*?PENDING[\s\S]*?APPROVED[\s\S]*?REJECTED/);
  assert.match(correction, /oldUnitPrice\s+Decimal/);
  assert.match(correction, /newUnitPrice\s+Decimal/);
  assert.match(correction, /deltaAmount\s+Decimal/);
  assert.match(correction, /requestedById\s+String/);
  assert.match(correction, /reviewedById\s+String\?/);
  assert.match(correction, /adjustmentId\s+String\?\s+@unique/);
  assert.match(purchaseOrder, /priceCorrections\s+FactoryPurchaseOrderPriceCorrection\[\]/);
  assert.match(item, /priceCorrections\s+FactoryPurchaseOrderPriceCorrection\[\]/);
});

test("database migration keeps price correction requests immutable after submission and review", () => {
  assert.match(migration, /CREATE TYPE "FactoryPurchasePriceCorrectionStatus"/);
  assert.match(migration, /CREATE TABLE "factory_purchase_order_price_corrections"/);
  assert.match(migration, /fpo_price_corrections_pending_item_key[\s\S]*WHERE "status" = 'PENDING'/);
  assert.match(migration, /protect_factory_purchase_order_price_correction/);
  assert.match(migration, /records cannot be deleted/);
  assert.match(migration, /reviewed factory purchase price correction records are immutable/);
  assert.match(migration, /request content is immutable after submission/);
  assert.match(migration, /approved factory purchase price correction requires an adjustment row/);
});

test("price correction request blocks paid, settled, and tax-archived orders", () => {
  const request = exportedFunctionSource("requestFactoryPurchaseOrderPriceCorrection");
  const review = exportedFunctionSource("reviewFactoryPurchaseOrderPriceCorrection");

  assert.match(request, /assertWrite\(actor,\s*"costs"\)/);
  assert.match(request, /assertPriceCorrectionAllowed\(before\)/);
  assert.match(service, /activeConfirmedPayments\(purchaseOrder\.payments\)\.length/);
  assert.match(request, /assertBusinessOrderWritableInTransaction\(/);
  assert.match(request, /oldUnitPrice\s*=\s*item\.supplierPrice\?\.unitPrice\s*\?\?\s*item\.purchaseUnitPrice/);
  assert.doesNotMatch(request, /factoryPurchaseOrderItem\.update|supplierPrice\.update/);
  assert.match(review, /requireAdminGlobal\(actor/);
  assert.match(review, /assertPriceCorrectionAllowed\(before\)/);
  assert.match(review, /assertBusinessOrderWritableInTransaction\(/);
});

test("approved price correction creates a confirmed settlement adjustment carrying only the difference", () => {
  const review = exportedFunctionSource("reviewFactoryPurchaseOrderPriceCorrection");

  assert.match(review, /direction\s*=\s*correction\.deltaAmount\.gte\(0\)\s*\?\s*"INCREASE"\s*:\s*"DECREASE"/);
  assert.match(review, /amount\s*=\s*correction\.deltaAmount\.abs\(\)\.toDecimalPlaces\(2\)/);
  assert.match(review, /factoryPurchaseOrderAdjustment\.create\(/);
  assert.match(review, /kind:\s*"OTHER"/);
  assert.match(review, /status:\s*"CONFIRMED"/);
  assert.match(review, /sourceType:\s*"PURCHASE_PRICE_CORRECTION"/);
  assert.match(review, /adjustmentId/);
  assert.match(review, /writeAudit\(request,[\s\S]*?采购价格更正生成差额调整/);
});

test("purchase execution UI exposes price correction request and review feedback", () => {
  assert.match(panel, /PurchaseOrderPriceCorrection/);
  assert.match(component, /采购价格更正申请/);
  assert.match(component, /待管理员审核/);
  assert.match(component, /title=\{reasonUnavailable \|\| undefined\}/);
  assert.match(component, /disabled=\{busy \|\| !available\}/);
  assert.match(component, /已有付款记录，采购价格需走财务冲销或补差流程/);
  assert.match(component, /工厂采购单确认接受后，才可以申请采购价格更正/);
  assert.match(component, /通过/);
  assert.match(component, /驳回/);
  assert.match(serializer, /priceCorrections/);
  assert.match(route, /requestFactoryPurchaseOrderPriceCorrection/);
  assert.match(reviewRoute, /reviewFactoryPurchaseOrderPriceCorrection/);
});
