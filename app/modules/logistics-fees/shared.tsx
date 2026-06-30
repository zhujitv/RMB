import styles from "../../WorkspaceShell.module.css";
import { formatAmount } from "../../formatters";
import { customerDisplayName } from "../../utils";
import {
  canReviewLogisticsBill,
  canSubmitLogisticsBill,
  logisticsBillDefaultTab,
  logisticsBillDeleteBlockReason,
  logisticsBillEditBlockReason,
  logisticsBillPayState,
} from "../../../lib/platform/logistics-bill-state-machine";
import {
  logisticsCostTypeDefaultCurrency,
  logisticsCostTypeLabel,
} from "../../../lib/platform/logistics-cost-types";
import {
  logisticsInvoiceGroupForExpense,
  logisticsInvoiceGroupsForExpenses,
} from "../../../lib/platform/logistics-invoice-groups";
import {
  COST_TYPES,
  DEFAULT_BILLING_METHOD,
  FOREIGN_CURRENCY_ORDER,
  LOGISTICS_EXPENSE_BILL_SORT_PRIORITY,
  LOGISTICS_FEE_SUPPLIER_TYPES,
  PAY_BUTTON_RULE,
  type ExpenseItemForm,
  type ExpenseOrderOption,
  type LogisticsExpense,
  type LogisticsExpenseBatchCreateItem,
  type LogisticsExpenseBatchUpdateItem,
  type LogisticsExpenseContainerSummary,
  type LogisticsExpenseCurrencySummary,
  type LogisticsExpenseDraft,
  type LogisticsExpenseReviewResult,
  type LogisticsExpenseMutationResult,
  type LogisticsInvoiceGroupSummary,
  type LogisticsStatementRow,
  type SupplierOption,
} from "./model";

export function SupplierSectionComponent({
  rows,
  loading,
}: {
  rows: LogisticsStatementRow[];
  loading: boolean;
}) {
  if (!rows.length) {
    return (
      <p className={styles.mutedText}>
        {loading ? "月结汇总加载中..." : "当前月份暂无已审核物流费用。"}
      </p>
    );
  }
  return (
    <div className={styles.statementList}>
      {rows.map((row) => (
        <div
          key={row.supplierId || row.supplierName || "-"}
          className={styles.statementRow}
        >
          <strong>{row.supplierName || "-"}</strong>
          <span>{row.orderCount || 0} 票</span>
          <span>供应商明细</span>
          <span>金额以上方月结汇总为准</span>
        </div>
      ))}
    </div>
  );
}

export function StatusPill({ value }: { value: string }) {
  let tone = styles.statusMuted;
  if (["审核通过", "已确认", "已付款", "已上传", "已上传发票"].includes(value))
    tone = styles.statusSuccess;
  if (
    ["待审核", "未通知", "已通知开票", "待付款", "待开票", "草稿"].includes(
      value,
    ) ||
    value.startsWith("部分")
  )
    tone = styles.statusWarning;
  if (
    [
      "已驳回",
      "已退回",
      "已取消",
      "部分驳回",
      "通知失败",
      "待开票 / 通知失败",
    ].includes(value)
  )
    tone = styles.statusDanger;
  return <span className={`${styles.statusPill} ${tone}`}>{value || "-"}</span>;
}

export function normalizeExpenseOrder(
  order: Partial<ExpenseOrderOption>,
): ExpenseOrderOption {
  const id = order.orderId || order.id || "";
  const transportItems = Array.isArray(order.transportItems)
    ? order.transportItems
    : [];
  const containerNos = Array.isArray(order.containerNos)
    ? order.containerNos.filter(Boolean)
    : transportItems.map((item) => item.containerNo || "").filter(Boolean);
  const containerTypes = uniqueContainerTypes([
    order.containerType,
    ...(order.containerTypes || []),
    ...transportItems.map((item) => item.containerType),
  ]);
  return {
    ...order,
    id,
    orderId: id,
    transportItems,
    containerNos,
    containerTypes,
    containerType:
      order.containerType ||
      (containerTypes.length === 1 ? containerTypes[0] : ""),
    containerCount: Number(
      order.containerCount || containerNos.length || transportItems.length || 0,
    ),
    logisticsSuppliers: filterLogisticsFeeSuppliers(
      order.logisticsSuppliers || [],
    ),
  };
}

export function mergeOrders(
  current: ExpenseOrderOption[],
  next: ExpenseOrderOption[],
) {
  const merged = [...current];
  for (const order of next.map((item) => normalizeExpenseOrder(item))) {
    if (order.id && !merged.some((item) => item.id === order.id))
      merged.push(order);
  }
  return merged;
}

export function mergeSuppliers(
  current: SupplierOption[],
  next: SupplierOption[],
) {
  const merged = filterLogisticsFeeSuppliers(current);
  for (const supplier of filterLogisticsFeeSuppliers(next)) {
    if (supplier.id && !merged.some((item) => item.id === supplier.id))
      merged.push(supplier);
  }
  return merged;
}

