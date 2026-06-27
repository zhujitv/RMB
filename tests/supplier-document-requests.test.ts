import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const service = readFileSync("lib/platform/supplier-document-requests.ts", "utf8");
const supplierModule = readFileSync("app/modules/SupplierDocumentsModule.tsx", "utf8");
const taxModule = readFileSync("app/modules/TaxRefundModule.tsx", "utf8");
const settingsModule = readFileSync("app/modules/SettingsModule.tsx", "utf8");
const menu = readFileSync("app/menu.ts", "utf8");
const permissions = readFileSync("lib/platform/shared-permission-data.ts", "utf8");

test("supplier document request schema links supplier uploads to tax refund documents", () => {
  assert.match(schema, /model SupplierDocumentRequest/);
  assert.match(schema, /allowFactoryDocumentUpload Boolean @default\(false\) @map\("allow_factory_document_upload"\)/);
  assert.match(schema, /factoryDocumentRequestId String\? @map\("factory_document_request_id"\)/);
  assert.match(schema, /documents\s+OrderDocument\[\]/);
});

test("supplier document workflow uses existing factory tax document types", () => {
  assert.match(service, /SUPPLIER_PURCHASE_CONTRACT/);
  assert.match(service, /SUPPLIER_INVOICE/);
  assert.match(service, /refreshTaxRefundCompleteness\(row\.orderId\)/);
  assert.match(service, /readValidatedPdfUploadFile/);
  assert.match(service, /readValidatedExcelTemplate/);
});

test("supplier portal does not render customer identity fields", () => {
  assert.doesNotMatch(supplierModule, /customerName|customerFullName|customerShortName|客户简称|客户全称/);
  assert.doesNotMatch(service, /customerName|customerFullName|customerShortName/);
  assert.match(supplierModule, /订单号/);
  assert.match(supplierModule, /资料回传/);
});

test("admin tax refund drawer can notify factory suppliers without replacing tax upload flow", () => {
  assert.match(taxModule, /通知工厂供应商回传/);
  assert.match(taxModule, /\/api\/supplier-document-requests/);
  assert.match(taxModule, /allowFactoryDocumentUpload/);
  assert.match(taxModule, /document\.costId === cost\.id \|\| Boolean\(cost\.supplierId && document\.supplierId === cost\.supplierId\)/);
});

test("supplier settings and menus expose the controlled factory upload switch", () => {
  assert.match(settingsModule, /allowFactoryDocumentUpload/);
  assert.match(settingsModule, /允许供应商资料回传/);
  assert.match(menu, /supplierDocuments/);
  assert.match(permissions, /supplierDocuments/);
});
