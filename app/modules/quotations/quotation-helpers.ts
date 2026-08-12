import type { CustomerAutocompleteOption } from "../../CustomerAutocomplete";
import type {
  CustomerProduct,
  QuotationDraft,
  QuotationItem,
  QuotationItemDraft,
  QuotationRow,
} from "./types";

const QUOTATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SENT: "已发送",
  ACCEPTED: "客户已接受",
  REJECTED: "客户已拒绝",
  VOIDED: "已作废",
};

let quotationLineSequence = 0;

function nextLineKey() {
  quotationLineSequence += 1;
  return `quotation-line-${quotationLineSequence}`;
}

function dateInputValue(value?: string | null) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function defaultValidUntil() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function currentQuotationVersion(quotation?: QuotationRow | null) {
  if (quotation?.currentVersion) return quotation.currentVersion;
  return quotation?.versions?.[0] || null;
}

export function hasCurrentManualQuotationAcceptance(quotation?: QuotationRow | null) {
  if (quotation?.status !== "ACCEPTED") return false;
  const currentVersion = currentQuotationVersion(quotation);
  if (!currentVersion?.id) return false;
  return (quotation.decisions || []).some((decision) => (
    decision.quotationVersionId === currentVersion.id
    && decision.decision === "ACCEPTED"
    && decision.channel !== "SYSTEM_EMAIL"
  ));
}

export function quotationNumber(quotation?: QuotationRow | null) {
  return quotation?.quoteNo || quotation?.quotationNo || "";
}

export function quotationCustomerName(quotation?: QuotationRow | null) {
  return quotation?.customer?.shortName
    || quotation?.customerShortName
    || quotation?.customer?.displayName
    || quotation?.customer?.name
    || quotation?.customerName
    || quotation?.customerFullName
    || "-";
}

export function quotationCustomerLegalName(quotation?: QuotationRow | null) {
  return quotation?.customer?.fullName
    || quotation?.customer?.name
    || quotation?.customerFullName
    || quotation?.customerName
    || quotationCustomerName(quotation);
}

export function quotationBusinessEntityName(quotation?: QuotationRow | null) {
  const version = currentQuotationVersion(quotation);
  return quotation?.businessEntity?.displayName
    || quotation?.businessEntity?.shortName
    || quotation?.businessEntityShortName
    || version?.businessEntityShortNameSnapshot
    || quotation?.businessEntity?.name
    || quotation?.businessEntityName
    || version?.businessEntityNameSnapshot
    || "-";
}

export function quotationCustomerOption(quotation?: QuotationRow | null): CustomerAutocompleteOption | null {
  const id = quotation?.customerId || quotation?.customer?.id;
  if (!id) return null;
  const version = currentQuotationVersion(quotation);
  return {
    id,
    name: quotationCustomerLegalName(quotation),
    fullName: quotationCustomerLegalName(quotation),
    shortName: quotation?.customer?.shortName || quotation?.customerShortName || undefined,
    displayName: quotationCustomerName(quotation),
    defaultCurrency: version?.currency || undefined,
    defaultPaymentTermType: version?.paymentTerm || undefined,
    defaultTradeTerm: version?.tradeTerm || undefined,
    contactPerson: quotation?.customer?.contactPerson || version?.contactPersonSnapshot || undefined,
    contactEmail: quotation?.customer?.contactEmail || version?.contactEmailSnapshot || undefined,
    contactPhone: quotation?.customer?.contactPhone || version?.contactPhoneSnapshot || undefined,
  };
}

export function quotationItemName(item?: QuotationItem | null) {
  return item?.productNameSnapshot || item?.name || item?.productName || item?.description || "";
}

export function customerProductName(product?: CustomerProduct | null) {
  return product?.name || product?.productName || "";
}

