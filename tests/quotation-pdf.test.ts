import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  quotationProformaInvoiceFileName,
  renderProformaInvoicePdf,
  renderQuotationProformaInvoicePdf,
  type ProformaInvoicePdfInput,
} from "../lib/platform/quotation-pdf.ts";
import {
  assertQuotationPdfTemplateCanRender,
  CURRENT_QUOTATION_PDF_TEMPLATE_VERSION,
} from "../lib/platform/quotation-pdf-input.ts";

const quotationDocumentsSource = readFileSync("lib/platform/quotation-documents.ts", "utf8");

type PdfTextContent = { items: Array<{ str?: string }> };
type PdfPage = {
  getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<PdfTextContent>;
};
type PdfDocumentProxy = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
};
type PdfLoadingTask = {
  promise: Promise<PdfDocumentProxy>;
  destroy?: () => Promise<void>;
};

function fixture(itemCount: number, options: { longDescriptions?: boolean; longTerms?: boolean } = {}): ProformaInvoicePdfInput {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    lineNumber: index + 1,
    description: options.longDescriptions
      ? `Universal panel WPC (24*140*2900 mm) exterior wall cladding with UV protection and custom color ${index + 1}. `.repeat((index % 3) + 1)
      : `Universal panel WPC (24*140*2900 mm) - Color ${index + 1}`,
    unit: "PCS",
    quantity: "10.0000",
    unitPrice: "12.500000",
    amount: "125.00",
    remark: index % 7 === 0 ? "Packed on reinforced pallets." : null,
  }));
  return {
    quotationId: "quotation-test",
    quotationVersionId: "quotation-version-test",
    quoteNo: `QT-PDF-${String(itemCount).padStart(3, "0")}`,
    invoiceNo: "20260809",
    versionNumber: 3,
    quoteDate: "2026-08-09",
    validUntil: "2026-09-09",
    currency: "USD",
    seller: {
      legalName: "Zhejiang Lainuo Building Materials Co., Ltd.",
      address: "No. 88 Industrial Road, Zhejiang, China",
      email: "sales@nextwood.example",
      phone: "+86 571 1234 5678",
      website: "https://www.nextwood.net",
    },
    buyer: {
      legalName: "Example Buyer LLC",
      address: "123 Market Street, Dubai",
      country: "United Arab Emirates",
      contactPerson: "Jane Doe",
      email: "jane@example.test",
      phone: "+971 4 123 4567",
    },
    items,
    subtotal: `${itemCount * 125}.00`,
    discountAmount: "0.00",
    totalAmount: `${itemCount * 125}.00`,
    tradeTerm: "FOB Ningbo",
    paymentTerm: options.longTerms
      ? "Payment is due in agreed milestones after document approval and before shipment release. ".repeat(900)
      : "30% deposit and 70% balance before shipment.",
    leadTimeDays: 30,
    remark: "All dimensions are nominal. Final colors are subject to approved samples.",
    bankAccount: {
      beneficiaryName: "Zhejiang Lainuo Building Materials Co., Ltd.",
      bankName: "Example International Bank",
      bankAddress: "1 Finance Avenue, Hangzhou, China",
      accountNumber: "1234567890",
      swiftCode: "EXAMPLEXXX",
      currency: "USD",
    },
  };
}

function normalizedPdfText(content: PdfTextContent) {
  return content.items
    .map((item) => item.str || "")
    .join(" ")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function inspectPdf(buffer: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as {
    getDocument(options: Record<string, unknown>): PdfLoadingTask;
  };
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const pages: Array<{ width: number; height: number; text: string }> = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({
        width: viewport.width,
        height: viewport.height,
        text: normalizedPdfText(await page.getTextContent()),
      });
    }
  } finally {
    await loadingTask.destroy?.().catch(() => undefined);
  }
  return { pageCount: document.numPages, pages };
}

