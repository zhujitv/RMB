export const QUOTATION_PAGE_SIZE = 20;
export const QUOTATION_CURRENCIES = ["USD", "EUR", "GBP", "CNY", "HKD"];
export const QUOTATION_TRADE_TERMS = ["FOB", "CIF", "CFR", "EXW", "FCA", "DAP", "DDP"];

export type QuotationStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "VOIDED";
export type QuotationDeliveryStatus = "PENDING" | "SENT" | "FAILED";
export type QuotationResponseStatus = "ACCEPTED" | "REJECTED";
export type QuotationDecisionChannel = "SYSTEM_EMAIL" | "EXTERNAL_EMAIL" | "WECHAT" | "WHATSAPP" | "PHONE" | "OTHER";

export type QuotationBusinessEntity = {
  id: string;
  name?: string | null;
  shortName?: string | null;
  displayName?: string | null;
  isDefault?: boolean;
  status?: string | null;
};

export type BusinessEntitiesResponse = {
  entities?: QuotationBusinessEntity[];
};

export type QuotationItem = {
  id?: string;
  customerProductId?: string | null;
  productNameSnapshot?: string | null;
  name?: string | null;
  productName?: string | null;
  description?: string | null;
  specificationSnapshot?: string | null;
  specification?: string | null;
  unit?: string | null;
  quantity?: string | number | null;
  unitPrice?: string | number | null;
  amount?: string | number | null;
  lineTotal?: string | number | null;
  remark?: string | null;
};

export type QuotationTotals = {
  subtotal?: string | number | null;
  discountAmount?: string | number | null;
  totalAmount?: string | number | null;
};

export type QuotationSellerSnapshot = {
  businessEntityNameSnapshot?: string | null;
  businessEntityShortNameSnapshot?: string | null;
  sellerNameEnSnapshot?: string | null;
  sellerAddressSnapshot?: string | null;
  sellerEmailSnapshot?: string | null;
  sellerPhoneSnapshot?: string | null;
  sellerWebsiteSnapshot?: string | null;
  sellerSnapshotReady?: boolean;
  documentTemplateVersion?: string | null;
};

export type QuotationVersion = QuotationTotals & QuotationSellerSnapshot & {
  id?: string;
  versionNumber?: number;
  invoiceNoSnapshot?: string | null;
  customerNameSnapshot?: string | null;
  customerShortNameSnapshot?: string | null;
  countrySnapshot?: string | null;
  contactPersonSnapshot?: string | null;
  contactEmailSnapshot?: string | null;
  contactPhoneSnapshot?: string | null;
  quoteDate?: string | null;
  validUntil?: string | null;
  currency?: string | null;
  exchangeRate?: string | number | null;
  tradeTerm?: string | null;
  paymentTerm?: string | null;
  leadTimeDays?: number | string | null;
  remark?: string | null;
  items?: QuotationItem[];
  totals?: QuotationTotals | null;
  createdAt?: string | null;
};

export type QuotationCustomer = {
  id?: string;
  name?: string | null;
  fullName?: string | null;
  shortName?: string | null;
  displayName?: string | null;
  contactPerson?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
};

export type QuotationSalesperson = {
  id?: string;
  name?: string | null;
};

export type QuotationSalesExecution = {
  id: string;
  executionNo?: string | null;
  status?: "DRAFT" | "VOIDED" | null;
};

export type QuotationDeliveryUser = {
  id?: string | null;
  name?: string | null;
};

export type QuotationDelivery = {
  id: string;
  quotationId?: string | null;
  quotationVersionId?: string | null;
  status?: QuotationDeliveryStatus | null;
  recipientEmails?: string[];
  ccEmails?: string[];
  subject?: string | null;
  body?: string | null;
  attachmentFileAssetId?: string | null;
  attachmentFileName?: string | null;
  outboxId?: string | null;
  attempts?: number | null;
  lastError?: string | null;
  sentBy?: QuotationDeliveryUser | null;
  sentAt?: string | null;
  failedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type QuotationDecision = {
  id: string;
  quotationId?: string | null;
  quotationVersionId?: string | null;
  decision: QuotationResponseStatus;
  channel: QuotationDecisionChannel;
  respondedAt?: string | null;
  note?: string | null;
  recordedBy?: QuotationDeliveryUser | null;
  createdAt?: string | null;
};

export type QuotationRow = {
  id: string;
  quoteNo?: string | null;
  quotationNo?: string | null;
  invoiceNo?: string | null;
  status?: QuotationStatus | null;
  statusLabel?: string | null;
  customerId?: string | null;
  customer?: QuotationCustomer | null;
  customerName?: string | null;
  customerFullName?: string | null;
  customerShortName?: string | null;
  businessEntityId?: string | null;
  businessEntity?: QuotationBusinessEntity | null;
  businessEntityName?: string | null;
  businessEntityShortName?: string | null;
  salespersonUserId?: string | null;
  salesperson?: QuotationSalesperson | null;
  salespersonName?: string | null;
  salesExecution?: QuotationSalesExecution | null;
  currentVersionNumber?: number | null;
  currentVersion?: QuotationVersion | null;
  versions?: QuotationVersion[];
  deliveries?: QuotationDelivery[];
  decisions?: QuotationDecision[];
  latestDelivery?: QuotationDelivery | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
};

export type QuotationsResponse = {
  success?: boolean;
  data?: {
    rows?: QuotationRow[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
  quotations?: QuotationRow[];
  message?: string;
};

export type QuotationDetailResponse = {
  success?: boolean;
  data?: QuotationRow;
  quotation?: QuotationRow;
  message?: string;
};

export type QuotationDeleteResponse = {
  success?: boolean;
  data?: {
    id?: string;
    quoteNo?: string;
    action?: "deleted";
    deletedVersionCount?: number;
    deletedDocumentCount?: number;
    cleanupPending?: boolean;
  };
  message?: string;
};

export type CustomerProduct = {
  id: string;
  customerId?: string | null;
  name?: string | null;
  productName?: string | null;
  specification?: string | null;
  unit?: string | null;
  remark?: string | null;
  lastUnitPrice?: string | number | null;
  lastCurrency?: string | null;
  lastQuotedAt?: string | null;
  updatedAt?: string | null;
};

export type CustomerProductsResponse = {
  success?: boolean;
  data?: {
    rows?: CustomerProduct[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
  products?: CustomerProduct[];
  message?: string;
};

export type QuotationItemDraft = {
  key: string;
  id?: string;
  customerProductId: string;
  description: string;
  specification: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  unitPriceSource: "" | "history" | "manual";
  remark: string;
};

export type QuotationDraft = {
  customerId: string;
  businessEntityId: string;
  currency: string;
  tradeTerm: string;
  paymentTerm: string;
  validUntil: string;
  leadTimeDays: string;
  remark: string;
  items: QuotationItemDraft[];
};

export {
  comparableQuotationDraft,
  currentQuotationVersion,
  hasCurrentManualQuotationAcceptance,
  customerProductDescription,
  customerProductName,
  duplicateQuotationItemAfter,
  emptyQuotationItem,
  quotationBusinessEntityName,
  quotationCustomerLegalName,
  quotationCustomerName,
  quotationCustomerOption,
  quotationDraftFromRow,
  quotationItemDescription,
  quotationItemName,
  quotationItemSpecification,
  quotationLineAmount,
  quotationNumber,
  quotationNeedsSellerSnapshotRepair,
  quotationStatusLabel,
  quotationSubtotal,
  quotationTotal,
} from "./quotation-helpers.ts";
