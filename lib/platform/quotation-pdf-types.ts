export type QuotationPdfDecimal = string | number;

export type QuotationPdfSellerSnapshot = {
  legalName: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  bankAccount?: string | null;
};

export type QuotationPdfBuyerSnapshot = {
  legalName: string;
  address?: string | null;
  country?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type QuotationPdfBankAccountSnapshot = {
  beneficiaryName: string;
  bankName: string;
  bankAddress?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  swiftCode?: string | null;
  currency?: string | null;
  intermediaryBank?: string | null;
};

export type QuotationPdfItemSnapshot = {
  lineNumber?: number | null;
  description: string;
  unit: string;
  quantity: QuotationPdfDecimal;
  unitPrice: QuotationPdfDecimal;
  amount: QuotationPdfDecimal;
  remark?: string | null;
};

/**
 * Immutable, database-independent data needed to render a customer-facing PI.
 * Dates should be ISO date strings (`YYYY-MM-DD`) and decimal values should
 * preferably be serialized decimal strings so no precision is lost.
 */
export type QuotationProformaInvoiceSnapshot = {
  quotationId?: string | null;
  quotationVersionId?: string | null;
  quoteNo: string;
  invoiceNo?: string | null;
  versionNumber?: number | null;
  quoteDate: string;
  validUntil?: string | null;
  currency: string;
  seller: QuotationPdfSellerSnapshot;
  buyer: QuotationPdfBuyerSnapshot;
  items: QuotationPdfItemSnapshot[];
  subtotal: QuotationPdfDecimal;
  discountAmount?: QuotationPdfDecimal | null;
  totalAmount: QuotationPdfDecimal;
  tradeTerm?: string | null;
  paymentTerm?: string | null;
  leadTimeDays?: number | null;
  remark?: string | null;
  bankAccount?: QuotationPdfBankAccountSnapshot | null;
};

export type ProformaInvoicePdfInput = QuotationProformaInvoiceSnapshot;

export type QuotationPdfRenderResult = {
  buffer: Buffer;
  fileName: string;
  pageCount: number;
  mimeType: "application/pdf";
};
