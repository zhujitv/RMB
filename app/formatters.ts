export function formatCny(value: unknown) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(value || 0));
}

export function formatAmount(value: unknown) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  HKD: "HK$",
};

export function currencySymbol(currency = "CNY") {
  const normalized = String(currency || "CNY").toUpperCase();
  return CURRENCY_SYMBOLS[normalized] || normalized;
}

export function formatCurrencyAmount(currency = "CNY", value: unknown) {
  const normalized = String(currency || "CNY").toUpperCase();
  return `${currencySymbol(normalized)} ${formatAmount(value)}`;
}

export function moneyText(currency = "CNY", amount: unknown, amountCny: unknown) {
  if (amount === "" || amount == null) return "-";
  const normalized = String(currency || "CNY").toUpperCase();
  if (normalized === "CNY") return `CNY：${formatCurrencyAmount("CNY", Number(amountCny || amount || 0))}`;
  return `${normalized}：${formatCurrencyAmount(normalized, amount)} / 折人民币：${formatCny(Number(amountCny || 0))}`;
}

export function formatPercent(value: unknown) {
  if (value == null || value === "") return "--";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${(numeric * 100).toFixed(2)}%`;
}

export function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("zh-CN");
}

export function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN");
}

export function yesNo(value: unknown) {
  return value ? "开启" : "关闭";
}
