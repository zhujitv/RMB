export const CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO = "AUTO_PDF_TEXT";
export const CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL = "MANUAL";
export const CUSTOMS_DECLARATION_PARSE_STATUSES = ["SUCCESS", "PARTIAL", "FAILED"] as const;

export type CustomsParseStatus = (typeof CUSTOMS_DECLARATION_PARSE_STATUSES)[number];

export type CustomsFields = {
  customsDeclarationNo: string;
  customsDeclarationDate: string;
};

export type CustomsDeclarationItemFields = {
  itemNo?: string;
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

export type CustomsParseResult = CustomsFields & {
  customsDeclarationParseStatus: CustomsParseStatus;
  customsDeclarationParseSource: typeof CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO;
  customsDeclarationParseMessage: string;
};

export type CustomsDeclarationDetailParseResult = CustomsParseResult & {
  exportDate: string;
  domesticShipper: string;
  overseasConsignee: string;
  tradeMode: string;
  tradeTerm: string;
  currency: string;
  totalAmount: number;
  items: CustomsDeclarationItemFields[];
};

export type Candidate = {
  value: string;
  score: number;
  index: number;
};

export type PdfParseOptions = {
  requireText?: boolean;
};

export type ParserError = Error & {
  status?: number;
  code?: string;
  expose?: boolean;
};

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

export function customsParseStatusFromFields(fields: Partial<CustomsFields> = {}): CustomsParseStatus {
  const hasNo = Boolean(String(fields.customsDeclarationNo || "").trim());
  const hasDate = Boolean(String(fields.customsDeclarationDate || "").trim());
  if (hasNo && hasDate) return "SUCCESS";
  if (hasNo || hasDate) return "PARTIAL";
  return "FAILED";
}

export function customsParseMessage(fields: Partial<CustomsFields> = {}, status = customsParseStatusFromFields(fields)) {
  if (status === "SUCCESS") return "已读取：\n✓ 报关单号\n✓ 申报日期";
  const missing: string[] = [];
  if (!fields.customsDeclarationDate) missing.push("申报日期");
  if (!fields.customsDeclarationNo) missing.push("报关单号");
  if (status === "PARTIAL") return `文件已上传，已读取部分信息，未读取到${missing.join("/")}，请手动填写。`;
  return "未读取到报关单号和申报日期，请手动填写";
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

export function parserError(message: string, status: number, code: string): ParserError {
  const error: ParserError = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}