export function orderLabel(order: ExpenseOrderOption) {
  const customer = customerDisplayName(order);
  const blNo = order.blNo || order.billOfLadingNo;
  return `${order.orderNo || "未编号"} / ${customer}${blNo ? ` / ${blNo}` : ""}`;
}

export function supplierLabel(supplier: SupplierOption) {
  const name = supplier.supplierName || supplier.name || "未命名供应商";
  return supplier.supplierType ? `${name} / ${supplier.supplierType}` : name;
}

export function filterLogisticsFeeSuppliers(suppliers: SupplierOption[]) {
  return suppliers.filter((supplier) =>
    LOGISTICS_FEE_SUPPLIER_TYPES.includes(supplier.supplierType || ""),
  );
}

export function allowedCostTypeOptions(
  supplier: SupplierOption | null,
  shouldRestrict: boolean,
) {
  if (!shouldRestrict) return COST_TYPES;
  const allowed =
    supplier?.allowedLogisticsCostTypes?.filter((type) =>
      COST_TYPES.includes(type),
    ) || [];
  return allowed.length ? allowed : COST_TYPES;
}

export function normalizeExpenseItemCostType(
  item: ExpenseItemForm,
  options: string[],
) {
  if (!options.length || options.includes(item.costType)) return item;
  return { ...item, costType: options[0] || item.costType };
}

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

export function validBillingQuantity(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return false;
  return Number.isInteger(numeric);
}

export function billingQuantityLegacyInteger(value: unknown) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return Math.max(1, Math.ceil(numeric));
}

