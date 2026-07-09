import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  ORDER_DOCUMENT_LABELS,
  ORDER_DOCUMENT_TYPES,
  SEA_FREIGHT_REQUIREMENT_KEY,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_EXPORT_DOCUMENT_TYPES,
  TAX_REFUND_LOGISTICS_RULE_VERSION,
  normalizedCostType,
} from "./shared-constants";
import { serializeDomesticLogisticsInfo } from "./shared-serialization";
import {
  type MissingEntry,
  type OrderDocumentLike,
  type SupplierEntry,
  type TaxOrderLike,
  type TaxRefundCompletenessSummary,
  asRecord,
  displayDocumentLabel,
  hasDisabledTaxRefundCompletenessMarker,
  isActualApprovedLogisticsCost,
  isExwTaxRefundOrder,
  isNonFullContainerTaxRefundOrder,
  isSeaFreightRequiredByTradeTerm,
  isTaxRefundFactoryCost,
  isTaxRefundLogisticsInvoiceCost,
  logisticsInvoiceRequirementForCost,
  notApplicableLogisticsRequirementsForOrder,
  orderTransportMode,
  sanitizeTaxRefundCompletenessSummary,
  supplierKey,
  supplierNameForCost,
  supplierTypeForCost,
  successDocument,
  taxRefundLogisticsInvoiceRequirementsForOrder,
} from "./shared-tax-completeness-types";
import {
  logisticsInvoiceGroupCoverages,
  logisticsRequirementMatchesCoverage,
  logisticsRequirementMissingLabel,
  logTaxRefundLogisticsInvoiceDecision,
} from "./shared-tax-logistics-invoices";
import { factoryCostEntryLabel, factoryDocumentMatchesCost } from "./shared-tax-supplier-documents";
import { taxDocumentCompleteness } from "./shared-tax-completeness-calculator";

export {
  displayDocumentLabel,
  hasDisabledTaxRefundCompletenessMarker,
  isExwTaxRefundOrder,
  isNonFullContainerTaxRefundOrder,
  isSeaFreightRequirement,
  isSeaFreightRequiredByTradeTerm,
  isTaxRefundFactoryCost,
  isTaxRefundLogisticsInvoiceCost,
  logisticsInvoiceRequirementForCost,
  normalizedTradeTerm,
  normalizedTransportMode,
  orderTransportMode,
  sanitizeTaxRefundCompletenessSummary,
  sanitizeTaxRefundCompletenessText,
  successDocument,
  supplierKey,
  supplierNameForCost,
  supplierTypeForCost,
  taxRefundLogisticsInvoiceRequirementsForOrder,
} from "./shared-tax-completeness-types";
export {
  logisticsInvoiceLabelForCost,
} from "./shared-tax-logistics-invoices";
export {
  booleanInput,
  canConfirmLogisticsCost,
  confirmedFactorySupplierMismatch,
  inputHasOwn,
  isTaxRefundFactoryDocument,
  isTaxRefundLogisticsInvoiceDocument,
  isTaxRefundSupplierDocument,
} from "./shared-tax-supplier-documents";

export { documentCompleteness, taxDocumentCompleteness } from "./shared-tax-completeness-calculator";

export function derivedTaxRefundStatus(order: TaxOrderLike | null | undefined, documents: OrderDocumentLike[] = order?.documents || []) {
  const status = order?.taxRefundStatus || "NOT_READY";
  if (["COMPLETED", "ARCHIVED"].includes(status)) return "SUBMITTED";
  if (["SUBMITTED", "REFUND_RECEIVED", "PROBLEM"].includes(status)) return status;
  return taxDocumentCompleteness({ ...order, documents }).complete ? "READY" : "NOT_READY";
}

const LEGACY_TAX_REFUND_WORKFLOW_STATUSES = new Set([
  "NO_CUSTOMS",
  "CUSTOMS_RECOGNIZED_PENDING_CONFIRM",
  "HS_NOT_MAINTAINED",
  "REBATE_RATE_MATCHED",
  "SUPPLIER_INVOICE_MATCHED",
  "REFUND_CALCULATED",
]);

export function taxRefundStatusFromCompleteness(currentStatus: unknown, completeness: TaxRefundCompletenessSummary | null | undefined) {
  const status = String(currentStatus || "");
  if (["COMPLETED", "ARCHIVED"].includes(status)) return "SUBMITTED";
  if (["SUBMITTED", "REFUND_RECEIVED", "PROBLEM"].includes(status)) return status;
  if (LEGACY_TAX_REFUND_WORKFLOW_STATUSES.has(status)) return "NOT_READY";
  if (completeness && !completeness.complete && status && !["READY", "NOT_READY"].includes(status)) return status;
  return completeness?.complete ? "READY" : "NOT_READY";
}

