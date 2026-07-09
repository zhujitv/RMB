import { isPlainRecord } from "./shared-base-utils";
import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  FACTORY_SUPPLIER_COST_TYPES,
  ORDER_DOCUMENT_LABELS,
  SEA_FREIGHT_REQUIREMENT_KEY,
  SEA_FREIGHT_REQUIRED_TRADE_TERMS,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_REFUND_BASE_LOGISTICS_REQUIREMENT_KEYS,
  TAX_EXPORT_DOCUMENT_TYPES,
  TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS,
  TAX_REFUND_SUPPLIER_TYPES,
  isLogisticsGeneratedCostSourceType,
  normalizedCostType,
} from "./shared-constants";

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

export function successDocument(doc: OrderDocumentLike | null | undefined): doc is OrderDocumentLike {
  return Boolean(doc && !doc.deletedAt && doc.uploadStatus === "SUCCESS");
}

export function displayDocumentLabel(value: unknown) {
  const key = String(value || "");
  return (ORDER_DOCUMENT_LABELS as Record<string, string>)[key] || key || "";
}

export function supplierKey(cost: CostLike) {
  return cost.supplierId || `vendor:${cost.supplierNameSnapshot || cost.vendorName || cost.id}`;
}

export function supplierNameForCost(cost: CostLike) {
  return cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "未命名供应商";
}

export function supplierTypeForCost(cost: CostLike) {
  return cost.supplierType || cost.supplier?.supplierType || "";
}

export function isTaxRefundFactoryCost(cost: CostLike) {
  return FACTORY_SUPPLIER_COST_TYPES.includes(String(cost.costType || "")) && TAX_REFUND_SUPPLIER_TYPES.includes(supplierTypeForCost(cost));
}

export function isTaxRefundLogisticsInvoiceCost(cost: CostLike | null | undefined) {
  return Boolean(cost?.supplierId && logisticsInvoiceRequirementForCost(cost));
}

export function logisticsInvoiceRequirementForCost(cost: CostLike = {}) {
  const costType = normalizedCostType(String(cost.costType || ""));
  return TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS.find((item) => item.costTypes.includes(costType)) || null;
}

export function normalizedTradeTerm(value = "") {
  const text = String(value || "").trim().toUpperCase();
  if (text.includes("CIF")) return "CIF";
  if (text.includes("CFR")) return "CFR";
  if (text.includes("FOB")) return "FOB";
  if (text.includes("EXW")) return "EXW";
  return text;
}

export function normalizedTaxRefundTradeTerm(order: TaxOrderLike = {}) {
  const orderRecord = asRecord(order);
  const candidates = [
    order.tradeTerm,
    orderRecord.declarationType,
    orderRecord.customsDeclarationType,
    orderRecord.tradeMode,
    orderRecord.modeOfTrade,
    orderRecord.exportMode,
    orderRecord.customsTradeMode,
  ];
  return candidates.map((value) => normalizedTradeTerm(String(value || ""))).find((value) => (
    value === "FOB" || value === "CIF" || value === "CFR" || value === "EXW"
  )) || normalizedTradeTerm(order.tradeTerm || "");
}

export function isExwTaxRefundOrder(order: TaxOrderLike = {}) {
  return normalizedTaxRefundTradeTerm(order) === "EXW";
}

export function isSeaFreightRequirement(requirement: { key?: string } = {}) {
  return requirement.key === SEA_FREIGHT_REQUIREMENT_KEY;
}

export function isSeaFreightRequiredByTradeTerm(order: TaxOrderLike = {}) {
  return SEA_FREIGHT_REQUIRED_TRADE_TERMS.includes(normalizedTaxRefundTradeTerm(order));
}

