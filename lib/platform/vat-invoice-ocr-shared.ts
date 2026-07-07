import {
  isSuspiciousInvoiceParty,
  isSuspiciousInvoiceProduct,
  parseVatInvoiceFields as parseVatInvoiceFieldsCore,
} from "./supplier-vat-invoice-parser";

export type ValidationIssue = {
  level: "error" | "warning" | "manual";
  message: string;
  field?: string;
};

export type FieldResult = {
  key: string;
  label: string;
  value: string;
};

export function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function normalizeComparable(value: unknown) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[（）()【】\[\]{}《》<>，,。.\s·\-_/\\:：;；"'“”‘’]/g, "");
}

export function looselyMatches(left: unknown, right: unknown) {
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

export function visibleResultFields(fields: Record<string, unknown>, labels: Record<string, string>): FieldResult[] {
  return Object.entries(labels)
    .map(([key, label]) => ({ key, label, value: cleanText(fields[key]) }))
    .filter((field) => field.value);
}

export function parseVatInvoiceFields(text: string, structuredFields: Record<string, unknown> = {}) {
  return parseVatInvoiceFieldsCore(text, structuredFields);
}

export function vatInvoiceResultLabels() {
  return {
    invoiceNo: "发票号",
    invoiceDate: "开票日期",
    amountWithTax: "含税金额",
    amountWithoutTax: "不含税金额",
    taxAmount: "税额",
    taxRate: "税率",
    seller: "销售方",
    sellerTaxNo: "销售方纳税人识别号",
    buyer: "购买方",
    buyerTaxNo: "购买方纳税人识别号",
    productName: "产品名称 / 服务名称",
    specModel: "规格型号",
    unit: "单位",
    quantity: "数量",
    unitPrice: "单价",
  };
}

export function vatInvoiceParserIssues(fields: ReturnType<typeof parseVatInvoiceFields>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (isSuspiciousInvoiceParty(fields.buyer)) {
    issues.push({ level: "error", field: "buyer", message: "发票购买方解析异常，请人工确认" });
  }
  if (isSuspiciousInvoiceParty(fields.seller)) {
    issues.push({ level: "error", field: "seller", message: "发票销售方解析异常，请人工确认" });
  }
  if (isSuspiciousInvoiceProduct(fields.productName)) {
    issues.push({ level: "error", field: "productName", message: "发票产品名称解析异常，请人工确认" });
  }
  return issues;
}
