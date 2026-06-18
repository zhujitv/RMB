export const CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO = "AUTO_PDF_TEXT";
export const CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL = "MANUAL";
export const CUSTOMS_DECLARATION_PARSE_STATUSES = ["SUCCESS", "PARTIAL", "FAILED"] as const;

process.env.PDF2JSON_DISABLE_LOGS ||= "1";

type CustomsParseStatus = (typeof CUSTOMS_DECLARATION_PARSE_STATUSES)[number];

type CustomsFields = {
  customsDeclarationNo: string;
  customsDeclarationDate: string;
};

type CustomsParseResult = CustomsFields & {
  customsDeclarationParseStatus: CustomsParseStatus;
  customsDeclarationParseSource: typeof CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO;
  customsDeclarationParseMessage: string;
};

type Candidate = {
  value: string;
  score: number;
  index: number;
};

type PdfParseOptions = {
  requireText?: boolean;
};

type ParserError = Error & {
  status?: number;
  code?: string;
  expose?: boolean;
};

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

type Pdf2JsonParserConstructor = new (context?: unknown, needRawText?: boolean, password?: string) => Pdf2JsonParser;

const DECLARATION_NO_LABELS = ["报关单号", "海关编号", "预录入编号"];
const DECLARATION_DATE_LABELS = ["申报日期", "出口申报日期", "申报时间"];
const NON_DECLARATION_DATE_LABEL_PATTERN = /(出口|录入|打印|放行|签发)日期/g;
const DECLARATION_NO_PATTERN = /[A-Z0-9]{8,32}/gi;
let pdf2JsonParserClassPromise: Promise<Pdf2JsonParserConstructor> | null = null;

