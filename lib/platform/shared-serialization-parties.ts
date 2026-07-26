import {
  LOGISTICS_COST_TYPES,
  SHIPPING_EMAIL_LANGUAGE_LABELS,
  normalizeClearanceEmailLanguage,
  normalizeCustomerName,
  normalizedCostType,
  normalizeShippingDocumentTypes,
  supplierTypeDisplayName,
} from "./shared-constants";
import { serializeUser } from "./shared-users";
import {
  type CustomerLike,
  type SupplierLike,
  asLooseRecord,
} from "./shared-serialization-types";

export function serializeCustomer(customerInput: unknown = {}) {
  const customer = asLooseRecord<CustomerLike>(customerInput);
  const fullName = normalizeCustomerName(customer.name);
  const shortName = normalizeCustomerName(customer.shortName || "");
  return {
    id: customer.id,
    name: fullName,
    fullName,
    shortName,
    displayName: shortName || fullName,
    country: customer.country || "",
    defaultCurrency: customer.defaultCurrency,
    salespersonUserId: customer.salespersonUserId || "",
    salespersonName: customer.salesperson?.name || "",
    commissionRate: Number(customer.commissionRate || 0),
    commissionStatus: customer.commissionStatus || "启用",
    contactPerson: customer.contactPerson || "",
    contactEmail: customer.contactEmail || "",
    contactPhone: customer.contactPhone || "",
    enableAutoShippingDocsNotification: Boolean(customer.enableAutoShippingDocsNotification),
    shippingDocsEmails: Array.isArray(customer.shippingDocsEmails) ? customer.shippingDocsEmails : [],
    shippingDocsCcEmails: Array.isArray(customer.shippingDocsCcEmails) ? customer.shippingDocsCcEmails : [],
    autoSendDocumentTypes: normalizeShippingDocumentTypes(customer.autoSendDocumentTypes),
    clearanceEmailLanguage: normalizeClearanceEmailLanguage(customer.clearanceEmailLanguage, customer.country),
    clearanceEmailLanguageLabel: (SHIPPING_EMAIL_LANGUAGE_LABELS as Record<string, string>)[normalizeClearanceEmailLanguage(customer.clearanceEmailLanguage, customer.country)],
    remark: customer.remark || "",
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export function customerFullName(customerInput: unknown, snapshot: unknown = "") {
  const customer = asLooseRecord<CustomerLike>(customerInput);
  return normalizeCustomerName(snapshot || customer.name || "");
}

export function customerShortName(customerInput: unknown) {
  const customer = asLooseRecord<CustomerLike>(customerInput);
  return normalizeCustomerName(customer.shortName || "");
}

export function customerBusinessName(customer: unknown, snapshot: unknown = "") {
  return customerShortName(customer) || customerFullName(customer, snapshot);
}

export function normalizedStringArray(value: unknown = []) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizedStringArray(parsed);
    } catch {}
    return value.split(/[,\n;；，]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function normalizeLogisticsCostTypeList(value: unknown = []) {
  const rows = normalizedStringArray(value).map(normalizedCostType).filter((item) => LOGISTICS_COST_TYPES.includes(item));
  return rows.filter((item, index, arr) => arr.indexOf(item) === index);
}

export function expandLegacyFullLogisticsCostTypeList(value: unknown = []) {
  const rows = normalizeLogisticsCostTypeList(value);
  const documentFeeType = "打单费";
  const ensFeeType = "ENS";
  const legacyFullRows = LOGISTICS_COST_TYPES.filter((item) => ![documentFeeType, ensFeeType].includes(item));
  const preEnsFullRows = LOGISTICS_COST_TYPES.filter((item) => item !== ensFeeType);
  if (!rows.includes(documentFeeType) && legacyFullRows.every((item) => rows.includes(item))) {
    return LOGISTICS_COST_TYPES;
  }
  if (!rows.includes(ensFeeType) && preEnsFullRows.every((item) => rows.includes(item))) {
    return LOGISTICS_COST_TYPES;
  }
  return rows;
}

export function serializeSupplier(supplierInput: unknown = {}) {
  const supplier = asLooseRecord<SupplierLike>(supplierInput);
  return {
    id: supplier.id,
    supplierName: supplier.supplierName,
    supplierType: supplierTypeDisplayName(supplier.supplierType),
    country: supplier.country || "",
    contactPerson: supplier.contactPerson || "",
    phone: supplier.phone || "",
    email: supplier.email || "",
    address: supplier.address || "",
    invoiceTitle: supplier.invoiceTitle || "",
    taxNumber: supplier.taxNumber || "",
    bankName: supplier.bankName || "",
    bankAccount: supplier.bankAccount || "",
    remark: supplier.remark || "",
    status: supplier.status,
    allowDomesticLogisticsEntry: Boolean(supplier.allowDomesticLogisticsEntry),
    allowLogisticsExpenseEntry: Boolean(supplier.allowLogisticsExpenseEntry),
    allowLogisticsInvoiceUpload: Boolean(supplier.allowLogisticsInvoiceUpload),
    allowFactoryDocumentUpload: Boolean(supplier.allowFactoryDocumentUpload),
    isDefaultLogisticsSupplier: Boolean(supplier.isDefaultLogisticsSupplier),
    allowedLogisticsCostTypes: expandLegacyFullLogisticsCostTypeList(supplier.allowedLogisticsCostTypes || []),
    createdBy: serializeUser(supplier.createdBy),
    updatedBy: serializeUser(supplier.updatedBy),
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

export function serializeSupplierOption(supplierInput: unknown = {}) {
  const supplier = asLooseRecord<SupplierLike>(supplierInput);
  return {
    id: supplier.id,
    supplierName: supplier.supplierName,
    supplierType: supplierTypeDisplayName(supplier.supplierType),
    status: supplier.status,
    allowDomesticLogisticsEntry: Boolean(supplier.allowDomesticLogisticsEntry),
    allowLogisticsExpenseEntry: Boolean(supplier.allowLogisticsExpenseEntry),
    allowLogisticsInvoiceUpload: Boolean(supplier.allowLogisticsInvoiceUpload),
    allowFactoryDocumentUpload: Boolean(supplier.allowFactoryDocumentUpload),
    isDefaultLogisticsSupplier: Boolean(supplier.isDefaultLogisticsSupplier),
    allowedLogisticsCostTypes: expandLegacyFullLogisticsCostTypeList(supplier.allowedLogisticsCostTypes || []),
  };
}
