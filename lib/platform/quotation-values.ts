import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-utils";
import { decimalIntegerDigits } from "./quotation-calculations";
import { serializeQuotationDecision as serializeQuotationDecisionValue } from "./quotation-decision-values";
import { serializeQuotationDelivery } from "./quotation-delivery-values";

export { quotationDate, todayInChina } from "./quotation-date-values";
export {
  QUOTATION_DECISION_CHANNELS,
  quotationManualConfirmationChannel,
  requiredQuotationConfirmationDate,
} from "./quotation-decision-values";
export type {
  ManualQuotationDecisionChannel,
  QuotationDecisionChannel,
} from "./quotation-decision-values";

export {
  normalizeProductPart,
  productIdentityKey,
  productFingerprint,
  productVisibleDescription,
  quotationLineAmount,
} from "./quotation-calculations";

export type QuotationActor = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
} | null | undefined;

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

function boundedText(value: unknown, label: string, maxLength: number, required = false) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (required && !text) throw codedError(`${label}不能为空`, 400, "QUOTATION_FIELD_REQUIRED");
  if (text.length > maxLength) throw codedError(`${label}不能超过 ${maxLength} 个字符`, 400, "QUOTATION_FIELD_TOO_LONG");
  return text;
}

export function quotationText(value: unknown, label: string, maxLength = 500, required = false) {
  return boundedText(value, label, maxLength, required);
}

type DecimalOptions = {
  positive?: boolean;
  scale: number;
  integerDigits: number;
};

export function quotationDecimal(value: unknown, label: string, options: DecimalOptions) {
  const raw = String(value ?? "").trim();
  if (!raw) throw codedError(`${label}不能为空`, 400, "QUOTATION_DECIMAL_REQUIRED");
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(raw);
  } catch {
    throw codedError(`${label}格式错误`, 400, "QUOTATION_DECIMAL_INVALID");
  }
  if (!decimal.isFinite() || decimal.isNegative() || (options.positive && decimal.isZero())) {
    throw codedError(`${label}${options.positive ? "必须大于 0" : "不能小于 0"}`, 400, "QUOTATION_DECIMAL_RANGE");
  }
  if (decimal.decimalPlaces() > options.scale) {
    throw codedError(`${label}最多保留 ${options.scale} 位小数`, 400, "QUOTATION_DECIMAL_SCALE");
  }
  const integerLength = decimalIntegerDigits(decimal);
  if (integerLength > options.integerDigits) {
    throw codedError(`${label}数值过大`, 400, "QUOTATION_DECIMAL_OVERFLOW");
  }
  return decimal;
}

export function decimalText(value: unknown, fallback = "0") {
  if (value === null || value === undefined || value === "") return fallback;
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  return String(value);
}

