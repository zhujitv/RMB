import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readCostRecordsMutationsSource, readLogisticsExpenseInvoiceSource, readLogisticsExpenseWorkflowSource, readOrderDocumentsSource, readSupplierDocumentRequestsSource } from "./source-helpers.ts";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260701193000_file_assets/migration.sql",
  "utf8",
);
const fileAssets = readFileSync("lib/platform/file-assets.ts", "utf8");
const orderDocuments = readOrderDocumentsSource();
const costs = readCostRecordsMutationsSource();
const supplierDocuments = readSupplierDocumentRequestsSource();
const logisticsInvoice = readLogisticsExpenseInvoiceSource();
const logisticsWorkflow = readLogisticsExpenseWorkflowSource();

test("file asset schema stores shared metadata and explicit business bindings", () => {
  assert.match(schema, /model FileAsset \{/);
  assert.match(schema, /fileUrl\s+String\?\s+@map\("file_url"\)/);
  assert.match(schema, /fileName\s+String\s+@map\("file_name"\)/);
  assert.match(schema, /mimeType\s+String\s+@map\("mime_type"\)/);
  assert.match(schema, /storageKey\s+String\s+@map\("storage_key"\)/);
  assert.match(schema, /bucket\s+String\?/);
  assert.match(schema, /uploadedAt\s+DateTime\?\s+@map\("uploaded_at"\)/);
  assert.match(schema, /uploadedById\s+String\?\s+@map\("uploaded_by"\)/);
  assert.match(schema, /orderId\s+String\?\s+@map\("order_id"\)/);
  assert.match(schema, /costId\s+String\?\s+@map\("cost_id"\)/);
  assert.match(schema, /supplierDocumentRequestId\s+String\?\s+@map\("supplier_document_request_id"\)/);
  assert.match(schema, /orderDocumentId\s+String\?\s+@map\("order_document_id"\)/);
  assert.match(schema, /@@unique\(\[sourceTable, sourceId, fileRole\], map: "file_assets_source_unique"\)/);
  assert.match(schema, /@@map\("file_assets"\)/);
});

test("file asset migration backfills existing document voucher and template files", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "file_assets"/);
  assert.match(migration, /"r2_key" AS "storage_key"[\s\S]*FROM "order_documents"/);
  assert.match(migration, /"payment_voucher_storage_key" AS "storage_key"[\s\S]*FROM "order_costs"/);
  assert.match(migration, /"template_storage_key" AS "storage_key"[\s\S]*FROM "supplier_document_requests"/);
  assert.match(migration, /ON CONFLICT \("source_table", "source_id", "file_role"\) DO UPDATE SET/);
});

test("uploads create file assets and reads prefer file assets after business permission checks", () => {
  assert.match(fileAssets, /export async function upsertFileAssetForOrderDocument/);
  assert.match(fileAssets, /export async function upsertFileAssetForPaymentVoucher/);
  assert.match(fileAssets, /export async function upsertFileAssetForSupplierRequestTemplate/);
  assert.match(fileAssets, /export async function findActiveFileAssetBySource/);
  assert.match(fileAssets, /export function applyFileAssetToOrderDocument/);
  assert.match(fileAssets, /export function mergeFileAssetMetadata/);

  assert.match(orderDocuments, /await upsertFileAssetForOrderDocument\(tx, created\)/);
  assert.match(logisticsInvoice, /await upsertFileAssetForOrderDocument\(tx, created, \{ logisticsExpenseId: expense\.id \|\| null \}\)/);
  assert.match(costs, /await upsertFileAssetForPaymentVoucher\(tx, saved\)/);
  assert.match(supplierDocuments, /await upsertFileAssetForSupplierRequestTemplate\(tx, saved\)/);
  assert.match(supplierDocuments, /await upsertFileAssetForOrderDocument\(tx, created\)/);

  assert.match(orderDocuments, /findActiveFileAssetBySource\(FILE_ASSET_SOURCE_TABLES\.ORDER_DOCUMENTS/);
  assert.match(orderDocuments, /applyFileAssetToOrderDocument\(document, asset\)/);
  assert.match(costs, /findActiveFileAssetBySource\([\s\S]*FILE_ASSET_SOURCE_TABLES\.ORDER_COSTS/);
  assert.match(supplierDocuments, /findActiveFileAssetBySource\([\s\S]*FILE_ASSET_SOURCE_TABLES\.SUPPLIER_DOCUMENT_REQUESTS/);
});

test("business deletes soft delete file assets centrally", () => {
  assert.match(orderDocuments, /softDeleteFileAssetBySource\([\s\S]*FILE_ASSET_SOURCE_TABLES\.ORDER_DOCUMENTS/);
  assert.match(logisticsWorkflow, /softDeleteFileAssetBySource\([\s\S]*FILE_ASSET_SOURCE_TABLES\.ORDER_DOCUMENTS/);
  assert.match(costs, /softDeleteFileAssetBySource\([\s\S]*FILE_ASSET_SOURCE_TABLES\.ORDER_COSTS/);
  assert.match(supplierDocuments, /softDeleteFileAssetBySource\([\s\S]*FILE_ASSET_SOURCE_TABLES\.SUPPLIER_DOCUMENT_REQUESTS/);
});
