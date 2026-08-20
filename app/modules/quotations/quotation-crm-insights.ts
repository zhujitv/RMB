import { quotationValidityState } from "./quotation-expiry";
import {
  currentQuotationVersion,
  quotationCustomerLegalName,
  quotationCustomerName,
  quotationItemDescription,
  type QuotationRow,
} from "./types";

export type CustomerInsight = {
  key: string;
  customerId: string;
  name: string;
  legalName: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  quoteCount: number;
  acceptedCount: number;
  draftCount: number;
  expiredCount: number;
  pendingCount: number;
  productNames: Set<string>;
  rejectedCount: number;
  sentCount: number;
  quotations: QuotationRow[];
  latestQuotation?: QuotationRow;
  latestUpdatedAt: number;
};

export type CustomerMasterSeed = {
  id?: string | null;
  name?: string | null;
  fullName?: string | null;
  shortName?: string | null;
  displayName?: string | null;
  contactPerson?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
};

export function timestamp(value?: string | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function latestQuotationTime(quotation: QuotationRow) {
  return Math.max(timestamp(quotation.updatedAt), timestamp(quotation.createdAt), timestamp(currentQuotationVersion(quotation)?.createdAt));
}

export function firstText(...values: Array<string | null | undefined>) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "-";
}

export function customerInsightKey(quotation: QuotationRow) {
  return quotation.customerId || quotation.customer?.id || quotationCustomerLegalName(quotation) || quotationCustomerName(quotation) || quotation.id;
}

function customerMasterKey(customer: CustomerMasterSeed) {
  return customer.id || customer.fullName || customer.name || customer.displayName || "";
}

function customerMasterInsight(customer: CustomerMasterSeed): CustomerInsight {
  const name = firstText(customer.displayName, customer.shortName, customer.name, customer.fullName);
  const legalName = firstText(customer.fullName, customer.name, name);
  return {
    key: customerMasterKey(customer),
    customerId: String(customer.id || ""),
    name,
    legalName,
    contactPerson: firstText(customer.contactPerson),
    contactEmail: firstText(customer.contactEmail),
    contactPhone: firstText(customer.contactPhone),
    quoteCount: 0,
    acceptedCount: 0,
    draftCount: 0,
    expiredCount: 0,
    pendingCount: 0,
    productNames: new Set<string>(),
    rejectedCount: 0,
    sentCount: 0,
    quotations: [],
    latestUpdatedAt: Math.max(timestamp(customer.updatedAt), timestamp(customer.createdAt)),
  };
}

export function buildCustomerInsights(quotations: QuotationRow[], customerMasters: CustomerMasterSeed[] = []) {
  const customers = new Map<string, CustomerInsight>();
  for (const customer of customerMasters) {
    const key = customerMasterKey(customer);
    if (key) customers.set(key, customerMasterInsight(customer));
  }
  for (const quotation of quotations) {
    const key = customerInsightKey(quotation);
    const version = currentQuotationVersion(quotation);
    const current = customers.get(key);
    const currentTime = latestQuotationTime(quotation);
    const insight: CustomerInsight = current || {
      key,
      customerId: quotation.customerId || quotation.customer?.id || "",
      name: quotationCustomerName(quotation) || "未命名客户",
      legalName: quotationCustomerLegalName(quotation),
      contactPerson: firstText(version?.contactPersonSnapshot, quotation.customer?.contactPerson),
      contactEmail: firstText(version?.contactEmailSnapshot, quotation.customer?.contactEmail),
      contactPhone: firstText(version?.contactPhoneSnapshot, quotation.customer?.contactPhone),
      quoteCount: 0,
      acceptedCount: 0,
      draftCount: 0,
      expiredCount: 0,
      pendingCount: 0,
      productNames: new Set<string>(),
      rejectedCount: 0,
      sentCount: 0,
      quotations: [],
      latestUpdatedAt: currentTime,
    };

    insight.quotations.push(quotation);
    insight.quoteCount += 1;
    if (quotation.status === "DRAFT") insight.draftCount += 1;
    if (quotation.status === "SENT") insight.sentCount += 1;
    if (quotation.status === "ACCEPTED") insight.acceptedCount += 1;
    if (quotation.status === "REJECTED") insight.rejectedCount += 1;
    if (quotation.status === "SENT" || quotation.status === "DRAFT") insight.pendingCount += 1;
    if (quotationValidityState(quotation).expired) insight.expiredCount += 1;
    for (const item of version?.items || []) {
      const productName = quotationItemDescription(item);
      if (productName) insight.productNames.add(productName);
    }
    if (!current || currentTime >= insight.latestUpdatedAt) {
      insight.latestQuotation = quotation;
      insight.latestUpdatedAt = currentTime;
      insight.customerId = quotation.customerId || quotation.customer?.id || insight.customerId;
      insight.name = quotationCustomerName(quotation) || insight.name;
      insight.legalName = quotationCustomerLegalName(quotation) || insight.legalName;
      insight.contactPerson = firstText(version?.contactPersonSnapshot, quotation.customer?.contactPerson, insight.contactPerson);
      insight.contactEmail = firstText(version?.contactEmailSnapshot, quotation.customer?.contactEmail, insight.contactEmail);
      insight.contactPhone = firstText(version?.contactPhoneSnapshot, quotation.customer?.contactPhone, insight.contactPhone);
    }
    customers.set(key, insight);
  }
  return Array.from(customers.values()).map((customer) => ({
    ...customer,
    quotations: customer.quotations.sort((left, right) => latestQuotationTime(right) - latestQuotationTime(left)),
  })).sort((left, right) => {
    const quoteDiff = Number(Boolean(right.latestQuotation)) - Number(Boolean(left.latestQuotation));
    return quoteDiff || right.latestUpdatedAt - left.latestUpdatedAt || left.name.localeCompare(right.name, "zh-CN");
  });
}

export function buildCrmSummary(quotations: QuotationRow[], customers: CustomerInsight[]) {
  const expiredCount = quotations.filter((quotation) => quotationValidityState(quotation).expired).length;
  return {
    acceptedCount: quotations.filter((quotation) => quotation.status === "ACCEPTED").length,
    draftCount: quotations.filter((quotation) => quotation.status === "DRAFT").length,
    expiredCount,
    followUpCount: quotations.filter((quotation) => quotation.status === "SENT" || quotationValidityState(quotation).expired).length,
    productCount: customers.reduce((totalCount, customer) => totalCount + customer.productNames.size, 0),
    rejectedCount: quotations.filter((quotation) => quotation.status === "REJECTED").length,
    sentCount: quotations.filter((quotation) => quotation.status === "SENT").length,
  };
}
