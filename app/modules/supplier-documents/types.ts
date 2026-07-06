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
  ocrTask?: SupplierDocumentOcrTask | null;
};

export type SupplierDocumentOcrIssue = {
  level?: string;
  message?: string;
  field?: string;
};

export type SupplierDocumentOcrField = {
  key?: string;
  label?: string;
  value?: string;
};

export type SupplierDocumentOcrTask = {
  id?: string;
  status?: string;
  validationStatus?: string;
  errorMessage?: string;
  rejectReason?: string;
  rawText?: string;
  fields?: SupplierDocumentOcrField[];
  issues?: SupplierDocumentOcrIssue[];
  expectedAmount?: number | null;
  supplierName?: string;
  businessEntityName?: string;
  updatedAt?: string;
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
  sendStatus?: string;
  sendError?: string;
  sentAt?: string;
  canDelete?: boolean;
  hasTaxRefundDocuments?: boolean;
  taxRefundDocumentCount?: number;
  documents?: SupplierDocument[];
  createdAt?: string;
  updatedAt?: string;
};

export type SupplierDocumentsResponse = {
  requests?: SupplierDocumentTask[];
  pagination?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
  summary?: {
    pendingCount?: number;
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

export type SupplierDocumentOcrResponse = {
  success?: boolean;
  status?: "PASSED" | "NEEDS_REVIEW" | "FAILED" | "TIMEOUT" | string;
  ocrTask?: SupplierDocumentOcrTask | null;
  result?: SupplierDocumentOcrTask | null;
  error?: string;
  message?: string;
};
