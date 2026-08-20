import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import JSZip from "jszip";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
const jiti = createJiti(import.meta.url);
const { matchSupplierInvoiceToContract } = jiti("../lib/platform/supplier-invoice-contract-match.ts") as typeof import("../lib/platform/supplier-invoice-contract-match.ts");
const { generateSupplierTaxContractXlsx } = jiti("../lib/platform/supplier-tax-contract-xlsx.ts") as typeof import("../lib/platform/supplier-tax-contract-xlsx.ts");
const { applySupplierTaxContractDraftEdits } = jiti("../lib/platform/supplier-tax-contract-draft-edit.ts") as typeof import("../lib/platform/supplier-tax-contract-draft-edit.ts");
const { normalizeSupplierTaxContractNumber, supplierTaxContractNumberFromJson } = jiti("../lib/platform/supplier-tax-contract-number.ts") as typeof import("../lib/platform/supplier-tax-contract-number.ts");

const contract = {
  contractNo: "PV258",
  customerOrderNo: "PV258",
  orderId: "order",
  costId: "cost",
  purchaseOrderId: "po",
  purchaseOrderNo: "PO-1",
  customsDocumentId: "customs",
  customsDeclarationNo: "DECLARATION",
  supplierId: "supplier",
  supplierName: "浙江供应商有限公司",
  supplierTaxNumber: "91330000123456789X",
  supplierAddress: "浙江省",
  supplierPhone: "0571-12345678",
  supplierBankName: "中国银行",
  supplierBankAccount: "123456789",
  buyerBusinessEntityId: "entity",
  buyerName: "浙江莱诺建材有限公司",
  buyerTaxNumber: "91330000987654321X",
  buyerAddress: "浙江省诸暨市",
  buyerPhone: "0575-12345678",
  buyerBankName: "工商银行",
  buyerBankAccount: "987654321",
  signingPlace: "中国",
  signingDate: "2026-08-17",
  latestDeliveryDate: "2026-08-20",
  currency: "CNY",
  totalAmountWithTax: "1130.00",
  items: [
    { lineNo: 1, purchaseOrderItemId: "item-1", customsItemNo: "1", customsCommodityCode: "3918909000", productName: "木塑复合地板", unit: "平方米", quantity: "10", declaredQuantity: "10", unitPriceWithTax: "113", amountWithTax: "1130.00" },
  ],
  customsSnapshot: [],
  warnings: [],
  blockingIssues: [],
  generatedAt: "2026-08-17T00:00:00.000Z",
  ocrRequestIds: ["request"],
};

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    provider: "TENCENT_CLOUD",
    apiName: "VatInvoiceOCR",
    requestId: "ocr-request",
    pageCount: 1,
    header: {
      invoiceName: "增值税专用发票",
      invoiceCode: "",
      invoiceNo: "INV-001",
      invoiceDate: "2026年08月17日",
      sellerName: contract.supplierName,
      sellerTaxNo: contract.supplierTaxNumber,
      buyerName: contract.buyerName,
      buyerTaxNo: contract.buyerTaxNumber,
      amountWithoutTax: "1000.00",
      taxAmount: "130.00",
      amountWithTax: "1130.00",
      checkCode: "",
      ...(overrides.header as object || {}),
    },
    items: [{ lineNo: "1", name: "*塑料制品*木塑复合地板", unit: "平方米", quantity: "10.0000", unitPrice: "100", amountWithoutTax: "1000", taxRate: "13%", taxAmount: "130", taxClassifyCode: "107060107" }],
    rawJson: {},
    ...overrides,
  };
}

test("VAT invoice must match supplier, buyer, tax ids, product name, quantity, unit and total", () => {
  const matched = matchSupplierInvoiceToContract(invoice() as never, contract as never);
  assert.equal(matched.matched, true);
  assert.deepEqual(matched.issues, []);

  const mismatch = matchSupplierInvoiceToContract(invoice({
    header: { buyerTaxNo: "WRONG", amountWithTax: "1129.99" },
    items: [{ lineNo: "1", name: "其它商品", unit: "件", quantity: "9" }],
  }) as never, contract as never);
  assert.equal(mismatch.matched, false);
  assert.match(mismatch.issues.join("|"), /购买方纳税人识别号/);
  assert.match(mismatch.issues.join("|"), /价税合计/);
  assert.match(mismatch.issues.join("|"), /缺少合同商品/);
  assert.match(mismatch.issues.join("|"), /合同外商品/);
});

