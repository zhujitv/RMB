import { formatCny } from "../../formatters";

export type ProfitSummary = {
  receivableCny?: number;
  arrivedPaymentsCny?: number;
  confirmedTotalCostCny?: number;
  totalCostCny?: number;
  logisticsCostCny?: number;
  commissionBaseCny?: number;
  commissionFormulaLabel?: string;
  commissionFormulaDescription?: string;
  taxLogisticsCostsComplete?: boolean;
  taxLogisticsMissingLabels?: string[];
  expectedGrossProfit?: number;
  expectedGrossMargin?: number | null;
  realizedGrossProfit?: number | null;
  realizedGrossMargin?: number | null;
  netCashFlowCny?: number;
  commissionAmountCny?: number;
  estimatedCommissionCny?: number;
  commissionRate?: number;
  commissionCanSettle?: boolean;
  commissionStatus?: string;
  costGroups?: Record<string, number>;
};

export type ProfitRow = {
  id: string;
  orderNo?: string;
  blNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  salespersonName?: string;
  commissionStatus?: string;
  commissionSettledByName?: string;
  commissionSettledAt?: string | null;
  summary?: ProfitSummary;
};

export type ProfitResponse = {
  data?: {
    rows?: ProfitRow[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
  error?: string;
};

export const PAGE_SIZE = 20;

export const REALIZED_GROSS_PROFIT_TOOLTIP = "客户款项未收齐时，不计算已实现毛利；负数现金流请查看净现金流。";

export function formatCnyOrDash(value: unknown) {
  return value == null || value === "" ? "--" : formatCny(value);
}

export function realizedGrossProfitLabel() {
  return (
    <span title={REALIZED_GROSS_PROFIT_TOOLTIP} style={{ cursor: "help" }}>
      已实现毛利 <span aria-label={REALIZED_GROSS_PROFIT_TOOLTIP}>?</span>
    </span>
  );
}

export function costGroupText(groups?: Record<string, number>) {
  const entries = Object.entries(groups || {}).filter(([, value]) => Number(value || 0) !== 0);
  if (!entries.length) return "-";
  return entries.map(([label, value]) => `${label} ${formatCny(value)}`).join(" / ");
}
