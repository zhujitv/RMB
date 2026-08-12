import type {
  ProformaInvoicePdfInput,
  QuotationPdfRenderResult,
  QuotationProformaInvoiceSnapshot,
} from "./quotation-pdf-types.ts";
import {
  assertQuotationPdfOutputBudget,
  quotationProformaInvoiceFileName,
  validateQuotationPdfSnapshot,
} from "./quotation-pdf-input.ts";
import {
  beginQuotationPdfPage,
  createQuotationPdfState,
  endQuotationPdfPage,
} from "./quotation-pdf-page.ts";
import {
  drawQuotationPdfPostTableSections,
  drawQuotationPdfTotals,
} from "./quotation-pdf-sections.ts";
import { drawQuotationPdfItemsTable } from "./quotation-pdf-table.ts";

export function renderQuotationProformaInvoicePdf(
  snapshot: QuotationProformaInvoiceSnapshot,
): QuotationPdfRenderResult {
  validateQuotationPdfSnapshot(snapshot);
  const state = createQuotationPdfState(snapshot);
  beginQuotationPdfPage(state, true);
  drawQuotationPdfItemsTable(state);
  drawQuotationPdfTotals(state);
  drawQuotationPdfPostTableSections(state);
  endQuotationPdfPage(state);
  const buffer = state.document.close();
  assertQuotationPdfOutputBudget(buffer, state.pageCount);
  return {
    buffer,
    fileName: quotationProformaInvoiceFileName(snapshot),
    pageCount: state.pageCount,
    mimeType: "application/pdf",
  };
}

export function renderProformaInvoicePdf(input: ProformaInvoicePdfInput): Buffer {
  return renderQuotationProformaInvoicePdf(input).buffer;
}

export const generateQuotationProformaInvoicePdf = renderProformaInvoicePdf;
export { quotationProformaInvoiceFileName } from "./quotation-pdf-input.ts";
export type {
  ProformaInvoicePdfInput,
  QuotationPdfBankAccountSnapshot,
  QuotationPdfBuyerSnapshot,
  QuotationPdfDecimal,
  QuotationPdfItemSnapshot,
  QuotationPdfRenderResult,
  QuotationPdfSellerSnapshot,
  QuotationProformaInvoiceSnapshot,
} from "./quotation-pdf-types.ts";