test("generated tax contract workbook contains no specification column and freezes approved customs values", async () => {
  const body = await generateSupplierTaxContractXlsx(contract as never);
  assert.equal(body.subarray(0, 2).toString("binary"), "PK");
  const zip = await JSZip.loadAsync(body);
  const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
  assert.match(sheet || "", /出口产品订货合同/);
  assert.match(sheet || "", /PV258/);
  assert.match(sheet || "", /木塑复合地板/);
  assert.match(sheet || "", /平方米/);
  assert.match(sheet || "", /签订地点：浙江诸暨/);
  assert.doesNotMatch(sheet || "", /签订地点：中国/);
  assert.match(sheet || "", /二、交（提）货地点、方式：需方指定船公司仓库。允许溢短装。/);
  assert.match(sheet || "", /十、未尽事宜，协商解决。/);
  assert.match(sheet || "", /税号：91330000987654321X/);
  assert.match(sheet || "", /开户行：工商银行/);
  assert.match(sheet || "", /账号：987654321/);
  assert.match(sheet || "", /<c r="A7"[^>]*s="8"/);
  assert.match(sheet || "", /<c r="C7"[^>]*s="8"/);
  assert.match(sheet || "", /<c r="F7"[^>]*s="6"/);
  assert.match(sheet || "", /<sheetFormatPr[^>]*defaultRowHeight="14"/);
  assert.match(sheet || "", /<c r="B9"[^>]*s="8"/);
  assert.match(sheet || "", /<c r="F9"[^>]*s="8"/);
  assert.doesNotMatch(sheet || "", /规格型号/);
});

test("tax contract number is exactly the customer order number without supplier suffixes", () => {
  assert.equal(normalizeSupplierTaxContractNumber({ contractNo: "PV258-T01", customerOrderNo: "PV258" }).contractNo, "PV258");
  assert.equal(supplierTaxContractNumberFromJson({ customerOrderNo: "PV258" }, "PV258-T01"), "PV258");
  const draftSource = readFileSync("lib/platform/supplier-tax-contract-draft.ts", "utf8");
  const transitionSource = readFileSync("lib/platform/supplier-transition-settlement.ts", "utf8");
  const workflowSource = readFileSync("lib/platform/supplier-tax-contract-workflow.ts", "utf8");
  const serializerSource = readFileSync("lib/platform/supplier-document-request-serializers.ts", "utf8");
  assert.match(draftSource, /const contractNo = purchaseOrder\.execution\.customerOrderNo;/);
  assert.match(transitionSource, /contractNo: cost\.order\.orderNo,/);
  assert.doesNotMatch(draftSource, /contractNo[^\n]*padStart/);
  assert.doesNotMatch(transitionSource, /contractNo[^\n]*-T/);
  assert.match(workflowSource, /contractNo: draft\.contractNo,/);
  assert.match(workflowSource, /contractNo: rejectedDraft\.contractNo,/);
  assert.match(serializerSource, /row\.contractStatus === "PENDING_REVIEW" \|\| row\.contractStatus === "REJECTED"/);
});

test("tax contracts use the dedicated domestic buyer account instead of CNY international remittance data", () => {
  const draftSource = readFileSync("lib/platform/supplier-tax-contract-draft.ts", "utf8");
  const transitionSource = readFileSync("lib/platform/supplier-transition-settlement.ts", "utf8");
  assert.match(draftSource, /buyerBankName: purchaseOrder\.execution\.businessEntity\.domesticBankName/);
  assert.match(draftSource, /buyerBankAccount: purchaseOrder\.execution\.businessEntity\.domesticBankAccount/);
  assert.match(transitionSource, /buyerBankName: entity\.domesticBankName/);
  assert.match(transitionSource, /buyerBankAccount: entity\.domesticBankAccount/);
  assert.doesNotMatch(draftSource, /buyerBankName: cnyAccount/);
  assert.doesNotMatch(transitionSource, /buyerBankName: cnyAccount/);
});

test("tax contract adds one bordered product row per item and shifts the remaining template", async () => {
  const items = Array.from({ length: 9 }, (_, index) => ({
    ...contract.items[0],
    lineNo: index + 1,
    purchaseOrderItemId: `item-${index + 1}`,
    productName: `产品${index + 1}`,
  }));
  const body = await generateSupplierTaxContractXlsx({ ...contract, items } as never);
  const zip = await JSZip.loadAsync(body);
  const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string") || "";
  assert.match(sheet, /<dimension ref="A1:F34"/);
  assert.match(sheet, /<c r="A15"[^>]*s="8"[^>]*>.*产品9/);
  assert.match(sheet, /<c r="A16"[^>]*s="7"[^>]*>.*合计/);
  assert.match(sheet, /<row r="16" ht="15" customHeight="1"/);
  for (let footerRow = 29; footerRow <= 34; footerRow += 1) {
    assert.match(sheet, new RegExp(`<row r="${footerRow}" ht="20" customHeight="1"`));
    assert.match(sheet, new RegExp(`<mergeCell ref="A${footerRow}:C${footerRow}"`));
    assert.match(sheet, new RegExp(`<mergeCell ref="D${footerRow}:F${footerRow}"`));
  }
  assert.match(sheet, /供方（盖章）：浙江供应商有限公司/);
});

