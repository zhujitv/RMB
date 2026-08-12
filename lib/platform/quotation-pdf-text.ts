import type { QuotationPdfDecimal } from "./quotation-pdf-types.ts";
import type { PdfContext, TextAlign } from "./quotation-pdf-layout.ts";

export function cleanPdfBlockText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .trim();
}

export function cleanPdfInlineText(value: unknown) {
  return cleanPdfBlockText(value).replace(/\s+/g, " ").trim();
}

export function requirePdfText(value: unknown, label: string) {
  const text = cleanPdfInlineText(value);
  if (!text) throw new TypeError(`${label} is required to generate a Proforma Invoice PDF.`);
  return text;
}

function decimalParts(value: QuotationPdfDecimal | null | undefined, label: string) {
  const raw = String(value ?? "0").trim().replaceAll(",", "");
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new TypeError(`${label} must be a plain decimal value.`);
  const sign = match[1] === "-" ? "-" : "";
  const integer = (match[2] || "0").replace(/^0+(?=\d)/, "") || "0";
  const fraction = match[3] || "";
  return { sign: integer === "0" && !/[1-9]/.test(fraction) ? "" : sign, integer, fraction };
}

function formatDecimal(
  value: QuotationPdfDecimal | null | undefined,
  label: string,
  minimumFractionDigits: number,
  maximumFractionDigits: number,
) {
  const parts = decimalParts(value, label);
  if (parts.fraction.length > maximumFractionDigits) {
    throw new RangeError(`${label} supports at most ${maximumFractionDigits} decimal places.`);
  }
  const grouped = parts.integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let fraction = parts.fraction;
  while (fraction.length > minimumFractionDigits && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  fraction = fraction.padEnd(minimumFractionDigits, "0");
  return `${parts.sign}${grouped}${fraction ? `.${fraction}` : ""}`;
}

export function formatPdfMoney(value: QuotationPdfDecimal | null | undefined, label: string) {
  return formatDecimal(value, label, 2, 2);
}

export function formatPdfUnitPrice(value: QuotationPdfDecimal, label: string) {
  return formatDecimal(value, label, 2, 6);
}

export function formatPdfQuantity(value: QuotationPdfDecimal, label: string) {
  return formatDecimal(value, label, 0, 4);
}

export function formatPdfDate(value: unknown) {
  const text = cleanPdfInlineText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return text || "-";
  const monthIndex = Number(match[2]) - 1;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (monthIndex < 0 || monthIndex >= months.length) return text;
  return `${match[3]} ${months[monthIndex]} ${match[1]}`;
}

function splitOversizedToken(context: PdfContext, token: string, maxWidth: number) {
  const chunks: string[] = [];
  let current = "";
  for (const character of Array.from(token)) {
    const candidate = `${current}${character}`;
    if (current && context.measureText(candidate).width > maxWidth) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [""];
}

export function wrapPdfText(context: PdfContext, value: unknown, maxWidth: number) {
  const source = cleanPdfBlockText(value);
  if (!source) return [""];
  const lines: string[] = [];
  for (const paragraph of source.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const chunks = context.measureText(word).width > maxWidth
        ? splitOversizedToken(context, word, maxWidth)
        : [word];
      for (const chunk of chunks) {
        const candidate = current ? `${current} ${chunk}` : chunk;
        if (current && context.measureText(candidate).width > maxWidth) {
          lines.push(current);
          current = chunk;
        } else {
          current = candidate;
        }
      }
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [""];
}

function fitSingleLine(context: PdfContext, value: unknown, maxWidth: number) {
  const text = cleanPdfInlineText(value);
  if (!text) return "";
  if (context.measureText(text).width <= maxWidth) return text;
  const suffix = "...";
  let fitted = "";
  for (const character of Array.from(text)) {
    if (context.measureText(`${fitted}${character}${suffix}`).width > maxWidth) break;
    fitted += character;
  }
  return `${fitted}${suffix}`;
}

export function drawPdfFittedSingleLine(
  context: PdfContext,
  value: unknown,
  x: number,
  y: number,
  width: number,
  options: {
    align?: TextAlign;
    weight?: number;
    maxFontSize?: number;
    minFontSize?: number;
  } = {},
) {
  const text = cleanPdfInlineText(value);
  if (!text) return;
  const align = options.align || "left";
  const weight = options.weight || 700;
  const minFontSize = options.minFontSize || 8;
  let fontSize = options.maxFontSize || 14;
  context.font = `${weight} ${fontSize}px sans-serif`;
  while (fontSize > minFontSize && context.measureText(text).width > width) {
    fontSize = Math.max(minFontSize, fontSize - 0.25);
    context.font = `${weight} ${fontSize}px sans-serif`;
  }
  const measuredWidth = context.measureText(text).width;
  if (measuredWidth > width) {
    fontSize = Math.max(5, fontSize * width / measuredWidth);
    context.font = `${weight} ${fontSize}px sans-serif`;
  }
  context.textAlign = align;
  const drawX = align === "right" ? x + width : align === "center" ? x + width / 2 : x;
  context.fillText(text, drawX, y);
  context.textAlign = "left";
}

export function drawPdfSingleLine(
  context: PdfContext,
  value: unknown,
  x: number,
  y: number,
  width: number,
  align: TextAlign = "left",
) {
  const text = fitSingleLine(context, value, width);
  context.textAlign = align;
  const drawX = align === "right" ? x + width : align === "center" ? x + width / 2 : x;
  context.fillText(text, drawX, y);
  context.textAlign = "left";
}

export function drawPdfWrappedLines(
  context: PdfContext,
  value: unknown,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
) {
  const lines = wrapPdfText(context, value, width);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}
