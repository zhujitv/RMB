export type NumericLike = number | string | { toString(): string };
export type PaymentLike = {
  status?: string | null; deletedAt?: Date | string | null; currency?: string | null;
  amount?: NumericLike | null; amountCny?: NumericLike | null; paymentType?: string | null;
};
export type CostLike = {
  status?: string | null; paymentStatus?: string | null; deletedAt?: Date | string | null;
  costType?: string | null; costConfirmed?: boolean | null; amountCny?: NumericLike | null; createdById?: string | null;
};
type SalespersonLike = { name?: string | null; email?: string | null };
export type OrderLike = {
  currency?: string | null; salespersonUserId?: string | null; salesperson?: SalespersonLike | null;
  salespersonCommissionRate?: NumericLike | null; commissionStatus?: string | null; status?: string | null;
  receivableAmount?: NumericLike | null; receivableAmountCny?: NumericLike | null;
  estimatedReceivableAmount?: NumericLike | null; estimatedReceivableAmountCny?: NumericLike | null;
  actualShipmentAmount?: NumericLike | null; actualShipmentAmountCny?: NumericLike | null;
  actualShipmentDate?: Date | string | null;
  taxArchived?: boolean | null; taxRefundStatus?: string | null;
  taxRefundArchivedAt?: Date | string | null; taxSubmittedAt?: Date | string | null;
  finalReceivableAmount?: NumericLike | null; finalReceivableAmountCny?: NumericLike | null;
  exchangeRate?: NumericLike | null; depositRatio?: NumericLike | null; dueDate?: Date | null;
  reminderDays?: NumericLike | null; payments?: PaymentLike[] | null; costs?: CostLike[] | null;
};
export type TaxLogisticsMissingItem = {
  label?: string | null; invoiceLabel?: string | null; missingCostLabel?: string | null;
  costType?: string | null; [key: string]: unknown;
};
export type OrderSummary = {
  receivableCny: number; receivableAmount: number; estimatedReceivableAmount: number;
  estimatedReceivableAmountCny: number; actualShipmentAmount: number | null; actualShipmentAmountCny: number | null;
  finalReceivableAmount: number; finalReceivableAmountCny: number; confirmedPaymentsCny: number;
  confirmedPaymentsAmount: number; arrivedPaymentsCny: number; arrivedPaymentsAmount: number;
  prepaidAmountCny: number; receivedDepositCny: number; receivedDepositAmount: number;
  requiredDepositAmount: number; requiredDepositAmountCny: number; depositGapCny: number; depositOverpaidCny: number;
  depositRatio: number | null; pendingPaymentsCny: number; pendingPaymentsAmount: number;
  arrivedBalanceAmount: number; arrivedBalanceCny: number; arrivedOutstandingAmount: number; arrivedOutstandingCny: number;
  balanceCny: number; balanceAmount: number; outstandingCny: number; outstandingAmount: number;
  overpaidCny: number; overpaidAmount: number; exchangeDifferenceCny: number;
  hasArrivedPaymentCurrencyMismatch: boolean; isOverpaid: boolean; isUnderpaid: boolean;
  totalCostCny: number; confirmedTotalCostCny: number; paidConfirmedCostCny: number;
  logisticsCostCny: number; confirmedLogisticsCostCny: number; expectedTaxRefundIncomeCny: number;
  taxLogisticsCostsComplete: boolean; taxLogisticsMissing: TaxLogisticsMissingItem[]; taxLogisticsMissingLabels: string[];
  allCostsConfirmed: boolean; logisticsCostConfirmed: boolean; realSalespersonSet: boolean; commissionRate: number;
  commissionFormulaMode: string; commissionFormulaLabel: string; commissionFormulaDescription: string;
  commissionFormulaSource: string; commissionFormulaDeductions: unknown; commissionFormulaFloorAtZero: boolean;
  commissionBaseCny: number; estimatedCommissionBaseCny: number; estimatedCommissionCny: number;
  settleableCommissionBaseCny: number; settleableCommissionCny: number; expectedGrossProfit: number;
  profitMarginEligible: boolean;
  expectedGrossMargin: number | null; realizedGrossProfit: number | null; realizedGrossMargin: number | null;
  actualGrossProfit: number | null; netCashFlowCny: number; grossMargin: number | null;
  reminderStatus: string; overdueDays: number; commissionStatus?: string; commissionCanSettle?: boolean; commissionAmountCny?: number;
};
