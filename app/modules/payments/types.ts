import type { CurrencyTotals } from "../../../lib/platform/currency-totals";

export const CURRENCIES = ["", "CNY", "USD", "EUR", "GBP", "HKD"];
export const PAYMENT_TYPES = ["预付款", "中期款", "分批款", "全款", "尾款", "补差款", "退款", "其他"];
export const PAYMENT_STATUSES = ["待确认", "已到账", "已退回", "已取消"];

export type UserLite = {
  name?: string;
};

export type PaymentRow = {
  id: string;
  orderId?: string;
  orderNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  businessEntityIsDefault?: boolean;
  paymentDate?: string;
  currency?: string;
  exchangeRate?: number;
  exchangeRateDate?: string;
  exchangeRateSource?: string;
  exchangeRateType?: string;
  amount?: number;
  amountCny?: number;
  paymentType?: string;
  status?: string;
  bankReference?: string;
  remark?: string;
  createdBy?: UserLite;
  updatedBy?: UserLite;
  createdAt?: string;
  updatedAt?: string;
};

export type PaymentsResponse = {
  payments: PaymentRow[];
  data?: {
    rows?: PaymentRow[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
    summary?: PaymentSummary;
  };
  summary?: PaymentSummary;
};

export type PaymentSummary = {
  arrivedAmountCny?: number;
  pendingAmountCny?: number;
  arrivedCurrencyTotals?: CurrencyTotals;
  pendingCurrencyTotals?: CurrencyTotals;
  currentMonthCount?: number;
};

export type PaymentOrderOption = {
  id: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  currency?: string;
  receivableAmount?: number;
  receivableAmountCny?: number;
  finalReceivableAmount?: number;
  finalReceivableAmountCny?: number;
  receivedAmountCny?: number;
  receivedAmount?: number;
  outstandingAmount?: number;
  outstandingCny?: number;
  summary?: {
    receivableAmount?: number;
    receivableCny?: number;
    confirmedPaymentsCny?: number;
    confirmedPaymentsAmount?: number;
    outstandingAmount?: number;
    outstandingCny?: number;
  };
};

export type OrdersResponse = {
  orders?: PaymentOrderOption[];
  data?: {
    orders?: PaymentOrderOption[];
    rows?: PaymentOrderOption[];
  };
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

export type QuickPaymentForm = {
  orderId: string;
  paymentDate: string;
  paymentType: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  exchangeRateDate: string;
  exchangeRateSource: string;
  exchangeRateType: string;
  status: string;
  bankReference: string;
  remark: string;
};

export type PaymentFilters = {
  keyword: string;
  month: string;
  currency: string;
  paymentType: string;
  paymentStatus: string;
};

export const PAGE_SIZE = 20;

export const emptyQuickPaymentForm: QuickPaymentForm = {
  orderId: "",
  paymentDate: new Date().toISOString().slice(0, 10),
  paymentType: "",
  amount: "",
  currency: "",
  exchangeRate: "",
  exchangeRateDate: "",
  exchangeRateSource: "",
  exchangeRateType: "",
  status: "待确认",
  bankReference: "",
  remark: "",
};

export const emptyPaymentFilters: PaymentFilters = {
  keyword: "",
  month: "",
  currency: "",
  paymentType: "",
  paymentStatus: "",
};
