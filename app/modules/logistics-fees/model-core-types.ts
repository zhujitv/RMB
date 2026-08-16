export type UserLite = {
  name?: string;
};

export type DocumentLite = {
  id?: string;
  fileName?: string;
  originalFilename?: string;
  fileSize?: number;
  uploadedBy?: UserLite;
  uploadedAt?: string | null;
};

export type LogisticsExpense = {
  id: string;
  isBill?: boolean;
  isShipment?: boolean;
  isTemporary?: boolean;
  status?: string;
  voidedAt?: string | null;
  voidedBy?: UserLite | null;
  voidedById?: string;
  voidReason?: string;
  voidRemark?: string;
  itemCount?: number;
  billCount?: number;
  items?: LogisticsExpense[];
  shipmentNo?: string;
  customer?: string;
  shipmentBillIds?: string[];
  billId?: string;
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerShortName?: string;
  businessEntityIsDefault?: boolean;
  vesselVoyage?: string;
  supplierId?: string;
  supplierName?: string;
  supplierNames?: string[];
  supplierEmail?: string;
  costId?: string;
  costType?: string;
  currency?: string;
  exchangeRate?: number;
  amount?: number;
  amountCny?: number;
  totalCNY?: number;
  totalUSD?: number;
  currencyTotals?: LogisticsExpenseCurrencySummary;
  containerType?: string;
  appliedContainerCount?: number | null;
  billingMethod?: string;
  billingQuantity?: number | null;
  containerScope?: string;
  order?: Partial<ExpenseOrderOption>;
  remark?: string;
  auditStatus?: string;
  invoiceStatus?: string;
  detailInvoiceStatus?: string;
  billInvoiceStatus?: string;
  invoiceGroups?: LogisticsInvoiceGroupSummary[];
  paymentStatus?: string;
  detailPaymentStatus?: string;
  billPaymentStatus?: string;
  submittedAt?: string | null;
  reviewedBy?: UserLite;
  reviewedAt?: string | null;
  rejectedBy?: UserLite | null;
  rejectedAt?: string | null;
  reviewRemark?: string;
  rejectReason?: string;
  invoiceNotifiedAt?: string | null;
  invoiceNotificationError?: string;
  supplierAllowLogisticsInvoiceUpload?: boolean;
  paymentDate?: string | null;
  invoiceDocumentId?: string;
  invoiceDocument?: DocumentLite | null;
  invoiceUploadedBy?: UserLite;
  invoiceUploadedAt?: string | null;
  invoiceConfirmedBy?: UserLite;
  invoiceConfirmedAt?: string | null;
  invoiceValidationStatus?: string;
  invoiceValidationMessage?: string;
  invoiceValidationJson?: unknown;
  invoiceOcrTaskId?: string;
  invoiceRecognizedNo?: string;
  invoiceRecognizedDate?: string;
  invoiceRecognizedSeller?: string;
  invoiceRecognizedBuyer?: string;
  invoiceRecognizedAmount?: number | null;
  invoiceRecognizedName?: string;
  invoiceManualConfirmedById?: string;
  invoiceManualConfirmedAt?: string | null;
  invoiceManualConfirmReason?: string;
  createdBy?: UserLite;
  updatedBy?: UserLite;
  createdAt?: string;
  updatedAt?: string;
  sourceLabel?: string;
};

export type LogisticsInvoiceGroupSummary = {
  key: string;
  label: string;
  costTypes?: readonly string[];
  includedFeeTypes?: readonly string[];
  amountCny?: number;
  currencyTotals?: LogisticsExpenseCurrencySummary;
  itemIds?: string[];
  status?: string;
  uploaded?: boolean;
  confirmed?: boolean;
  failed?: boolean;
  notified?: boolean;
  invoiceDocumentId?: string;
  invoiceNotificationError?: string;
  validationStatus?: string;
  validationMessage?: string;
  validationJson?: unknown;
  ocrTaskId?: string;
  recognizedInvoiceNo?: string;
  recognizedInvoiceDate?: string;
  recognizedSeller?: string;
  recognizedBuyer?: string;
  recognizedAmount?: number;
  recognizedName?: string;
  manualConfirmedAt?: string | null;
  manualConfirmReason?: string;
};

export type LogisticsExpensesResponse = {
  rows: LogisticsExpense[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
};

export type LogisticsStatementRow = {
  supplierId?: string;
  supplierName?: string;
  orderCount?: number;
  approvedCurrencyTotals?: LogisticsExpenseCurrencySummary;
  pendingPaymentCurrencyTotals?: LogisticsExpenseCurrencySummary;
  paidCurrencyTotals?: LogisticsExpenseCurrencySummary;
  approvedAmountCny?: number;
  pendingPaymentAmountCny?: number;
  paidAmountCny?: number;
};

export type ExpenseOrderOption = {
  id: string;
  orderId?: string;
  orderNo?: string;
  tradeTerm?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerShortName?: string;
  businessEntityIsDefault?: boolean;
  vesselVoyage?: string;
  truckPlateNo?: string;
  cargoName?: string;
  containerCount?: number;
  containerNos?: string[];
  containerType?: string;
  containerTypes?: string[];
  transportItems?: Array<{
    id?: string;
    containerNo?: string;
    containerType?: string;
    sealNo?: string;
    truckPlateNo?: string;
    departureDate?: string;
    departurePlace?: string;
    arrivalPlace?: string;
    cargoName?: string;
  }>;
  logisticsSuppliers?: SupplierOption[];
};

export type SupplierOption = {
  id: string;
  supplierName?: string;
  name?: string;
  supplierType?: string;
  allowLogisticsExpenseEntry?: boolean;
  allowedLogisticsCostTypes?: string[];
};

export type ExpenseForm = {
  orderId: string;
  supplierId: string;
  items: ExpenseItemForm[];
};

export type ExpenseItemForm = {
  costType: string;
  billingMethod: string;
  amount: string;
  appliedContainerCount: string;
  currency: string;
  currencyTouched?: boolean;
  exchangeRate: string;
  remark: string;
};

export type LogisticsExpenseDraft = {
  costType: string;
  billingMethod: string;
  unitAmount: string;
  appliedContainerCount: string;
  currency: string;
  currencyTouched?: boolean;
  remark: string;
};

export type LogisticsExpenseCurrencyTotal = {
  currency: string;
  amount: number;
};

export type LogisticsExpenseCurrencySummary = {
  cnyActual: number;
  foreignTotals: LogisticsExpenseCurrencyTotal[];
  totalCny: number;
};
