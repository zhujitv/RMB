import {
  BODY_FONT,
  CELL_PADDING_X,
  CELL_PADDING_Y,
  CONTENT_BOTTOM,
  CONTENT_WIDTH,
  ITEM_LINE_HEIGHT,
  PAGE_MARGIN_X,
  PDF_COLORS,
  TABLE_COLUMNS,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_MIN_HEIGHT,
  type QuotationPdfRenderState,
} from "./quotation-pdf-layout.ts";
import {
  nextQuotationPdfPage,
  quotationPdfContext,
} from "./quotation-pdf-page.ts";
import type { QuotationPdfItemSnapshot } from "./quotation-pdf-types.ts";
import {
  cleanPdfBlockText,
  cleanPdfInlineText,
  drawPdfSingleLine,
  formatPdfMoney,
  formatPdfQuantity,
  formatPdfUnitPrice,
  wrapPdfText,
} from "./quotation-pdf-text.ts";

function drawTableHeader(state: QuotationPdfRenderState) {
  const context = quotationPdfContext(state);
  context.fillStyle = PDF_COLORS.accent;
  context.fillRect(PAGE_MARGIN_X, state.currentY, CONTENT_WIDTH, TABLE_HEADER_HEIGHT);
  context.strokeStyle = PDF_COLORS.accent;
  context.lineWidth = 0.6;
  context.font = "700 7.5px sans-serif";
  context.fillStyle = PDF_COLORS.white;
  let x = PAGE_MARGIN_X;
  for (const column of TABLE_COLUMNS) {
    context.strokeRect(x, state.currentY, column.width, TABLE_HEADER_HEIGHT);
    drawPdfSingleLine(
      context,
      column.label,
      x + CELL_PADDING_X,
      state.currentY + (TABLE_HEADER_HEIGHT - ITEM_LINE_HEIGHT) / 2,
      column.width - CELL_PADDING_X * 2,
      column.align,
    );
    x += column.width;
  }
  state.currentY += TABLE_HEADER_HEIGHT;
}

function nextItemsPage(state: QuotationPdfRenderState) {
  nextQuotationPdfPage(state);
  drawTableHeader(state);
}

function startItemsTable(state: QuotationPdfRenderState) {
  if (state.currentY + TABLE_HEADER_HEIGHT + TABLE_ROW_MIN_HEIGHT > CONTENT_BOTTOM) {
    nextQuotationPdfPage(state);
  }
  drawTableHeader(state);
}

function itemDescription(item: QuotationPdfItemSnapshot) {
  const description = cleanPdfBlockText(item.description);
  const remark = cleanPdfBlockText(item.remark);
  return remark ? `${description}\nNote: ${remark}` : description;
}

function drawTableRowFragment(
  state: QuotationPdfRenderState,
  item: QuotationPdfItemSnapshot,
  itemIndex: number,
  lines: string[],
  rowHeight: number,
  firstFragment: boolean,
) {
  const context = quotationPdfContext(state);
  const y = state.currentY;
  if (itemIndex % 2 === 1) {
    context.fillStyle = PDF_COLORS.rowAlternate;
    context.fillRect(PAGE_MARGIN_X, y, CONTENT_WIDTH, rowHeight);
  }
  context.strokeStyle = PDF_COLORS.border;
  context.lineWidth = 0.5;
  context.font = BODY_FONT;
  context.fillStyle = PDF_COLORS.ink;
  const itemLineNumber = Number(item.lineNumber);
  const lineNumber = Number.isSafeInteger(itemLineNumber) && itemLineNumber > 0
    ? String(itemLineNumber)
    : String(itemIndex + 1);
  const cells: Record<string, string> = firstFragment ? {
    line: lineNumber,
    unit: cleanPdfInlineText(item.unit),
    quantity: formatPdfQuantity(item.quantity, `Item ${itemIndex + 1} quantity`),
    unitPrice: formatPdfUnitPrice(item.unitPrice, `Item ${itemIndex + 1} unit price`),
    amount: formatPdfMoney(item.amount, `Item ${itemIndex + 1} amount`),
  } : { line: "", unit: "", quantity: "", unitPrice: "", amount: "" };

  let x = PAGE_MARGIN_X;
  for (const column of TABLE_COLUMNS) {
    context.strokeRect(x, y, column.width, rowHeight);
    if (column.key === "description") {
      const textY = y + Math.max(0, (rowHeight - lines.length * ITEM_LINE_HEIGHT) / 2);
      lines.forEach((line, index) => {
        context.fillText(line, x + CELL_PADDING_X, textY + index * ITEM_LINE_HEIGHT);
      });
    } else {
      drawPdfSingleLine(
        context,
        cells[column.key] || "",
        x + CELL_PADDING_X,
        y + (rowHeight - ITEM_LINE_HEIGHT) / 2,
        column.width - CELL_PADDING_X * 2,
        column.align,
      );
    }
    x += column.width;
  }
  state.currentY += rowHeight;
}

function drawItem(state: QuotationPdfRenderState, item: QuotationPdfItemSnapshot, itemIndex: number) {
  const context = quotationPdfContext(state);
  context.font = BODY_FONT;
  const descriptionWidth = TABLE_COLUMNS[1].width - CELL_PADDING_X * 2;
  const lines = wrapPdfText(context, itemDescription(item), descriptionWidth);
  let lineIndex = 0;
  let firstFragment = true;

  while (lineIndex < lines.length) {
    if (state.currentY + TABLE_ROW_MIN_HEIGHT > CONTENT_BOTTOM) {
      nextItemsPage(state);
    }
    const availableHeight = CONTENT_BOTTOM - state.currentY;
    const maxLines = Math.max(1, Math.floor((availableHeight - CELL_PADDING_Y * 2) / ITEM_LINE_HEIGHT));
    const fragmentLines = lines.slice(lineIndex, lineIndex + maxLines);
    const rowHeight = Math.max(TABLE_ROW_MIN_HEIGHT, fragmentLines.length * ITEM_LINE_HEIGHT + CELL_PADDING_Y * 2);
    if (state.currentY + rowHeight > CONTENT_BOTTOM) {
      nextItemsPage(state);
      continue;
    }
    drawTableRowFragment(state, item, itemIndex, fragmentLines, rowHeight, firstFragment);
    lineIndex += fragmentLines.length;
    firstFragment = false;
    if (lineIndex < lines.length) {
      nextItemsPage(state);
    }
  }
}

export function drawQuotationPdfItemsTable(state: QuotationPdfRenderState) {
  startItemsTable(state);
  state.snapshot.items.forEach((item, index) => drawItem(state, item, index));
}
