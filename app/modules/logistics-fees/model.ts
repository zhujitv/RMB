import {
  LOGISTICS_BILL_PAY_BUTTON_RULE,
  LOGISTICS_BILL_PAY_DISABLED_TOOLTIP,
} from "../../../lib/platform/logistics-bill-state-machine";
import {
  LOGISTICS_COST_TYPE_OPTIONS,
  LOGISTICS_COST_TYPES,
} from "../../../lib/platform/logistics-cost-types";

export const PAGE_SIZE = 20;
export const COST_TYPES = [...LOGISTICS_COST_TYPES];
export const COST_TYPE_OPTIONS = [...LOGISTICS_COST_TYPE_OPTIONS];
export const DEFAULT_BILLING_METHOD = "按柜";
export const CURRENCIES = ["CNY", "USD", "EUR", "GBP", "HKD"];
export const FOREIGN_CURRENCY_ORDER = ["USD", "EUR", "HKD", "GBP"];
export const LOGISTICS_EXPENSE_BILL_SORT_PRIORITY: Record<string, number> = {
  草稿: 10,
  已驳回: 20,
  待审核: 30,
  待开票: 40,
  未通知: 40,
  已通知开票: 40,
  通知失败: 40,
  "待开票 / 通知失败": 40,
  部分未通知: 40,
  部分已通知: 40,
  部分上传发票: 50,
  部分上传: 50,
  部分已上传: 50,
  部分已确认: 50,
  已上传发票: 60,
  已上传: 60,
  已确认发票: 60,
  已确认: 60,
  已开票: 60,
  待付款: 70,
  部分待付款: 70,
  部分付款: 80,
  部分已付款: 80,
  已付款: 90,
  审核通过: 100,
};
export const LOGISTICS_FEE_SUPPLIER_TYPES = [
  "物流供应商",
  "报关供应商",
  "海运供应商",
  "港杂费用供应商",
  "LOGISTICS_SUPPLIER",
  "CUSTOMS_SUPPLIER",
  "FREIGHT_FORWARDER",
  "SHIPPING_SUPPLIER",
  "PORT_CHARGES_SUPPLIER",
];
export const AUDIT_FILTERS = [
  { label: "全部审核状态", value: "" },
  { label: "草稿", value: "草稿" },
  { label: "待审核", value: "待审核" },
  { label: "审核通过", value: "审核通过" },
  { label: "已驳回", value: "已驳回" },
  { label: "待开票", value: "toInvoice" },
  { label: "已上传发票", value: "uploaded" },
  { label: "已确认发票", value: "confirmedInvoice" },
];
export const PAYMENT_STATUSES = ["待开票", "已开票", "待付款", "已付款"];
export const PAY_BUTTON_RULE = LOGISTICS_BILL_PAY_BUTTON_RULE;
export const PAY_BUTTON_DISABLED_TOOLTIP = LOGISTICS_BILL_PAY_DISABLED_TOOLTIP;
export const todayInputInChinaClient = () =>
  new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
  paymentDate?: string | null;
  invoiceDocumentId?: string;
  invoiceDocument?: DocumentLite | null;
  invoiceUploadedBy?: UserLite;
  invoiceUploadedAt?: string | null;
  invoiceConfirmedBy?: UserLite;
  invoiceConfirmedAt?: string | null;
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
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerShortName?: string;
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
  exchangeRate: string;
  remark: string;
};

export type LogisticsExpenseDraft = {
  costType: string;
  billingMethod: string;
  unitAmount: string;
  appliedContainerCount: string;
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

export type LogisticsExpenseBatchUpdateItem = {
  id: string;
  costType?: string;
  amount: number;
  billingMethod: string;
  billingQuantity: number;
  appliedContainerCount: number;
  currency?: string;
  exchangeRate?: number;
  remark: string;
};

export type LogisticsExpenseBatchCreateItem = {
  expenseType: string;
  amount: number;
  billingMethod: string;
  billingQuantity: number;
  appliedContainerCount: number;
  currency?: string;
  exchangeRate?: number;
  remark: string;
};

export type LogisticsExpenseBatchSavePayload = {
  groupKey: string;
  orderId?: string;
  updates: LogisticsExpenseBatchUpdateItem[];
  creates: LogisticsExpenseBatchCreateItem[];
  deletes: string[];
};

export type LogisticsExpenseBatchSaveResult = {
  items: LogisticsExpense[];
  bill?: LogisticsExpense;
  deletedIds: string[];
};

export type LogisticsExpenseMutationResult = {
  success?: boolean;
  message?: string;
  expense?: LogisticsExpense;
  expenses?: LogisticsExpense[];
  bill?: LogisticsExpense;
  bills?: LogisticsExpense[];
  invoiceGroup?: string;
  emailError?: string;
  successCount?: number;
  failedCount?: number;
  results?: LogisticsExpenseReviewResult[];
};

export type LogisticsExpenseReviewResult = {
  billId?: string;
  orderNo?: string;
  blNo?: string;
  auditStatus?: string;
  notificationStatus?: string;
  errorMessage?: string;
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

export type LogisticsExpenseContainerSummary = {
  hasContainers: boolean;
  typeLines: string[];
  containerNoLines: string[];
  shortText: string;
};

export const emptyExpenseItem = (): ExpenseItemForm => ({
  costType: "拖车费",
  billingMethod: "按柜",
  amount: "",
  appliedContainerCount: "1",
  currency: "CNY",
  exchangeRate: "1",
  remark: "",
});

export const emptyExpenseForm: ExpenseForm = {
  orderId: "",
  supplierId: "",
  items: [emptyExpenseItem()],
};
