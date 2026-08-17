export type SupplierDocument = {
  id: string;
  costId?: string;
  documentType?: string;
  requestItemType?: string;
  supplierDocumentType?: string;
  type?: string;
  category?: string;
  fileName?: string;
  displayFileName?: string;
  downloadFileName?: string;
  uploadStatus?: string;
  uploadStatusLabel?: string;
  uploadedByName?: string;
  uploadedAt?: string;
};

export type SupplierFactoryCostSlot = {
  id: string;
  label?: string;
  costType?: string;
  amount?: number;
  amountCny?: number;
  currency?: string;
};

export type SupplierDocumentTask = {
  id: string;
  purchaseOrderNo?: string;
  orderNo?: string;
  businessEntityIsDefault?: boolean;
  supplierName?: string;
  requestedByName?: string;
  requiredDocumentTypes?: string[];
  requiredDocumentLabels?: string[];
  factoryCostSlots?: SupplierFactoryCostSlot[];
  status?: string;
  dueDate?: string;
  message?: string;
  templateFileName?: string;
  hasTemplate?: boolean;
  contractNo?: string;
  contractStatus?: string;
  contractDraft?: SupplierTaxContractDraft | null;
  contractApproved?: SupplierTaxContractDraft | null;
  contractReviewRemark?: string;
  invoiceMatchStatus?: string;
  invoiceMatch?: SupplierInvoiceMatch | null;
  invoiceNo?: string;
  sendStatus?: string;
  sendError?: string;
  sentAt?: string;
  canDelete?: boolean;
  hasTaxRefundDocuments?: boolean;
  taxRefundDocumentCount?: number;
  documents?: SupplierDocument[];
  uploadedCount?: number;
  requiredCount?: number;
  detailLoaded?: boolean;
  detailLoading?: boolean;
  detailError?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SupplierTaxContractDraft = {
  contractNo?: string;
  supplierName?: string;
  buyerName?: string;
  buyerTaxNumber?: string;
  totalAmountWithTax?: string;
  currency?: string;
  warnings?: string[];
  blockingIssues?: string[];
  items?: Array<{
    lineNo?: number;
    productName?: string;
    quantity?: string;
    unit?: string;
    unitPriceWithTax?: string;
    amountWithTax?: string;
  }>;
};

export type SupplierInvoiceMatch = {
  matched?: boolean;
  issues?: string[];
  checkedAt?: string;
  invoice?: Record<string, unknown>;
};

export type SupplierDocumentsResponse = {
  requests?: SupplierDocumentTask[];
  pagination?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
};

export type SupplierDocumentDetailResponse = {
  request?: SupplierDocumentTask;
  data?: SupplierDocumentTask;
  message?: string;
};

export type SupplierDocumentsStatsResponse = {
  stats?: {
    pendingCount?: number;
    totalCount?: number;
  };
};

export type SupplierUploadResponse = {
  request?: SupplierDocumentTask;
  document?: SupplierDocument;
  message?: string;
};

export type SupplierDocumentDeleteResponse = {
  id?: string;
  message?: string;
};

export type SupplierDocumentNoticeResponse = {
  request?: SupplierDocumentTask;
  message?: string;
};