export function numberValue(value: NumericLike | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizedTransportMode(value: unknown = "") {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  if (
    ["LCL", "BULK", "BULK_WAREHOUSE", "BULK WAREHOUSE", "WAREHOUSE", "LOOSE", "LOOSE_CARGO", "LOOSE CARGO"].includes(text)
    || text.includes("LCL")
    || text.includes("BULK")
    || text.includes("LOOSE CARGO")
    || text.includes("LESS THAN CONTAINER")
    || text.includes("拼箱")
    || text.includes("散货")
    || text.includes("非整柜")
  ) return "LCL";
  if (["FCL", "FULL_CONTAINER", "FULL CONTAINER", "CONTAINER", "TRUCK", "MULTIMODAL", "整柜", "车辆运输", "多式联运"].includes(text)) return "FCL";
  if (["AIR", "AIR_FREIGHT", "AIR FREIGHT", "空运"].includes(text)) return "AIR";
  if (["EXPRESS", "COURIER", "快递", "快递运输"].includes(text)) return "EXPRESS";
  return text;
}

export function orderTransportMode(order: TaxOrderLike = {}) {
  const domesticLogisticsInfos = [
    ...(order.domesticLogisticsInfos || []),
    ...(order.domesticLogisticsInfo ? [order.domesticLogisticsInfo] : []),
  ];
  const candidates = [
    order.transportType,
    order.shipmentType,
    ...domesticLogisticsInfos.flatMap((info) => [
      info?.transportType,
      info?.transportTypeLabel,
      info?.remarkText,
    ]),
  ];
  const modes = candidates.map(normalizedTransportMode).filter(Boolean);
  return modes.find((mode) => mode === "LCL") || modes[0] || "";
}

export function positiveCostAmount(cost: CostLike = {}) {
  return Math.max(numberValue(cost.amountCny), numberValue(cost.amount)) > 0;
}

export function isActualApprovedLogisticsCost(cost: CostLike = {}) {
	if (!positiveCostAmount(cost)) return false;
	return isLogisticsGeneratedCostSourceType(cost.sourceType) || cost.costConfirmed === true || !cost.sourceType;
}

export function isNonFullContainerTaxRefundOrder(order: TaxOrderLike = {}) {
  return orderTransportMode(order) === "LCL";
}

export function isPortChargesRequirement(requirement: { key?: string } = {}) {
  return requirement.key === "PORT";
}

export function taxRefundLogisticsInvoiceRequirementsForOrder(order: TaxOrderLike = {}, logisticsInvoiceCosts: CostLike[] = []) {
  if (isExwTaxRefundOrder(order)) return [];
  const actualRequirementKeys = new Set(logisticsInvoiceCosts.flatMap((cost) => {
    const requirement = logisticsInvoiceRequirementForCost(cost);
    return requirement?.key ? [requirement.key] : [];
  }));
  const tradeTerm = normalizedTaxRefundTradeTerm(order);
  const tradeTermRequiredKeys = new Set<string>();
  if (["FOB", "CIF", "CFR"].includes(tradeTerm)) {
    TAX_REFUND_BASE_LOGISTICS_REQUIREMENT_KEYS.forEach((key) => tradeTermRequiredKeys.add(key));
  }
  if (isSeaFreightRequiredByTradeTerm(order)) {
    tradeTermRequiredKeys.add(SEA_FREIGHT_REQUIREMENT_KEY);
  }
  const nonFullContainer = isNonFullContainerTaxRefundOrder(order);
  if (nonFullContainer) {
    tradeTermRequiredKeys.delete("PORT");
    actualRequirementKeys.delete("PORT");
  }
  return TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS.filter((requirement) => (
    (!nonFullContainer || !isPortChargesRequirement(requirement))
    && (
      tradeTermRequiredKeys.has(requirement.key)
      || (tradeTerm !== "FOB" && actualRequirementKeys.has(requirement.key))
    )
  ));
}

export function notApplicableLogisticsRequirementsForOrder(order: TaxOrderLike = {}) {
  if (isExwTaxRefundOrder(order)) {
    return [{
      key: "LOGISTICS_INVOICE",
      label: "物流费用发票",
      reason: "EXW 条款下不强制要求物流费用发票",
    }];
  }
  if (!isNonFullContainerTaxRefundOrder(order)) return [];
  return [{
    key: "PORT",
    label: "港杂费",
    reason: "拼箱散货/非整柜出口不强制要求港杂费",
  }];
}
