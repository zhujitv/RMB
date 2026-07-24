import type { CurrencyTotals } from "./currency-totals";
import { nonEmpty } from "./shared-base-utils";
import {
  getLogisticsInvoiceNotificationSettings,
  logisticsInvoiceNotificationUploadUrl,
} from "./notification-logistics-settings";

type LogisticsInvoiceGroupLike = {
  label?: string | null;
  amountCny?: unknown;
  currencyTotals?: CurrencyTotals | null;
};

type LogisticsInvoiceNotificationBillLike = {
  orderNo?: unknown;
  blNo?: unknown;
  customerShortName?: unknown;
  containerSummary?: unknown;
  amountCny?: unknown;
  currencyTotals?: CurrencyTotals | null;
  detailText?: unknown;
  invoiceGroups?: LogisticsInvoiceGroupLike[] | null;
  remark?: unknown;
};

type TemplateVariables = Record<string, unknown>;

const LOGISTICS_CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  HKD: "HK$",
};

function formatOriginalCurrency(currency = "CNY", value: unknown) {
  const normalized = String(currency || "CNY").trim().toUpperCase() || "CNY";
  const symbol = LOGISTICS_CURRENCY_SYMBOLS[normalized] || normalized;
  const amount = Number(value || 0);
  const formatted = Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
  return `${normalized} ${symbol}${formatted}`;
}

function formatLogisticsCurrencyTotals(
  totals?: CurrencyTotals | null,
  fallbackAmountCny?: unknown,
) {
  const rows: string[] = [];
  if (Number(totals?.cnyActual || 0) !== 0 || !(totals?.foreignTotals || []).length) {
    rows.push(formatOriginalCurrency("CNY", totals?.cnyActual ?? fallbackAmountCny ?? 0));
  }
  for (const item of totals?.foreignTotals || []) {
    rows.push(formatOriginalCurrency(item.currency, item.amount));
  }
  return rows.join(" / ");
}

function formatLogisticsCurrencyBreakdown(
  totals?: CurrencyTotals | null,
  fallbackAmountCny?: unknown,
) {
  const rows: string[] = [];
  const foreignTotals = totals?.foreignTotals || [];
  const cnyActual = Number(totals?.cnyActual ?? fallbackAmountCny ?? 0);
  if (cnyActual !== 0 || !foreignTotals.length) {
    rows.push(`人民币实际费用合计：${formatOriginalCurrency("CNY", cnyActual)}`);
  }
  for (const item of foreignTotals) {
    rows.push(`${item.currency} 外币费用合计：${formatOriginalCurrency(item.currency, item.amount)}`);
  }
  rows.push(`折人民币总合计：${formatOriginalCurrency("CNY", totals?.totalCny ?? fallbackAmountCny ?? 0)}`);
  return rows.join("\n");
}

function formatInvoiceGroupAmount(group: LogisticsInvoiceGroupLike = {}) {
  const totals = group.currencyTotals;
  if (!totals) {
    return group.amountCny == null ? "" : formatOriginalCurrency("CNY", group.amountCny);
  }
  const parts: string[] = [];
  const cnyActual = Number(totals.cnyActual || 0);
  if (cnyActual !== 0 || !(totals.foreignTotals || []).length) {
    parts.push(formatOriginalCurrency("CNY", cnyActual));
  }
  for (const item of totals.foreignTotals || []) {
    parts.push(formatOriginalCurrency(item.currency, item.amount));
  }
  if ((totals.foreignTotals || []).length) {
    parts.push(`折人民币 ${formatOriginalCurrency("CNY", totals.totalCny)}`);
  }
  return parts.join(" / ");
}

function templateValue(value: unknown) {
  return nonEmpty(value) || "-";
}

function applyTemplate(template = "", variables: TemplateVariables = {}) {
  return String(template || "").replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] ?? "") : match
  ));
}

function billVariables(bill: LogisticsInvoiceNotificationBillLike = {}) {
  return {
    orderNo: templateValue(bill.orderNo),
    blNo: templateValue(bill.blNo),
    customerShortName: templateValue(bill.customerShortName),
    containerSummary: templateValue(bill.containerSummary || "未录入"),
    amountCny: formatLogisticsCurrencyTotals(bill.currencyTotals, bill.amountCny),
    amountText: formatLogisticsCurrencyTotals(bill.currencyTotals, bill.amountCny),
    amountBreakdown: formatLogisticsCurrencyBreakdown(bill.currencyTotals, bill.amountCny),
    expenseDetails: templateValue(bill.detailText),
    invoiceGroups: (bill.invoiceGroups || []).map((group) => {
      const label = nonEmpty(group.label);
      if (!label) return "";
      const amount = formatInvoiceGroupAmount(group);
      return amount ? `${label}：${amount}` : label;
    }).filter(Boolean).join("\n") || "对应物流费用发票",
    remark: templateValue(bill.remark),
  };
}

function defaultBillRows(bills: LogisticsInvoiceNotificationBillLike[] = []) {
  return bills.map((bill, index) => {
    const variables = billVariables(bill);
    const invoiceGroups = variables.invoiceGroups
      .split("\n")
      .map((line) => `   - ${line}`)
      .join("\n");
    const detailLines = String(variables.expenseDetails || "-")
      .split("\n")
      .map((line) => `   - ${line}`)
      .join("\n");
    return [
      `${index + 1}. 订单号：${variables.orderNo}`,
      `   提单号：${variables.blNo}`,
      `   柜型/柜量：${variables.containerSummary}`,
      `   客户简称：${variables.customerShortName}`,
      "   费用合计：",
      ...String(variables.amountBreakdown || variables.amountText || "-")
        .split("\n")
        .map((line) => `   - ${line}`),
      "   费用明细：",
      detailLines,
      "   请分别上传：",
      invoiceGroups,
    ].join("\n");
  }).join("\n\n");
}

export async function renderLogisticsInvoiceNotificationEmail(
  supplierName: unknown = "供应商",
  bills: LogisticsInvoiceNotificationBillLike[] = [],
) {
  const settings = await getLogisticsInvoiceNotificationSettings();
  const firstBillVariables = billVariables(bills[0] || {});
  const uploadUrl = logisticsInvoiceNotificationUploadUrl(settings);
  const variables = {
    ...firstBillVariables,
    supplierName: templateValue(supplierName),
    billCount: String(bills.length || 0),
    billRows: defaultBillRows(bills),
    invoiceRequirements: settings.invoiceRequirements,
    uploadUrl,
    signature: settings.signature,
  };
  const subjectTemplate = bills.length === 1
    ? settings.singleSubjectTemplate
    : settings.batchSubjectTemplate;
  return {
    subject: applyTemplate(subjectTemplate, variables),
    body: applyTemplate(settings.bodyTemplate, variables),
    settings,
  };
}