export function toHalfWidth(value = "") {
  return String(value || "")
    .replace(/\u3000/g, " ")
    .replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

export function normalizePdfText(value = "") {
  return toHalfWidth(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeCustomsDate(value = "") {
  const text = toHalfWidth(value).trim();
  let match = text.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*(?:日)?/);
  if (match) return normalizeDateParts(match[1], match[2], match[3]);
  match = text.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (match) return normalizeDateParts(match[1], match[2], match[3]);
  return "";
}

export function parseCustomsDeclarationText(text = ""): CustomsParseResult {
  const normalized = normalizePdfText(text);
  const customsDeclarationNo = findBestDeclarationNo(normalized);
  const customsDeclarationDate = findBestDeclarationDate(normalized);
  const fields = {
    customsDeclarationNo,
    customsDeclarationDate,
  };
  const status = customsParseStatusFromFields(fields);
  return {
    ...fields,
    customsDeclarationParseStatus: status,
    customsDeclarationParseSource: CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
    customsDeclarationParseMessage: customsParseMessage(fields, status),
  };
}

export async function parseCustomsDeclarationPdfBuffer(buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined, options: PdfParseOptions = {}) {
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
  return parseCustomsDeclarationText(normalizedText);
}

export function customsParseStatusFromFields(fields: Partial<CustomsFields> = {}): CustomsParseStatus {
  const hasNo = Boolean(String(fields.customsDeclarationNo || "").trim());
  const hasDate = Boolean(String(fields.customsDeclarationDate || "").trim());
  if (hasNo && hasDate) return "SUCCESS";
  if (hasNo || hasDate) return "PARTIAL";
  return "FAILED";
}

export function customsParseMessage(fields: Partial<CustomsFields> = {}, status = customsParseStatusFromFields(fields)) {
  if (status === "SUCCESS") return "已识别：\n✓ 报关单号\n✓ 申报日期";
  const missing: string[] = [];
  if (!fields.customsDeclarationDate) missing.push("申报日期");
  if (!fields.customsDeclarationNo) missing.push("报关单号");
  if (status === "PARTIAL") return `文件已上传，已自动识别部分信息，未自动识别到${missing.join("/")}，请手工填写。`;
  return "未识别成功，请手工填写报关单号和申报日期";
}

function normalizeDateParts(year: string, month: string, day: string) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function loadPdf2JsonParser(): Promise<Pdf2JsonParserConstructor> {
  if (!pdf2JsonParserClassPromise) {
    pdf2JsonParserClassPromise = import("pdf2json").then((module) => {
      const moduleRecord = module as Record<string, unknown>;
      const PDFParser = (moduleRecord.default || moduleRecord.PDFParser) as Pdf2JsonParserConstructor | undefined;
      if (typeof PDFParser !== "function") {
        throw new Error("pdf2json 未导出可用的 PDFParser 构造器。");
      }
      return PDFParser;
    });
  }
  return pdf2JsonParserClassPromise;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parserError(message: string, status: number, code: string): ParserError {
  const error: ParserError = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
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

function compactForNearbySearch(text = "") {
  return String(text || "").replace(/\s+/g, " ");
}

function findBestDeclarationNo(text = "") {
  const compact = compactForNearbySearch(text);
  const candidates: Candidate[] = [];
  DECLARATION_NO_LABELS.forEach((label, labelIndex) => {
    const pattern = new RegExp(`${escapeRegExp(label)}\\s*[:：]?\\s*([A-Z0-9\\s-]{8,48})`, "gi");
    for (const match of compact.matchAll(pattern)) {
      const raw = (match[1] || "").replace(/[\s-]+/g, "");
      const declarationNo = raw.match(/^[A-Z0-9]{8,32}/i)?.[0] || raw.match(DECLARATION_NO_PATTERN)?.[0] || "";
      if (isLikelyDeclarationNo(declarationNo)) {
        candidates.push({ value: declarationNo.toUpperCase(), score: 100 - labelIndex * 10, index: match.index || 0 });
      }
    }
  });
  if (!candidates.length) {
    for (const match of compact.matchAll(DECLARATION_NO_PATTERN)) {
      const value = (match[0] || "").toUpperCase();
      if (isLikelyDeclarationNo(value)) candidates.push({ value, score: 10, index: match.index || 0 });
    }
  }
  return chooseBest(candidates);
}

function isLikelyDeclarationNo(value = "") {
  const normalized = String(value || "").replace(/[\s-]+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8,32}$/.test(normalized)) return false;
  if (/^20\d{6}$/.test(normalized)) return false;
  return true;
}

function findBestDeclarationDate(text = "") {
  const candidates: Candidate[] = [];
  DECLARATION_DATE_LABELS.forEach((label, labelIndex) => {
    const pattern = new RegExp(`${escapeRegExp(label)}[\\s:：]{0,8}([\\s\\S]{0,80})`, "gi");
    for (const match of text.matchAll(pattern)) {
      const context = trimBeforeKnownLabels(match[1] || "");
      const date = normalizeCustomsDate(context);
      if (date) candidates.push({ value: date, score: 120 - labelIndex * 10, index: match.index || 0 });
    }
  });
  for (const match of text.matchAll(NON_DECLARATION_DATE_LABEL_PATTERN)) {
    const context = text.slice(match.index || 0, (match.index || 0) + 80);
    const date = normalizeCustomsDate(context);
    if (date) candidates.push({ value: date, score: -50, index: match.index || 0 });
  }
  if (!candidates.length) {
    for (const match of text.matchAll(/20\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*(?:日)?|\b20\d{6}\b/g)) {
      const date = normalizeCustomsDate(match[0]);
      if (date) candidates.push({ value: date, score: 5, index: match.index || 0 });
    }
  }
  return chooseBest(candidates.filter((item) => item.score > 0));
}

function chooseBest(candidates: Candidate[] = []) {
  if (!candidates.length) return "";
  return [...candidates].sort((a, b) => b.score - a.score || a.index - b.index)[0].value || "";
}

function trimBeforeKnownLabels(value = "") {
  const labels = [...DECLARATION_NO_LABELS, ...DECLARATION_DATE_LABELS, ...negativeDateLabelsIn(value)];
  const indexes = labels
    .map((label) => String(value || "").indexOf(label))
    .filter((index) => index >= 0);
  if (!indexes.length) return value;
  return String(value || "").slice(0, Math.min(...indexes));
}

function negativeDateLabelsIn(value = "") {
  return [...String(value || "").matchAll(NON_DECLARATION_DATE_LABEL_PATTERN)].map((match) => match[0]);
}
