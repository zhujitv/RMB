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

const contract = {
  contractNo: "CUSTOMER-01",
  customerOrderNo: "CUSTOMER",
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
  signingPlace: "浙江省诸暨市",
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
  assert.match(sheet || "", /CUSTOMER-01/);
  assert.match(sheet || "", /木塑复合地板/);
  assert.match(sheet || "", /平方米/);
  assert.doesNotMatch(sheet || "", /规格型号/);
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
  assert.match(workflow, /input\.confirmed !== true/);
  assert.match(workflow, /contractRevision: \{ increment: 1 \}/);
  assert.match(workflow, /generateSupplierTaxContractXlsx/);
  assert.match(upload, /processSupplierInvoiceOcr/);
  assert.match(completion, /invoiceMatchStatus === "CONFIRMED"/);
  assert.match(taxStatus, /SUPPLIER_INVOICE_REVIEW_REQUIRED/);
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
