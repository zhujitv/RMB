import {
  A4_WIDTH,
  BODY_FONT,
  CONTENT_BOTTOM,
  CONTENT_WIDTH,
  ITEM_LINE_HEIGHT,
  PAGE_MARGIN_X,
  PDF_COLORS,
  type QuotationPdfRenderState,
} from "./quotation-pdf-layout.ts";
import { quotationPdfBankDetails } from "./quotation-pdf-input.ts";
import {
  ensureQuotationPdfSpace,
  nextQuotationPdfPage,
  quotationPdfContext,
} from "./quotation-pdf-page.ts";
import {
  cleanPdfBlockText,
  cleanPdfInlineText,
  drawPdfSingleLine,
  formatPdfDate,
  formatPdfMoney,
  wrapPdfText,
} from "./quotation-pdf-text.ts";

export function drawQuotationPdfTotals(state: QuotationPdfRenderState) {
  const boxWidth = 250;
  const boxX = A4_WIDTH - PAGE_MARGIN_X - boxWidth;
  const rowHeight = 18;
  const rows = [
    ["Subtotal", state.snapshot.subtotal],
    ["Discount", state.snapshot.discountAmount ?? "0"],
    ["TOTAL", state.snapshot.totalAmount],
  ] as const;
  state.currentY += 10;
  ensureQuotationPdfSpace(state, rows.length * rowHeight + 2);
  const context = quotationPdfContext(state);
  rows.forEach(([label, value], index) => {
    const y = state.currentY + index * rowHeight;
    const isTotal = index === rows.length - 1;
    context.fillStyle = isTotal ? PDF_COLORS.accent : PDF_COLORS.accentSoft;
    context.fillRect(boxX, y, boxWidth, rowHeight);
    context.strokeStyle = PDF_COLORS.border;
    context.lineWidth = 0.5;
    context.strokeRect(boxX, y, boxWidth, rowHeight);
    context.fillStyle = isTotal ? PDF_COLORS.white : PDF_COLORS.ink;
    context.font = isTotal ? "700 9px sans-serif" : BODY_FONT;
    drawPdfSingleLine(context, label, boxX + 8, y + 5, 90);
    drawPdfSingleLine(
      context,
      `${cleanPdfInlineText(state.snapshot.currency).toUpperCase()} ${formatPdfMoney(value, label)}`,
      boxX + 103,
      y + 5,
      boxWidth - 111,
      "right",
    );
  });
  state.currentY += rows.length * rowHeight + 10;
}

function drawSection(state: QuotationPdfRenderState, title: string, value: unknown) {
  const text = cleanPdfBlockText(value);
  if (!text) return;
  let context = quotationPdfContext(state);
  context.font = BODY_FONT;
  const lines = wrapPdfText(context, text, CONTENT_WIDTH - 16);
  let lineIndex = 0;
  let continued = false;

  while (lineIndex < lines.length) {
    const titleHeight = 19;
    if (state.currentY + titleHeight + 5 + ITEM_LINE_HEIGHT > CONTENT_BOTTOM) {
      nextQuotationPdfPage(state);
      context = quotationPdfContext(state);
    }
    context.fillStyle = PDF_COLORS.accentSoft;
    context.fillRect(PAGE_MARGIN_X, state.currentY, CONTENT_WIDTH, titleHeight);
    context.fillStyle = PDF_COLORS.accent;
    context.font = "700 8px sans-serif";
    context.fillText(`${title}${continued ? " (CONTINUED)" : ""}`, PAGE_MARGIN_X + 8, state.currentY + 6);
    state.currentY += titleHeight + 5;
    context.fillStyle = PDF_COLORS.ink;
    context.font = BODY_FONT;

    while (lineIndex < lines.length && state.currentY + ITEM_LINE_HEIGHT <= CONTENT_BOTTOM) {
      context.fillText(lines[lineIndex], PAGE_MARGIN_X + 8, state.currentY);
      state.currentY += ITEM_LINE_HEIGHT;
      lineIndex += 1;
    }
    state.currentY += 9;
    if (lineIndex < lines.length) {
      nextQuotationPdfPage(state);
      context = quotationPdfContext(state);
      continued = true;
    }
  }
}

export function drawQuotationPdfPostTableSections(state: QuotationPdfRenderState) {
  const commercialTerms = [
    state.snapshot.tradeTerm ? `Trade term: ${cleanPdfInlineText(state.snapshot.tradeTerm)}` : "",
    state.snapshot.paymentTerm ? `Payment terms: ${cleanPdfBlockText(state.snapshot.paymentTerm)}` : "",
    state.snapshot.validUntil
      ? `Validity: This quotation remains valid until ${formatPdfDate(state.snapshot.validUntil)}.`
      : "",
    state.snapshot.leadTimeDays != null ? `Lead time: ${state.snapshot.leadTimeDays} calendar days` : "",
  ].filter(Boolean).join("\n");
  drawSection(state, "COMMERCIAL TERMS", commercialTerms);
  drawSection(state, "REMARKS", state.snapshot.remark);
  drawSection(state, "BANK DETAILS", quotationPdfBankDetails(state.snapshot.bankAccount, state.snapshot.seller.bankAccount));
  drawSection(
    state,
    "DECLARATION",
    "This Proforma Invoice is issued for quotation purposes only and is subject to the commercial terms stated above.",
  );
}
