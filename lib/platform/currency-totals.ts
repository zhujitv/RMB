export type CurrencyTotalInput = {
  currency?: unknown;
  amount?: unknown;
  amountCny?: unknown;
};

export type ForeignCurrencyTotal = {
  currency: string;
  amount: number;
};

export type CurrencyTotals = {
  cnyActual: number;
  foreignTotals: ForeignCurrencyTotal[];
  totalCny: number;
};

const FOREIGN_CURRENCY_PRIORITY = ["USD", "EUR", "HKD", "GBP"];

function numberValue(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizeCurrencyCode(currency?: unknown) {
  return String(currency || "CNY").trim().toUpperCase() || "CNY";
}

export function emptyCurrencyTotals(): CurrencyTotals {
  return { cnyActual: 0, foreignTotals: [], totalCny: 0 };
}

export function summarizeCurrencyTotals(rows: CurrencyTotalInput[] = []): CurrencyTotals {
  const foreignMap = new Map<string, number>();
  let cnyActual = 0;
  let totalCny = 0;

  rows.forEach((row) => {
    const currency = normalizeCurrencyCode(row.currency);
    const amount = numberValue(row.amount);
    const amountCny = numberValue(row.amountCny ?? (currency === "CNY" ? amount : 0));

    if (currency === "CNY") {
      cnyActual += amount;
    } else {
      foreignMap.set(currency, (foreignMap.get(currency) || 0) + amount);
    }
    totalCny += amountCny;
  });

  const foreignTotals = Array.from(foreignMap.entries())
    .map(([currency, amount]) => ({ currency, amount: roundMoney(amount) }))
    .sort((a, b) => {
      const aIndex = FOREIGN_CURRENCY_PRIORITY.indexOf(a.currency);
      const bIndex = FOREIGN_CURRENCY_PRIORITY.indexOf(b.currency);
      const aRank = aIndex === -1 ? FOREIGN_CURRENCY_PRIORITY.length : aIndex;
      const bRank = bIndex === -1 ? FOREIGN_CURRENCY_PRIORITY.length : bIndex;
      return aRank - bRank || a.currency.localeCompare(b.currency);
    });

  return {
    cnyActual: roundMoney(cnyActual),
    foreignTotals,
    totalCny: roundMoney(totalCny),
  };
}
