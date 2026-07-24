import {
  looselyMatches,
  parseVatInvoiceFields,
} from "./vat-invoice-ocr-shared";
import {
  logisticsInvoiceGroupCurrencies,
  type LogisticsInvoiceGroupDefinition,
} from "./logistics-invoice-groups";
import {
  LOGISTICS_INVOICE_VALIDATION_PASSED,
  LOGISTICS_INVOICE_VALIDATION_AMOUNT_MISMATCH,
  LOGISTICS_INVOICE_VALIDATION_NAME_MISMATCH,
  LOGISTICS_INVOICE_VALIDATION_PARTY_MISMATCH,
  LOGISTICS_INVOICE_VALIDATION_FAILED,
  type LogisticsInvoiceValidationRow,
  groupCurrency,
  expectedGroupAmount,
  amountMatches,
  recognizedLogisticsInvoiceAmount,
  matchesAnyKeyword,
} from "./logistics-invoice-validation-model";
export function validateLogisticsInvoiceFields(input: {
  fields: ReturnType<typeof parseVatInvoiceFields>;
  rawText: string;
  rows: LogisticsInvoiceValidationRow[];
  invoiceGroup: LogisticsInvoiceGroupDefinition;
  keywords: string[];
  expectedSellerName?: string;
  expectedBuyerName?: string;
}) {
  const expectedAmount = expectedGroupAmount(input.rows);
  const currencies = logisticsInvoiceGroupCurrencies(input.rows);
  const currency = currencies.length === 1 ? currencies[0] : groupCurrency(input.rows);
  const issues: Array<{ level: "error" | "manual"; field: string; message: string }> = [];
  if (currencies.length > 1) {
    issues.push({
      level: "error",
      field: "amountWithTax",
      message: `同一发票分组包含多个币种（${currencies.join(" / ")}），请按币种拆分发票后再校验。`,
    });
  }
  const recognizedAmountResult = recognizedLogisticsInvoiceAmount({
    fields: input.fields,
    rawText: input.rawText,
    invoiceGroup: input.invoiceGroup,
    currency,
    expectedAmount,
  });
  const recognizedAmount = recognizedAmountResult.amount;
  if (currencies.length > 1) {
    // Mixed-currency groups cannot be compared to one invoice amount.
  } else if (!recognizedAmount) {
    issues.push({
      level: "manual",
      field: "amountWithTax",
      message: recognizedAmountResult.source === "FOREIGN_CURRENCY_MISSING"
        ? "未识别到发票外币金额"
        : "未识别到发票价税合计金额",
    });
  } else if (!amountMatches(recognizedAmount, expectedAmount)) {
    issues.push({
      level: "error",
      field: "amountWithTax",
      message: `金额不一致：系统金额 ${currency} ${expectedAmount.toFixed(2)}，发票金额 ${currency} ${recognizedAmount.toFixed(2)}`,
    });
  }
  if (!input.fields.productName) {
    issues.push({ level: "manual", field: "productName", message: "未识别到货物或应税劳务/服务名称" });
  } else if (!matchesAnyKeyword(input.fields.productName, input.keywords)) {
    issues.push({
      level: "error",
      field: "productName",
      message: `品名不匹配：系统费用分组 ${input.invoiceGroup.label}，识别品名 ${input.fields.productName}`,
    });
  }
  if (input.expectedSellerName) {
    if (!input.fields.seller) {
      issues.push({ level: "manual", field: "seller", message: "未识别到发票销售方，需人工确认" });
    } else if (!looselyMatches(input.fields.seller, input.expectedSellerName)) {
      issues.push({
        level: "error",
        field: "seller",
        message: `销售方不匹配：物流供应商 ${input.expectedSellerName}，识别销售方 ${input.fields.seller}`,
      });
    }
  }
  if (input.expectedBuyerName) {
    if (!input.fields.buyer) {
      issues.push({ level: "manual", field: "buyer", message: "未识别到发票购买方，需人工确认" });
    } else if (!looselyMatches(input.fields.buyer, input.expectedBuyerName)) {
      issues.push({
        level: "error",
        field: "buyer",
        message: `购买方不匹配：系统抬头 ${input.expectedBuyerName}，识别购买方 ${input.fields.buyer}`,
      });
    }
  }
  const status = issues.some((issue) => issue.field === "amountWithTax")
    ? LOGISTICS_INVOICE_VALIDATION_AMOUNT_MISMATCH
    : issues.some((issue) => issue.field === "productName")
      ? LOGISTICS_INVOICE_VALIDATION_NAME_MISMATCH
      : issues.some((issue) => issue.field === "seller" || issue.field === "buyer")
        ? LOGISTICS_INVOICE_VALIDATION_PARTY_MISMATCH
        : LOGISTICS_INVOICE_VALIDATION_PASSED;
  return {
    expectedAmount,
    currency,
    issues,
    status,
    recognizedAmount,
    recognizedAmountSource: recognizedAmountResult.source,
    taxInvoiceAmount: recognizedAmountResult.taxInvoiceAmount,
  };
}

export function validationStatusFromIssues(
  issues: Array<{ field?: string; level?: string }>,
  fallback: string,
) {
  if (!issues.length) return LOGISTICS_INVOICE_VALIDATION_PASSED;
  if (issues.some((issue) => issue.field === "amountWithTax")) return LOGISTICS_INVOICE_VALIDATION_AMOUNT_MISMATCH;
  if (issues.some((issue) => issue.field === "productName")) return LOGISTICS_INVOICE_VALIDATION_NAME_MISMATCH;
  if (issues.some((issue) => issue.field === "seller" || issue.field === "buyer")) return LOGISTICS_INVOICE_VALIDATION_PARTY_MISMATCH;
  return fallback || LOGISTICS_INVOICE_VALIDATION_FAILED;
}

export function mergeValidationIssues<T extends { field?: string; message?: string }>(
  primary: T[] = [],
  secondary: T[] = [],
) {
  const result = [...primary];
  for (const issue of secondary) {
    const exists = result.some((item) => item.field === issue.field && item.message === issue.message);
    if (!exists) result.push(issue);
  }
  return result;
}
