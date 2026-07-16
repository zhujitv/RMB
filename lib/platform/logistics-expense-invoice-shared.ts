import { customerBusinessName, customerShortName, nonEmpty, normalizedCostType } from "./shared";
import { logisticsExpenseOrderSummary } from "./logistics-expense-access";
import { logisticsCostTypeLabel } from "./logistics-cost-types";
import { logisticsInvoiceGroupForExpense, logisticsInvoiceGroupsForExpenses } from "./logistics-invoice-groups";
import { summarizeCurrencyTotals, type CurrencyTotals } from "./currency-totals";

export type UnknownRecord = Record<string, unknown>;
export type LogisticsInvoiceActor = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
export type SupplierUserLike = { email?: string | null; isActive?: boolean | null } & UnknownRecord;
export type SupplierLike = {
  id?: string;
  supplierName?: string | null;
  email?: string | null;
  contactEmail?: string | null;
  financeEmail?: string | null;
  operatorUsers?: SupplierUserLike[];
} & UnknownRecord;
export type CostLike = {
  id?: string | null;
  costType?: string;
} & UnknownRecord;
export type LogisticsExpenseLike = {
  id?: string;
  orderId?: string;
  supplierId?: string;
  supplierNameSnapshot?: string | null;
  supplier?: SupplierLike | null;
  supplierEmail?: string | null;
  order?: UnknownRecord | null;
  cost?: CostLike | null;
  costId?: string | null;
  costType?: string;
  currency?: string | null;
  amount?: unknown;
  amountCny?: unknown;
  billingQuantity?: unknown;
  appliedContainerCount?: unknown;
  remark?: string | null;
} & UnknownRecord;
export type LogisticsBillSummary = {
  supplierId: string;
  supplierName: string;
  supplierEmail: string;
  supplier: SupplierLike | null;
  orderNo: string;
  blNo: string;
  containerSummary: string;
  customerShortName: string;
  amountCny: number;
  currencyTotals: CurrencyTotals;
  detailText: string;
  invoiceGroups: ReturnType<typeof logisticsInvoiceGroupsWithTotals>;
  remark: string;
  expenses: LogisticsExpenseLike[];
};
export type EmailCandidate = {
  key: string;
  label: string;
  field: string;
  value: string;
};
export type InvoiceRecipientResolution = {
  email: string;
  emails: string[];
  label: string;
  field: string;
  checkedFields: string[];
  checkedText: string;
  error: string;
};
export type InvoiceNotificationResult = {
  supplierId: string;
  supplierName: string;
  supplierEmail?: string;
  sent: boolean;
  skipped?: boolean;
  queued?: boolean;
  outboxId?: string;
  error: string;
  expenseIds: string[];
};
export type SupplierNotificationGroup = {
  supplierId: string;
  supplierName: string;
  supplierEmail: string;
  supplier: SupplierLike | null;
  bills: LogisticsBillSummary[];
  expenses: LogisticsExpenseLike[];
};

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

export function errorMessage(error: unknown, fallback = "") {
  return error instanceof Error ? error.message : fallback;
}

function logisticsExpenseCustomerShortName(expense: LogisticsExpenseLike = {}) {
  const order = expense.order || {};
  return customerShortName(order.customer) || customerBusinessName(order.customer, nonEmpty(order.customerNameSnapshot)) || "-";
}

function logisticsExpenseContainerSummaryText(expense: LogisticsExpenseLike = {}) {
  const orderSummary = logisticsExpenseOrderSummary(expense.order || {});
  const items = orderSummary.transportItems || [];
  const counts = new Map<string, number>();
  for (const item of items) {
    const type = String(item.containerType || "").trim().toUpperCase();
    if (!type) continue;
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  const typeText = [...counts.entries()].map(([type, count]) => `${type}×${count}`).join("，");
  if (typeText) return typeText;
  if (orderSummary.containerCount) return `${orderSummary.containerCount} 个柜`;
  return "未录入";
}

function logisticsExpenseDetailText(expenses: LogisticsExpenseLike[] = []) {
  return expenses.map((expense, index) => {
    const amount = Number(expense.amount || 0).toFixed(2);
    const quantity = expense.billingQuantity == null
      ? Number(expense.appliedContainerCount || 1)
      : Number(expense.billingQuantity || 1);
    const remark = expense.remark ? `，备注：${expense.remark}` : "";
    return `${index + 1}. ${logisticsCostTypeLabel(normalizedCostType(nonEmpty(expense.costType)))}，数量 ${quantity || 1}，${expense.currency || "CNY"} ${amount}${remark}`;
  }).join("\n");
}

export function logisticsInvoiceGroupsWithTotals(expenses: LogisticsExpenseLike[] = []) {
  return logisticsInvoiceGroupsForExpenses(expenses).map((group) => {
    const groupRows = expenses.filter((expense) => logisticsInvoiceGroupForExpense(expense)?.key === group.key);
    const includedFeeTypes = [...new Set(groupRows
      .map((row) => normalizedCostType(nonEmpty(row.costType)))
      .filter(Boolean))];
    return {
      ...group,
      includedFeeTypes,
      amountCny: groupRows.reduce((sum, row) => sum + Number(row.amountCny || 0), 0),
      currencyTotals: summarizeCurrencyTotals(groupRows),
      itemIds: groupRows.map((row) => row.id).filter(Boolean),
    };
  });
}

export function logisticsBillSummaryRows(expenses: LogisticsExpenseLike[] = []): LogisticsBillSummary[] {
  const groups = new Map<string, LogisticsExpenseLike[]>();
  for (const expense of expenses) {
    const order = expense.order || {};
    const orderSummary = logisticsExpenseOrderSummary(order);
    const key = [expense.supplierId || "", expense.orderId || "", orderSummary.blNo || orderSummary.billOfLadingNo || orderSummary.orderNo || ""].join("::");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(expense);
  }
  return [...groups.values()].map((rows) => {
    const first = rows[0] || {};
    const orderSummary = logisticsExpenseOrderSummary(first.order || {});
    return {
      supplierId: first.supplierId || "",
      supplierName: first.supplierNameSnapshot || first.supplier?.supplierName || "供应商",
      supplierEmail: first.supplierEmail || first.supplier?.email || "",
      supplier: first.supplier || null,
      orderNo: orderSummary.orderNo || "-",
      blNo: orderSummary.blNo || orderSummary.billOfLadingNo || "-",
      containerSummary: logisticsExpenseContainerSummaryText(first),
      customerShortName: logisticsExpenseCustomerShortName(first),
      amountCny: rows.reduce((sum, row) => sum + Number(row.amountCny || 0), 0),
      currencyTotals: summarizeCurrencyTotals(rows),
      detailText: logisticsExpenseDetailText(rows),
      invoiceGroups: logisticsInvoiceGroupsWithTotals(rows),
      remark: rows.map((row) => row.remark || "").filter(Boolean).join("；") || "-",
      expenses: rows,
    };
  });
}
