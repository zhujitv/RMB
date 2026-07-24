import type { CurrencyTotals } from "../../../lib/platform/currency-totals";

export type UserLite = {
  name?: string;
};

export type CostRow = {
  id: string;
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  businessEntityIsDefault?: boolean;
  supplierName?: string;
  supplierNameSnapshot?: string;
  vendorName?: string;
  costType?: string;
  currency?: string;
  exchangeRate?: number;
  exchangeRateDate?: string;
  exchangeRateSource?: string;
  exchangeRateType?: string;
  amount?: number;
  amountCny?: number;
  status?: string;
  voidedAt?: string;
  voidedById?: string;
  voidReason?: string;
  restoredAt?: string;
  restoredById?: string;
  restoreReason?: string;
  canDeleteCost?: boolean;
  deleteBlockedReasons?: string[];
  taxArchived?: boolean;
  taxRefundStatus?: string;
  paymentStatus?: string;
  paymentDate?: string;
  paid?: boolean;
  paidAt?: string;
  paymentVoucherUrl?: string;
  paymentVoucherFileName?: string;
  paymentVoucherMimeType?: string;
  paymentVoucherUploadedAt?: string;
  invoiceStatus?: string;
  costConfirmed?: boolean;
  sourceLabel?: string;
  sourceType?: string;
  sourceId?: string;
  logisticsSource?: {
    logisticsFeeId?: string;
    logisticsInvoiceId?: string;
    invoiceId?: string;
    shipmentId?: string;
    logisticsBillId?: string;
    billOfLadingNo?: string;
    supplierId?: string;
    supplierName?: string;
    feeType?: string;
    currency?: string;
    amount?: number;
    amountCny?: number;
    auditStatus?: string;
    invoiceStatus?: string;
    createdAt?: string;
    reviewedAt?: string;
  } | null;
  supplierId?: string;
  remark?: string;
  createdBy?: UserLite;
  updatedBy?: UserLite;
  createdAt?: string;
  updatedAt?: string;
  supplierType?: string;
  documents?: CostDocument[];
  invoiceExceptionType?: string;
  invoiceExceptionLabel?: string;
};

export type CostInvoiceGroupRow = {
  id: string;
  groupKey?: string;
  groupType?: string;
  logisticsBillId?: string;
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  businessEntityIsDefault?: boolean;
  supplierId?: string;
  supplierName?: string;
  supplierNameSnapshot?: string;
  vendorName?: string;
  invoiceNo?: string;
  costTypes?: string[];
  costTypeSummary?: string;
  currencyTotals?: CurrencyTotals;
  paymentStatus?: string;
  invoiceStatus?: string;
  invoiceExceptionType?: string;
  invoiceExceptionLabel?: string;
  costCount?: number;
  costs?: CostRow[];
  documents?: CostDocument[];
  createdAt?: string;
  updatedAt?: string;
  sourceType?: string;
};

export type CostDocument = {
  id: string;
  documentType?: string;
  fileName?: string;
  fileSize?: number;
  uploadStatus?: string;
  uploadedByName?: string;
  uploadedAt?: string;
  costId?: string;
  supplierId?: string;
};

export type CostsPage = {
  rows: CostRow[] | CostOrderSummary[] | CostInvoiceGroupRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
};

export type CostsResponse = {
  success: boolean;
  data: CostsPage;
  costs?: CostRow[];
};

export type CostDetailResponse = {
  success?: boolean;
  cost?: CostRow;
  data?: {
    cost?: CostRow;
  };
  message?: string;
};

export type CostDeleteResponse = {
  success?: boolean;
  ok?: boolean;
  message?: string;
  action?: "deleted" | "voided";
  cost?: CostRow;
  orderSummary?: CostOrderSummary | null;
};

export type CostBatchVoidResponse = {
  success?: boolean;
  ok?: boolean;
  message?: string;
  voidedCount?: number;
  skippedCount?: number;
  costs?: CostRow[];
};

export type CostPaymentResponse = {
  success?: boolean;
  cost?: CostRow;
  data?: {
    cost?: CostRow;
  };
  message?: string;
};

export type PaymentVoucherPreviewState = "checking" | "ready" | "failed";
export type PaymentVoucherPreviewKind = "image" | "pdf";

export type CostOrderOption = {
  id: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
};

export type OrdersResponse = {
  orders: CostOrderOption[];
};

export type SupplierOption = {
  id: string;
  supplierName?: string;
  name?: string;
  supplierType?: string;
  invoiceTitle?: string;
};

export type SuppliersResponse = {
  suppliers: SupplierOption[];
};

export type ExchangeRateResponse = {
  rate?: {
    rateToCny?: number;
    exchangeRate?: number;
    rate?: number;
    source?: string;
    rateType?: string;
    rateDate?: string;
  };
};

export type CostOrderSummary = {
  id: string;
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  businessEntityIsDefault?: boolean;
  receivableAmountCny?: number;
  totalCostCny?: number;
  factoryCostCny?: number;
  logisticsCostCny?: number;
  portCostCny?: number;
  otherCostCny?: number;
  currencyTotals?: CurrencyTotals;
  costCount?: number;
  costs?: CostRow[];
  costConfirmProgress?: {
    completed?: number;
    total?: number;
    text?: string;
  };
  documentProgress?: {
    completed?: number;
    total?: number;
    text?: string;
  };
};

export type CostFilters = {
  keyword: string;
  costStatus: string;
  costType: string;
  paymentStatus: string;
  costConfirmed: string;
  invoiceStatus: string;
  dateFrom: string;
  dateTo: string;
};

export type QuickCostForm = {
  orderId: string;
};

export type CostItemForm = {
  localId: string;
  supplierId: string;
  costType: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  exchangeRateDate: string;
  exchangeRateSource: string;
  exchangeRateType: string;
  paymentStatus: string;
  paymentDate: string;
  costConfirmed: string;
  remark: string;
};

export type CostFormDrawerState = {
  mode: "create" | "edit" | "copy";
  cost: CostRow | null;
};
export type CostView = "invoiceGroups" | "details" | "orders" | "invoiceExceptions";
