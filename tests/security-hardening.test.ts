import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const nextConfig = readFileSync("next.config.mjs", "utf8");
const proxy = readFileSync("proxy.ts", "utf8");
const sharedBaseUtils = readFileSync("lib/platform/shared-base-utils.ts", "utf8");
const sharedAudit = readFileSync("lib/platform/shared-audit.ts", "utf8");
const inputSchemas = readFileSync("lib/platform/input-schemas.ts", "utf8");
const uploadValidation = readFileSync("lib/platform/upload-validation.ts", "utf8");
const orderDocumentsRoute = readFileSync("app/api/order-documents/route.ts", "utf8");
const orderDocumentsService = readFileSync("lib/platform/order-documents.ts", "utf8");
const logisticsInvoiceService = readFileSync("lib/platform/logistics-expense-invoice.ts", "utf8");
const ordersModule = readFileSync("lib/platform/orders-module.ts", "utf8");
const paymentsModule = readFileSync("lib/platform/payments-module.ts", "utf8");
const costsModule = readFileSync("lib/platform/cost-records-mutations.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

test("global security headers are configured for pages api and proxy responses", () => {
  for (const source of [nextConfig, proxy]) {
    assert.match(source, /Content-Security-Policy/);
    assert.match(source, /X-Content-Type-Options/);
    assert.match(source, /X-Frame-Options/);
    assert.match(source, /Referrer-Policy/);
    assert.match(source, /Permissions-Policy/);
    assert.match(source, /Cross-Origin-Opener-Policy/);
  }
  assert.match(nextConfig, /frame-ancestors 'self'/);
  assert.match(proxy, /applySecurityHeaders/);
  assert.match(nextConfig, /Access-Control-Allow-Origin/);
  assert.match(proxy, /Access-Control-Allow-Origin/);
  assert.doesNotMatch(nextConfig, /Access-Control-Allow-Origin", value: "\*"/);
  assert.doesNotMatch(proxy, /"Access-Control-Allow-Origin": "\*"/);
});

test("critical write paths use shared input schemas", () => {
  assert.match(inputSchemas, /RECEIVABLE_ORDER_INPUT_SCHEMA/);
  assert.match(inputSchemas, /PAYMENT_INPUT_SCHEMA/);
  assert.match(inputSchemas, /COST_INPUT_SCHEMA/);
  assert.match(inputSchemas, /ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA/);
  assert.match(ordersModule, /assertInputSchema\(assertJsonObject\(input\), RECEIVABLE_ORDER_INPUT_SCHEMA\)/);
  assert.match(paymentsModule, /assertInputSchema\(assertJsonObject\(input\), PAYMENT_INPUT_SCHEMA\)/);
  assert.match(costsModule, /assertInputSchema\(assertJsonObject\(input\), COST_INPUT_SCHEMA\)/);
  assert.match(orderDocumentsService, /assertInputSchema\(assertJsonObject\(\{ orderId, documentType, costId, supplierId, uploadSource \}\), ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA\)/);
});

test("all active PDF upload services reuse shared PDF validation", () => {
  assert.match(uploadValidation, /export function assertPdfUploadFileCandidate/);
  assert.match(uploadValidation, /export async function readValidatedPdfUploadFile/);
  assert.match(uploadValidation, /FILE_SIGNATURE_INVALID/);
  assert.match(orderDocumentsRoute, /assertPdfUploadFileCandidate\(candidate\)/);
  assert.match(orderDocumentsService, /readValidatedPdfUploadFile\(file, "document\.pdf"\)/);
  assert.match(logisticsInvoiceService, /readValidatedPdfUploadFile\(file, "invoice\.pdf"\)/);
});

test("server and audit logs redact sensitive file and credential fields", () => {
  assert.match(sharedBaseUtils, /SENSITIVE_LOG_KEY_PATTERN/);
  assert.match(sharedBaseUtils, /original\(name\|filename\)/);
  assert.match(sharedBaseUtils, /logServerError/);
  assert.match(sharedAudit, /originalName\|originalFilename/);
  assert.doesNotMatch(orderDocumentsRoute, /originalName: file/);
  assert.doesNotMatch(orderDocumentsRoute, /originalFilename/);
  assert.doesNotMatch(orderDocumentsService, /originalFilename: document\.originalFilename/);
});

test("legacy attachment model and service are removed", () => {
  assert.equal(existsSync("lib/platform/legacy-attachments.ts"), false);
  assert.doesNotMatch(schema, /model Attachment/);
  assert.doesNotMatch(schema, /attachments Attachment\[\]/);
  assert.match(readFileSync("prisma/migrations/20260619143000_drop_legacy_attachments/migration.sql", "utf8"), /DROP TABLE IF EXISTS "attachments"/);
});
