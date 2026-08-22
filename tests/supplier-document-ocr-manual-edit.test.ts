import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { normalizeManualSupplierInvoice } = jiti("../lib/platform/supplier-invoice-manual-values.ts") as typeof import("../lib/platform/supplier-invoice-manual-values.ts");

const rawInvoice = {
  provider: "TENCENT_CLOUD",
  apiName: "VatInvoiceOCR",
  requestId: "ocr-request-1",
  pageCount: 1,
  header: {
    invoiceName: "增值税专用发票",
    invoiceCode: "001",
    invoiceNo: "10001",
    invoiceDate: "2026-08-22",
    sellerName: "OCR错误供方",
    sellerTaxNo: "OLD-SELLER",
    buyerName: "OCR错误需方",
    buyerTaxNo: "OLD-BUYER",
    amountWithoutTax: "100",
    taxAmount: "13",
    amountWithTax: "113",
    checkCode: "123456",
  },
  items: [{
    lineNo: "1",
    name: "OCR错误品名",
    spec: "旧规格",
    unit: "个",
    quantity: "3918909000",
    unitPrice: "100",
    amountWithoutTax: "100",
    taxRate: "13%",
    taxAmount: "13",
    taxClassifyCode: "OLD-HS",
  }],
  rawJson: { source: "immutable" },
};

test("supplier invoice manual review edits the five approved item fields and can add rows", () => {
  const originalSnapshot = structuredClone(rawInvoice);
  const manual = normalizeManualSupplierInvoice({
    header: {
      invoiceName: "增值税专用发票",
      invoiceCode: "002",
      invoiceNo: "20002",
      invoiceDate: "2026-08-21",
      sellerName: "人工确认供方",
      sellerTaxNo: "NEW-SELLER",
      buyerName: "人工确认需方",
      buyerTaxNo: "NEW-BUYER",
      amountWithoutTax: "1,000.00",
      taxAmount: "130.00",
      amountWithTax: "1,130.00",
      checkCode: "654321",
    },
    items: [{
      rowId: "ocr:1",
      lineNo: "9",
      name: "塑料制地板",
      spec: "人工规格",
      unit: "千克",
      quantity: "22430",
      unitPrice: "0.04",
      amountWithoutTax: "800",
      taxRate: "13%",
      taxAmount: "104",
      amountWithTax: "904",
      taxClassifyCode: "3918909000",
    }, {
      rowId: "manual-2",
      lineNo: "10",
      name: "不锈钢连接件",
      spec: "人工补录",
      unit: "个",
      quantity: "1344",
      unitPrice: "0.1681547619",
      amountWithoutTax: "200",
      taxRate: "13%",
      taxAmount: "26",
      amountWithTax: "226",
      taxClassifyCode: "7326909000",
    }],
  }, rawInvoice);

  assert.equal(manual.header.invoiceNo, "10001");
  assert.equal(manual.header.sellerName, "OCR错误供方");
  assert.equal(manual.header.amountWithTax, "113");
  assert.equal(manual.items.length, 2);
  assert.equal(manual.items[0]?.lineNo, "1");
  assert.equal(manual.items[0]?.spec, "旧规格");
  assert.equal(manual.items[0]?.amountWithTax, "904");
  assert.equal(manual.items[1]?.name, "不锈钢连接件");
  assert.equal(manual.items[1]?.quantity, "1344");
  assert.equal(manual.items[1]?.spec, "");
  assert.equal(manual.items[1]?.taxClassifyCode, "");
  assert.deepEqual(rawInvoice, originalSnapshot);
});

test("supplier invoice manual review rejects malformed numeric values but permits an empty editable table", () => {
  assert.throws(() => normalizeManualSupplierInvoice({
    header: rawInvoice.header,
    items: [{ ...rawInvoice.items[0], quantity: "HS-3918909000" }],
  }, rawInvoice), /数量必须是有效数字/);
  const empty = normalizeManualSupplierInvoice({ header: rawInvoice.header, items: [] }, rawInvoice);
  assert.deepEqual(empty.items, []);
});

test("OCR raw evidence is immutable while manual versions are revisioned and stale task writes are rejected", () => {
  const migration = readFileSync("prisma/migrations/20260822180000_supplier_ocr_and_factory_price_correction_batch/migration.sql", "utf8");
  const service = readFileSync("lib/platform/supplier-invoice-manual-review.ts", "utf8");
  const route = readFileSync("app/api/supplier-document-requests/[id]/invoice-review/route.ts", "utf8");
  const serializer = readFileSync("lib/platform/supplier-document-request-serializers.ts", "utf8");
  const review = [
    readFileSync("lib/platform/supplier-invoice-review.ts", "utf8"),
    readFileSync("lib/platform/supplier-invoice-review-decision.ts", "utf8"),
  ].join("\n");
  const panel = readFileSync("app/modules/supplier-documents/tax-contract-review-panel.tsx", "utf8");
  const upload = readFileSync("lib/platform/supplier-document-request-upload.ts", "utf8");
  const contractWorkflow = readFileSync("lib/platform/supplier-tax-contract-workflow.ts", "utf8");

  assert.match(migration, /original OCR result cannot be overwritten/);
  assert.match(migration, /manual review must advance revision exactly once/);
  assert.match(migration, /confirmed OCR review cannot be reopened or changed/);
  assert.match(migration, /confirmation and manual changes must be separate updates/);
  assert.match(service, /expectedOcrTaskId/);
  assert.match(service, /reviewRevision: \{ increment: 1 \}/);
  assert.match(service, /originalOcrRetained/);
  assert.match(route, /SAVE_MANUAL/);
  assert.match(serializer, /supplierActor \|\| !invoiceMatch\?\.invoice/);
  assert.match(panel, /expectedOcrTaskId: task\.invoiceOcrTaskId/);
  assert.match(panel, /expectedRevision: task\.invoiceReviewRevision/);
  assert.match(review, /task\.reviewRevision !== expectedRevision/);
  assert.match(review, /SELECT "id" FROM "supplier_document_requests" WHERE "id" = \$\{requestId\} FOR UPDATE/);
  assert.match(review, /已人工确认，不能驳回或重新打开/);
  assert.match(upload, /SUPPLIER_INVOICE_ALREADY_CONFIRMED/);
  assert.match(upload, /assertBusinessOrderWritableInTransaction/);
  assert.match(panel, /expectedRevision: task\.contractRevision/);
  assert.match(contractWorkflow, /contractRevision: expectedRevision/);
});

test("transition and normal contract drafts share the five-field editable table", () => {
  const panel = readFileSync("app/modules/supplier-documents/tax-contract-review-panel.tsx", "utf8");
  const editor = readFileSync("app/modules/supplier-documents/contract-draft-editor.tsx", "utf8");
  const workflow = readFileSync("lib/platform/supplier-tax-contract-workflow.ts", "utf8");

  assert.match(panel, /task\.contractStatus === "PENDING_REVIEW"/);
  assert.doesNotMatch(panel, /PENDING_REVIEW" && !isTransitionContract/);
  for (const label of ["品名", "数量", "单位", "单价", "总价"]) {
    assert.match(editor, new RegExp(label.replace(/[()]/g, "\\$&")));
  }
  assert.doesNotMatch(editor, /updateRow\(index, "customsCommodityCode"/);
  assert.match(editor, /增加一行/);
  assert.match(editor, /删除/);
  assert.doesNotMatch(workflow, /TRANSITION_DRAFT_IMMUTABLE/);
});
