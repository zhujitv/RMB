import {
  CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
  customsParseMessage,
  customsParseStatusFromFields,
  normalizePdfText,
  type CustomsDeclarationDetailParseResult,
  type CustomsDeclarationItemFields,
  type CustomsParseResult,
  type PdfParseOptions,
} from "./customs-declaration-parser-shared.ts";
import { extractPdfTextFromPdfBuffer } from "./customs-pdf-text-extractor.ts";
import {
  findBestDeclarationDate,
  findBestDeclarationNo,
  findBestLabeledDate,
  findCurrency,
  findDeclarationTotalAmount,
  findDomesticShipper,
  findOverseasConsignee,
  findTradeMode,
  findTradeTerm,
  EXPORT_DATE_LABELS,
} from "./customs-declaration-field-parser.ts";
import {
  normalizeCustomsDeclarationItemForTaxRefund,
  parseCustomsDeclarationItems,
} from "./customs-declaration-item-parser.ts";

export {
  CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
  CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL,
  CUSTOMS_DECLARATION_PARSE_STATUSES,
  customsParseMessage,
  customsParseStatusFromFields,
  normalizeCustomsDate,
  normalizePdfText,
  toHalfWidth,
} from "./customs-declaration-parser-shared.ts";
export type {
  CustomsDeclarationDetailParseResult,
  CustomsDeclarationItemFields,
  CustomsFields,
  CustomsParseResult,
  CustomsParseStatus,
  PdfParseOptions,
} from "./customs-declaration-parser-shared.ts";
export { extractPdfTextFromPdfBuffer } from "./customs-pdf-text-extractor.ts";
export {
  cleanCustomsDeclarationProductNameForTaxRefund,
  normalizeCustomsDeclarationItemForTaxRefund,
} from "./customs-declaration-item-parser.ts";

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
  const domesticShipper = findDomesticShipper(normalized);
  const overseasConsignee = findOverseasConsignee(normalized);
  const tradeMode = findTradeMode(normalized);
  const tradeTerm = findTradeTerm(normalized);
  const currency = findCurrency(normalized);
  const items = parseCustomsDeclarationItems(normalized)
    .map((item) => normalizeCustomsDeclarationItemForTaxRefund(item, { tradeTerm, currency }))
    .filter((item): item is CustomsDeclarationItemFields => Boolean(item));
  const totalAmount = items.reduce((sum, item) => sum + (item.totalAmount || item.fobAmount || 0), 0) || findDeclarationTotalAmount(normalized);
  return {
    ...base,
    exportDate,
    domesticShipper,
    overseasConsignee,
    tradeMode,
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
