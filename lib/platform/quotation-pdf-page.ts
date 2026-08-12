import { PDFDocument } from "@napi-rs/canvas";
import {
  A4_HEIGHT,
  A4_WIDTH,
  BODY_FONT,
  CONTENT_BOTTOM,
  CONTENT_WIDTH,
  FOOTER_Y,
  PAGE_MARGIN_X,
  PDF_COLORS,
  SMALL_FONT,
  type PdfContext,
  type QuotationPdfRenderState,
} from "./quotation-pdf-layout.ts";
import type { QuotationProformaInvoiceSnapshot } from "./quotation-pdf-types.ts";
import {
  QUOTATION_PDF_LIMITS,
  quotationPdfInvoiceNumber,
  quotationPdfLimitError,
} from "./quotation-pdf-input.ts";
import {
  cleanPdfInlineText,
  drawPdfFittedSingleLine,
  drawPdfSingleLine,
  drawPdfWrappedLines,
  formatPdfDate,
  requirePdfText,
} from "./quotation-pdf-text.ts";

export function createQuotationPdfState(snapshot: QuotationProformaInvoiceSnapshot): QuotationPdfRenderState {
  const quoteNo = requirePdfText(snapshot.quoteNo, "Quotation number");
  const invoiceNo = quotationPdfInvoiceNumber(snapshot);
  return {
    snapshot,
    document: new PDFDocument({
      title: `Proforma Invoice ${invoiceNo}`,
      author: cleanPdfInlineText(snapshot.seller.legalName),
      subject: `Quotation ${quoteNo}`,
      creator: "RMB Enterprise Workspace",
      producer: "RMB Enterprise Workspace / Skia PDF",
      keywords: "proforma invoice, quotation",
      compressionLevel: 6,
    }),
    context: null,
    currentY: 0,
    pageCount: 0,
  };
}

export function quotationPdfContext(state: QuotationPdfRenderState): PdfContext {
  if (!state.context) throw new Error("PDF page context is unavailable.");
  return state.context;
}

function drawSellerHeading(state: QuotationPdfRenderState, context: PdfContext) {
  const { seller } = state.snapshot;
  let y = 19;
  context.fillStyle = PDF_COLORS.accent;
  drawPdfFittedSingleLine(
    context,
    requirePdfText(seller.legalName, "Seller legal name"),
    PAGE_MARGIN_X,
    y,
    CONTENT_WIDTH,
    { align: "center", maxFontSize: 13.5, minFontSize: 8.5 },
  );
  y += 19;
  context.fillStyle = PDF_COLORS.ink;
  context.font = "700 14.5px sans-serif";
  drawPdfSingleLine(context, "PROFORMA INVOICE", PAGE_MARGIN_X, y, CONTENT_WIDTH, "center");
  y += 17;
  context.strokeStyle = PDF_COLORS.accent;
  context.lineWidth = 0.7;
  context.beginPath();
  context.moveTo(A4_WIDTH / 2 - 58, y - 2);
  context.lineTo(A4_WIDTH / 2 + 58, y - 2);
  context.stroke();
  const contactLine = [seller.phone, seller.email, seller.website]
    .map(cleanPdfInlineText)
    .filter(Boolean)
    .join(" | ");
  if (contactLine) {
    y += 4;
    context.fillStyle = PDF_COLORS.muted;
    context.font = "400 6.5px sans-serif";
    drawPdfSingleLine(context, contactLine, PAGE_MARGIN_X, y, CONTENT_WIDTH, "center");
    y += 9;
  }
  return y + 7;
}

function invoiceMetaRows(state: QuotationPdfRenderState) {
  return [
    ["INVOICE NO.", quotationPdfInvoiceNumber(state.snapshot)],
    ["ISSUE DATE", formatPdfDate(state.snapshot.quoteDate)],
    ["CURRENCY", cleanPdfInlineText(state.snapshot.currency).toUpperCase()],
  ] as const;
}

function drawInvoiceMeta(state: QuotationPdfRenderState, context: PdfContext, x: number, y: number, width: number) {
  const labelWidth = 78;
  const rowHeight = 13;
  invoiceMetaRows(state).forEach(([label, value], index) => {
    const rowY = y + index * rowHeight;
    context.fillStyle = PDF_COLORS.muted;
    context.font = "700 6.75px sans-serif";
    drawPdfSingleLine(context, label, x, rowY + 1, labelWidth);
    context.fillStyle = PDF_COLORS.ink;
    context.font = index === 0 ? "700 9px sans-serif" : "600 8.25px sans-serif";
    drawPdfSingleLine(context, value, x + labelWidth, rowY, width - labelWidth, "right");
  });
  return y + invoiceMetaRows(state).length * rowHeight;
}

function drawBuyerMeta(state: QuotationPdfRenderState, context: PdfContext, x: number, y: number, width: number) {
  const { buyer } = state.snapshot;
  context.fillStyle = PDF_COLORS.accent;
  context.font = "700 7.25px sans-serif";
  context.fillText("TO:", x, y + 1);
  context.fillStyle = PDF_COLORS.ink;
  drawPdfFittedSingleLine(
    context,
    requirePdfText(buyer.legalName, "Buyer legal name"),
    x + 20,
    y,
    width - 20,
    { maxFontSize: 10.5, minFontSize: 7.5 },
  );
  y += 16;
  context.font = BODY_FONT;
  for (const detail of [buyer.address, buyer.contactPerson ? `Attn: ${cleanPdfInlineText(buyer.contactPerson)}` : ""]) {
    if (!cleanPdfInlineText(detail)) continue;
    y = drawPdfWrappedLines(context, detail, x, y, width, 10) + 1;
  }
  return y;
}

