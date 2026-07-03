
import {
  logisticsCostTypeDefaultCurrency,
  logisticsCostTypeRequiresDeclarationScope,
} from "../../../lib/platform/logistics-cost-types";
import {
  CURRENCIES,
  COST_TYPES,
  DEFAULT_BILLING_METHOD,
  type LogisticsExpense,
  type LogisticsExpenseBatchCreateItem,
  type LogisticsExpenseBatchUpdateItem,
  type LogisticsExpenseCurrencySummary,
  type LogisticsExpenseDraft,
} from "./model";
import {
  addLogisticsCurrencyAmount,
  createLogisticsCurrencyAccumulator,
  finalizeLogisticsCurrencySummary,
  finiteNumber,
  logisticsExpenseDisplayCurrency,
  logisticsExpenseOriginalAmount,
  normalizeCurrencyCode,
} from "./shared-currency";
import {
  billingQuantityLegacyInteger,
  validBillingQuantity,
} from "./shared-order-helpers";

export function logisticsExpenseCurrencySummaryFromDrafts(
  items: LogisticsExpense[],
  drafts: Record<string, LogisticsExpenseDraft>,
): LogisticsExpenseCurrencySummary {
  return finalizeLogisticsCurrencySummary(
    items.reduce((summary, item) => {
      const draft = drafts[item.id];
      const currency = logisticsExpenseDisplayCurrency(item, draft);
      const originalAmount = logisticsExpenseDraftOriginalAmount(item, draft);
      const amountCny =
        originalAmount *
        finiteNumber(item.exchangeRate, currency === "CNY" ? 1 : 0);
      addLogisticsCurrencyAmount(summary, currency, originalAmount, amountCny);
      return summary;
    }, createLogisticsCurrencyAccumulator()),
  );
}

export function logisticsExpenseDraftOriginalAmount(
  expense: LogisticsExpense,
  draft?: LogisticsExpenseDraft,
) {
  if (
    !draft ||
    (!validLogisticsExpenseDraft(draft, expense.isTemporary) &&
      !draft.unitAmount.trim())
  ) {
    return logisticsExpenseOriginalAmount(expense);
  }
  return editableLineSubtotal(draft.unitAmount, draft.appliedContainerCount);
}

export function expenseUnitAmount(expense: LogisticsExpense) {
  const count = Number(expenseBillingQuantity(expense));
  const divisor = Number.isFinite(count) && count > 0 ? count : 1;
  return Number(expense.amount || 0) / divisor;
}