test("manual review can correct OCR name, quantity and unit while preserving original evidence", () => {
  const edited = applySupplierTaxContractDraftEdits(contract as never, [{
    purchaseOrderItemId: "item-1",
    productName: "木塑地板",
    quantity: "10.0000",
    unit: "平方米（m²）",
  }], new Date("2026-08-17T01:00:00.000Z"));
  assert.equal(edited.draft.items[0]?.productName, "木塑地板");
  assert.equal(edited.draft.items[0]?.quantity, "10");
  assert.equal(edited.draft.items[0]?.unit, "平方米（m²）");
  assert.equal(edited.draft.items[0]?.amountWithTax, "1130.00");
  assert.deepEqual(edited.draft.customsSnapshot, contract.customsSnapshot);
  assert.equal(edited.draft.generatedAt, contract.generatedAt);
  assert.equal(edited.draft.manualEditedAt, "2026-08-17T01:00:00.000Z");
  assert.deepEqual(edited.draft.blockingIssues, []);
  assert.match(edited.draft.warnings.join("|"), /OCR识别结果已人工修正/);
});

test("manual quantity correction is saved but blocks approval when the settlement total no longer matches", () => {
  const edited = applySupplierTaxContractDraftEdits(contract as never, [{
    purchaseOrderItemId: "item-1",
    productName: "木塑复合地板",
    quantity: "9",
    unit: "平方米",
  }]);
  assert.equal(edited.draft.items[0]?.amountWithTax, "1017.00");
  assert.match(edited.draft.blockingIssues.join("|"), /采购结算金额1130\.00不一致/);
  assert.throws(() => applySupplierTaxContractDraftEdits(contract as never, []), /完整提交合同中的全部商品行/);
});

test("workflow requires manual contract review and invoice confirmation before completion and tax submission", () => {
  const workflow = readFileSync("lib/platform/supplier-tax-contract-workflow.ts", "utf8");
  const upload = readFileSync("lib/platform/supplier-document-request-upload.ts", "utf8");
  const completion = readFileSync("lib/platform/supplier-document-request-completion.ts", "utf8");
  const taxStatus = readFileSync("lib/platform/tax-refunds-status-actions.ts", "utf8");
  assert.match(workflow, /contractStatus: "PENDING_REVIEW"/);
  assert.match(workflow, /refreshSupplierTaxContractBuyer\(contractDraft\(row\.contractDraft\)\)/);
  assert.match(workflow, /input\.confirmed !== true/);
  assert.match(workflow, /contractRevision: \{ increment: 1 \}/);
  assert.match(workflow, /generateSupplierTaxContractXlsx/);
  assert.match(upload, /processSupplierInvoiceOcr/);
  assert.match(upload, /row\.contractStatus !== "LEGACY"/);
  assert.match(upload, /row\.contractStatus !== "APPROVED" \|\| !row\.contractApproved/);
  assert.match(completion, /invoiceMatchStatus === "CONFIRMED"/);
  assert.match(taxStatus, /SUPPLIER_INVOICE_REVIEW_REQUIRED/);
});

test("pending contract previews refresh buyer domestic account data before review", () => {
  const preview = readFileSync("lib/platform/supplier-tax-contract-preview.ts", "utf8");
  const buyer = readFileSync("lib/platform/supplier-tax-contract-buyer.ts", "utf8");
  assert.match(preview, /refreshSupplierTaxContractBuyer\(pendingDraft\(row\.contractDraft\)\)/);
  assert.match(buyer, /domesticBankName: true, domesticBankAccount: true/);
  assert.match(buyer, /buyerBankName: entity\.domesticBankName/);
});

test("approved contracts can rerun Tencent invoice OCR for an already uploaded PDF", () => {
  const review = readFileSync("lib/platform/supplier-invoice-review.ts", "utf8");
  const route = readFileSync("app/api/supplier-document-requests/[id]/invoice-review/route.ts", "utf8");
  const panel = readFileSync("app/modules/supplier-documents/tax-contract-review-panel.tsx", "utf8");
  assert.match(review, /retrySupplierInvoiceOcr/);
  assert.match(review, /readR2Object\(document\.storageKey/);
  assert.match(review, /processSupplierInvoiceOcr\(row\.id, document\.id, body\)/);
  assert.match(route, /decision === "RETRY_OCR"/);
  assert.match(panel, /重新执行腾讯云 OCR/);
});

test("contract review UI requires saving manual OCR corrections before approval", () => {
  const panel = readFileSync("app/modules/supplier-documents/tax-contract-review-panel.tsx", "utf8");
  const route = readFileSync("app/api/supplier-document-requests/[id]/contract-review/route.ts", "utf8");
  assert.match(panel, /保存人工修正/);
  assert.match(panel, /productName/);
  assert.match(panel, /quantity/);
  assert.match(panel, /unit/);
  assert.match(panel, /draftDirty/);
  assert.match(route, /decision === "SAVE_DRAFT"/);
  assert.match(route, /saveSupplierTaxContractDraftEdits/);
});