test("one-line Proforma Invoice is a deterministic, parseable A4 PDF", async () => {
  const input = fixture(1);
  const first = renderProformaInvoicePdf(input);
  const second = renderProformaInvoicePdf(input);
  const rendered = renderQuotationProformaInvoicePdf(input);

  assert.equal(first.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(first.subarray(-32).toString("ascii"), /%%EOF\s*$/);
  assert.equal(first.equals(second), true);
  assert.equal(rendered.buffer.equals(first), true);
  assert.equal(rendered.mimeType, "application/pdf");
  assert.equal(rendered.fileName, "Proforma-Invoice-20260809-V3.pdf");
  assert.equal(quotationProformaInvoiceFileName(input), rendered.fileName);

  const inspected = await inspectPdf(first);
  assert.equal(inspected.pageCount, 1);
  assert.ok(Math.abs(inspected.pages[0].width - 595.28) < 0.5);
  assert.ok(Math.abs(inspected.pages[0].height - 841.89) < 0.5);
  assert.match(inspected.pages[0].text, /PROFORMA INVOICE/);
  assert.match(inspected.pages[0].text, /20260809/);
  assert.match(inspected.pages[0].text, /Zhejiang Lainuo Building Materials Co\., Ltd\./);
  assert.doesNotMatch(inspected.pages[0].text, /United Arab Emirates/);
  assert.match(inspected.pages[0].text, /Universal panel WPC/);
  assert.match(inspected.pages[0].text, /USD 125\.00/);
  assert.doesNotMatch(inspected.pages[0].text, /\bTax\b/);
  assert.doesNotMatch(inspected.pages[0].text, /VALID UNTIL/);
  assert.match(inspected.pages[0].text, /COMMERCIAL TERMS/);
  assert.match(inspected.pages[0].text, /Validity: This quotation remains valid until 09 Sep 2026\./);
  assert.match(inspected.pages[0].text, /BANK DETAILS/);
});

test("only the current PI template can be newly rendered after stored-file reuse", () => {
  assert.equal(
    assertQuotationPdfTemplateCanRender(CURRENT_QUOTATION_PDF_TEMPLATE_VERSION),
    "PI_V5",
  );
  assert.throws(
    () => assertQuotationPdfTemplateCanRender("PI_V4"),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 409);
      assert.equal(
        (error as { code?: string }).code,
        "QUOTATION_DOCUMENT_TEMPLATE_REGENERATION_REQUIRED",
      );
      return true;
    },
  );

  const existingAssetBranch = quotationDocumentsSource.indexOf("if (existing?.contentSha256)");
  const templateGuard = quotationDocumentsSource.indexOf(
    "assertQuotationPdfTemplateCanRender(version.documentTemplateVersion)",
  );
  const renderCall = quotationDocumentsSource.indexOf(
    "renderQuotationProformaInvoicePdf(quotationPdfSnapshot(quotation, version))",
  );
  assert.ok(existingAssetBranch >= 0 && existingAssetBranch < templateGuard);
  assert.ok(templateGuard < renderCall);
});

test("compact seller header omits address and hidden contacts without placeholder rows", async () => {
  const input = fixture(1);
  input.seller = {
    legalName: input.seller.legalName,
    address: input.seller.address,
  };
  const inspected = await inspectPdf(renderProformaInvoicePdf(input));
  const text = inspected.pages[0].text;

  assert.doesNotMatch(text, /sales@nextwood\.example/);
  assert.doesNotMatch(text, /\+86 571 1234 5678/);
  assert.doesNotMatch(text, /www\.nextwood\.net/);
  assert.doesNotMatch(text, /No\. 88 Industrial Road/);
});

test("a section title stays with its first content line at a page boundary", async () => {
  const input = fixture(1);
  input.items[0].remark = null;
  input.paymentTerm = "Payment milestone ".repeat(266);
  input.remark = "UNIQUE REMARK BODY";
  input.bankAccount = null;

  const inspected = await inspectPdf(renderProformaInvoicePdf(input));
  const remarksPages = inspected.pages.filter((page) => page.text.includes("REMARKS"));

  assert.equal(inspected.pageCount, 2);
  assert.equal(remarksPages.length, 1);
  assert.match(remarksPages[0].text, /REMARKS UNIQUE REMARK BODY/);
  assert.doesNotMatch(remarksPages[0].text, /REMARKS \(CONTINUED\)/);
});

test("30 items paginate and repeat the item table header", async () => {
  const rendered = renderQuotationProformaInvoicePdf(fixture(30, { longDescriptions: true }));
  const inspected = await inspectPdf(rendered.buffer);

  assert.equal(inspected.pageCount, rendered.pageCount);
  assert.ok(inspected.pageCount >= 3);
  assert.ok(inspected.pages.filter((page) => page.text.includes("Description")).length >= 2);
  assert.ok(inspected.pages.slice(1).every((page) => page.text.includes("PROFORMA INVOICE")));
  assert.ok(inspected.pages.slice(1).every((page) => page.text.includes("20260809")));
  assert.match(inspected.pages.map((page) => page.text).join(" "), /color 30/i);
  assert.match(inspected.pages.map((page) => page.text).join(" "), /USD 3,750\.00/);
});

test("200 items remain parseable across many A4 pages", async () => {
  const rendered = renderQuotationProformaInvoicePdf(fixture(200));
  const inspected = await inspectPdf(rendered.buffer);
  const allText = inspected.pages.map((page) => page.text).join(" ");

  assert.equal(inspected.pageCount, rendered.pageCount);
  assert.ok(inspected.pageCount >= 8);
  assert.ok(inspected.pages.filter((page) => page.text.includes("Description")).length >= 8);
  assert.match(allText, /Color 200/);
  assert.match(allText, /USD 25,000\.00/);
  assert.match(allText, /DECLARATION/);
});

test("a very long description and payment terms flow onto continuation pages", async () => {
  const input = fixture(1, { longDescriptions: true, longTerms: true });
  input.items[0].description = "Custom extruded WPC profile with project-specific finish and packaging instructions. ".repeat(600);
  const inspected = await inspectPdf(renderProformaInvoicePdf(input));
  const allText = inspected.pages.map((page) => page.text).join(" ");

  assert.ok(inspected.pageCount > 10);
  assert.ok(inspected.pages.filter((page) => page.text.includes("Description")).length > 1);
  assert.match(allText, /COMMERCIAL TERMS/);
  assert.match(allText, /COMMERCIAL TERMS \(CONTINUED\)/);
  assert.match(allText, /DECLARATION/);
});
