import type { PDFDocument } from "@napi-rs/canvas";
import type { QuotationProformaInvoiceSnapshot } from "./quotation-pdf-types.ts";

export type PdfContext = ReturnType<PDFDocument["beginPage"]>;
export type TextAlign = "left" | "center" | "right";

export type QuotationPdfRenderState = {
  document: PDFDocument;
  snapshot: QuotationProformaInvoiceSnapshot;
  context: PdfContext | null;
  currentY: number;
  pageCount: number;
};

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
export const PAGE_MARGIN_X = 34;
export const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN_X * 2;
export const CONTENT_BOTTOM = 790;
export const FOOTER_Y = 815;
export const BODY_FONT = "400 8.5px sans-serif";
export const SMALL_FONT = "400 7.5px sans-serif";
export const ITEM_LINE_HEIGHT = 11;
export const TABLE_HEADER_HEIGHT = 23;
export const TABLE_ROW_MIN_HEIGHT = 28;
export const CELL_PADDING_X = 5;
export const CELL_PADDING_Y = 6;

export const PDF_COLORS = {
  ink: "#172B3A",
  muted: "#5F6F7A",
  accent: "#1F4E78",
  accentSoft: "#EAF2F8",
  border: "#B8C4CC",
  rowAlternate: "#F7F9FA",
  white: "#FFFFFF",
} as const;

export const TABLE_COLUMNS = [
  { key: "line", label: "No.", width: 28, align: "center" as TextAlign },
  { key: "description", label: "Description", width: 220, align: "left" as TextAlign },
  { key: "unit", label: "Unit", width: 48, align: "center" as TextAlign },
  { key: "quantity", label: "Qty", width: 54, align: "right" as TextAlign },
  { key: "unitPrice", label: "Unit Price", width: 75, align: "right" as TextAlign },
  { key: "amount", label: "Amount", width: CONTENT_WIDTH - 425, align: "right" as TextAlign },
] as const;
