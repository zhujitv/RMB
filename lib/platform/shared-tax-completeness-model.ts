import { isPlainRecord } from "./shared-base-utils";

export type NumericLike = number | string | { toString(): string };
export type OrderDocumentLike = {
  id?: string | null;
  documentType?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  storageKey?: string | null;
  uploadStatus?: string | null;
  deletedAt?: Date | string | null;
  costId?: string | null;
  relatedModule?: string | null;
  supplierId?: string | null;
  supplier?: { supplierType?: string | null } | null;
  cost?: CostLike | null;
  logisticsExpenseInvoices?: LogisticsExpenseInvoiceLike[] | null;
};
export type CostLike = {
  id?: string | null;
  supplierId?: string | null;
  supplierNameSnapshot?: string | null;
  vendorName?: string | null;
  supplierType?: string | null;
  supplier?: { supplierName?: string | null; supplierType?: string | null } | null;
  costType?: string | null;
  amount?: NumericLike | null;
  amountCny?: NumericLike | null;
  currency?: string | null;
  status?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  costConfirmed?: boolean | null;
  createdAt?: Date | string | null;
  deletedAt?: Date | string | null;
  documents?: OrderDocumentLike[] | null;
};
export type LogisticsExpenseInvoiceLike = {
  id?: string | null;
  costId?: string | null;
  supplierId?: string | null;
  supplierNameSnapshot?: string | null;
  supplier?: { supplierName?: string | null; supplierType?: string | null } | null;
  costType?: string | null;
  amount?: NumericLike | null;
  amountCny?: NumericLike | null;
  currency?: string | null;
  deletedAt?: Date | string | null;
  invoiceDocumentId?: string | null;
  bill?: { billOfLadingNo?: string | null } | null;
  cost?: CostLike | null;
};
export type DomesticLogisticsInfoLike = {
  transportType?: string | null;
  transportTypeLabel?: string | null;
  destinationPlace?: string | null;
  cargoDescription?: string | null;
  remarkText?: string | null;
};
export type TaxOrderLike = {
  id?: string | null;
  orderNo?: string | null;
  blNo?: string | null;
  billOfLadingNo?: string | null;
  documents?: OrderDocumentLike[] | null;
  costs?: CostLike[] | null;
  domesticLogisticsInfos?: DomesticLogisticsInfoLike[] | null;
  domesticLogisticsInfo?: DomesticLogisticsInfoLike | null;
  taxRefundCompleteness?: unknown;
  tradeTerm?: string | null;
  transportType?: string | null;
  shipmentType?: string | null;
  taxRefundStatus?: string | null;
};
export type SupplierEntry = {
  key: string;
  supplierId: string;
  supplierName: string;
  costId?: string;
  costType?: string;
  amount?: number;
  amountCny?: number;
  currency?: string;
  itemIndex?: number;
  sameSupplierCostCount?: number;
  costIds: string[];
  earliestCostCreatedAt: Date | string | null | undefined;
  missingFactoryCost?: boolean;
};
export type LogisticsInvoiceCoverage = {
  documentId: string;
  documentFileName: string;
  logisticsExpenseId: string;
  invoiceGroupId: string;
  invoiceGroupLabel: string;
  includedFeeTypes: string[];
  costIds: string[];
  supplierName: string;
  billOfLadingNo: string;
  uploadedFileUrl: boolean;
};
export type MissingEntry = Record<string, unknown> & {
  label: string;
  documentType?: string;
  reminderDue?: boolean;
  missingBucket?: string;
};
export type TaxRefundCompletenessSummary = Record<string, unknown> & {
  complete?: boolean;
  total?: number;
  completed?: number;
  text?: string;
};

export const DISABLED_TAX_REFUND_COMPLETENESS_MARKERS = [
  "报关明细待确认",
  "已识别待确认",
  "CUSTOMS_RECOGNIZED_PENDING_CONFIRM",
];

export function asRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

export function hasDisabledTaxRefundCompletenessMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return DISABLED_TAX_REFUND_COMPLETENESS_MARKERS.some((marker) => value.includes(marker));
  }
  if (Array.isArray(value)) return value.some(hasDisabledTaxRefundCompletenessMarker);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasDisabledTaxRefundCompletenessMarker);
  }
  return false;
}

export function sanitizeTaxRefundCompletenessText(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  const sanitized = DISABLED_TAX_REFUND_COMPLETENESS_MARKERS.reduce(
    (current, marker) => current.replaceAll(marker, ""),
    text,
  )
    .replace(/缺失：\s*[、/，,\s]+/g, "缺失：")
    .replace(/[、/，,\s]+$/g, "")
    .replace(/([、/，,]){2,}/g, "$1")
    .trim();
  return sanitized === "缺失：" ? "" : sanitized;
}

export function sanitizeTaxRefundCompletenessValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !hasDisabledTaxRefundCompletenessMarker(item))
      .map(sanitizeTaxRefundCompletenessValue);
  }
  if (typeof value === "string") return sanitizeTaxRefundCompletenessText(value);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeTaxRefundCompletenessValue(item),
      ]),
    );
  }
  return value;
}

export function sanitizeTaxRefundCompletenessSummary<T extends TaxRefundCompletenessSummary>(summary: T): T {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return summary;
  if (!hasDisabledTaxRefundCompletenessMarker(summary)) return summary;
  const sanitized = sanitizeTaxRefundCompletenessValue(summary) as T;
  const total = Number(sanitized.total || 0);
  const completed = Number(sanitized.completed || 0);
  if (Number.isFinite(total) && total > 0) {
    sanitized.total = Math.max(completed, total - 1);
  }
  const missingLabels = Array.isArray(sanitized.missingLabels) ? sanitized.missingLabels : [];
  sanitized.complete = missingLabels.length === 0 && Number(sanitized.completed || 0) >= Number(sanitized.total || 0);
  if (!sanitizeTaxRefundCompletenessText(sanitized.text)) {
    sanitized.text = sanitized.complete ? "资料完整" : "";
  }
  return sanitized;
}
