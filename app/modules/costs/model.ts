import type { CurrencyTotals } from "../../../lib/platform/currency-totals";
import { LOGISTICS_COST_TYPE_OPTIONS, LOGISTICS_COST_TYPES, LOGISTICS_USD_COST_TYPES } from "../../../lib/platform/logistics-cost-types";

export const QUICK_COST_TYPES = ["工厂货款", "原材料货款", "采购货款", "产品货款", "银行手续费", "样品费", "国外佣金", "国外代理费", "佣金", "其他费用"];
export const COST_PAYMENT_STATUSES = ["待支付", "部分支付", "已支付", "已取消"];
export const COST_INVOICE_STATUSES = ["未收到", "已收到"];
export const COST_CONFIRMATION_OPTIONS = [
  { label: "未确认", value: "false" },
  { label: "已确认", value: "true" },
];
export const CURRENCIES = ["CNY", "USD", "EUR", "GBP", "HKD"];
export const FOREIGN_CURRENCY_COST_TYPES = ["国外佣金", "国外代理费", "佣金", ...LOGISTICS_USD_COST_TYPES];
export const FACTORY_COST_TYPES = ["工厂货款", "原材料货款", "采购货款", "产品货款"];
export const PRODUCT_SUPPLIER_TYPES = ["产品供应商", "工厂供应商"];
export const LOGISTICS_INVOICE_COST_TYPES = [...LOGISTICS_COST_TYPES, "国内物流费", "国内拖车费"];
export const COST_FILTER_TYPES = [...QUICK_COST_TYPES, ...LOGISTICS_COST_TYPES]
  .filter((type, index, rows) => rows.indexOf(type) === index);
export const COST_FILTER_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  LOGISTICS_COST_TYPE_OPTIONS.map((item) => [item.value, item.label]),
);
export const DISABLE_COMPONENT_RENDER = [
  "OrderPayableSummary",
  "RmbSummaryBlock",
  "UsdSummaryBlock",
  "ExchangeSummaryBlock",
] as const;
void DISABLE_COMPONENT_RENDER;
export const FACTORY_DOCUMENT_TYPES = [
  { value: "SUPPLIER_PURCHASE_CONTRACT", label: "工厂采购合同", required: true },
  { value: "SUPPLIER_INVOICE", label: "工厂增值税发票", required: true },
];

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
  mode: "create" | "edit";
  cost: CostRow | null;
};
export type CostView = "invoiceGroups" | "details" | "orders" | "invoiceExceptions";

export const PAGE_SIZE = 20;

export const emptyQuickCostForm: QuickCostForm = {
  orderId: "",
};

export function emptyCostItemForm(): CostItemForm {
  return {
    localId: `cost-item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    supplierId: "",
    costType: "工厂货款",
    amount: "",
    currency: "CNY",
    exchangeRate: "1",
    exchangeRateDate: "",
    exchangeRateSource: "系统",
    exchangeRateType: "人民币",
    paymentStatus: "待支付",
    paymentDate: "",
    costConfirmed: "false",
    remark: "",
  };
}

export const emptyCostFilters: CostFilters = {
  keyword: "",
  costType: "",
  paymentStatus: "",
  costConfirmed: "",
  invoiceStatus: "",
  dateFrom: "",
  dateTo: "",
};