export function expenseBillingQuantity(expense: Partial<LogisticsExpense>) {
  const quantity = Number(
    expense.billingQuantity ?? expense.appliedContainerCount ?? 1,
  );
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

export function logisticsExpenseDraftFromItem(
  expense: Partial<LogisticsExpense>,
): LogisticsExpenseDraft {
  return {
    costType: expense.costType || "拖车费",
    billingMethod: DEFAULT_BILLING_METHOD,
    unitAmount: editableNumberText(
      expenseUnitAmount(expense as LogisticsExpense),
    ),
    appliedContainerCount: editableQuantityText(
      expenseBillingQuantity(expense),
    ),
    currency: normalizeCurrencyCode(
      expense.currency || logisticsCostTypeDefaultCurrency(expense.costType || "拖车费"),
    ),
    currencyTouched: false,
    remark: expense.remark || "",
  };
}

export function logisticsExpenseDraftsFromItems(items: LogisticsExpense[]) {
  return items.reduce<Record<string, LogisticsExpenseDraft>>((acc, item) => {
    if (item.id) acc[item.id] = logisticsExpenseDraftFromItem(item);
    return acc;
  }, {});
}

export function logisticsExpenseDraftSignature(expense: LogisticsExpense) {
  return [
    expense.id,
    expense.costType || "",
    expense.amount || 0,
    expense.amountCny || 0,
    expense.currency || "",
    expense.containerType || "",
    expense.appliedContainerCount || 1,
    expense.billingMethod || "",
    expense.billingQuantity || "",
    expense.exchangeRate || 1,
    expense.customsDeclarationId || "",
    expense.allocationMethod || "",
    expense.allocatedAmount ?? "",
    expense.remark || "",
  ].join(":");
}

export function logisticsExpenseDraftChanged(
  expense: LogisticsExpense,
  draft?: LogisticsExpenseDraft,
) {
  if (!draft) return false;
  const initial = logisticsExpenseDraftFromItem(expense);
  return (
    draft.costType !== initial.costType ||
    draft.unitAmount.trim() !== initial.unitAmount ||
    draft.appliedContainerCount !== initial.appliedContainerCount ||
    draft.currency !== initial.currency ||
    draft.remark !== initial.remark
  );
}

export function validLogisticsExpenseDraft(
  draft?: LogisticsExpenseDraft,
  isCreate = false,
  expense?: LogisticsExpense,
) {
  if (!draft) return false;
  if (!draft.costType || !COST_TYPES.includes(draft.costType)) return false;
  if (expense && !expense.customsDeclarationId && logisticsCostTypeRequiresDeclarationScope(draft.costType)) return false;
  if (!draft.currency || !CURRENCIES.includes(normalizeCurrencyCode(draft.currency)))
    return false;
  if (!draft.unitAmount.trim()) return false;
  const unitAmount = Number(draft.unitAmount);
  return (
    Number.isFinite(unitAmount) &&
    (isCreate ? unitAmount > 0 : unitAmount >= 0) &&
    validBillingQuantity(draft.appliedContainerCount)
  );
}

export function logisticsExpenseDraftPayload(
  expense: LogisticsExpense,
  draft?: LogisticsExpenseDraft,
): LogisticsExpenseBatchUpdateItem {
  const safeDraft = draft || logisticsExpenseDraftFromItem(expense);
  const currency = normalizeCurrencyCode(safeDraft.currency || expense.currency);
  const allocationMethod = expense.allocationMethod === "手工金额" ? "" : expense.allocationMethod;
  return {
    id: expense.id,
    ...(expense.customsDeclarationId ? { customsDeclarationId: expense.customsDeclarationId } : {}),
    ...(allocationMethod ? { allocationMethod } : {}),
    costType: safeDraft.costType,
    amount: Number(safeDraft.unitAmount),
    billingMethod: DEFAULT_BILLING_METHOD,
    billingQuantity: Number(safeDraft.appliedContainerCount),
    appliedContainerCount: billingQuantityLegacyInteger(
      safeDraft.appliedContainerCount,
    ),
    currency,
    exchangeRate: Number(expense.exchangeRate || 1),
    remark: safeDraft.remark.trim(),
  };
}

export function logisticsExpenseDraftCreatePayload(
  expense: LogisticsExpense,
  draft?: LogisticsExpenseDraft,
): LogisticsExpenseBatchCreateItem {
  const safeDraft = draft || logisticsExpenseDraftFromItem(expense);
  const currency = normalizeCurrencyCode(safeDraft.currency || expense.currency);
  const allocationMethod = expense.allocationMethod === "手工金额" ? "" : expense.allocationMethod;
  return {
    expenseType: safeDraft.costType,
    ...(expense.customsDeclarationId ? { customsDeclarationId: expense.customsDeclarationId } : {}),
    ...(allocationMethod ? { allocationMethod } : {}),
    amount: Number(safeDraft.unitAmount),
    billingMethod: DEFAULT_BILLING_METHOD,
    billingQuantity: Number(safeDraft.appliedContainerCount),
    appliedContainerCount: billingQuantityLegacyInteger(
      safeDraft.appliedContainerCount,
    ),
    currency,
    exchangeRate: Number(expense.exchangeRate || 1),
    remark: safeDraft.remark.trim(),
  };
}

export function logisticsExpenseDraftValidationMessage(
  expense: LogisticsExpense,
  draft: LogisticsExpenseDraft | undefined,
  index: number,
) {
  const lineNo = index + 1;
  if (!draft?.costType || !COST_TYPES.includes(draft.costType))
    return `第 ${lineNo} 行请选择费用类型`;
  if (!expense.customsDeclarationId && logisticsCostTypeRequiresDeclarationScope(draft.costType)) {
    return `第 ${lineNo} 行${draft.costType}属于单次报关费用，请在新增物流费用中选择具体报关批次后录入`;
  }
  if (!draft.currency || !CURRENCIES.includes(normalizeCurrencyCode(draft.currency)))
    return `第 ${lineNo} 行请选择币种`;
  if (!draft.unitAmount.trim()) return `第 ${lineNo} 行金额不能为空`;
  const unitAmount = Number(draft.unitAmount);
  if (!Number.isFinite(unitAmount) || unitAmount < 0)
    return `第 ${lineNo} 行金额必须大于或等于 0`;
  if (expense.isTemporary && unitAmount <= 0)
    return `第 ${lineNo} 行金额必须大于 0`;
  if (!validBillingQuantity(draft.appliedContainerCount))
    return `第 ${lineNo} 行适用数量必须为正整数`;
  return `第 ${lineNo} 行填写不完整`;
}

export function editableNumberText(value: unknown) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "";
  const rounded = Math.round(numeric * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function editableQuantityText(value: unknown) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric) || numeric <= 0) return "1";
  return String(Math.max(1, Math.round(numeric)));
}

export function editableLineSubtotal(
  unitAmount: string,
  appliedContainerCount: string,
) {
  const unitPrice = Number(unitAmount || 0);
  const count = Number(appliedContainerCount || 1);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return 0;
  return unitPrice * (Number.isFinite(count) && count > 0 ? count : 1);
}

export function createTemporaryLogisticsExpenseRow(
  expense: LogisticsExpense,
  items: LogisticsExpense[],
  index: number,
): LogisticsExpense {
  const base = items[0] || expense;
  const now = Date.now();
  return {
    id: `temp:${expense.id}:${now}:${index}`,
    isTemporary: true,
    orderId: expense.orderId || base.orderId,
    orderNo: expense.orderNo || base.orderNo,
    blNo:
      expense.blNo ||
      expense.billOfLadingNo ||
      base.blNo ||
      base.billOfLadingNo,
    billOfLadingNo:
      expense.billOfLadingNo ||
      expense.blNo ||
      base.billOfLadingNo ||
      base.blNo,
    customerName: expense.customerName || base.customerName,
    customerShortName: expense.customerShortName || base.customerShortName,
    supplierId: base.supplierId,
    supplierName: base.supplierName,
    customsDeclarationId: base.customsDeclarationId || "",
    allocationMethod: base.allocationMethod === "手工金额" ? "" : base.allocationMethod || "",
    allocatedAmount: null,
    costType: "拖车费",
    currency: logisticsCostTypeDefaultCurrency("拖车费"),
    exchangeRate: 1,
    amount: 0,
    amountCny: 0,
    appliedContainerCount: 1,
    billingMethod: DEFAULT_BILLING_METHOD,
    billingQuantity: 1,
    remark: "",
    auditStatus: ["草稿", "已驳回"].includes(base.auditStatus || "")
      ? base.auditStatus
      : "草稿",
    invoiceStatus: "未通知",
    paymentStatus: "待开票",
    order: expense.order || base.order,
  };
}
