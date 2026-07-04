process.env.PDF2JSON_DISABLE_LOGS ||= "1";

import { normalizePdfText, parserError, type PdfParseOptions } from "./customs-declaration-parser-shared.ts";

type Pdf2JsonTextRun = {
  T?: string;
};

type Pdf2JsonTextItem = {
  x?: number;
  y?: number;
  R?: Pdf2JsonTextRun[];
};

type Pdf2JsonOutput = {
  Pages?: Array<{
    Texts?: Pdf2JsonTextItem[];
  }>;
};

type Pdf2JsonParser = {
  on(eventName: "pdfParser_dataError", listener: (error: { parserError?: Error } | Error) => void): Pdf2JsonParser;
  on(eventName: "pdfParser_dataReady", listener: (data: Pdf2JsonOutput) => void): Pdf2JsonParser;
  parseBuffer(pdfBuffer: Buffer, verbosity?: number): void;
  getRawTextContent?(): string;
  destroy?(): void;
};

type Pdf2JsonParserConstructor = new (context?: null, needRawText?: boolean, password?: string) => Pdf2JsonParser;
type Pdf2JsonModule = {
  default?: Pdf2JsonParserConstructor;
  PDFParser?: Pdf2JsonParserConstructor;
};

let pdf2JsonParserClassPromise: Promise<Pdf2JsonParserConstructor> | null = null;

export async function extractPdfTextFromPdfBuffer(buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined, options: PdfParseOptions = {}) {
  const pdfData = Buffer.isBuffer(buffer)
    ? buffer
    : buffer instanceof Uint8Array
      ? Buffer.from(buffer)
      : buffer instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(buffer))
        : Buffer.alloc(0);
  const normalizedText = normalizePdfText(await extractPdfTextWithPdf2Json(pdfData));
  if (options.requireText && !normalizedText) {
    throw parserError("PDF未提取到文字，请手工填写报关单号和申报日期。", 422, "CUSTOMS_PDF_NO_TEXT");
  }
  return normalizedText;
}

async function loadPdf2JsonParser(): Promise<Pdf2JsonParserConstructor> {
  if (!pdf2JsonParserClassPromise) {
    pdf2JsonParserClassPromise = import("pdf2json").then((module) => {
      const typedModule: Pdf2JsonModule = module;
      const PDFParser = typedModule.default || typedModule.PDFParser;
      if (typeof PDFParser !== "function") {
        throw new Error("pdf2json 未导出可用的 PDFParser 构造器。");
      }
      return PDFParser;
    });
  }
  return pdf2JsonParserClassPromise;
}

async function extractPdfTextWithPdf2Json(pdfData: Buffer) {
  const PDFParser = await loadPdf2JsonParser();
  return new Promise<string>((resolve, reject) => {
    const parser = new PDFParser(null, true);
    let settled = false;
    function finish(callback: () => void) {
      if (settled) return;
      settled = true;
      try {
        parser.destroy?.();
      } finally {
        callback();
      }
    }
    parser.on("pdfParser_dataError", (error) => {
      const parserErrorObject = error instanceof Error ? error : error?.parserError;
      finish(() => reject(parserError(
        parserErrorObject?.message || "PDF文本提取失败",
        422,
        "CUSTOMS_PDF_TEXT_EXTRACT_FAILED",
      )));
    });
    parser.on("pdfParser_dataReady", (pdfData) => {
      const rawText = typeof parser.getRawTextContent === "function" ? parser.getRawTextContent() : "";
      const structuredText = textFromPdf2JsonOutput(pdfData);
      finish(() => resolve([rawText, structuredText].filter(Boolean).join("\n")));
    });
    try {
      parser.parseBuffer(pdfData, 0);
    } catch (error) {
      const typedError = error as Error;
      finish(() => reject(parserError(typedError.message || "PDF文本提取失败", 422, "CUSTOMS_PDF_TEXT_EXTRACT_FAILED")));
    }
  });
}

function textFromPdf2JsonOutput(pdfData: Pdf2JsonOutput = {}) {
  return (pdfData.Pages || [])
    .map((page) => linesFromPdf2JsonTexts(page.Texts || []).join("\n"))
    .join("\n\n");
}

function linesFromPdf2JsonTexts(texts: Pdf2JsonTextItem[] = []) {
  const sorted = texts.slice().sort((left, right) => (
    Number(left.y || 0) - Number(right.y || 0)
    || Number(left.x || 0) - Number(right.x || 0)
  ));
  const lines: string[] = [];
  let currentY: number | null = null;
  let currentLine = "";
  for (const item of sorted) {
    const y = Number(item.y || 0);
    const text = decodePdf2JsonText(item);
    if (!text) continue;
    if (currentY === null || Math.abs(y - currentY) <= 0.35) {
      currentLine += text;
      currentY = currentY === null ? y : currentY;
    } else {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = text;
      currentY = y;
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines;
}

function decodePdf2JsonText(item: Pdf2JsonTextItem = {}) {
  return (item.R || [])
    .map((run) => decodePdf2JsonRun(run.T || ""))
    .join("");
}

function decodePdf2JsonRun(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
