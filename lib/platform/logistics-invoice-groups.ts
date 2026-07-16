import { LOGISTICS_COST_TYPES } from "./logistics-cost-types";

export type LogisticsInvoiceGroupDefinition = {
  key: string;
  label: string;
  costTypes: string[];
};

export type LogisticsInvoiceGroupExpenseLike = {
  costType?: unknown;
  currency?: unknown;
};

export const OCEAN_FREIGHT_INVOICE_GROUP_KEY = "OCEAN_FREIGHT";
export const TRUCKING_OTHER_INVOICE_GROUP_KEY = "TRUCKING_OTHER";
export const TRUCKING_OTHER_USD_BLOCK_MESSAGE = "USD 不允许出现在拖车及其他费用合并发票";

export const LOGISTICS_INVOICE_GROUPS: LogisticsInvoiceGroupDefinition[] = [
  {
    key: "CUSTOMS",
    label: "报关费发票",
    costTypes: ["报关费"],
  },
  {
    key: "PORT_CHARGES",
    label: "港杂费发票",
    costTypes: ["港杂费"],
  },
  {
    key: OCEAN_FREIGHT_INVOICE_GROUP_KEY,
    label: "海运费发票",
    costTypes: ["海运费", "ENS", "保险费", "其他国际费用"],
  },
  {
    key: TRUCKING_OTHER_INVOICE_GROUP_KEY,
    label: "拖车及其他费用合并发票",
    costTypes: [
      "拖车费",
      "打单费",
      "进港费",
      "提箱费",
      "落箱费",
      "预提费",
      "查验费",
      "超重费",
      "其他本地费用",
      "其他物流费用",
    ],
  },
];

export type LogisticsInvoiceGroupKey = string;

function normalizedInvoiceCostType(costType: unknown) {
  const value = String(costType || "").trim();
  if (value === "ENS费") return "ENS";
  return value;
}

function normalizedInvoiceCurrency(currency: unknown) {
  return String(currency || "").trim().toUpperCase();
}

export function logisticsInvoiceGroupForKey(key: unknown) {
  const value = String(key || "").trim();
  return LOGISTICS_INVOICE_GROUPS.find((group) => group.key === value) || null;
}

export function logisticsInvoiceGroupForCostType(costType: unknown) {
  const normalized = normalizedInvoiceCostType(costType);
  return LOGISTICS_INVOICE_GROUPS.find((group) => group.costTypes.includes(normalized)) || null;
}

export function logisticsInvoiceGroupForExpense(expense: LogisticsInvoiceGroupExpenseLike = {}) {
  const currency = normalizedInvoiceCurrency(expense.currency);
  if (currency === "USD") {
    return logisticsInvoiceGroupForKey(OCEAN_FREIGHT_INVOICE_GROUP_KEY);
  }
  const normalizedCostType = normalizedInvoiceCostType(expense.costType);
  if (!normalizedCostType) return null;
  const configuredGroup = logisticsInvoiceGroupForCostType(normalizedCostType);
  if (configuredGroup) return configuredGroup;
  return !currency || currency === "CNY"
    ? logisticsInvoiceGroupForKey(TRUCKING_OTHER_INVOICE_GROUP_KEY)
    : null;
}

export function logisticsInvoiceExpenseMatchesGroup(expense: LogisticsInvoiceGroupExpenseLike = {}, group: LogisticsInvoiceGroupDefinition | null = null) {
  if (!group) return false;
  return logisticsInvoiceGroupForExpense(expense)?.key === group.key;
}

export function logisticsInvoiceGroupCurrencyViolation(expense: LogisticsInvoiceGroupExpenseLike = {}, group: LogisticsInvoiceGroupDefinition | null = null) {
  if (group?.key === TRUCKING_OTHER_INVOICE_GROUP_KEY && normalizedInvoiceCurrency(expense.currency) === "USD") {
    return TRUCKING_OTHER_USD_BLOCK_MESSAGE;
  }
  return "";
}

export function logisticsInvoiceGroupCurrencies(expenses: LogisticsInvoiceGroupExpenseLike[] = []) {
  return [...new Set(expenses.map((expense) => normalizedInvoiceCurrency(expense.currency || "CNY")).filter(Boolean))];
}

export function logisticsInvoiceGroupMixedCurrencyViolation(expenses: LogisticsInvoiceGroupExpenseLike[] = [], group: LogisticsInvoiceGroupDefinition | null = null) {
  const currencies = logisticsInvoiceGroupCurrencies(expenses);
  if (group && group.key !== OCEAN_FREIGHT_INVOICE_GROUP_KEY && currencies.length > 1) {
    return `${group.label}包含多个币种（${currencies.join(" / ")}），请按币种拆分发票后再上传。`;
  }
  return "";
}

export function logisticsInvoiceGroupsForCostTypes(costTypes: unknown[] = []) {
  const normalizedTypes = costTypes
    .map((item) => normalizedInvoiceCostType(item))
    .filter((item) => LOGISTICS_COST_TYPES.includes(item));
  return LOGISTICS_INVOICE_GROUPS.filter((group) => group.costTypes.some((costType) => normalizedTypes.includes(costType)));
}

export function logisticsInvoiceGroupsForExpenses(expenses: LogisticsInvoiceGroupExpenseLike[] = []) {
  const groupKeys = new Set(expenses
    .map((expense) => logisticsInvoiceGroupForExpense(expense)?.key || "")
    .filter(Boolean));
  return LOGISTICS_INVOICE_GROUPS.filter((group) => groupKeys.has(group.key));
}
