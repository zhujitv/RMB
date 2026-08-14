export type OverviewTotals = {
  receivable?: number;
  confirmed?: number;
  outstanding?: number;
  exchangeDifference?: number;
  overdueOrders?: number;
  dueSoonOrders?: number;
  expectedProfit?: number;
  expectedGrossMargin?: number | null;
  profitMarginEligibleOrders?: number;
  realizedProfit?: number;
  netCashFlow?: number;
  realizedGrossMargin?: number | null;
  commissionAmount?: number;
  commissionSnapshotMissingOrders?: number;
  orderCount?: number;
  customerCount?: number;
  paymentCount?: number;
  costCount?: number;
  confirmedCost?: number;
  costPayments?: number;
  overdueAmount?: number;
  dueSoonAmount?: number;
  activeOrders?: number;
  pendingCostAmount?: number;
  pendingCostOrders?: number;
  missingCostOrders?: number;
  negativeMarginOrders?: number;
  lowMarginOrders?: number;
};

export type OverviewGroup = {
  label?: string;
  amount?: number;
  count?: number;
  share?: number;
};

export type TrendRow = {
  label?: string;
  receivable?: number;
  paid?: number;
  cost?: number;
  profit?: number;
  netCashFlow?: number;
};

export type PeriodComparison = {
  key?: string;
  label?: string;
  current?: number;
  previous?: number;
  difference?: number;
  change?: number | null;
  format?: "money" | "number";
};

export type RiskOrder = {
  id?: string;
  orderNo?: string;
  blNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  salespersonName?: string;
  dueDate?: string | null;
  receivable?: number;
  paid?: number;
  unpaid?: number;
  cost?: number;
  expectedGrossProfit?: number;
  expectedGrossMargin?: number | null;
  profitMarginEligible?: boolean;
  remainingDays?: number | null;
};

export type SalespersonRank = {
  label?: string;
  count?: number;
  receivable?: number;
  paid?: number;
  unpaid?: number;
  collectionRate?: number | null;
  expectedProfit?: number;
  expectedGrossMargin?: number | null;
  marginEligibleCount?: number;
  marginEligibleReceivable?: number;
  marginEligibleProfit?: number;
  commissionMonth?: number;
  commissionYear?: number;
  commissionPending?: number;
  commissionSettled?: number;
};

export type OverviewResponse = {
  overview?: {
    period?: { month?: string; previousMonth?: string };
    dataWarnings?: string[];
    totals?: OverviewTotals;
    costStructure?: OverviewGroup[];
    byCustomer?: OverviewGroup[];
    monthlyTrend?: TrendRow[];
    periodComparison?: PeriodComparison[];
    agingBuckets?: OverviewGroup[];
    customerRank?: OverviewGroup[];
    statusDistribution?: OverviewGroup[];
    overdueTop?: RiskOrder[];
    dueSoonTop?: RiskOrder[];
    lowMarginOrders?: RiskOrder[];
    salespersonCollections?: SalespersonRank[];
    commissionRank?: SalespersonRank[];
    salespersonProfitRank?: SalespersonRank[];
  };
};
