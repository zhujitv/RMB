
import type { CustomerAutocompleteOption } from "../../CustomerAutocomplete";
import type { CurrencyTotals } from "../../../lib/platform/currency-totals";

export const CURRENCIES = ["", "CNY", "USD", "EUR", "GBP", "HKD"];
export const TRADE_TERMS = ["EXW", "FOB", "FCA", "CFR", "CIF", "DDP", "DAP", "其他"];
export const ORDER_STATUSES = ["草稿", "已确认", "生产中", "已发货", "部分收款", "已收齐", "多收款", "已关闭", "已取消"];
export const PAYMENT_TERMS = [
  { value: "COPY_BL", label: "见提单复印件付款" },
  { value: "OA", label: "OA账期" },
  { value: "AFTER_ARRIVAL", label: "到港后付款" },
  { value: "INSTALLMENT", label: "分批付款" },
  { value: "CUSTOM", label: "其他付款约定" },
];
export const LOGISTICS_SUPPLIER_TYPES = ["物流供应商", "报关供应商", "海运供应商", "港杂费用供应商"];

export type OrderSummary = {
  arrivedPaymentsCny?: number;
  arrivedPaymentsAmount?: number;
  pendingPaymentsAmount?: number;
  arrivedOutstandingAmount?: number;
  arrivedOutstandingCny?: number;
  confirmedPaymentsCny?: number;
  confirmedPaymentsAmount?: number;
  outstandingCny?: number;
  outstandingAmount?: number;
  overpaidCny?: number;
  overpaidAmount?: number;
  exchangeDifferenceCny?: number;
  requiredDepositAmount?: number;
  receivedDepositCny?: number;
  depositGapCny?: number;
  reminderStatus?: string;
};

export type SupplierOption = {
  id: string;
  supplierName?: string;
  name?: string;
  supplierType?: string;
  status?: string;
  isDefaultLogisticsSupplier?: boolean;
};

export type BusinessEntityOption = {
  id: string;
  name: string;
  shortName?: string;
  displayName?: string;
  isDefault?: boolean;
  status?: string;
};

export type SalespersonOption = {
  id: string;
  name: string;
  role?: string;
  isActive?: boolean;
};

export type PaymentInstallment = {
  ratio: string;
  condition: string;
};

export type OrderRow = {
  id: string;
  updatedAt?: string;
  hasCurrencyLockPayments?: boolean;
  orderNo: string;
  customerId?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  businessEntityId?: string;
  businessEntityName?: string;
  businessEntityShortName?: string;
  businessEntityDisplayName?: string;
  businessEntityNameSnapshot?: string;
  businessEntityIsDefault?: boolean;
  businessEntity?: BusinessEntityOption | null;
  currency?: string;
  exchangeRate?: number;
  exchangeRateDate?: string;
  exchangeRateSource?: string;
  exchangeRateType?: string;
  finalReceivableAmount?: number;
  finalReceivableAmountCny?: number;
  estimatedReceivableAmount?: number;
  estimatedReceivableAmountCny?: number;
  actualShipmentAmount?: number | "";
  actualShipmentAmountCny?: number | "";
  actualShipmentDate?: string;
  tradeTerm?: string;
  paymentTerm?: string;
  paymentTermType?: string;
  paymentTermDisplay?: string;
  paymentInstallments?: Array<{ ratio?: number; condition?: string; amount?: number; amountCny?: number }>;
  paymentInstallmentText?: string;
  dueDate?: string;
  creditDays?: number | string;
  blDate?: string;
  expectedArrivalDate?: string;
  expectedPaymentDate?: string;
  depositRatio?: number | string;
  reminderDays?: number | string;
  salespersonId?: string;
  salespersonUserId?: string;
  salespersonName?: string;
  salespersonCommissionRate?: number;
  commissionRate?: number;
  status?: string;
  remark?: string;
  logisticsSupplierIds?: string[];
  logisticsSuppliers?: SupplierOption[];
  summary?: OrderSummary;
};

export type OrdersResponse = {
  orders: OrderRow[];
  data?: {
    rows?: OrderRow[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
    summary?: CurrencyTotals;
  };
};

export type CustomersResponse = {
  customers?: CustomerAutocompleteOption[];
};

export type SuppliersResponse = {
  suppliers?: SupplierOption[];
};

export type SettingsResponse = {
  settings?: {
    allowMultipleOrderLogisticsSuppliers?: boolean;
  };
};

export type ExchangeRateResponse = {
  rate?: {
    currency?: string;
    rateToCny?: number;
    exchangeRate?: number;
    rate?: number;
    source?: string;
    rateType?: string;
    rateDate?: string;
  };
};

export type QuickOrderForm = {
  expectedUpdatedAt: string;
  customerId: string;
  orderNo: string;
  blNo: string;
  currency: string;
  exchangeRate: string;
  exchangeRateDate: string;
  exchangeRateSource: string;
  exchangeRateType: string;
  estimatedReceivableAmount: string;
  finalReceivableAmount: string;
  actualShipmentAmount: string;
  actualShipmentDate: string;
  tradeTerm: string;
  paymentTermType: string;
  paymentTerm: string;
  blDate: string;
  expectedArrivalDate: string;
  expectedPaymentDate: string;
  dueDate: string;
  creditDays: string;
  reminderDays: string;
  status: string;
  businessEntityId: string;
  salespersonUserId: string;
  logisticsSupplierIds: string[];
  paymentInstallments: PaymentInstallment[];
  remark: string;
};

export const PAGE_SIZE = 20;

export const emptyQuickOrderForm: QuickOrderForm = {
  expectedUpdatedAt: "",
  customerId: "",
  orderNo: "",
  blNo: "",
  currency: "",
  exchangeRate: "",
  exchangeRateDate: "",
  exchangeRateSource: "",
  exchangeRateType: "",
  estimatedReceivableAmount: "",
  finalReceivableAmount: "",
  actualShipmentAmount: "",
  actualShipmentDate: "",
  tradeTerm: "FOB",
  paymentTermType: "COPY_BL",
  paymentTerm: "",
  blDate: "",
  expectedArrivalDate: "",
  expectedPaymentDate: "",
  dueDate: "",
  creditDays: "30",
  reminderDays: "7",
  status: "草稿",
  businessEntityId: "",
  salespersonUserId: "",
  logisticsSupplierIds: [],
  paymentInstallments: [{ ratio: "100", condition: "按约定付款" }],
  remark: "",
};
