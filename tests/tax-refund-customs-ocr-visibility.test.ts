import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const taxRefundService = readFileSync("lib/platform/tax-refunds.ts", "utf8");
const taxCalculationService = readFileSync("lib/platform/export-tax-refund-calculations.ts", "utf8");
const detail = readFileSync("app/modules/tax-refund/detail-components.tsx", "utf8");
const model = readFileSync("app/modules/tax-refund/model.ts", "utf8");
const styles = readFileSync("app/WorkspaceShell.module.css", "utf8");

test("customs document tab returns parsed declaration fields and admin raw OCR result", () => {
  const customsSection = taxRefundService.match(/async function getTaxRefundCustomsDocumentsSection[\s\S]*?\n}\n\nasync function getTaxRefundCostDocumentSection/)?.[0] || "";
  assert.match(customsSection, /prisma\.exportCustomsDeclarationItem\.findMany/);
  assert.match(customsSection, /rawJson: true/);
  assert.match(customsSection, /customsDeclarationItems: serializedItems/);
  assert.match(customsSection, /customsOcrRawResult: actor\?\.role === "管理员"/);
  assert.match(taxRefundService, /function serializeTaxRefundCustomsItem/);
  assert.match(taxRefundService, /domesticConsignor/);
  assert.match(taxRefundService, /function serializeCustomsOcrRawResult/);
});

test("tax refund detail displays customs OCR results and empty-field exception", () => {
  assert.match(model, /customsOcrRawResult\?:/);
  assert.match(model, /domesticConsignor\?: string/);
  assert.match(detail, /function CustomsRecognitionResultPanel/);
  assert.match(detail, /报关单识别结果/);
  assert.match(detail, /OCR识别成功，但未解析到报关单关键字段。/);
  assert.match(detail, /查看OCR原始结果/);
  assert.match(detail, /报关单号/);
  assert.match(detail, /申报日期/);
  assert.match(detail, /出口日期/);
  assert.match(detail, /成交方式/);
  assert.match(detail, /币种/);
  assert.match(detail, /FOB金额/);
  assert.match(detail, /境内发货人/);
  assert.match(detail, /HS编码/);
  assert.match(detail, /商品名称/);
  assert.match(styles, /\.customsRecognitionResultCard/);
  assert.match(styles, /\.customsOcrRawResult/);
});

test("tax refund calculation requires confirmed declaration items", () => {
  assert.match(taxCalculationService, /confirmationStatus: "CONFIRMED"/);
  assert.match(taxCalculationService, /CUSTOMS_DECLARATION_ITEMS_CONFIRM_REQUIRED/);
  assert.match(taxCalculationService, /没有确认报关商品明细，不允许进入退税计算。/);
  assert.match(taxCalculationService, /customsDeclarationNo: firstItem\?\.declarationNo/);
  assert.match(taxCalculationService, /customsDeclarationDate: firstItem\?\.declarationDate/);
  assert.match(detail, /const confirmedItems = items\.filter/);
  assert.match(detail, /没有确认报关商品明细，不允许进入退税计算。请先在“报关商品”中确认并保存。/);
  assert.match(detail, /保存后确认/);
  assert.match(styles, /\.taxCalculationBlockedPanel/);
});
