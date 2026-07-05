import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  readOcrIntegrationSource,
  readTaxRefundModuleSource,
  readTaxRefundsSource,
} from "./source-helpers.ts";

const detail = [
  "app/modules/tax-refund/detail-components.tsx",
  "app/modules/tax-refund/detail-panel.tsx",
].map((file) => readFileSync(file, "utf8")).join("\n");
const model = readFileSync("app/modules/tax-refund/model.ts", "utf8");
const controller = readFileSync("app/modules/tax-refund/use-tax-refund-controller.ts", "utf8");
const overlays = readFileSync("app/modules/tax-refund/overlays.tsx", "utf8");
const uploadComponents = [
  "app/modules/tax-refund/upload-components.tsx",
  "app/modules/tax-refund/upload-card.tsx",
].map((file) => readFileSync(file, "utf8")).join("\n");
const taxRefundService = readTaxRefundsSource();
const customsRecognition = readFileSync("lib/platform/customs-recognition.ts", "utf8");
const taxProfitBarrel = readFileSync("lib/platform/tax-profit.ts", "utf8");
const taxRefundDetailRoute = readFileSync("app/api/tax-refunds/[orderId]/route.ts", "utf8");
const customsOcrRoute = readFileSync("app/api/tax-refund/[orderId]/recognize-customs-declaration/route.ts", "utf8");
const taxRefundCalculationRoute = readFileSync("app/api/tax-refund/[orderId]/calculation/route.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260703102000_remove_tax_refund_ocr_calculation/migration.sql", "utf8");
const ocrIntegration = readOcrIntegrationSource();

test("tax refund module no longer renders OCR and tax calculation panels", () => {
  assert.doesNotMatch(detail, /function CustomsRecognitionResultPanel/);
  assert.doesNotMatch(detail, /function TaxRefundCalculationPanel/);
  assert.doesNotMatch(detail, /OCR原始结果|查看OCR原始结果|OCR调用日志|同步OCR商品明细/);
  assert.doesNotMatch(detail, /退税计算数据|退税结果|理论退税额|发票匹配/);
  assert.doesNotMatch(overlays, /CustomsFilePickerDialog|onRecognizeCustomsDocument|onRecognizeFromUploadedCustoms/);
  assert.doesNotMatch(controller, /recognizingDocumentId|recognitionStatusByDocument|customsFilePicker|patchCustomsRecognition/);
  assert.doesNotMatch(
    uploadComponents,
    /ALIYUN_CUSTOMS_FALLBACK_PDF_TEXT|OCR|Aliyun|ALIYUN|fallback|raw|parsed|商品明细识别|请确认商品明细|OCR识别状态|Aliyun识别状态|fallback识别状态|识别状态/,
  );
  assert.match(uploadComponents, /上传报关单 PDF 后，系统将读取 PDF 文本内容，并自动回填报关单号和申报日期。/);
  assert.match(uploadComponents, /已读取：报关单号/);
  assert.match(uploadComponents, /未读取到报关单号，请手动填写/);
  assert.match(detail, /CustomsRecognitionForm/);
});

test("tax refund DTO excludes OCR raw results and tax calculation payloads", () => {
  for (const forbidden of [
    "customsOcrRawResult",
    "customsOcrCallLogs",
    "customsDeclarationItems",
    "currentCustomsDocument",
    "historicalCustomsDocuments",
    "exportTaxRefundCalculations",
    "exportTaxRefundSummary",
  ]) {
    assert.doesNotMatch(model, new RegExp(forbidden));
    assert.doesNotMatch(taxRefundService, new RegExp(forbidden));
  }
});

test("tax refund OCR and calculation APIs are disabled while PDF text reread remains available", () => {
  assert.match(taxRefundDetailRoute, /TAX_REFUND_OCR_CALC_DISABLED/);
  assert.match(taxRefundDetailRoute, /previewCustomsRecognition/);
  assert.match(taxRefundDetailRoute, /recalculateTaxRefund/);
  assert.match(customsOcrRoute, /reparseTaxRefundCustomsDeclarationPdf/);
  assert.match(taxRefundCalculationRoute, /TAX_REFUND_CALCULATION_DISABLED/);
  assert.match(customsRecognition, /parseCustomsDeclarationPdf/);
  assert.doesNotMatch(customsRecognition, /saveOcrRawResult|persistCustomsRecognitionArtifacts/);
  assert.equal(existsSync("lib/platform/export-tax-refund-calculations.ts"), false);
  assert.doesNotMatch(taxProfitBarrel, /export-tax-refund-calculations/);
});

test("tax refund dedicated OCR and calculation database structures are removed by migration", () => {
  assert.doesNotMatch(schema, /model ExportCustomsDeclarationItem/);
  assert.doesNotMatch(schema, /model ExportTaxRefundCalculation/);
  assert.doesNotMatch(schema, /model ExportTaxRebateRate/);
  assert.match(migration, /DROP VIEW IF EXISTS "customs_declaration_items"/);
  assert.match(migration, /DROP TABLE IF EXISTS "export_customs_declaration_items"/);
  assert.match(migration, /DROP TABLE IF EXISTS "export_tax_refund_calculations"/);
  assert.match(migration, /DROP TABLE IF EXISTS "export_tax_rebate_rates"/);
  assert.match(migration, /'REFUND_CALCULATED'/);
});

test("generic OCR center and supplier return OCR remain available", () => {
  assert.match(schema, /model OcrTask/);
  assert.match(schema, /model OcrRawResult/);
  assert.match(schema, /model OcrResult/);
  assert.match(schema, /model SupplierDocumentRequest/);
  assert.match(schema, /documents\s+OrderDocument\[\]/);
  assert.match(schema, /requestId\s+String\?\s+@map\("request_id"\)/);
  assert.match(ocrIntegration, /supplierDocumentReturnEnabled/);
  assert.equal(existsSync("app/api/settings/ocr/route.ts"), true);
});