export function serializeCustomerProduct(value: unknown) {
  const product = asRecord(value);
  const quoteItems = Array.isArray(product.quoteItems) ? product.quoteItems : [];
  const executionItems = Array.isArray(product.salesExecutionItems) ? product.salesExecutionItems : [];
  const latestQuoteItem = asRecord(quoteItems[0]);
  const latestExecutionItem = asRecord(executionItems[0]);
  const timestamp = (item: LooseRecord) => {
    const time = new Date(String(item.createdAt || "")).getTime();
    return Number.isFinite(time) ? time : 0;
  };
  const latestPriceItem = timestamp(latestExecutionItem) >= timestamp(latestQuoteItem)
    ? latestExecutionItem
    : latestQuoteItem;
  const lastUnitPrice = latestPriceItem.salesUnitPrice ?? latestPriceItem.unitPrice;
  return {
    id: String(product.id || ""),
    customerId: String(product.customerId || ""),
    name: String(product.name || ""),
    productName: String(product.name || ""),
    specification: String(product.specification || ""),
    unit: String(product.unit || ""),
    fingerprint: String(product.fingerprint || ""),
    remark: String(product.remark || ""),
    lastUnitPrice: lastUnitPrice === null || lastUnitPrice === undefined
      ? null
      : decimalText(lastUnitPrice),
    lastCurrency: latestPriceItem.currencySnapshot ? String(latestPriceItem.currencySnapshot) : null,
    lastQuotedAt: latestPriceItem.createdAt || null,
    status: product.deletedAt ? "VOIDED" : "ACTIVE",
    deletedAt: product.deletedAt || null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export function serializeQuotationItem(value: unknown) {
  const item = asRecord(value);
  const amount = decimalText(item.amount);
  const productName = String(item.productNameSnapshot || "");
  const specification = String(item.specificationSnapshot || "");
  const unit = String(item.unitSnapshot || "");
  return {
    id: String(item.id || ""),
    lineNumber: Number(item.lineNumber || 0),
    customerProductId: item.customerProductId ? String(item.customerProductId) : null,
    productFingerprintSnapshot: String(item.productFingerprintSnapshot || ""),
    productNameSnapshot: productName,
    name: productName,
    productName,
    description: productName,
    specificationSnapshot: specification,
    specification,
    unitSnapshot: unit,
    unit,
    currencySnapshot: String(item.currencySnapshot || ""),
    quantity: decimalText(item.quantity),
    unitPrice: decimalText(item.unitPrice),
    amount,
    lineTotal: amount,
    remark: String(item.remark || ""),
    createdAt: item.createdAt,
  };
}

export function serializeQuotationVersion(value: unknown) {
  const version = asRecord(value);
  const items = Array.isArray(version.items) ? version.items.map(serializeQuotationItem) : [];
  const sellerSnapshotReady = Boolean(
    String(version.businessEntityNameSnapshot || "").trim()
    && String(version.sellerNameEnSnapshot || "").trim()
    && String(version.documentTemplateVersion || "").trim(),
  );
  const totals = {
    subtotal: decimalText(version.subtotal),
    discountAmount: decimalText(version.discountAmount),
    totalAmount: decimalText(version.totalAmount),
  };
  return {
    id: String(version.id || ""),
    versionNumber: Number(version.versionNumber || 0),
    invoiceNoSnapshot: version.invoiceNoSnapshot ? String(version.invoiceNoSnapshot) : null,
    customerNameSnapshot: String(version.customerNameSnapshot || ""),
    customerShortNameSnapshot: String(version.customerShortNameSnapshot || ""),
    countrySnapshot: String(version.countrySnapshot || ""),
    contactPersonSnapshot: String(version.contactPersonSnapshot || ""),
    contactEmailSnapshot: String(version.contactEmailSnapshot || ""),
    contactPhoneSnapshot: String(version.contactPhoneSnapshot || ""),
    businessEntityNameSnapshot: String(version.businessEntityNameSnapshot || ""),
    businessEntityShortNameSnapshot: String(version.businessEntityShortNameSnapshot || ""),
    sellerNameEnSnapshot: String(version.sellerNameEnSnapshot || ""),
    sellerAddressSnapshot: String(version.sellerAddressSnapshot || ""),
    sellerEmailSnapshot: String(version.sellerEmailSnapshot || ""),
    sellerPhoneSnapshot: String(version.sellerPhoneSnapshot || ""),
    sellerWebsiteSnapshot: String(version.sellerWebsiteSnapshot || ""),
    sellerSnapshotReady,
    documentTemplateVersion: String(version.documentTemplateVersion || "PI_V1"),
    quoteDate: version.quoteDate,
    validUntil: version.validUntil,
    currency: String(version.currency || ""),
    exchangeRate: decimalText(version.exchangeRate, "1"),
    ...totals,
    totals,
    tradeTerm: String(version.tradeTerm || ""),
    paymentTerm: String(version.paymentTerm || ""),
    leadTimeDays: version.leadTimeDays === null || version.leadTimeDays === undefined ? null : Number(version.leadTimeDays),
    remark: String(version.remark || ""),
    items,
    createdAt: version.createdAt,
  };
}

export function serializeQuotationDecision(value: unknown) {
  return serializeQuotationDecisionValue(value);
}

export function serializeQuotation(
  value: unknown,
  includeVersions = false,
  includeSalesExecution = false,
) {
  const quotation = asRecord(value);
  const customer = asRecord(quotation.customer);
  const salesperson = asRecord(quotation.salesperson);
  const businessEntity = asRecord(quotation.businessEntity);
  const salesExecution = asRecord(quotation.salesExecution);
  const rawVersions = Array.isArray(quotation.versions) ? quotation.versions : [];
  const versions = rawVersions.map(serializeQuotationVersion);
  const deliveries = Array.isArray(quotation.deliveries)
    ? quotation.deliveries.map(serializeQuotationDelivery)
    : [];
  const decisions = Array.isArray(quotation.decisions)
    ? quotation.decisions.map(serializeQuotationDecision)
    : [];
  const currentVersionNumber = Number(quotation.currentVersionNumber || 0);
  const currentVersion = versions.find((version) => version.versionNumber === currentVersionNumber) || versions[0] || null;
  const fullName = String(customer.name || currentVersion?.customerNameSnapshot || "");
  const shortName = String(customer.shortName || currentVersion?.customerShortNameSnapshot || "");
  return {
    id: String(quotation.id || ""),
    quoteNo: String(quotation.quoteNo || ""),
    quotationNo: String(quotation.quoteNo || ""),
    invoiceNo: quotation.invoiceNo ? String(quotation.invoiceNo) : null,
    status: String(quotation.status || "DRAFT"),
    statusLabel: ({
      DRAFT: "草稿",
      SENT: "已发送",
      ACCEPTED: "客户已接受",
      REJECTED: "客户已拒绝",
      VOIDED: "已作废",
    } as Record<string, string>)[String(quotation.status || "DRAFT")] || String(quotation.status || "DRAFT"),
    customerId: String(quotation.customerId || customer.id || ""),
    customer: {
      id: String(customer.id || quotation.customerId || ""),
      name: fullName,
      fullName,
      shortName,
      displayName: shortName || fullName,
    },
    customerName: fullName,
    customerFullName: fullName,
    customerShortName: shortName,
    businessEntityId: String(quotation.businessEntityId || businessEntity.id || ""),
    businessEntity: businessEntity.id ? {
      id: String(businessEntity.id),
      name: String(businessEntity.name || ""),
      shortName: String(businessEntity.shortName || ""),
      displayName: String(businessEntity.shortName || businessEntity.name || ""),
      isDefault: Boolean(businessEntity.isDefault),
    } : null,
    salespersonUserId: String(quotation.salespersonUserId || ""),
    salesperson: quotation.salespersonUserId || salesperson.id ? {
      id: String(salesperson.id || quotation.salespersonUserId || ""),
      name: String(salesperson.name || ""),
    } : null,
    salespersonName: String(salesperson.name || ""),
    salesExecution: includeSalesExecution && salesExecution.id ? {
      id: String(salesExecution.id),
      executionNo: String(salesExecution.executionNo || ""),
      status: String(salesExecution.status || "DRAFT"),
    } : null,
    currentVersionNumber,
    currentVersion,
    ...(currentVersion ? {
      currency: currentVersion.currency,
      subtotal: currentVersion.subtotal,
      totalAmount: currentVersion.totalAmount,
    } : {}),
    versions: includeVersions ? versions : undefined,
    deliveries: includeVersions ? deliveries : undefined,
    decisions: includeVersions ? decisions : undefined,
    latestDelivery: includeVersions ? deliveries[0] || null : undefined,
    voidedAt: quotation.voidedAt,
    voidedById: quotation.voidedById ? String(quotation.voidedById) : null,
    voidReason: String(quotation.voidReason || ""),
    createdAt: quotation.createdAt,
    updatedAt: quotation.updatedAt,
  };
}