function productDescription(name?: string | null, specification?: string | null) {
  const normalizedName = String(name || "").trim();
  const normalizedSpecification = String(specification || "").trim();
  if (!normalizedSpecification) return normalizedName;
  if (!normalizedName) return normalizedSpecification;
  if (normalizedName.toLocaleLowerCase().includes(normalizedSpecification.toLocaleLowerCase())) {
    return normalizedName;
  }
  if (/^[【[(（]/.test(normalizedSpecification)) {
    return `${normalizedName} ${normalizedSpecification}`;
  }
  return `${normalizedName} (${normalizedSpecification})`;
}

export function customerProductDescription(product?: CustomerProduct | null) {
  return productDescription(customerProductName(product), product?.specification);
}

export function quotationItemSpecification(item?: QuotationItem | QuotationItemDraft | null) {
  if (!item) return "";
  return "specificationSnapshot" in item
    ? item.specificationSnapshot || item.specification || ""
    : item.specification || "";
}

export function quotationItemDescription(item?: QuotationItem | QuotationItemDraft | null) {
  return productDescription(quotationItemName(item), quotationItemSpecification(item));
}

export function quotationLineAmount(item?: QuotationItem | QuotationItemDraft | null) {
  if (!item) return 0;
  if ("amount" in item && item.amount != null && item.amount !== "") return Number(item.amount || 0);
  if ("lineTotal" in item && item.lineTotal != null && item.lineTotal !== "") return Number(item.lineTotal || 0);
  return Number(item.quantity || 0) * Number(item.unitPrice || 0);
}

export function quotationSubtotal(quotation?: QuotationRow | null) {
  const version = currentQuotationVersion(quotation);
  const value = version?.subtotal ?? version?.totals?.subtotal;
  if (value != null && value !== "") return Number(value || 0);
  return (version?.items || []).reduce((total, item) => total + quotationLineAmount(item), 0);
}

export function quotationTotal(quotation?: QuotationRow | null) {
  const version = currentQuotationVersion(quotation);
  const value = version?.totalAmount ?? version?.totals?.totalAmount;
  return value != null && value !== "" ? Number(value || 0) : quotationSubtotal(quotation);
}

export function quotationStatusLabel(status?: string | null) {
  const normalized = String(status || "").trim().toUpperCase();
  return QUOTATION_STATUS_LABELS[normalized] || status || "-";
}

export function quotationNeedsSellerSnapshotRepair(quotation?: QuotationRow | null) {
  if (!quotation?.id) return false;
  const version = currentQuotationVersion(quotation);
  if (!version) return false;
  if (String(version.documentTemplateVersion || "").trim() !== "PI_V5") return true;
  if (typeof version.sellerSnapshotReady === "boolean") return !version.sellerSnapshotReady;
  return !String(version.businessEntityNameSnapshot || "").trim()
    || !String(version.sellerNameEnSnapshot || "").trim()
    || !String(version.documentTemplateVersion || "").trim();
}

export function emptyQuotationItem(): QuotationItemDraft {
  return {
    key: nextLineKey(),
    customerProductId: "",
    description: "",
    specification: "",
    unit: "PCS",
    quantity: "1",
    unitPrice: "",
    unitPriceSource: "",
    remark: "",
  };
}

export function duplicateQuotationItemAfter(items: QuotationItemDraft[], key: string) {
  const sourceIndex = items.findIndex((item) => item.key === key);
  if (sourceIndex < 0) return items;

  const { id: _id, key: _key, ...values } = items[sourceIndex];
  const duplicate: QuotationItemDraft = {
    ...values,
    key: nextLineKey(),
  };

  return [
    ...items.slice(0, sourceIndex + 1),
    duplicate,
    ...items.slice(sourceIndex + 1),
  ];
}

export function quotationDraftFromRow(quotation?: QuotationRow | null): QuotationDraft {
  const version = currentQuotationVersion(quotation);
  const items = Array.isArray(version?.items) && version.items.length
    ? version.items.map((item) => ({
      key: nextLineKey(),
      id: item.id,
      customerProductId: item.customerProductId || "",
      description: quotationItemName(item),
      specification: quotationItemSpecification(item),
      unit: item.unit || "PCS",
      quantity: String(item.quantity ?? "1"),
      unitPrice: String(item.unitPrice ?? ""),
      unitPriceSource: item.unitPrice == null || item.unitPrice === "" ? "" as const : "manual" as const,
      remark: item.remark || "",
    }))
    : [emptyQuotationItem()];
  return {
    customerId: quotation?.customerId || quotation?.customer?.id || "",
    businessEntityId: quotation?.businessEntityId || quotation?.businessEntity?.id || "",
    currency: String(version?.currency || "USD").toUpperCase(),
    tradeTerm: version?.tradeTerm || "FOB",
    paymentTerm: version?.paymentTerm || "",
    validUntil: dateInputValue(version?.validUntil) || defaultValidUntil(),
    leadTimeDays: version?.leadTimeDays == null ? "" : String(version.leadTimeDays),
    remark: version?.remark || "",
    items,
  };
}

export function comparableQuotationDraft(form: QuotationDraft) {
  return {
    ...form,
    items: form.items.map(({ key: _key, id: _id, ...item }) => item),
  };
}
