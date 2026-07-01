
import { formatAmount } from "../../formatters";
import { logisticsCostTypeDefaultCurrency } from "../../../lib/platform/logistics-cost-types";
import {
  FOREIGN_CURRENCY_ORDER,
  type ExpenseItemForm,
  type LogisticsExpense,
  type LogisticsExpenseCurrencySummary,
  type LogisticsExpenseDraft,
  type LogisticsStatementRow,
} from "./model";

export function lineSubtotal(item: ExpenseItemForm) {
  const unitPrice = Number(item.amount || 0);
  const quantity = Number(item.appliedContainerCount || 1);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return 0;
  return unitPrice * (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
}

export function logisticsExpenseFormCurrencySummary(
  items: ExpenseItemForm[],
): LogisticsExpenseCurrencySummary {
  return finalizeLogisticsCurrencySummary(
    items.reduce((summary, item) => {
      const currency = normalizeCurrencyCode(item.currency);
      const amount = lineSubtotal(item);
      const exchangeRate = finiteNumber(
        item.exchangeRate,
        currency === "CNY" ? 1 : 0,
      );
      addLogisticsCurrencyAmount(
        summary,
        currency,
        amount,
        amount * exchangeRate,
      );
      return summary;
    }, createLogisticsCurrencyAccumulator()),
  );
}

export function formatCnyAccounting(value: unknown) {
  return `¥ ${formatAmount(value)}`;
}

export const LOGISTICS_CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  HKD: "HK$",
};

export function formatOriginalCurrencyAccounting(
  currency: string,
  value: unknown,
) {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "CNY") return formatCnyAccounting(value);
  const symbol = LOGISTICS_CURRENCY_SYMBOLS[normalized] || normalized;
  return `${normalized} ${symbol}${formatAmount(value)}`;
}

export function formatOriginalCurrencyValue(currency: string, value: unknown) {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "CNY") return formatCnyAccounting(value);
  const symbol = LOGISTICS_CURRENCY_SYMBOLS[normalized] || normalized;
  return `${symbol}${formatAmount(value)}`;
}

export function currencySummaryFromSingleExpense(
  expense: LogisticsExpense,
): LogisticsExpenseCurrencySummary {
  const currency = normalizeCurrencyCode(expense.currency);
  const amount = logisticsExpenseOriginalAmount(expense);
  const amountCny = logisticsExpenseAmountCny(expense, amount, currency);
  const accumulator = createLogisticsCurrencyAccumulator();
  addLogisticsCurrencyAmount(accumulator, currency, amount, amountCny);
  return finalizeLogisticsCurrencySummary(accumulator);
}

export function logisticsExpenseCurrencySummaryFromItems(
  items: LogisticsExpense[],
): LogisticsExpenseCurrencySummary {
  return finalizeLogisticsCurrencySummary(
    items.reduce((summary, item) => {
      const currency = normalizeCurrencyCode(item.currency);
      const originalAmount = logisticsExpenseOriginalAmount(item);
      const amountCny = logisticsExpenseAmountCny(
        item,
        originalAmount,
        currency,
      );
      addLogisticsCurrencyAmount(summary, currency, originalAmount, amountCny);
      return summary;
    }, createLogisticsCurrencyAccumulator()),
  );
}

export function emptyLogisticsCurrencySummary(): LogisticsExpenseCurrencySummary {
  return { cnyActual: 0, foreignTotals: [], totalCny: 0 };
}

export function logisticsCurrencySummaryIsZero(
  summary?: LogisticsExpenseCurrencySummary | null,
) {
  if (!summary) return true;
  return (
    Math.abs(Number(summary.cnyActual || 0)) < 0.000001 &&
    !(summary.foreignTotals || []).some(
      (item) => Math.abs(Number(item.amount || 0)) >= 0.000001,
    )
  );
}

export function mergeLogisticsCurrencySummaries(
  left: LogisticsExpenseCurrencySummary = emptyLogisticsCurrencySummary(),
  right: LogisticsExpenseCurrencySummary = emptyLogisticsCurrencySummary(),
): LogisticsExpenseCurrencySummary {
  const accumulator = createLogisticsCurrencyAccumulator();
  addLogisticsCurrencyAmount(
    accumulator,
    "CNY",
    left.cnyActual,
    left.cnyActual,
  );
  for (const item of left.foreignTotals || [])
    addLogisticsCurrencyAmount(accumulator, item.currency, item.amount, 0);
  addLogisticsCurrencyAmount(
    accumulator,
    "CNY",
    right.cnyActual,
    right.cnyActual,
  );
  for (const item of right.foreignTotals || [])
    addLogisticsCurrencyAmount(accumulator, item.currency, item.amount, 0);
  return finalizeLogisticsCurrencySummary(accumulator);
}

