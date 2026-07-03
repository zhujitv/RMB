import {
  CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
  CUSTOMS_DECLARATION_PARSE_STATUSES,
  extractPdfTextFromPdfBuffer,
  parseCustomsDeclarationText,
} from "../customs-declaration-parser";

export const CUSTOMS_PDF_NO_TEXT_MESSAGE = "当前 PDF 未检测到可读取文本，请手工填写报关单号和申报日期。";
const CUSTOMS_PDF_PARSE_FAILED_MESSAGE = "报关单 PDF 文本解析失败，请手工填写报关单号和申报日期。";

type CustomsPdfTextParseStatus = (typeof CUSTOMS_DECLARATION_PARSE_STATUSES)[number];

export type CustomsDeclarationPdfTextParseResult = {
  textLength: number;
  customsDeclarationNo: string;
  customsDeclarationDate: string;
  customsDeclarationParseStatus: CustomsPdfTextParseStatus;
  customsDeclarationParseSource: typeof CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO;
  customsDeclarationParseMessage: string;
  parseFailedReason?: string;
};

export async function parseCustomsDeclarationPdf(buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined): Promise<CustomsDeclarationPdfTextParseResult> {
  let text = "";
  try {
    text = await extractPdfTextFromPdfBuffer(buffer, { requireText: false });
  } catch (error) {
    return failedPdfTextParseResult(CUSTOMS_PDF_PARSE_FAILED_MESSAGE, error instanceof Error ? error.message : String(error || ""));
  }

  const textLength = text.length;
  if (!textLength) {
    return failedPdfTextParseResult(CUSTOMS_PDF_NO_TEXT_MESSAGE, "PDF text layer is empty.", textLength);
  }

  return {
    ...parseCustomsDeclarationText(text),
    textLength,
  };
}

function failedPdfTextParseResult(message: string, reason = "", textLength = 0): CustomsDeclarationPdfTextParseResult {
  return {
    textLength,
    customsDeclarationNo: "",
    customsDeclarationDate: "",
    customsDeclarationParseStatus: "FAILED",
    customsDeclarationParseSource: CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
    customsDeclarationParseMessage: message,
    parseFailedReason: reason,
  };
}
