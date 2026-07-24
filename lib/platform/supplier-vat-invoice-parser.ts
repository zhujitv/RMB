import {
  firstMatch,
  normalizeInvoiceProductName,
  parseDateText,
  stripInvoiceFieldNoise,
  structuredAmount,
  structuredPartyFallback,
  structuredProductFallback,
  structuredText,
  type VatInvoiceFields,
} from "./supplier-vat-invoice-parser-utils";
import {
  extractInvoiceAmountWithTax,
  extractInvoiceNameSequence,
  extractInvoiceProductName,
  extractInvoiceTaxNoSequence,
  extractInvoiceTaxRate,
  extractInvoiceTotals,
  extractPartyName,
  extractPartyTaxNo,
  sectionBetween,
} from "./supplier-vat-invoice-text-extraction";

export type { VatInvoiceFields } from "./supplier-vat-invoice-parser-utils";
export {
  isSuspiciousInvoiceParty,
  isSuspiciousInvoiceProduct,
} from "./supplier-vat-invoice-parser-utils";

export function parseVatInvoiceFields(text: string, structuredFields: Record<string, unknown> = {}): VatInvoiceFields {
  const buyerSection = sectionBetween(text, [
    /购买方/,
    /购\s*买\s*方/,
  ], [
    /密码区/,
    /货物或应税劳务/,
    /项目名称/,
    /销售方/,
  ]);
  const sellerSection = sectionBetween(text, [
    /销售方/,
    /销\s*售\s*方/,
  ], [
    /备注/,
    /收款人/,
    /复核/,
    /开票人/,
  ]);
  const partyNames = extractInvoiceNameSequence(text);
  const partyTaxNos = extractInvoiceTaxNoSequence(text);
  const rawSeller = partyNames.seller || extractPartyName(sellerSection, "销售方") || firstMatch(text, [
    /销售方(?:名称)?[:：]\s*([^\n\r]+)/,
    /销\s*售\s*方[:：]\s*([^\n\r]+)/,
  ]);
  const rawBuyer = partyNames.buyer || extractPartyName(buyerSection, "购买方") || firstMatch(text, [
    /购买方(?:名称)?[:：]\s*([^\n\r]+)/,
    /购\s*买\s*方[:：]\s*([^\n\r]+)/,
  ]);
  const rawProductName = extractInvoiceProductName(text) || firstMatch(text, [
    /货物或应税劳务、服务名称[:：]?\s*([^\n\r]+)/,
    /产品名称[:：]\s*([^\n\r]+)/,
    /服务名称[:：]\s*([^\n\r]+)/,
  ]);
  const invoiceNo = structuredText(structuredFields, "invoiceNo") || firstMatch(text, [
    /发票号码[:：]?\s*([A-Z0-9\-]{6,30})/i,
    /发票号[:：]?\s*([A-Z0-9\-]{6,30})/i,
    /No\.?\s*[:：]?\s*([A-Z0-9\-]{6,30})/i,
  ]);
  const invoiceDate = structuredText(structuredFields, "invoiceDate") || parseDateText(text, [
    /开票日期[:：]?\s*([0-9]{4}[年\-/.][0-9]{1,2}[月\-/.][0-9]{1,2}[日号]?)/,
    /日期[:：]?\s*([0-9]{4}[年\-/.][0-9]{1,2}[月\-/.][0-9]{1,2}[日号]?)/,
  ]);
  const amountWithTax = structuredAmount(structuredFields, "amountWithTax") || extractInvoiceAmountWithTax(text);
  const totals = extractInvoiceTotals(text);
  const taxRate = structuredText(structuredFields, "taxRate") || extractInvoiceTaxRate(text);
  const seller = structuredPartyFallback(structuredFields, "seller") || stripInvoiceFieldNoise(rawSeller);
  const buyer = structuredPartyFallback(structuredFields, "buyer") || stripInvoiceFieldNoise(rawBuyer);
  const productName = structuredProductFallback(structuredFields) || normalizeInvoiceProductName(rawProductName);
  return {
    invoiceNo,
    invoiceDate,
    amountWithTax,
    amountWithoutTax: structuredAmount(structuredFields, "amountWithoutTax") || totals.amountWithoutTax,
    taxAmount: structuredAmount(structuredFields, "taxAmount") || totals.taxAmount,
    taxRate,
    seller,
    sellerTaxNo: structuredText(structuredFields, "sellerTaxNo") || partyTaxNos.sellerTaxNo || extractPartyTaxNo(sellerSection),
    buyer,
    buyerTaxNo: structuredText(structuredFields, "buyerTaxNo") || partyTaxNos.buyerTaxNo || extractPartyTaxNo(buyerSection),
    productName,
    specModel: structuredText(structuredFields, "specModel"),
    unit: structuredText(structuredFields, "unit"),
    quantity: structuredText(structuredFields, "quantity"),
    unitPrice: structuredText(structuredFields, "unitPrice"),
  };
}