export function logisticsCurrencySummaryPlainText(
  summary?: LogisticsExpenseCurrencySummary | null,
) {
  const safeSummary = summary || emptyLogisticsCurrencySummary();
  const lines: string[] = [];
  if (
    Math.abs(Number(safeSummary.cnyActual || 0)) > 0.000001 ||
    !(safeSummary.foreignTotals || []).length
  ) {
    lines.push(
      `CNY：${formatOriginalCurrencyAccounting("CNY", safeSummary.cnyActual)}`,
    );
  }
  for (const item of safeSummary.foreignTotals || []) {
    lines.push(
      `${item.currency}：${formatOriginalCurrencyAccounting(item.currency, item.amount)}`,
    );
  }
  return lines.join(" / ");
}

export function statementRowSummary(
  row: LogisticsStatementRow,
  key: "approved" | "pendingPayment" | "paid",
): LogisticsExpenseCurrencySummary {
  const summary =
    key === "approved"
      ? row.approvedCurrencyTotals
      : key === "pendingPayment"
        ? row.pendingPaymentCurrencyTotals
        : row.paidCurrencyTotals;
  if (summary) return summary;
  const fallback =
    key === "approved"
      ? row.approvedAmountCny
      : key === "pendingPayment"
        ? row.pendingPaymentAmountCny
        : row.paidAmountCny;
  return {
    cnyActual: Number(fallback || 0),
    foreignTotals: [],
    totalCny: Number(fallback || 0),
  };
}

export function createLogisticsCurrencyAccumulator() {
  return {
    cnyActual: 0,
    foreignTotals: new Map<string, number>(),
    totalCny: 0,
  };
}

export function addLogisticsCurrencyAmount(
  summary: ReturnType<typeof createLogisticsCurrencyAccumulator>,
  currency: string,
  originalAmount: number,
  amountCny: number,
) {
  if (currency === "CNY") {
    summary.cnyActual += originalAmount;
  } else {
    summary.foreignTotals.set(
      currency,
      (summary.foreignTotals.get(currency) || 0) + originalAmount,
    );
  }
  summary.totalCny += amountCny;
}

export function finalizeLogisticsCurrencySummary(
  summary: ReturnType<typeof createLogisticsCurrencyAccumulator>,
): LogisticsExpenseCurrencySummary {
  return {
    cnyActual: roundCurrencyTotal(summary.cnyActual),
    foreignTotals: [...summary.foreignTotals.entries()]
      .map(([currency, amount]) => ({
        currency,
        amount: roundCurrencyTotal(amount),
      }))
      .filter((item) => Math.abs(item.amount) > 0.000001)
      .sort(
        (left, right) =>
          logisticsCurrencyOrder(left.currency) -
            logisticsCurrencyOrder(right.currency) ||
          left.currency.localeCompare(right.currency),
      ),
    totalCny: roundCurrencyTotal(summary.totalCny),
  };
}

export function logisticsCurrencyOrder(currency: string) {
  const index = FOREIGN_CURRENCY_ORDER.indexOf(currency);
  return index >= 0 ? index : FOREIGN_CURRENCY_ORDER.length;
}

export function logisticsExpenseOriginalAmount(expense: LogisticsExpense) {
  const amount = finiteNumberOrNull(expense.amount);
  if (amount !== null) return amount;
  const amountCny = finiteNumber(expense.amountCny, 0);
  const currency = normalizeCurrencyCode(expense.currency);
  const exchangeRate = finiteNumber(
    expense.exchangeRate,
    currency === "CNY" ? 1 : 0,
  );
  if (currency === "CNY" || exchangeRate <= 0) return amountCny;
  return amountCny / exchangeRate;
}

export function logisticsExpenseDisplayCurrency(
  expense: LogisticsExpense,
  draft?: LogisticsExpenseDraft,
) {
  const costType = draft?.costType || expense.costType || "";
  if (logisticsCostTypeDefaultCurrency(costType) === "USD") return "USD";
  return normalizeCurrencyCode(expense.currency);
}

export function logisticsExpenseAmountCny(
  expense: LogisticsExpense,
  originalAmount: number,
  currency: string,
) {
  const amountCny = finiteNumberOrNull(expense.amountCny);
  if (amountCny !== null) return amountCny;
  return (
    originalAmount *
    finiteNumber(expense.exchangeRate, currency === "CNY" ? 1 : 0)
  );
}

export function normalizeCurrencyCode(value: unknown) {
  const currency = String(value || "CNY")
    .trim()
    .toUpperCase();
  return currency || "CNY";
}

export function finiteNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function finiteNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function roundCurrencyTotal(value: number) {
  return Math.round(value * 100) / 100;
}
