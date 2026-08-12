import type {
  QuotationPdfBankAccountSnapshot,
  QuotationProformaInvoiceSnapshot,
} from "./quotation-pdf-types.ts";
import {
  cleanPdfBlockText,
  cleanPdfInlineText,
  formatPdfMoney,
  formatPdfQuantity,
  formatPdfUnitPrice,
  requirePdfText,
} from "./quotation-pdf-text.ts";

type QuotationPdfLimitError = Error & { status?: number; code?: string; expose?: boolean };
type QuotationPdfTemplateError = Error & { status?: number; code?: string; expose?: boolean };

export const CURRENT_QUOTATION_PDF_TEMPLATE_VERSION = "PI_V5";

export function quotationPdfLimitError(message: string, code: string): QuotationPdfLimitError {
  const error: QuotationPdfLimitError = new Error(message);
  error.status = 413;
  error.code = code;
  error.expose = true;
  return error;
}

export const QUOTATION_PDF_LIMITS = {
  items: 200,
  totalTextCharacters: 400_000,
  pages: 100,
  outputBytes: 20 * 1024 * 1024,
} as const;

function textLength(value: unknown) {
  return value === null || value === undefined ? 0 : String(value).length;
}

export function quotationPdfTextCharacterCount(snapshot: QuotationProformaInvoiceSnapshot) {
  const topLevel = [
    snapshot.quoteNo, snapshot.invoiceNo, snapshot.quoteDate, snapshot.validUntil, snapshot.currency,
    snapshot.subtotal, snapshot.discountAmount, snapshot.totalAmount,
    snapshot.tradeTerm, snapshot.paymentTerm, snapshot.remark,
  ];
  const parties = [...Object.values(snapshot.seller || {}), ...Object.values(snapshot.buyer || {})];
  const bank = snapshot.bankAccount ? Object.values(snapshot.bankAccount) : [];
  const items = snapshot.items.flatMap((item) => Object.values(item));
  return [...topLevel, ...parties, ...bank, ...items]
    .reduce<number>((total, value) => total + textLength(value), 0);
}

export function assertQuotationPdfOutputBudget(buffer: Buffer, pageCount: number) {
  if (pageCount > QUOTATION_PDF_LIMITS.pages) {
    throw quotationPdfLimitError(`形式发票不能超过 ${QUOTATION_PDF_LIMITS.pages} 页`, "QUOTATION_PDF_PAGE_LIMIT_EXCEEDED");
  }
  if (buffer.byteLength > QUOTATION_PDF_LIMITS.outputBytes) {
    throw quotationPdfLimitError("形式发票文件超过 20MB 安全上限", "QUOTATION_PDF_OUTPUT_TOO_LARGE");
  }
}

export function validateQuotationPdfSnapshot(snapshot: QuotationProformaInvoiceSnapshot) {
  requirePdfText(snapshot.quoteNo, "Quotation number");
  quotationPdfInvoiceNumber(snapshot);
  requirePdfText(snapshot.quoteDate, "Quotation date");
  requirePdfText(snapshot.currency, "Currency");
  requirePdfText(snapshot.seller?.legalName, "Seller legal name");
  requirePdfText(snapshot.buyer?.legalName, "Buyer legal name");
  if (!Array.isArray(snapshot.items) || snapshot.items.length < 1) {
    throw new RangeError("At least one quotation item is required to generate a Proforma Invoice PDF.");
  }
  if (snapshot.items.length > QUOTATION_PDF_LIMITS.items) {
    throw quotationPdfLimitError(`形式发票最多支持 ${QUOTATION_PDF_LIMITS.items} 行产品`, "QUOTATION_PDF_ITEM_LIMIT_EXCEEDED");
  }
  if (quotationPdfTextCharacterCount(snapshot) > QUOTATION_PDF_LIMITS.totalTextCharacters) {
    throw quotationPdfLimitError("形式发票文本内容过多，请精简后重试", "QUOTATION_PDF_TEXT_BUDGET_EXCEEDED");
  }
  snapshot.items.forEach((item, index) => {
    requirePdfText(item.description, `Item ${index + 1} description`);
    requirePdfText(item.unit, `Item ${index + 1} unit`);
    formatPdfQuantity(item.quantity, `Item ${index + 1} quantity`);
    formatPdfUnitPrice(item.unitPrice, `Item ${index + 1} unit price`);
    formatPdfMoney(item.amount, `Item ${index + 1} amount`);
  });
  formatPdfMoney(snapshot.subtotal, "Subtotal");
  formatPdfMoney(snapshot.discountAmount ?? "0", "Discount amount");
  formatPdfMoney(snapshot.totalAmount, "Total amount");
  if (snapshot.leadTimeDays != null && (!Number.isSafeInteger(snapshot.leadTimeDays) || snapshot.leadTimeDays < 0)) {
    throw new RangeError("Lead time must be a non-negative integer.");
  }
}

export function assertQuotationPdfTemplateCanRender(value: unknown) {
  const templateVersion = cleanPdfInlineText(value);
  if (templateVersion === CURRENT_QUOTATION_PDF_TEMPLATE_VERSION) return templateVersion;
  const error: QuotationPdfTemplateError = new Error(
    "历史报价使用旧版形式发票模板且没有固定文件，请编辑报价并生成新版本后再生成形式发票",
  );
  error.status = 409;
  error.code = "QUOTATION_DOCUMENT_TEMPLATE_REGENERATION_REQUIRED";
  error.expose = true;
  throw error;
}

export function quotationPdfInvoiceNumber(snapshot: QuotationProformaInvoiceSnapshot) {
  return requirePdfText(snapshot.invoiceNo || snapshot.quoteNo, "Invoice number");
}

export function quotationPdfBankDetails(
  account: QuotationPdfBankAccountSnapshot | null | undefined,
  snapshotText: unknown = "",
) {
  const frozenText = cleanPdfBlockText(snapshotText);
  if (frozenText) return frozenText;
  if (!account) return "";
  const rows = [
    ["Beneficiary", account.beneficiaryName],
    ["Bank", account.bankName],
    ["Bank address", account.bankAddress],
    ["Account number", account.accountNumber],
    ["IBAN", account.iban],
    ["SWIFT / BIC", account.swiftCode],
    ["Account currency", account.currency],
    ["Intermediary bank", account.intermediaryBank],
  ];
  return rows
    .map(([label, value]) => [label, cleanPdfInlineText(value)])
    .filter((row) => row[1])
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export function quotationProformaInvoiceFileName(snapshot: QuotationProformaInvoiceSnapshot) {
  const invoiceNo = quotationPdfInvoiceNumber(snapshot)
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "quotation";
  const versionNumber = Number(snapshot.versionNumber);
  const version = Number.isSafeInteger(versionNumber) && versionNumber > 0 ? `-V${versionNumber}` : "";
  return `Proforma-Invoice-${invoiceNo}${version}.pdf`;
}
