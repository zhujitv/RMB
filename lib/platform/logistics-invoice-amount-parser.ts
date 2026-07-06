function cleanText(value: unknown) {
  return String(value || "").trim();
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function amountMatches(actual: number, expected: number) {
  return Math.abs(roundMoney(actual) - roundMoney(expected)) <= 0.01;
}

function moneyCandidate(value: unknown) {
  const text = String(value || "").replace(/[,，\s]/g, "");
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

export function extractLogisticsForeignCurrencyAmount(text: string, currency: string, expectedAmount = 0) {
  const normalizedCurrency = cleanText(currency).toUpperCase();
  if (!normalizedCurrency || normalizedCurrency === "CNY") return 0;
  const source = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ");
  const currencyTokens = normalizedCurrency === "USD"
    ? "(?:USD|US\\$|美元|美金|美金金额|美元金额)"
    : `(?:${normalizedCurrency})`;
  const amountPattern = "([0-9]{1,7}(?:[,，][0-9]{3})*(?:\\.[0-9]{1,2})?)(?![0-9])";
  const patterns = [
    new RegExp(`${currencyTokens}\\s*(?:金额|合计|费用|海运费|运费|FREIGHT|AMOUNT)?\\s*[:：]?\\s*${amountPattern}`, "gi"),
    new RegExp(`${amountPattern}\\s*(?:${normalizedCurrency === "USD" ? "USD|US\\$|美元|美金" : normalizedCurrency})`, "gi"),
  ];
  const candidates = patterns.flatMap((pattern) => Array.from(source.matchAll(pattern)).map((match) => moneyCandidate(match[1])))
    .filter((value) => value > 0 && value < 10_000_000);
  if (!candidates.length) return 0;
  const unique = Array.from(new Set(candidates));
  const expected = roundMoney(expectedAmount);
  const exact = unique.find((value) => expected > 0 && amountMatches(value, expected));
  if (exact) return exact;
  return unique[0] || 0;
}
