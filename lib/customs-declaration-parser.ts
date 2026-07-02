export const CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO = "AUTO_PDF_TEXT";
export const CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL = "MANUAL";
export const CUSTOMS_DECLARATION_PARSE_STATUSES = ["SUCCESS", "PARTIAL", "FAILED"] as const;

process.env.PDF2JSON_DISABLE_LOGS ||= "1";

type CustomsParseStatus = (typeof CUSTOMS_DECLARATION_PARSE_STATUSES)[number];

type CustomsFields = {
  customsDeclarationNo: string;
  customsDeclarationDate: string;
};

export type CustomsDeclarationItemFields = {
  hsCode: string;
  productName: string;
  specification?: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  totalAmount?: number;
  tradeTerm: string;
  currency: string;
  fobAmount: number;
  grossWeight?: number;
  netWeight?: number;
  originCountry?: string;
  destinationCountry?: string;
};

type CustomsParseResult = CustomsFields & {
  customsDeclarationParseStatus: CustomsParseStatus;
  customsDeclarationParseSource: typeof CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO;
  customsDeclarationParseMessage: string;
};

export type CustomsDeclarationDetailParseResult = CustomsParseResult & {
  exportDate: string;
  tradeTerm: string;
  currency: string;
  totalAmount: number;
  items: CustomsDeclarationItemFields[];
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

type Pdf2JsonParserConstructor = new (context?: null, needRawText?: boolean, password?: string) => Pdf2JsonParser;
type Pdf2JsonModule = {
  default?: Pdf2JsonParserConstructor;
  PDFParser?: Pdf2JsonParserConstructor;
};

const DECLARATION_NO_LABELS = ["报关单号", "海关编号", "预录入编号"];
const DECLARATION_DATE_LABELS = ["申报日期", "出口申报日期", "申报时间"];
const EXPORT_DATE_LABELS = ["出口日期", "出口时间", "离境日期"];
const DOMESTIC_CONSIGNOR_LABELS = ["境内发货人", "境内收发货人", "发货人"];
const DECLARATION_UNIT_LABELS = ["申报单位", "报关单位", "代理报关企业"];
const TRANSPORT_MODE_LABELS = ["运输方式", "运输模式"];
const BILL_OF_LADING_LABELS = ["提运单号", "提单号", "运单号", "B/L No", "BL No"];
const TRADE_COUNTRY_LABELS = ["贸易国别", "贸易国", "贸易国家"];
const DESTINATION_COUNTRY_LABELS = ["目的国", "最终目的国", "运抵国"];
const SUPERVISION_MODE_LABELS = ["监管方式", "贸易方式"];
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

export function parseCustomsDeclarationDetailText(text = ""): CustomsDeclarationDetailParseResult {
  const normalized = normalizePdfText(text);
  const base = parseCustomsDeclarationText(normalized);
  const exportDate = findBestLabeledDate(normalized, EXPORT_DATE_LABELS);
  const tradeTerm = findTradeTerm(normalized);
  const currency = findCurrency(normalized);
  const items = parseCustomsDeclarationItems(normalized)
    .map((item) => normalizeCustomsDeclarationItemForTaxRefund(item, { tradeTerm, currency }))
    .filter((item): item is CustomsDeclarationItemFields => Boolean(item));
  const totalAmount = items.reduce((sum, item) => sum + (item.totalAmount || item.fobAmount || 0), 0) || findDeclarationTotalAmount(normalized);
  return {
    ...base,
    exportDate,
    tradeTerm,
    currency,
    totalAmount,
    items,
  };
}

export async function parseCustomsDeclarationPdfBuffer(buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined, options: PdfParseOptions = {}) {
  const normalizedText = await extractPdfTextFromPdfBuffer(buffer, options);
  return parseCustomsDeclarationText(normalizedText);
}

export async function parseCustomsDeclarationDetailPdfBuffer(buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined, options: PdfParseOptions = {}) {
  const normalizedText = await extractPdfTextFromPdfBuffer(buffer, options);
  return parseCustomsDeclarationDetailText(normalizedText);
}

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
  const candidates = labeledDateCandidates(text, DECLARATION_DATE_LABELS, 120);
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

function findBestLabeledDate(text = "", labels: string[] = []) {
  return chooseBest(labeledDateCandidates(text, labels, 100));
}

function findBestLabeledText(text = "", labels: string[] = []) {
  const candidates: Candidate[] = [];
  const compact = compactForNearbySearch(text);
  labels.forEach((label, labelIndex) => {
    const pattern = new RegExp(`${escapeRegExp(label)}[\\s:：]{0,8}([^\\n]{2,80})`, "gi");
    for (const match of compact.matchAll(pattern)) {
      const value = cleanLabeledTextValue(match[1] || "");
      if (value) candidates.push({ value, score: 100 - labelIndex * 10, index: match.index || 0 });
    }
  });
  return chooseBest(candidates);
}

function cleanLabeledTextValue(value = "") {
  const stopLabels = [
    ...DECLARATION_NO_LABELS,
    ...DECLARATION_DATE_LABELS,
    ...EXPORT_DATE_LABELS,
    ...DOMESTIC_CONSIGNOR_LABELS,
    "消费使用单位",
    "生产销售单位",
    "运输方式",
    "提运单号",
    "成交方式",
    "贸易方式",
    "监管方式",
    "申报单位",
    "贸易国别",
    "目的国",
    "币制",
    "币种",
  ];
  let text = String(value || "").replace(/[：:]+$/g, "").trim();
  for (const label of stopLabels) {
    const index = text.indexOf(label);
    if (index > 0) text = text.slice(0, index).trim();
  }
  return text.replace(/\s{2,}/g, " ").slice(0, 80);
}

function labeledDateCandidates(text = "", labels: string[] = [], baseScore = 100) {
  const candidates: Candidate[] = [];
  labels.forEach((label, labelIndex) => {
    const pattern = new RegExp(`${escapeRegExp(label)}[\\s:：]{0,8}([\\s\\S]{0,80})`, "gi");
    for (const match of text.matchAll(pattern)) {
      const context = trimBeforeKnownLabels(match[1] || "");
      const date = normalizeCustomsDate(context);
      if (date) candidates.push({ value: date, score: baseScore - labelIndex * 10, index: match.index || 0 });
    }
  });
  return candidates;
}

function findTradeTerm(text = "") {
  const compact = compactForNearbySearch(text).toUpperCase();
  const labeled = compact.match(/(?:成交方式|贸易方式|价格条款)[:：]?\s*(FOB|CIF|CFR|EXW)/i)?.[1];
  return (labeled || compact.match(/\b(FOB|CIF|CFR|EXW)\b/i)?.[1] || "").toUpperCase();
}

function findCurrency(text = "") {
  const compact = compactForNearbySearch(text);
  const value = compact.match(/(?:币制|币种|成交币制)[:：]?\s*([A-Z]{3}|美元|人民币|欧元|日元|港币)/i)?.[1] || "";
  return normalizeCurrency(value);
}

function normalizeCurrency(value = "") {
  const text = String(value || "").trim().toUpperCase();
  if (/美元|USD/.test(text)) return "USD";
  if (/人民币|CNY|RMB/.test(text)) return "CNY";
  if (/欧元|EUR/.test(text)) return "EUR";
  if (/日元|JPY/.test(text)) return "JPY";
  if (/港币|HKD/.test(text)) return "HKD";
  return /^[A-Z]{3}$/.test(text) ? text : "";
}

function numericAmount(value = "") {
  const parsed = Number.parseFloat(String(value || "").replace(/[,，\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

const CUSTOMS_ITEM_UNIT_PATTERN = "(千克|公斤|克|吨|个|只|件|套|台|米|平方米|立方米|双|条|箱|PCS|PCE|PC|SET|SETS|KG|KGS|M2|M3|MT|UNIT|UNITS|PIECE|PIECES)";
const CUSTOMS_ITEM_UNIT_REGEX = new RegExp(CUSTOMS_ITEM_UNIT_PATTERN, "i");
const CUSTOMS_ITEM_HEADER_PATTERN = /^(项号|商品编号|HS编码|商品名称|商品名称及规格型号|规格型号|数量及单位|数量|单位|单价|总价|币制|原产国|最终目的国|征免|法定|成交|第一|第二)$/i;
const CUSTOMS_ITEM_LABEL_PATTERN = /(报关单号|海关编号|预录入编号|申报日期|出口日期|日期|出境关别|进境关别|备案号|境内发货人|境内收发货人|境外收发货人|生产销售单位|消费使用单位|申报单位|运输方式|运输工具名称|航次号|提运单号|提单号|贸易国别|贸易国|运抵国|目的国|监管方式|征免性质|征免|许可证号|合同协议号|成交方式|运费|保费|杂费|件数|包装种类|集装箱|集装箱号|箱号|港口|口岸|装货港|指运港|启运港|境内货源地|随附单证|标记唛码|备注|发票|代理报关委托协议|统一编号|申报地海关|入境口岸|毛重|净重)/;
const CUSTOMS_COMPANY_NAME_PATTERN = /(有限公司|有限责任公司|股份有限公司|进出口公司|贸易公司|B\.?V\.?|LTD\.?|LIMITED|INC\.?|CO\.?,?\s*LTD\.?)/i;
const CUSTOMS_ITEM_PARTY_OR_TRANSPORT_PATTERN = /(水路运输|铁路运输|公路运输|航空运输|多式联运|运输工具|航次|提运单|提单|HAMBURG\s+EXPRESS|EXPRESS\s*\/|VESSEL|VOYAGE|MAJOR\s+FENCE\s+B\.?V\.?|洋山\s*区|洋山港区|港区|口岸)/i;
const CUSTOMS_ITEM_CONTAINER_NO_PATTERN = /\b[A-Z]{4}\d{7}\b/i;
const CUSTOMS_ITEM_DATE_PATTERN = /\b20\d{2}[-/.年]?\d{1,2}[-/.月]?\d{1,2}(?:日)?\b/;
const CUSTOMS_COUNTRY_NAMES = "中国|荷兰|美国|德国|英国|法国|意大利|日本|韩国|越南|印度|加拿大|澳大利亚|比利时|西班牙|波兰|俄罗斯|泰国|马来西亚|印尼|墨西哥|巴西|阿联酋|沙特|奥地利|瑞典|瑞士|土耳其|南非";
const CUSTOMS_ITEM_TRAILING_METADATA_PATTERNS = [
  new RegExp(`\\s+(?:${CUSTOMS_COUNTRY_NAMES})(?:\\s*(?:${CUSTOMS_COUNTRY_NAMES}))?(?:\\s|[()（）]|$).*$`, "i"),
  new RegExp(`中国\\s*(?:${CUSTOMS_COUNTRY_NAMES})(?:\\s|[()（）]|$).*$`, "i"),
  /[()（）\s]*(?:宣城|照章征税|照章|征税|全免|征免方式|征免性质|境内货源地|最终目的国|原产国).*$/i,
];

export function normalizeCustomsDeclarationItemForTaxRefund(
  input: Partial<CustomsDeclarationItemFields> & Record<string, unknown> = {},
  defaults: Partial<Pick<CustomsDeclarationItemFields, "currency" | "tradeTerm">> = {},
): CustomsDeclarationItemFields | null {
  const productName = cleanCustomsDeclarationProductNameForTaxRefund(input.productName);
  const quantity = numericAmount(String(input.quantity ?? ""));
  const unit = normalizeCustomsItemUnit(input.unit);
  const totalAmount = numericAmount(String(input.totalAmount ?? input.fobAmount ?? ""));
  if (!isValidTaxRefundProductName(productName) || quantity <= 0 || !unit || totalAmount <= 0) return null;
  const currency = normalizeCurrency(String(input.currency || defaults.currency || ""));
  return {
    hsCode: "",
    productName,
    specification: "",
    quantity,
    unit,
    unitPrice: 0,
    totalAmount,
    tradeTerm: normalizeTradeTerm(String(input.tradeTerm || defaults.tradeTerm || "")),
    currency,
    fobAmount: totalAmount,
    grossWeight: 0,
    netWeight: 0,
    originCountry: "",
    destinationCountry: "",
  };
}

function normalizeTradeTerm(value = "") {
  const match = String(value || "").trim().toUpperCase().match(/\b(FOB|CIF|CFR|EXW)\b/);
  return match?.[1] || "";
}

function normalizeCustomsItemUnit(value: unknown) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  if (["KG", "KGS", "公斤"].includes(text)) return "千克";
  if (["PC", "PCE", "PCS", "PIECE", "PIECES"].includes(text)) return "PCS";
  if (["SET", "SETS"].includes(text)) return "套";
  if (["M2"].includes(text)) return "平方米";
  if (["M3"].includes(text)) return "立方米";
  if (["MT"].includes(text)) return "吨";
  if (/^(千克|克|吨|个|只|件|套|台|米|平方米|立方米|双|条|箱|PCS|UNIT|UNITS)$/i.test(text)) {
    return text;
  }
  return "";
}

export function cleanCustomsDeclarationProductNameForTaxRefund(value: unknown) {
  let text = toHalfWidth(String(value || ""))
    .replace(/^\s*\d{1,3}\s+/, "")
    .replace(/^\s*\d{8,13}\s+/, "")
    .replace(/商品名称及规格型号|商品名称|中文品名|品名|规格型号|HS编码|商品编号/g, " ")
    .replace(/\b(FOB|CIF|CFR|EXW|USD|CNY|RMB|EUR|JPY|HKD)\b/ig, " ")
    .replace(/[（(]\s*[）)]/g, " ")
    .replace(/[;；:：|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (isWholeCustomsMetadataRow(text)) return text.slice(0, 100);
  text = stripTrailingCustomsItemMetadata(text)
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 100);
}

function isValidTaxRefundProductName(productName = "") {
  const raw = toHalfWidth(String(productName || "")).replace(/\s+/g, " ").trim();
  const text = cleanCustomsDeclarationProductNameForTaxRefund(productName);
  return Boolean(
    text
    && /[\u4e00-\u9fa5A-Za-z]/.test(text)
    && !CUSTOMS_ITEM_HEADER_PATTERN.test(raw)
    && !CUSTOMS_ITEM_HEADER_PATTERN.test(text)
    && !CUSTOMS_ITEM_LABEL_PATTERN.test(raw)
    && !CUSTOMS_ITEM_LABEL_PATTERN.test(text)
    && !CUSTOMS_COMPANY_NAME_PATTERN.test(raw)
    && !CUSTOMS_COMPANY_NAME_PATTERN.test(text)
    && !CUSTOMS_ITEM_PARTY_OR_TRANSPORT_PATTERN.test(raw)
    && !CUSTOMS_ITEM_PARTY_OR_TRANSPORT_PATTERN.test(text)
    && !CUSTOMS_ITEM_CONTAINER_NO_PATTERN.test(raw)
    && !CUSTOMS_ITEM_CONTAINER_NO_PATTERN.test(text)
    && !CUSTOMS_ITEM_DATE_PATTERN.test(raw)
    && !CUSTOMS_ITEM_DATE_PATTERN.test(text),
  );
}

function isWholeCustomsMetadataRow(text = "") {
  return Boolean(
    text
    && (
      CUSTOMS_COMPANY_NAME_PATTERN.test(text)
      || CUSTOMS_ITEM_PARTY_OR_TRANSPORT_PATTERN.test(text)
      || CUSTOMS_ITEM_CONTAINER_NO_PATTERN.test(text)
      || CUSTOMS_ITEM_DATE_PATTERN.test(text)
    )
  );
}

function stripTrailingCustomsItemMetadata(value = "") {
  let text = value;
  for (const pattern of CUSTOMS_ITEM_TRAILING_METADATA_PATTERNS) {
    const match = text.match(pattern);
    const index = match?.index ?? -1;
    if (index > 1 && hasProductNameSignal(text.slice(0, index))) {
      text = text.slice(0, index).trim();
    }
  }
  return text;
}

function hasProductNameSignal(value = "") {
  const text = value.trim();
  return /[\u4e00-\u9fa5]{2,}/.test(text) || /[A-Za-z]{3,}/.test(text);
}

function parseCustomsDeclarationItems(text = ""): CustomsDeclarationItemFields[] {
  const lines = normalizePdfText(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const items: CustomsDeclarationItemFields[] = [];
  const itemPattern = new RegExp(`(?:^|\\s)(?:\\d{1,3}\\s+)?([0-9]{8,13})\\s+(.+?)\\s+([0-9]+(?:[,，][0-9]{3})*(?:\\.[0-9]+)?|[0-9]+(?:\\.[0-9]+)?)\\s*${CUSTOMS_ITEM_UNIT_PATTERN}\\s+(?:(FOB|CIF|CFR|EXW)\\s+)?(?:(USD|CNY|RMB|EUR|JPY|HKD|美元|人民币|欧元|日元|港币)\\s+)?([0-9]+(?:[,，][0-9]{3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)(?:\\s|$)`, "i");
  for (const line of lines) {
    const match = line.match(itemPattern);
    if (!match) continue;
    const productName = String(match[2] || "")
      .replace(/\s+(FOB|CIF|CFR|EXW)\b.*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const item = normalizeCustomsDeclarationItemForTaxRefund({
      hsCode: String(match[1] || "").trim(),
      productName,
      quantity: numericAmount(match[3] || ""),
      unit: String(match[4] || "").trim(),
      totalAmount: numericAmount(match[7] || ""),
      tradeTerm: String(match[5] || "").trim().toUpperCase(),
      currency: normalizeCurrency(match[6] || ""),
    });
    if (item) items.push(item);
  }
  return dedupeCustomsItems([...items, ...parseMultilineCustomsDeclarationItems(lines)]);
}

function parseMultilineCustomsDeclarationItems(lines: string[] = []): CustomsDeclarationItemFields[] {
  const hsRows = lines
    .map((line, index) => ({ line, index, hsCode: findHsCodeInLine(line) }))
    .filter((row) => row.hsCode);
  const items: CustomsDeclarationItemFields[] = [];
  for (const [rowIndex, row] of hsRows.entries()) {
    const nextIndex = hsRows[rowIndex + 1]?.index ?? Math.min(lines.length, row.index + 16);
    const windowLines = lines.slice(row.index, Math.min(nextIndex, row.index + 16));
    const windowText = windowLines.join(" ");
    const productName = findProductNameInItemWindow(windowLines, row.hsCode);
    const quantityUnit = findQuantityUnitInItemWindow(windowText);
    const currency = findCurrency(windowText);
    const tradeTerm = findTradeTerm(windowText);
    const totalAmount = findTotalAmountInItemWindow(windowText, quantityUnit.quantity);
    const item = normalizeCustomsDeclarationItemForTaxRefund({
      hsCode: row.hsCode,
      productName,
      quantity: quantityUnit.quantity,
      unit: quantityUnit.unit,
      totalAmount,
      tradeTerm,
      currency,
    });
    if (item) items.push(item);
  }
  return items;
}

function findHsCodeInLine(line = "") {
  if (CUSTOMS_ITEM_LABEL_PATTERN.test(line)) return "";
  const match = toHalfWidth(line).match(/(?:^|\D)([0-9]{8,13})(?!\d)/);
  return match?.[1] || "";
}

function findProductNameInItemWindow(lines: string[] = [], hsCode = "") {
  const candidates = lines
    .map((line) => cleanProductNameCandidate(line, hsCode))
    .filter(Boolean)
    .filter((line) => /[\u4e00-\u9fa5A-Za-z]/.test(line))
    .filter((line) => !CUSTOMS_ITEM_HEADER_PATTERN.test(line))
    .filter((line) => isValidTaxRefundProductName(line));
  return candidates[0] || "";
}

function cleanProductNameCandidate(line = "", hsCode = "") {
  let text = toHalfWidth(line)
    .replace(hsCode, " ")
    .replace(/^\s*\d{1,3}\s*/, "")
    .replace(/商品名称及规格型号|商品名称|规格型号|HS编码|商品编号/g, " ")
    .replace(new RegExp(`\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?\\s*${CUSTOMS_ITEM_UNIT_PATTERN}`, "ig"), " ")
    .replace(new RegExp(`${CUSTOMS_ITEM_UNIT_PATTERN}\\s*\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?`, "ig"), " ")
    .replace(/\b(FOB|CIF|CFR|EXW|USD|CNY|RMB|EUR|JPY|HKD)\b/ig, " ")
    .replace(/[美元人民币欧元日元港币]+/g, " ")
    .replace(/\d+(?:[,，]\d{3})*(?:\.\d+)?/g, " ")
    .replace(/[;；:：|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 80) text = text.slice(0, 80).trim();
  return text;
}

function findQuantityUnitInItemWindow(text = "") {
  const normalized = toHalfWidth(text);
  const amount = "\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?";
  const quantityBeforeUnit = new RegExp(`(${amount})\\s*${CUSTOMS_ITEM_UNIT_PATTERN}`, "i");
  const quantityAfterUnit = new RegExp(`${CUSTOMS_ITEM_UNIT_PATTERN}\\s*(${amount})`, "i");
  let match = normalized.match(quantityBeforeUnit);
  if (match) return { quantity: numericAmount(match[1]), unit: match[2] || "" };
  match = normalized.match(quantityAfterUnit);
  if (match) return { quantity: numericAmount(match[2]), unit: match[1] || "" };
  return { quantity: 0, unit: "" };
}

function findTotalAmountInItemWindow(text = "", quantity = 0) {
  const normalized = toHalfWidth(text);
  const currencyAmount = normalized.match(/(?:FOB|CIF|CFR|EXW)?\s*(?:USD|CNY|RMB|EUR|JPY|HKD|美元|人民币|欧元|日元|港币)\s*(\d+(?:[,，]\d{3})*(?:\.\d+)?)/i);
  if (currencyAmount) return numericAmount(currencyAmount[1]);
  const amountCandidates = [...normalized.matchAll(/\d+(?:[,，]\d{3})*(?:\.\d+)?/g)]
    .map((match) => ({ value: numericAmount(match[0]), index: match.index || 0, raw: match[0] }))
    .filter((candidate) => candidate.value > 0)
    .filter((candidate) => candidate.raw.replace(/\D/g, "").length < 14)
    .filter((candidate) => Math.abs(candidate.value - quantity) > 0.0001)
    .filter((candidate) => !CUSTOMS_ITEM_UNIT_REGEX.test(normalized.slice(candidate.index, candidate.index + 20)));
  if (!amountCandidates.length) return 0;
  return amountCandidates.sort((left, right) => right.index - left.index)[0].value;
}

function dedupeCustomsItems(items: CustomsDeclarationItemFields[] = []) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.productName, item.quantity, item.unit, item.fobAmount || item.totalAmount || 0].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findDeclarationTotalAmount(text = "") {
  const compact = compactForNearbySearch(text);
  const labeled = compact.match(/(?:报关总金额|FOB金额|成交金额|总价)[:：]?\s*(?:USD|CNY|RMB|EUR|JPY|HKD|美元|人民币|欧元|日元|港币)?\s*(\d+(?:[,，]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i);
  return labeled ? numericAmount(labeled[1]) : 0;
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