export function normalizeContainerType(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function uniqueContainerTypes(values: unknown[]) {
  return values
    .map(normalizeContainerType)
    .filter(
      (value, index, arr) => Boolean(value) && arr.indexOf(value) === index,
    );
}

export function uniqueTextValues(values: unknown[]) {
  return values
    .map((value) => String(value || "").trim())
    .filter(
      (value, index, arr) => Boolean(value) && arr.indexOf(value) === index,
    );
}

export function logisticsExpenseContainerSummary(
  expense: Partial<LogisticsExpense>,
  items: LogisticsExpense[] = [],
): LogisticsExpenseContainerSummary {
  const rows = [expense, ...(items.length ? items : [])];
  const seenTransportItems = new Set<string>();
  const transportItems: Array<{ containerNo: string; containerType: string }> =
    [];
  const fallbackNos: string[] = [];
  const fallbackTypes: unknown[] = [];
  let fallbackCount = 0;

  for (const row of rows) {
    const order = row.order || {};
    const orderTransportItems = Array.isArray(order.transportItems)
      ? order.transportItems
      : [];
    fallbackNos.push(...(order.containerNos || []));
    fallbackTypes.push(order.containerType, ...(order.containerTypes || []));
    fallbackCount = Math.max(fallbackCount, Number(order.containerCount || 0));
    for (const item of orderTransportItems) {
      const containerNo = String(item.containerNo || "").trim();
      const containerType = normalizeContainerType(item.containerType);
      const key =
        item.id ||
        `${containerNo}|${containerType}|${String(item.sealNo || "").trim()}`;
      if ((!containerNo && !containerType) || seenTransportItems.has(key))
        continue;
      seenTransportItems.add(key);
      transportItems.push({ containerNo, containerType });
    }
  }

  const typeCounts = new Map<string, number>();
  if (transportItems.length) {
    for (const item of transportItems) {
      if (!item.containerType) continue;
      typeCounts.set(
        item.containerType,
        (typeCounts.get(item.containerType) || 0) + 1,
      );
    }
  } else {
    const types = uniqueContainerTypes(fallbackTypes);
    const nos = uniqueTextValues(fallbackNos);
    if (types.length === 1) {
      typeCounts.set(types[0], nos.length || fallbackCount || 1);
    } else {
      for (const type of types) typeCounts.set(type, 0);
    }
  }

  const typeLines = [...typeCounts.entries()].map(([type, count]) =>
    count > 0 ? `${type} × ${count}` : type,
  );
  const containerNoLines = transportItems.length
    ? uniqueTextValues(transportItems.map((item) => item.containerNo))
    : uniqueTextValues(fallbackNos);
  const hasContainers = Boolean(typeLines.length || containerNoLines.length);
  return {
    hasContainers,
    typeLines,
    containerNoLines,
    shortText:
      hasContainers && typeLines.length
        ? typeLines.map((line) => line.replace(/\s×\s/g, "×")).join(" / ")
        : "未录入",
  };
}

export function containerSummaryText(order?: ExpenseOrderOption | null) {
  const count = Number(order?.containerCount || 0);
  if (!count) return "未录入集装箱明细";
  const nos = order?.containerNos?.length
    ? `：${order.containerNos.join(" / ")}`
    : "";
  return `${count} 个柜${nos}`;
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

const MONTHLY_SUMMARY_STATUS_ROWS: Array<{
  key: "approved" | "pendingPayment" | "paid";
  label: string;
}> = [
  { key: "approved", label: "应付总额" },
  { key: "pendingPayment", label: "待付款" },
  { key: "paid", label: "已付款" },
];

export function MonthlySummaryComponent({
  rows,
}: {
  rows: LogisticsStatementRow[];
}) {
  const monthlySummary = buildMonthlySummary(rows);
  return (
    <div className={styles.monthlySummaryCard}>
      <table className={styles.monthlySummaryTable}>
        <thead>
          <tr>
            <th>状态</th>
            {monthlySummary.currencies.map((currency) => (
              <th key={currency}>{currency} 合计</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthlySummary.statusRows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              {monthlySummary.currencies.map((currency) => (
                <td key={`${row.key}-${currency}`}>
                  {formatOriginalCurrencyValue(
                    currency,
                    row.amounts[currency] || 0,
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function buildMonthlySummary(rows: LogisticsStatementRow[]) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.approved = mergeLogisticsCurrencySummaries(
        acc.approved,
        statementRowSummary(row, "approved"),
      );
      acc.pendingPayment = mergeLogisticsCurrencySummaries(
        acc.pendingPayment,
        statementRowSummary(row, "pendingPayment"),
      );
      acc.paid = mergeLogisticsCurrencySummaries(
        acc.paid,
        statementRowSummary(row, "paid"),
      );
      return acc;
    },
    {
      approved: emptyLogisticsCurrencySummary(),
      pendingPayment: emptyLogisticsCurrencySummary(),
      paid: emptyLogisticsCurrencySummary(),
    },
  );
  const currencies = monthlySummaryCurrencies(Object.values(totals));
  const statusRows = MONTHLY_SUMMARY_STATUS_ROWS.map((item) => ({
    ...item,
    amounts: monthlySummaryAmountsByCurrency(totals[item.key], currencies),
  }));
  return { currencies, statusRows };
}

export function monthlySummaryCurrencies(
  summaries: LogisticsExpenseCurrencySummary[],
) {
  const currencies = new Set<string>();
  for (const summary of summaries) {
    if (Math.abs(Number(summary.cnyActual || 0)) > 0.000001)
      currencies.add("CNY");
    for (const item of summary.foreignTotals || [])
      currencies.add(item.currency);
  }
  if (!currencies.size) currencies.add("CNY");
  return [...currencies].sort(
    (left, right) =>
      logisticsCurrencyOrder(left) - logisticsCurrencyOrder(right) ||
      left.localeCompare(right),
  );
}

export function monthlySummaryAmountsByCurrency(
  summary: LogisticsExpenseCurrencySummary,
  currencies: string[],
) {
  const amounts: Record<string, number> = {};
  for (const currency of currencies) {
    amounts[currency] =
      currency === "CNY"
        ? Number(summary.cnyActual || 0)
        : Number(
            (summary.foreignTotals || []).find(
              (item) => item.currency === currency,
            )?.amount || 0,
          );
  }
  return amounts;
}

export function logisticsCurrencyAmountByCode(
  summary: LogisticsExpenseCurrencySummary,
  currency: string,
) {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "CNY") return Number(summary.cnyActual || 0);
  return Number(
    (summary.foreignTotals || []).find((item) => item.currency === normalized)
      ?.amount || 0,
  );
}

export function LogisticsCurrencyAmountList({
  summary,
  compact = false,
}: {
  summary: LogisticsExpenseCurrencySummary;
  compact?: boolean;
}) {
  return (
    <div
      className={`${styles.logisticsCurrencySummary} ${compact ? styles.logisticsCurrencySummaryCompact : ""}`}
    >
      {Math.abs(summary.cnyActual) > 0.000001 ||
      !summary.foreignTotals.length ? (
        <div className={styles.logisticsCurrencySummaryRow}>
          <span>CNY：</span>
          <strong>
            {formatOriginalCurrencyValue("CNY", summary.cnyActual)}
          </strong>
        </div>
      ) : null}
      {summary.foreignTotals.map((item) => (
        <div className={styles.logisticsCurrencySummaryRow} key={item.currency}>
          <span>{item.currency}：</span>
          <strong>
            {formatOriginalCurrencyValue(item.currency, item.amount)}
          </strong>
        </div>
      ))}
    </div>
  );
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

export function compactStatusLabel(
  value: unknown,
  type: "audit" | "invoice" | "payment",
) {
  const text = String(value || "").trim();
  if (!text || text === "-") {
    if (type === "audit") return "草稿";
    if (type === "invoice") return "待开票";
    return "待付款";
  }
  if (type === "audit") {
    if (text.includes("待审核")) return "待审核";
    if (text.includes("审核通过")) return "审核通过";
    if (text.includes("驳回")) return "已驳回";
    return "草稿";
  }
  if (type === "invoice") {
    if (text.includes("通知失败")) return "通知失败";
    if (text.includes("部分")) return "部分上传";
    if (text.includes("已确认") || text.includes("已上传")) return "已上传";
    return "待开票";
  }
  if (text.includes("已付款")) return "已付款";
  if (text.includes("部分")) return "部分付款";
  return "待付款";
}

export function logisticsExpensePayButtonState(expense: LogisticsExpense) {
  const items = logisticsExpenseBillItems(expense);
  const auditStatus = compactStatusLabel(
    logisticsExpenseBillAuditStatusFromRow(expense),
    "audit",
  );
  const invoiceStatus = normalizePayButtonInvoiceStatus([
    logisticsExpenseBillInvoiceStatusFromRow(expense),
    expense.billInvoiceStatus,
    expense.invoiceStatus,
    ...items.flatMap((item) => [
      item.billInvoiceStatus,
      item.invoiceStatus,
      item.detailInvoiceStatus,
    ]),
  ]);
  const paymentStatus = compactStatusLabel(
    logisticsExpenseBillPaymentStatusFromRow(expense),
    "payment",
  );
  return {
    ...logisticsBillPayState({ auditStatus, invoiceStatus, paymentStatus }),
    rule: PAY_BUTTON_RULE,
  };
}

export function normalizePayButtonInvoiceStatus(values: unknown[]) {
  const statuses = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (
    statuses.some(
      (status) =>
        status.includes("已上传发票") ||
        status === "已上传" ||
        status.includes("已确认"),
    )
  ) {
    return "已上传发票";
  }
  if (statuses.some((status) => status.includes("部分"))) return "未上传发票";
  return "未上传发票";
}

export function logisticsExpenseLineContainerType(expense: LogisticsExpense) {
  const types = uniqueContainerTypes([
    expense.containerType,
    expense.order?.containerType,
    ...(expense.order?.containerTypes || []),
    ...(expense.order?.transportItems || []).map((item) => item.containerType),
  ]);
  if (!types.length) return "-";
  return types.length === 1 ? types[0] : types.join(" / ");
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
    expense.containerType || "",
    expense.appliedContainerCount || 1,
    expense.billingMethod || "",
    expense.billingQuantity || "",
    expense.exchangeRate || 1,
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
    draft.remark !== initial.remark
  );
}

export function validLogisticsExpenseDraft(
  draft?: LogisticsExpenseDraft,
  isCreate = false,
) {
  if (!draft) return false;
  if (!draft.costType || !COST_TYPES.includes(draft.costType)) return false;
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
  const currency =
    logisticsCostTypeDefaultCurrency(safeDraft.costType) === "USD"
      ? "USD"
      : expense.currency || "CNY";
  return {
    id: expense.id,
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
  const currency =
    logisticsCostTypeDefaultCurrency(safeDraft.costType) === "USD"
      ? "USD"
      : expense.currency || "CNY";
  return {
    expenseType: safeDraft.costType,
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
    costType: "拖车费",
    currency: base.currency || "CNY",
    exchangeRate: Number(base.exchangeRate || 1),
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

export function aggregateClientLogisticsExpenseStatus(
  items: LogisticsExpense[],
  field: keyof LogisticsExpense,
) {
  if (field === "auditStatus") return logisticsExpenseBillAuditStatus(items);
  if (field === "invoiceStatus") {
    const billValues = items
      .map(logisticsExpenseBillInvoiceStatusFromRow)
      .filter(Boolean);
    if (billValues.length)
      return aggregateClientStatusValues(billValues, field);
  }
  if (field === "paymentStatus") {
    const billValues = items
      .map(logisticsExpenseBillPaymentStatusFromRow)
      .filter(Boolean);
    if (billValues.length)
      return aggregateClientStatusValues(billValues, field);
  }
  return aggregateClientStatusValues(
    items
      .map((item) => item[field])
      .filter(Boolean)
      .map(String),
    field,
  );
}

export function aggregateClientStatusValues(
  values: string[] = [],
  field: keyof LogisticsExpense | "invoiceStatus" | "paymentStatus",
) {
  const unique = [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ];
  if (!unique.length) return "-";
  if (unique.length === 1) return unique[0];
  if (field === "invoiceStatus") {
    if (unique.includes("已上传")) return "部分已上传";
    if (unique.includes("已上传发票")) return "部分上传发票";
    if (unique.includes("已确认")) return "部分已确认";
    if (unique.includes("已确认发票")) return "部分已确认";
    if (unique.includes("已通知开票")) return "部分已通知";
    if (unique.includes("未通知")) return "部分未通知";
  }
  if (field === "paymentStatus") {
    if (unique.includes("已付款")) return "部分已付款";
    if (unique.includes("待付款")) return "部分待付款";
    if (unique.includes("已开票")) return "部分已开票";
    if (unique.includes("待开票")) return "部分待开票";
  }
  return "混合状态";
}

export function logisticsInvoiceGroupsForBill(
  items: LogisticsExpense[],
): LogisticsInvoiceGroupSummary[] {
  return logisticsInvoiceGroupsForExpenses(items).map((group) => {
    const groupItems = items.filter(
      (item) => logisticsInvoiceGroupForExpense(item)?.key === group.key,
    );
    const includedFeeTypes = [...new Set(groupItems
      .map((item) => String(item.costType || "").trim())
      .filter(Boolean))];
    const uploaded =
      groupItems.length > 0 &&
      groupItems.every((item) =>
        ["已上传", "已确认"].includes(
          logisticsExpenseDetailInvoiceStatus(item),
        ),
      );
    const confirmed =
      groupItems.length > 0 &&
      groupItems.every(
        (item) => logisticsExpenseDetailInvoiceStatus(item) === "已确认",
      );
    const failed = groupItems.some(
      (item) => logisticsExpenseDetailInvoiceStatus(item) === "通知失败",
    );
    const notified = groupItems.some(
      (item) => logisticsExpenseDetailInvoiceStatus(item) === "已通知开票",
    );
    return {
      key: group.key,
      label: group.label,
      costTypes: group.costTypes,
      includedFeeTypes,
      amountCny: groupItems.reduce(
        (sum, item) => sum + Number(item.amountCny || 0),
        0,
      ),
      currencyTotals: logisticsExpenseCurrencySummaryFromItems(groupItems),
      itemIds: groupItems.map((item) => item.id).filter(Boolean),
      status: confirmed
        ? "已确认"
        : uploaded
          ? "已上传"
          : failed
            ? "通知失败"
            : notified
              ? "已通知开票"
              : "待开票",
      uploaded,
      confirmed,
      failed,
      notified,
      invoiceDocumentId:
        groupItems.find((item) => item.invoiceDocumentId)?.invoiceDocumentId ||
        "",
      invoiceNotificationError:
        groupItems
          .map((item) => item.invoiceNotificationError || "")
          .find(Boolean) || "",
    };
  });
}

export function aggregateClientLogisticsInvoiceStatus(
  items: LogisticsExpense[],
) {
  const groups = logisticsInvoiceGroupsForBill(items);
  if (!groups.length)
    return aggregateClientLogisticsExpenseStatus(items, "invoiceStatus");
  if (groups.every((group) => group.confirmed)) return "已确认";
  if (groups.every((group) => group.uploaded || group.confirmed))
    return "已上传发票";
  if (groups.some((group) => group.uploaded || group.confirmed))
    return "部分上传发票";
  if (groups.some((group) => group.failed)) return "待开票 / 通知失败";
  return "待开票";
}

export function logisticsExpenseBillAuditStatusFromRow(
  expense: LogisticsExpense,
) {
  return String(expense.auditStatus || "草稿").trim() || "草稿";
}

export function logisticsExpenseBillInvoiceStatusFromRow(
  expense: LogisticsExpense,
) {
  return (
    String(
      expense.invoiceStatus || expense.billInvoiceStatus || "待开票",
    ).trim() || "待开票"
  );
}

export function logisticsExpenseBillPaymentStatusFromRow(
  expense: LogisticsExpense,
) {
  return (
    String(
      expense.paymentStatus || expense.billPaymentStatus || "待开票",
    ).trim() || "待开票"
  );
}

export function logisticsExpenseDetailInvoiceStatus(expense: LogisticsExpense) {
  return String(expense.detailInvoiceStatus || "未通知").trim() || "未通知";
}

export function logisticsExpenseBillItems(expense: LogisticsExpense) {
  return expense.items?.length ? expense.items : [expense];
}

export function logisticsExpenseShipmentBillIds(expense: LogisticsExpense) {
  const ids = expense.shipmentBillIds?.length
    ? expense.shipmentBillIds
    : [expense.billId || expense.id];
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
}

export function logisticsExpenseSelectionSelected(
  expense: LogisticsExpense,
  selectedIds: string[],
) {
  const ids = logisticsExpenseShipmentBillIds(expense);
  return ids.length > 0 && ids.every((id) => selectedIds.includes(id));
}

export function defaultLogisticsExpenseDetailTab({
  auditStatus,
  invoiceStatus,
  paymentStatus,
}: {
  auditStatus?: string;
  invoiceStatus?: string;
  paymentStatus?: string;
}) {
  return logisticsBillDefaultTab({ auditStatus, invoiceStatus, paymentStatus });
}

export function logisticsExpenseBillAuditStatus(items: LogisticsExpense[]) {
  const unique = [
    ...new Set(
      items.map(logisticsExpenseBillAuditStatusFromRow).filter(Boolean),
    ),
  ];
  if (!unique.length) return "草稿";
  if (unique.length === 1) return unique[0];
  if (unique.includes("审核通过")) return "审核通过";
  if (unique.includes("待审核")) return "待审核";
  if (unique.includes("已驳回")) return "已驳回";
  return "草稿";
}

export function logisticsExpenseBillIsEditable(status: string) {
  return canSubmitLogisticsBill({ auditStatus: status });
}

export function logisticsExpenseBillCanApprove(expense: LogisticsExpense) {
  const items = logisticsExpenseBillItems(expense);
  return (
    canReviewLogisticsBill({
      auditStatus: logisticsExpenseBillAuditStatusFromRow(expense),
    }) ||
    items.some((item) =>
      canReviewLogisticsBill({
        auditStatus: logisticsExpenseBillAuditStatusFromRow(item),
      }),
    ) ||
    (items.length > 0 &&
      canReviewLogisticsBill({
        auditStatus: logisticsExpenseBillAuditStatus(items),
      }))
  );
}

export function logisticsExpenseBillCanSubmit(expense: LogisticsExpense) {
  const items = logisticsExpenseBillItems(expense);
  return (
    items.length > 0 &&
    logisticsExpenseBillIsEditable(logisticsExpenseBillAuditStatus(items))
  );
}

export function billSupplierIds(expense: LogisticsExpense) {
  return logisticsExpenseBillItems(expense)
    .map((item) => item.supplierId || item.supplierName || "")
    .filter(
      (value, index, arr) => Boolean(value) && arr.indexOf(value) === index,
    );
}

export function sortLogisticsExpenseBillsForDisplay(rows: LogisticsExpense[]) {
  return [...rows].sort((left, right) => {
    return (
      logisticsExpenseBillSortRank(left) -
        logisticsExpenseBillSortRank(right) ||
      logisticsExpenseBillUpdatedAtValue(right) -
        logisticsExpenseBillUpdatedAtValue(left)
    );
  });
}

export function logisticsExpenseBillSortRank(expense: LogisticsExpense) {
  const auditStatus = normalizeLogisticsExpenseSortStatus(
    logisticsExpenseBillAuditStatusFromRow(expense),
  );
  if (["草稿", "已驳回", "待审核"].includes(auditStatus)) {
    return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[auditStatus] ?? 999;
  }

  const invoiceStatus = normalizeLogisticsExpenseSortStatus(
    logisticsExpenseBillInvoiceStatusFromRow(expense),
  );
  const paymentStatus = normalizeLogisticsExpenseSortStatus(
    logisticsExpenseBillPaymentStatusFromRow(expense),
  );
  const invoiceRank = LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[invoiceStatus];
  if (
    Number.isFinite(invoiceRank) &&
    invoiceRank < LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票
  )
    return invoiceRank;
  if (["部分付款", "部分已付款"].includes(paymentStatus))
    return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.部分付款;
  if (paymentStatus === "已付款")
    return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已付款;
  if (
    Number.isFinite(invoiceRank) &&
    invoiceRank === LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票
  )
    return invoiceRank;
  const paymentRank = LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[paymentStatus];
  if (Number.isFinite(paymentRank)) return paymentRank;
  return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[auditStatus] ?? 999;
}

export function normalizeLogisticsExpenseSortStatus(value: unknown) {
  const text = String(value || "").trim();
  if (text === "部分上传") return "部分上传发票";
  if (text === "已确认发票") return "已确认";
  if (text === "部分已付款") return "部分付款";
  return text || "草稿";
}

export function logisticsExpenseBillUpdatedAtValue(expense: LogisticsExpense) {
  const value = expense.updatedAt || 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function removeLogisticsExpenseFromRows(
  rows: LogisticsExpense[],
  expenseId: string,
) {
  let removedBill = false;
  let billId = "";
  const nextRows = rows.flatMap((row) => {
    const items = row.items?.length ? row.items : [row];
    if (!items.some((item) => item.id === expenseId)) return [row];
    billId = row.id;
    const nextItems = items.filter((item) => item.id !== expenseId);
    if (!nextItems.length) {
      removedBill = true;
      return [];
    }
    return [rebuildLogisticsExpenseBill(row, nextItems)];
  });
  return {
    rows: sortLogisticsExpenseBillsForDisplay(nextRows),
    removedBill,
    billId,
  };
}

export function replaceLogisticsExpenseItemsInRows(
  rows: LogisticsExpense[],
  savedItems: LogisticsExpense[],
) {
  const savedById = new Map(savedItems.map((item) => [item.id, item]));
  return sortLogisticsExpenseBillsForDisplay(
    rows.map((row) => {
      const items = row.items?.length ? row.items : [row];
      if (!items.some((item) => savedById.has(item.id))) return row;
      const nextItems = items.map((item) => savedById.get(item.id) || item);
      return rebuildLogisticsExpenseBill(row, nextItems);
    }),
  );
}

export function normalizeLogisticsExpenseBillRow(bill: LogisticsExpense) {
  const items = bill.items?.length ? bill.items : [];
  return items.length ? rebuildLogisticsExpenseBill(bill, items) : bill;
}

export function replaceLogisticsExpenseBillsInRows(
  rows: LogisticsExpense[],
  bills: LogisticsExpense[],
) {
  if (!bills.length) return rows;
  const billById = new Map(
    bills.map((bill) => [bill.id, normalizeLogisticsExpenseBillRow(bill)]),
  );
  return sortLogisticsExpenseBillsForDisplay(
    rows.map((row) => billById.get(row.id) || row),
  );
}

export function logisticsExpenseReviewResultLabel(
  result: LogisticsExpenseReviewResult,
) {
  const orderNo = result.orderNo || "";
  const blNo = result.blNo || "";
  const identity = [orderNo, blNo].filter(Boolean).join(" / ");
  return identity || result.billId || "账单";
}

export function logisticsExpenseReviewFailureMessage(
  result: LogisticsExpenseMutationResult,
) {
  const failures = (result.results || []).filter(
    (item) => item.auditStatus !== "审核通过" && item.errorMessage,
  );
  if (!failures.length) return "";
  return failures
    .map(
      (item) =>
        `${logisticsExpenseReviewResultLabel(item)}：${item.errorMessage}`,
    )
    .join("；");
}

export function logisticsExpenseReviewNotice(
  result: LogisticsExpenseMutationResult,
) {
  if (result.message) return result.message;
  if (result.emailError)
    return `费用已审核，开票通知发送失败，可稍后重发：${result.emailError}`;
  const successCount = Number(result.successCount || 0);
  if (successCount > 0)
    return `已审核 ${successCount} 票物流费用，开票通知已按供应商合并发送`;
  return "物流费用已审核，开票通知已按供应商合并发送";
}

export function reconcileLogisticsExpenseMutationRows(
  rows: LogisticsExpense[],
  result: LogisticsExpenseMutationResult,
) {
  const bills = [
    ...(Array.isArray(result.bills) ? result.bills : []),
    ...(result.bill ? [result.bill] : []),
  ].filter(Boolean);
  if (bills.length) return replaceLogisticsExpenseBillsInRows(rows, bills);
  const savedItems = [
    ...(Array.isArray(result.expenses) ? result.expenses : []),
    ...(result.expense ? [result.expense] : []),
  ].filter(Boolean);
  if (savedItems.length)
    return replaceLogisticsExpenseItemsInRows(rows, savedItems);
  return rows;
}

export function markLogisticsExpenseBillSubmitted(
  rows: LogisticsExpense[],
  billId: string,
  updatedIds: string[],
  submittedAt?: string,
) {
  const updatedIdSet = new Set(updatedIds.filter(Boolean));
  const submittedAtValue = submittedAt || new Date().toISOString();
  return sortLogisticsExpenseBillsForDisplay(
    rows.map((row) => {
      const items = row.items?.length ? row.items : [row];
      const belongsToBill =
        row.id === billId || items.some((item) => updatedIdSet.has(item.id));
      if (!belongsToBill) return row;
      const nextItems = items.map((item) => {
        return {
          ...item,
          auditStatus: "待审核",
          submittedAt: submittedAtValue,
          rejectReason: "",
          invoiceNotificationError: "",
        };
      });
      return rebuildLogisticsExpenseBill(row, nextItems);
    }),
  );
}

export function markLogisticsExpenseBillRejected(
  rows: LogisticsExpense[],
  billId: string,
  rejectReason: string,
) {
  const reviewedAt = new Date().toISOString();
  return sortLogisticsExpenseBillsForDisplay(
    rows.map((row) => {
      const items = row.items?.length ? row.items : [row];
      const belongsToBill = row.id === billId;
      if (!belongsToBill) return row;
      const nextItems = items.map((item) => ({
        ...item,
        auditStatus: "已驳回",
        invoiceStatus: "未通知",
        paymentStatus: "待开票",
        reviewedAt,
        rejectedAt: reviewedAt,
        rejectReason,
        invoiceNotifiedAt: null,
        invoiceNotificationError: "",
      }));
      return rebuildLogisticsExpenseBill(row, nextItems);
    }),
  );
}

export function reconcileLogisticsExpenseRowsAfterBatchSave(
  rows: LogisticsExpense[],
  billId: string,
  savedItems: LogisticsExpense[],
  deletedIds: string[],
) {
  const savedById = new Map(savedItems.map((item) => [item.id, item]));
  const deletedIdSet = new Set(deletedIds);
  let matchedBill = false;
  let removedBill = false;
  const nextRows = rows.flatMap((row) => {
    const items = row.items?.length ? row.items : [row];
    const belongsToBill =
      row.id === billId ||
      items.some((item) => savedById.has(item.id) || deletedIdSet.has(item.id));
    if (!belongsToBill) return [row];
    matchedBill = true;
    const nextItems = items
      .filter((item) => !deletedIdSet.has(item.id))
      .map((item) => savedById.get(item.id) || item);
    for (const savedItem of savedItems) {
      if (!nextItems.some((item) => item.id === savedItem.id))
        nextItems.push(savedItem);
    }
    if (!nextItems.length) {
      removedBill = true;
      return [];
    }
    return [rebuildLogisticsExpenseBill(row, nextItems)];
  });
  if (!matchedBill && savedItems.length) {
    nextRows.unshift(buildLogisticsExpenseBillFromItems(savedItems));
  }
  return { rows: sortLogisticsExpenseBillsForDisplay(nextRows), removedBill };
}

export function buildLogisticsExpenseBillFromItems(items: LogisticsExpense[]) {
  const first = items[0] || {};
  return rebuildLogisticsExpenseBill(
    {
      id: logisticsExpenseBillIdFromItem(first),
      isBill: true,
      orderId: first.orderId,
      orderNo: first.orderNo,
      blNo: first.blNo || first.billOfLadingNo,
      billOfLadingNo: first.billOfLadingNo || first.blNo,
      customerName: first.customerName,
      customerShortName: first.customerShortName,
      order: first.order,
    } as LogisticsExpense,
    items,
  );
}

export function logisticsExpenseBillIdFromItem(
  item: Partial<LogisticsExpense>,
) {
  return `bill:${item.orderId || "order"}:${item.blNo || item.billOfLadingNo || item.orderNo || "no-bl"}`;
}

export function rebuildLogisticsExpenseBill(
  row: LogisticsExpense,
  nextItems: LogisticsExpense[],
) {
  const amountCny = nextItems.reduce(
    (sum, item) => sum + Number(item.amountCny || 0),
    0,
  );
  const amount = nextItems.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );
  const currencyTotals = logisticsExpenseCurrencySummaryFromItems(nextItems);
  const first = nextItems[0] || {};
  return {
    ...row,
    ...(nextItems.length === 1
      ? {
          costType: first.costType,
          currency: first.currency,
          exchangeRate: first.exchangeRate,
          amount,
        }
      : {
          costType: `${nextItems.length} 项费用`,
          amount: currencyTotals.cnyActual,
        }),
    amountCny,
    currencyTotals,
    auditStatus: aggregateClientLogisticsExpenseStatus(
      nextItems,
      "auditStatus",
    ),
    invoiceStatus: aggregateClientLogisticsInvoiceStatus(nextItems),
    paymentStatus: aggregateClientLogisticsExpenseStatus(
      nextItems,
      "paymentStatus",
    ),
    itemCount: nextItems.length,
    invoiceGroups: logisticsInvoiceGroupsForBill(nextItems),
    supplierNames: [
      ...new Set(nextItems.map((item) => item.supplierName).filter(Boolean)),
    ],
    items: nextItems,
  } as LogisticsExpense;
}

export function expenseCostSyncText(expense: LogisticsExpense) {
  const status = String(
    (expense as LogisticsExpense & { costSyncStatus?: string })
      .costSyncStatus || "",
  ).trim();
  if (["未同步", "已同步", "同步失败"].includes(status)) return status;
  return expense.costId ? "已同步" : "未同步";
}

export function logisticsExpenseEditBlockReason(expense: LogisticsExpense) {
  const auditStatus = logisticsExpenseBillAuditStatusFromRow(expense);
  const invoiceStatus = logisticsExpenseDetailInvoiceStatus(expense);
  const paymentStatus = logisticsExpenseBillPaymentStatusFromRow(expense);
  return logisticsBillEditBlockReason({
    auditStatus,
    invoiceStatus,
    paymentStatus,
    costSynced: Boolean(expense.costId),
  }).replace(/。$/, "");
}

export function logisticsExpenseDeleteBlockReason(expense: LogisticsExpense) {
  const auditStatus = logisticsExpenseBillAuditStatusFromRow(expense);
  const invoiceStatus = logisticsExpenseDetailInvoiceStatus(expense);
  const paymentStatus = logisticsExpenseBillPaymentStatusFromRow(expense);
  return logisticsBillDeleteBlockReason({
    auditStatus,
    invoiceStatus,
    paymentStatus,
    costSynced: Boolean(expense.costId),
  });
}

export function csvCell(value: string) {
  const escaped = value.replaceAll('"', '""');
  const safe = /^[=+\-@]/.test(escaped) ? `'${escaped}` : escaped;
  return `"${safe}"`;
}