export function emptyTaxRefundCompleteness(): TaxRefundCompletenessSummary {
  const supplierTotal = SUPPLIER_DOCUMENT_TYPES.length;
  const factory = {
    completed: 0,
    total: supplierTotal,
    missing: [],
    reminders: [],
    suppliers: [],
    missingFactoryCost: true,
  };
  return {
    complete: false,
    total: DOMESTIC_LOGISTICS_DOCUMENT_TYPES.length + TAX_EXPORT_DOCUMENT_TYPES.length + 1 + supplierTotal + 3,
    completed: 0,
    missingTypes: [],
    missingLabels: [],
    export: { completed: 0, total: TAX_EXPORT_DOCUMENT_TYPES.length, missingTypes: [] },
    customs: { completed: 0, total: DOMESTIC_LOGISTICS_DOCUMENT_TYPES.length, complete: false, missingTypes: [] },
    domesticLogistics: {
      completed: 0,
      total: 1,
      complete: false,
      missing: [{ documentType: "DOMESTIC_LOGISTICS_INFO", label: "物流信息", financeStatus: "MISSING" }],
      info: null,
    },
    factory,
    supplier: factory,
    logistics: {
      completed: 0,
      total: 0,
      ruleVersion: TAX_REFUND_LOGISTICS_RULE_VERSION,
      missing: [],
      reminders: [],
      costs: [],
      requirements: [],
      missingLogisticsInvoices: [],
      missingCustomsInvoices: [],
      missingPortInvoices: [],
      missingSeaInvoices: [],
      notApplicableRequirements: [],
      transportMode: "",
    },
    text: "完整度缓存未生成",
  };
}

export function cachedTaxRefundCompleteness(order: TaxOrderLike = {}): TaxRefundCompletenessSummary {
  const cached = order.taxRefundCompleteness;
  if (cached && typeof cached === "object" && !Array.isArray(cached)) {
    return sanitizeTaxRefundCompletenessSummary(cached as TaxRefundCompletenessSummary);
  }
  return emptyTaxRefundCompleteness();
}

export function needsTaxRefundCompletenessRefresh(order: TaxOrderLike = {}) {
  const cachedValue = order.taxRefundCompleteness;
  const cached = asRecord(cachedValue);
  if (!cachedValue || typeof cachedValue !== "object" || Array.isArray(cachedValue)) return true;
  if (hasDisabledTaxRefundCompletenessMarker(cachedValue)) return true;
  const supplier = asRecord(cached.supplier);
  const factory = asRecord(cached.factory);
  const logistics = asRecord(cached.logistics);
  const exportSection = asRecord(cached.export);
  const customs = asRecord(cached.customs);
  const domesticLogistics = asRecord(cached.domesticLogistics);
  if (!cached || typeof cached !== "object" || Array.isArray(cached)) return true;
  if (Number(supplier.total || 0) < SUPPLIER_DOCUMENT_TYPES.length) return true;
  if (typeof supplier.missingFactoryCost === "undefined") return true;
  if (!Object.keys(factory).length) return true;
  if (!Object.keys(logistics).length || !Array.isArray(logistics.missing)) return true;
  if (logistics.ruleVersion !== TAX_REFUND_LOGISTICS_RULE_VERSION) return true;
  if (Number(exportSection.total || 0) < TAX_EXPORT_DOCUMENT_TYPES.length) return true;
  if (!Object.keys(customs).length || Number(customs.total || 0) !== DOMESTIC_LOGISTICS_DOCUMENT_TYPES.length) return true;
  if (!Object.keys(domesticLogistics).length || Number(domesticLogistics.total || 0) !== 1) return true;
  const cachedLogisticsRequirements = Array.isArray(logistics.requirements) ? logistics.requirements as Array<Record<string, unknown>> : [];
  const hasCachedSeaRequirement = cachedLogisticsRequirements.some((item) => item?.key === SEA_FREIGHT_REQUIREMENT_KEY);
  const hasCachedPortRequirement = cachedLogisticsRequirements.some((item) => item?.key === "PORT");
  if (isExwTaxRefundOrder(order) && cachedLogisticsRequirements.length) return true;
  if (isExwTaxRefundOrder(order) && Array.isArray(logistics.missing) && logistics.missing.length) return true;
  if (!isSeaFreightRequiredByTradeTerm(order) && hasCachedSeaRequirement) return true;
  if (isSeaFreightRequiredByTradeTerm(order) && !hasCachedSeaRequirement) return true;
  if (isNonFullContainerTaxRefundOrder(order) && hasCachedPortRequirement) return true;
  if (isNonFullContainerTaxRefundOrder(order) && Array.isArray(logistics.missingPortInvoices) && logistics.missingPortInvoices.length) return true;
  if (!Array.isArray(logistics.requirements)) return true;
  if (Array.isArray(cached.missingLabels) && cached.missingLabels.some((label) => (ORDER_DOCUMENT_TYPES as readonly string[]).includes(String(label)))) return true;
  return false;
}
