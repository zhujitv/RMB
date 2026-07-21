export type OverviewTotals = {
  receivable?: number;
  confirmed?: number;
  outstanding?: number;
  exchangeDifference?: number;
  overdueOrders?: number;
  dueSoonOrders?: number;
  expectedProfit?: number;
  expectedGrossMargin?: number | null;
  realizedProfit?: number;
  netCashFlow?: number;
  realizedGrossMargin?: number | null;
  commissionAmount?: number;
  commissionSnapshotMissingOrders?: number;
  orderCount?: number;
};

export type OverviewGroup = {
  label?: string;
  amount?: number;
  count?: number;
};

export type TrendRow = {
  label?: string;
  receivable?: number;
  paid?: number;
  unpaid?: number;
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
  commissionMonth?: number;
  commissionYear?: number;
  commissionPending?: number;
  commissionSettled?: number;
};

export type OverviewResponse = {
  overview?: {
    totals?: OverviewTotals;
    costStructure?: OverviewGroup[];
    byCustomer?: OverviewGroup[];
    monthlyTrend?: TrendRow[];
    overdueTop?: RiskOrder[];
    dueSoonTop?: RiskOrder[];
    lowMarginOrders?: RiskOrder[];
    salespersonCollections?: SalespersonRank[];
    commissionRank?: SalespersonRank[];
    salespersonProfitRank?: SalespersonRank[];
  };
};
