import type { LogisticsExpense } from "./model-core-types";

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
  status?: "PASSED" | "NEEDS_REVIEW" | "FAILED" | "TIMEOUT" | string;
  message?: string;
  error?: string;
  result?: unknown;
  ocrTask?: unknown;
  expense?: LogisticsExpense;
  expenses?: LogisticsExpense[];
  bill?: LogisticsExpense;
  bills?: LogisticsExpense[];
  invoiceGroup?: string;
  emailNotified?: boolean;
  emailResults?: Array<{ supplierId?: string; supplierName?: string; sent?: boolean; skipped?: boolean; error?: string; expenseIds?: string[] }>;
  emailError?: string;
  successCount?: number;
  failedCount?: number;
  results?: LogisticsExpenseReviewResult[];
  voidedBillId?: string;
  voidedCostIds?: string[];
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