function drawFirstPageHeader(state: QuotationPdfRenderState) {
  const context = quotationPdfContext(state);
  const contentTop = drawSellerHeading(state, context);
  const dividerX = 352;
  const buyerBottom = drawBuyerMeta(state, context, PAGE_MARGIN_X, contentTop, 304);
  const invoiceBottom = drawInvoiceMeta(state, context, 366, contentTop, A4_WIDTH - PAGE_MARGIN_X - 366);
  const contentBottom = Math.max(buyerBottom, invoiceBottom, contentTop + 52);
  context.strokeStyle = PDF_COLORS.border;
  context.lineWidth = 0.5;
  context.beginPath();
  context.moveTo(dividerX, contentTop);
  context.lineTo(dividerX, contentBottom);
  context.stroke();
  context.beginPath();
  context.moveTo(PAGE_MARGIN_X, contentBottom + 4);
  context.lineTo(A4_WIDTH - PAGE_MARGIN_X, contentBottom + 4);
  context.stroke();
  return contentBottom + 11;
}

function drawContinuationHeader(state: QuotationPdfRenderState) {
  const context = quotationPdfContext(state);
  context.fillStyle = PDF_COLORS.accent;
  context.fillRect(PAGE_MARGIN_X, 20, CONTENT_WIDTH, 1.5);
  context.fillStyle = PDF_COLORS.accent;
  context.font = "700 11px sans-serif";
  drawPdfFittedSingleLine(context, state.snapshot.seller.legalName, PAGE_MARGIN_X, 30, 320, {
    maxFontSize: 11,
    minFontSize: 8,
  });
  context.font = "700 11.5px sans-serif";
  drawPdfSingleLine(context, "PROFORMA INVOICE", A4_WIDTH - PAGE_MARGIN_X - 190, 30, 190, "right");
  context.fillStyle = PDF_COLORS.muted;
  context.font = SMALL_FONT;
  drawPdfSingleLine(
    context,
    `Invoice no. ${quotationPdfInvoiceNumber(state.snapshot)} | V${Number(state.snapshot.versionNumber) || 1}`,
    A4_WIDTH - PAGE_MARGIN_X - 220,
    49,
    220,
    "right",
  );
  context.strokeStyle = PDF_COLORS.accent;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(PAGE_MARGIN_X, 62);
  context.lineTo(A4_WIDTH - PAGE_MARGIN_X, 62);
  context.stroke();
  return 75;
}

function drawFooter(state: QuotationPdfRenderState) {
  const context = quotationPdfContext(state);
  context.strokeStyle = PDF_COLORS.border;
  context.lineWidth = 0.5;
  context.beginPath();
  context.moveTo(PAGE_MARGIN_X, FOOTER_Y - 8);
  context.lineTo(A4_WIDTH - PAGE_MARGIN_X, FOOTER_Y - 8);
  context.stroke();
  context.fillStyle = PDF_COLORS.muted;
  context.font = SMALL_FONT;
  const versionNumber = Number(state.snapshot.versionNumber);
  const version = Number.isSafeInteger(versionNumber) && versionNumber > 0 ? ` | V${versionNumber}` : "";
  drawPdfSingleLine(
    context,
    `Proforma Invoice ${quotationPdfInvoiceNumber(state.snapshot)}${version}`,
    PAGE_MARGIN_X,
    FOOTER_Y,
    300,
  );
  drawPdfSingleLine(context, `Page ${state.pageCount}`, A4_WIDTH - PAGE_MARGIN_X - 90, FOOTER_Y, 90, "right");
}

export function beginQuotationPdfPage(state: QuotationPdfRenderState, firstPage: boolean) {
  if (state.context) endQuotationPdfPage(state);
  if (state.pageCount >= QUOTATION_PDF_LIMITS.pages) {
    throw quotationPdfLimitError(`形式发票不能超过 ${QUOTATION_PDF_LIMITS.pages} 页`, "QUOTATION_PDF_PAGE_LIMIT_EXCEEDED");
  }
  state.context = state.document.beginPage(A4_WIDTH, A4_HEIGHT);
  state.pageCount += 1;
  const context = quotationPdfContext(state);
  context.textBaseline = "top";
  context.fillStyle = PDF_COLORS.ink;
  context.strokeStyle = PDF_COLORS.border;
  context.lineWidth = 0.6;
  state.currentY = firstPage ? drawFirstPageHeader(state) : drawContinuationHeader(state);
}

export function endQuotationPdfPage(state: QuotationPdfRenderState) {
  if (!state.context) return;
  drawFooter(state);
  state.document.endPage();
  state.context = null;
}

export function nextQuotationPdfPage(state: QuotationPdfRenderState) {
  beginQuotationPdfPage(state, false);
}

export function ensureQuotationPdfSpace(state: QuotationPdfRenderState, height: number) {
  if (state.currentY + height <= CONTENT_BOTTOM) return;
  nextQuotationPdfPage(state);
}
