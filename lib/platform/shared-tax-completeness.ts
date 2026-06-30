import { canRead, canWrite, type AccessUser } from "./shared-access";
import { isPlainRecord } from "./shared-base-utils";
import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  FACTORY_SUPPLIER_COST_TYPES,
  ORDER_DOCUMENT_LABELS,
  ORDER_DOCUMENT_TYPES,
  SEA_FREIGHT_REQUIREMENT_KEY,
  SEA_FREIGHT_REQUIRED_TRADE_TERMS,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_EXPORT_DOCUMENT_TYPES,
  TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS,
  TAX_REFUND_LOGISTICS_RULE_VERSION,
  TAX_REFUND_SUPPLIER_TYPES,
  normalizedCostType,
} from "./shared-constants";
import { logisticsInvoiceGroupForExpense } from "./logistics-invoice-groups";
import { serializeDomesticLogisticsInfo } from "./shared-serialization";

type NumericLike = number | string | { toString(): string };
type OrderDocumentLike = {
  id?: string | null;
  documentType?: string | null;
  fileName?: string | null;
  uploadStatus?: string | null;
  deletedAt?: Date | string | null;
  costId?: string | null;
  relatedModule?: string | null;
  supplierId?: string | null;
  supplier?: { supplierType?: string | null } | null;
  cost?: CostLike | null;
};
type CostLike = {
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
  sourceType?: string | null;
  sourceId?: string | null;
  costConfirmed?: boolean | null;
  createdAt?: Date | string | null;
  deletedAt?: Date | string | null;
};
type DomesticLogisticsInfoLike = {
  transportType?: string | null;
  destinationPlace?: string | null;
  cargoDescription?: string | null;
  remarkText?: string | null;
};
type TaxOrderLike = {
  id?: string | null;
  orderNo?: string | null;
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
type SupplierEntry = {
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
type LogisticsInvoiceCoverage = {
  documentId: string;
  logisticsExpenseId: string;
  invoiceGroupId: string;
  invoiceGroupLabel: string;
  includedFeeTypes: string[];
  costIds: string[];
};
type MissingEntry = Record<string, unknown> & {
  label: string;
  documentType?: string;
  reminderDue?: boolean;
  missingBucket?: string;
};
type TaxRefundCompletenessSummary = Record<string, unknown> & {
  complete?: boolean;
  total?: number;
  completed?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

export function documentCompleteness(documents: OrderDocumentLike[] = []) {
  return taxDocumentCompleteness({ documents });
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
  return String(value || "").trim().toUpperCase();
}

export function isSeaFreightRequirement(requirement: { key?: string } = {}) {
  return requirement.key === SEA_FREIGHT_REQUIREMENT_KEY;
}

export function isSeaFreightRequiredByTradeTerm(order: TaxOrderLike = {}) {
  return SEA_FREIGHT_REQUIRED_TRADE_TERMS.includes(normalizedTradeTerm(order.tradeTerm || ""));
}

function numberValue(value: NumericLike | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizedTransportMode(value: unknown = "") {
  const text = String(value || "").trim().toUpperCase();
  if (["FCL", "FULL_CONTAINER", "FULL CONTAINER", "CONTAINER", "TRUCK", "MULTIMODAL", "整柜", "车辆运输", "多式联运"].includes(text)) return "FCL";
  if (["LCL", "BULK_WAREHOUSE", "BULK WAREHOUSE", "WAREHOUSE", "拼箱", "散货", "散货进舱"].includes(text)) return "LCL";
  if (["AIR", "AIR_FREIGHT", "AIR FREIGHT", "空运"].includes(text)) return "AIR";
  if (["EXPRESS", "COURIER", "快递", "快递运输"].includes(text)) return "EXPRESS";
  return text;
}

export function orderTransportMode(order: TaxOrderLike = {}) {
  const domesticLogisticsInfo = (order.domesticLogisticsInfos || [])[0] || order.domesticLogisticsInfo || null;
  return normalizedTransportMode(order.transportType || order.shipmentType || domesticLogisticsInfo?.transportType || "");
}

function positiveCostAmount(cost: CostLike = {}) {
  return Math.max(numberValue(cost.amountCny), numberValue(cost.amount)) > 0;
}

function isActualApprovedLogisticsCost(cost: CostLike = {}) {
  if (!positiveCostAmount(cost)) return false;
  const sourceType = String(cost.sourceType || "");
  return sourceType === "LOGISTICS_EXPENSE" || cost.costConfirmed === true || !sourceType;
}

function isFobLclOrder(order: TaxOrderLike = {}) {
  return normalizedTradeTerm(order.tradeTerm || "") === "FOB" && orderTransportMode(order) === "LCL";
}

function isLclGeneralLogisticsRequirement(requirement: { key?: string } = {}) {
  return requirement.key === "TRUCKING";
}

export function taxRefundLogisticsInvoiceRequirementsForOrder(order: TaxOrderLike = {}, logisticsInvoiceCosts: CostLike[] = []) {
  const hasSeaFreightCost = logisticsInvoiceCosts.some((cost) => normalizedCostType(String(cost.costType || "")) === "海运费");
  const actualRequirementKeys = new Set(logisticsInvoiceCosts.flatMap((cost) => {
    const requirement = logisticsInvoiceRequirementForCost(cost);
    return requirement?.key ? [requirement.key] : [];
  }));
  const fobLcl = isFobLclOrder(order);
  return TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS.filter((requirement) => (
    actualRequirementKeys.has(requirement.key)
    || (requirement.key === "CUSTOMS" && fobLcl)
    || (isLclGeneralLogisticsRequirement(requirement) && fobLcl)
    || (isSeaFreightRequirement(requirement) && (isSeaFreightRequiredByTradeTerm(order) || hasSeaFreightCost))
  ));
}

export function logisticsInvoiceLabelForCost(cost: CostLike = {}) {
  return logisticsInvoiceRequirementForCost(cost)?.label || "物流资料";
}

function logisticsInvoiceGroupForCost(cost: CostLike = {}) {
  return logisticsInvoiceGroupForExpense({
    costType: normalizedCostType(String(cost.costType || "")),
    currency: cost.currency,
  });
}

function uniqueNormalizedCostTypes(costs: CostLike[] = []) {
  return [...new Set(costs
    .map((cost) => normalizedCostType(String(cost.costType || "")))
    .filter(Boolean))];
}

function logisticsInvoiceGroupCoverages(documents: OrderDocumentLike[] = [], logisticsInvoiceCosts: CostLike[] = []) {
  const costsById = new Map<string, CostLike>(
    logisticsInvoiceCosts
      .map((cost): [string, CostLike] => [cost.id || "", cost])
      .filter(([id]) => Boolean(id)),
  );
  return documents
    .filter((document) => (
      document.documentType === "SUPPLIER_INVOICE"
      && document.relatedModule === "SUPPLIER"
    ))
    .map((document): LogisticsInvoiceCoverage | null => {
      const documentCost = (document.cost && isTaxRefundLogisticsInvoiceCost(document.cost))
        ? document.cost
        : costsById.get(document.costId || "") || null;
      if (!documentCost || !isTaxRefundLogisticsInvoiceCost(documentCost)) return null;
      const group = logisticsInvoiceGroupForCost(documentCost);
      if (!group) return null;
      const groupCosts = logisticsInvoiceCosts.filter((cost) => logisticsInvoiceGroupForCost(cost)?.key === group.key);
      return {
        documentId: document.id || "",
        logisticsExpenseId: documentCost.sourceId || documentCost.id || "",
        invoiceGroupId: group.key,
        invoiceGroupLabel: group.label,
        includedFeeTypes: uniqueNormalizedCostTypes(groupCosts.length ? groupCosts : [documentCost]),
        costIds: groupCosts.map((cost) => cost.id || "").filter(Boolean),
      };
    })
    .filter((item): item is LogisticsInvoiceCoverage => Boolean(item));
}

function logisticsRequirementMatchesCoverage(requirement: { costTypes?: string[] } = {}, coverage: LogisticsInvoiceCoverage) {
  const requiredTypes = new Set((requirement.costTypes || []).map((type) => normalizedCostType(String(type || ""))).filter(Boolean));
  return coverage.includedFeeTypes.some((costType) => requiredTypes.has(costType));
}

function logTaxRefundLogisticsInvoiceDecision({
  order,
  requirement,
  costs,
  directCompleted,
  matchedCoverages,
  completed,
}: {
  order: TaxOrderLike;
  requirement: { key?: string; label?: string; costTypes?: string[] };
  costs: CostLike[];
  directCompleted: boolean;
  matchedCoverages: LogisticsInvoiceCoverage[];
  completed: boolean;
}) {
  const truckingCosts = costs.filter((cost) => normalizedCostType(String(cost.costType || "")) === "拖车费");
  const hasTruckingCost = truckingCosts.length > 0;
  const candidateLogisticsExpenseIds = costs.map((cost) => cost.sourceId || cost.id || "").filter(Boolean);
  const candidateInvoiceGroupIds = [...new Set(costs.map((cost) => logisticsInvoiceGroupForCost(cost)?.key || "").filter(Boolean))];
  const candidateIncludedFeeTypes = uniqueNormalizedCostTypes(costs);
  const directTruckingCompleted = directCompleted && truckingCosts.some((cost) => (
    cost.id && matchedCoverages.some((coverage) => coverage.costIds.includes(cost.id || ""))
  ));
  const truckingCoveredByGroup = matchedCoverages.some((coverage) => coverage.includedFeeTypes.includes("拖车费"));
  if (requirement.key !== "TRUCKING" && !hasTruckingCost && !truckingCoveredByGroup) return;
  const orderRecord = order as Record<string, unknown>;
  console.info("tax-refund-logistics-invoice-decision", {
    orderId: orderRecord.id || "",
    orderNo: orderRecord.orderNo || "",
    requirementKey: requirement.key || "",
    requirementLabel: requirement.label || "",
    logisticsExpenseIds: matchedCoverages.map((coverage) => coverage.logisticsExpenseId).filter(Boolean),
    candidateLogisticsExpenseIds,
    invoiceGroupIds: matchedCoverages.map((coverage) => coverage.invoiceGroupId).filter(Boolean),
    candidateInvoiceGroupIds,
    invoiceGroups: matchedCoverages.map((coverage) => ({
      documentId: coverage.documentId,
      logisticsExpenseId: coverage.logisticsExpenseId,
      invoiceGroupId: coverage.invoiceGroupId,
      includedFeeTypes: coverage.includedFeeTypes,
    })),
    includedFeeTypes: [...new Set(matchedCoverages.flatMap((coverage) => coverage.includedFeeTypes))],
    candidateIncludedFeeTypes,
    costIds: costs.map((cost) => cost.id || "").filter(Boolean),
    directCostInvoiceMatched: directCompleted,
    "拖车费": directTruckingCompleted || truckingCoveredByGroup,
    completed,
  });
}

export function isTaxRefundFactoryDocument(document: OrderDocumentLike) {
  const supplierType = document.supplier?.supplierType || document.cost?.supplier?.supplierType || "";
  return TAX_REFUND_SUPPLIER_TYPES.includes(supplierType);
}

export function isTaxRefundLogisticsInvoiceDocument(document: OrderDocumentLike) {
  return document.documentType === "SUPPLIER_INVOICE" && isTaxRefundLogisticsInvoiceCost(document.cost);
}

export function isTaxRefundSupplierDocument(document: OrderDocumentLike) {
  if (document.documentType === "SUPPLIER_PURCHASE_CONTRACT") return isTaxRefundFactoryDocument(document);
  if (document.documentType === "SUPPLIER_INVOICE") return isTaxRefundFactoryDocument(document) || isTaxRefundLogisticsInvoiceDocument(document);
  return false;
}

function factoryDocumentMatchesCost(document: OrderDocumentLike, cost: CostLike, allowLegacySupplierFallback = false) {
  if (!successDocument(document)) return false;
  if (!cost.id || !cost.supplierId) return false;
  if (document.relatedModule !== "SUPPLIER") return false;
  if (!SUPPLIER_DOCUMENT_TYPES.includes(document.documentType as never)) return false;
  if (document.costId) return document.costId === cost.id;
  return allowLegacySupplierFallback && document.supplierId === cost.supplierId;
}

function factoryCostEntryLabel(cost: CostLike, itemIndex: number, sameSupplierCostCount: number) {
  const supplierName = supplierNameForCost(cost);
  const costType = normalizedCostType(String(cost.costType || "")) || "工厂货款";
  const amount = numberValue(cost.amountCny) || numberValue(cost.amount);
  const amountText = amount > 0 ? ` ${cost.currency || "CNY"} ${amount}` : "";
  const itemLabel = sameSupplierCostCount > 1 ? `工厂货款 ${itemIndex}` : costType;
  return `${supplierName} / ${itemLabel}${amountText}`;
}

export function confirmedFactorySupplierMismatch(input: Record<string, unknown> = {}) {
  return input.factorySupplierMismatchConfirmed === true || input.factorySupplierMismatchConfirmed === "true";
}

export function booleanInput(value: unknown, fallback = false) {
  if (value === true || value === "true" || value === "已确认") return true;
  if (value === false || value === "false" || value === "未确认") return false;
  return Boolean(fallback);
}

export function inputHasOwn(input: Record<string, unknown> | null | undefined, key: string) {
  return Object.prototype.hasOwnProperty.call(input || {}, key);
}

export function canConfirmLogisticsCost(actor: AccessUser) {
  return ["管理员", "财务"].includes(String(actor?.role || "")) || (canWrite(actor, "commissions") && canRead(actor, "payments"));
}

export function taxDocumentCompleteness(order: TaxOrderLike = {}) {
  const documents = order.documents || [];
  const activeCosts = (order.costs || []).filter((cost) => !cost.deletedAt && cost.supplierId);
  const factoryCosts = activeCosts.filter(isTaxRefundFactoryCost);
  const logisticsInvoiceCosts = activeCosts.filter((cost) => !isTaxRefundFactoryCost(cost) && isTaxRefundLogisticsInvoiceCost(cost) && isActualApprovedLogisticsCost(cost));
  const successDocs = documents.filter(successDocument);
  const logisticsInvoiceCoverages = logisticsInvoiceGroupCoverages(successDocs, logisticsInvoiceCosts);
  const hasOrderType = (type: string) => successDocs.some((doc) => doc.documentType === type && !doc.costId && doc.relatedModule !== "SUPPLIER");
  const domesticLogisticsInfo = (order.domesticLogisticsInfos || [])[0] || order.domesticLogisticsInfo || null;
  const customsMissing = DOMESTIC_LOGISTICS_DOCUMENT_TYPES.filter((type) => !hasOrderType(type));
  const exportMissing = TAX_EXPORT_DOCUMENT_TYPES.filter((type) => !hasOrderType(type));
  const domesticLogisticsComplete = Boolean(
    domesticLogisticsInfo
    && String(domesticLogisticsInfo.destinationPlace || "").trim()
    && String(domesticLogisticsInfo.cargoDescription || "").trim()
    && String(domesticLogisticsInfo.remarkText || "").trim()
  );
  const domesticLogisticsMissing = domesticLogisticsComplete ? [] : [{
    documentType: "DOMESTIC_LOGISTICS_INFO",
    label: "物流信息",
  }];
  const supplierCostCounts = factoryCosts.reduce<Record<string, number>>((acc, cost) => {
    const key = supplierKey(cost);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const supplierCostIndexes = new Map<string, number>();
  const supplierEntries: SupplierEntry[] = factoryCosts.map((cost) => {
    const key = supplierKey(cost);
    const itemIndex = (supplierCostIndexes.get(key) || 0) + 1;
    supplierCostIndexes.set(key, itemIndex);
    const sameSupplierCostCount = supplierCostCounts[key] || 1;
    return {
      key: `${key}:${cost.id || itemIndex}`,
      supplierId: cost.supplierId || "",
      supplierName: supplierNameForCost(cost),
      costId: cost.id || "",
      costType: normalizedCostType(String(cost.costType || "")),
      amount: Number(cost.amount || 0),
      amountCny: Number(cost.amountCny || 0),
      currency: cost.currency || "CNY",
      itemIndex,
      sameSupplierCostCount,
      costIds: cost.id ? [cost.id] : [],
      earliestCostCreatedAt: cost.createdAt,
    };
  });
  const hasFactorySupplierCost = supplierEntries.length > 0;
  const supplierRequirementEntries = hasFactorySupplierCost
    ? supplierEntries
    : [{
        key: "__missing_factory_supplier__",
        supplierId: "",
        supplierName: "未录入产品供应商",
        costIds: [],
        earliestCostCreatedAt: null,
        missingFactoryCost: true,
      }];
  const supplierMissing: MissingEntry[] = [];
  supplierRequirementEntries.forEach((entry) => {
    const costCreatedAt = entry.earliestCostCreatedAt ? new Date(entry.earliestCostCreatedAt) : null;
    const daysSinceCostCreated = costCreatedAt ? Math.floor((Date.now() - costCreatedAt.getTime()) / 86400000) : 0;
    SUPPLIER_DOCUMENT_TYPES.forEach((type) => {
      const cost = factoryCosts.find((item) => item.id && item.id === entry.costId) || null;
      const allowLegacySupplierFallback = Boolean(cost && entry.sameSupplierCostCount === 1);
      const exists = entry.missingFactoryCost ? false : successDocs.some((doc) => (
        doc.documentType === type
        && cost
        && factoryDocumentMatchesCost(doc, cost, allowLegacySupplierFallback)
      ));
      const matchedDocument = entry.missingFactoryCost ? null : successDocs.find((doc) => (
        doc.documentType === type
        && cost
        && factoryDocumentMatchesCost(doc, cost, allowLegacySupplierFallback)
      ));
      if (!entry.missingFactoryCost) {
        console.info("tax-refund-factory-document-match", {
          orderId: (order as Record<string, unknown>).id || "",
          supplierId: entry.supplierId,
          costItemId: entry.costId || "",
          purchaseOrderId: "",
          documentType: type,
          matchedDocumentId: matchedDocument?.id || "",
          matchedFileName: (matchedDocument as Record<string, unknown> | null)?.fileName || "",
        });
      }
      if (!exists) {
        supplierMissing.push({
          costId: entry.costId,
          supplierId: entry.supplierId,
          supplierName: entry.supplierName,
          costType: entry.costType,
          amount: entry.amount,
          amountCny: entry.amountCny,
          currency: entry.currency,
          itemIndex: entry.itemIndex,
          sameSupplierCostCount: entry.sameSupplierCostCount,
          documentType: type,
          label: entry.missingFactoryCost
            ? "缺少产品供应商成本记录"
            : `${factoryCostEntryLabel(cost || {}, entry.itemIndex || 1, entry.sameSupplierCostCount || 1)} ${type === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂合同" : "工厂发票"}`,
          reminderDue: daysSinceCostCreated >= 3,
          daysSinceCostCreated,
          missingFactoryCost: Boolean(entry.missingFactoryCost),
        });
      }
    });
  });
  const exportCompleted = TAX_EXPORT_DOCUMENT_TYPES.length - exportMissing.length;
  const supplierTotal = Math.max(SUPPLIER_DOCUMENT_TYPES.length, supplierRequirementEntries.length * SUPPLIER_DOCUMENT_TYPES.length);
  const supplierCompleted = supplierTotal - supplierMissing.length;
  const logisticsMissing: MissingEntry[] = [];
  const logisticsRequirements = taxRefundLogisticsInvoiceRequirementsForOrder(order, logisticsInvoiceCosts);
  const logisticsRequirementRows = logisticsRequirements.map((requirement) => {
    const costs = logisticsInvoiceCosts.filter((cost) => requirement.costTypes.includes(normalizedCostType(String(cost.costType || ""))));
    const directCompleted = costs.some((cost) => successDocs.some((doc) => (
      doc.documentType === "SUPPLIER_INVOICE"
      && doc.relatedModule === "SUPPLIER"
      && doc.costId === cost.id
    )));
    const matchedCoverages = logisticsInvoiceCoverages.filter((coverage) => logisticsRequirementMatchesCoverage(requirement, coverage));
    const completed = directCompleted || matchedCoverages.length > 0;
    logTaxRefundLogisticsInvoiceDecision({
      order,
      requirement,
      costs,
      directCompleted,
      matchedCoverages,
      completed,
    });
    if (!costs.length) {
      logisticsMissing.push({
        requirementKey: requirement.key,
        documentType: "SUPPLIER_INVOICE",
        invoiceLabel: requirement.label,
        label: requirement.missingCostLabel,
        missingCost: true,
        missingBucket: requirement.key,
      });
    } else if (!completed) {
      const cost = costs[0];
      const costCreatedAt = cost.createdAt ? new Date(cost.createdAt) : null;
      const daysSinceCostCreated = costCreatedAt ? Math.floor((Date.now() - costCreatedAt.getTime()) / 86400000) : 0;
      logisticsMissing.push({
        requirementKey: requirement.key,
        costId: cost.id,
        supplierId: cost.supplierId,
        supplierName: supplierNameForCost(cost),
        supplierType: supplierTypeForCost(cost),
        costType: normalizedCostType(String(cost.costType || "")),
        costTypeRaw: cost.costType,
        amount: Number(cost.amount || 0),
        amountCny: Number(cost.amountCny || 0),
        currency: cost.currency || "CNY",
        documentType: "SUPPLIER_INVOICE",
        invoiceLabel: requirement.label,
        missingBucket: requirement.key,
        label: "缺少已发生费用对应资料",
        reminderDue: daysSinceCostCreated >= 3,
        daysSinceCostCreated,
      });
    }
    return {
      key: requirement.key,
      label: requirement.label,
      missingCostLabel: requirement.missingCostLabel,
      costTypes: requirement.costTypes,
      completed,
      costs: costs.map((cost) => ({
        costId: cost.id,
        supplierId: cost.supplierId,
        supplierName: supplierNameForCost(cost),
        supplierType: supplierTypeForCost(cost),
        costType: normalizedCostType(String(cost.costType || "")),
        costTypeRaw: cost.costType,
        amount: Number(cost.amount || 0),
        amountCny: Number(cost.amountCny || 0),
        currency: cost.currency || "CNY",
        invoiceLabel: requirement.label,
      })),
      invoiceGroups: matchedCoverages.map((coverage) => ({
        documentId: coverage.documentId,
        logisticsExpenseId: coverage.logisticsExpenseId,
        invoiceGroupId: coverage.invoiceGroupId,
        invoiceGroupLabel: coverage.invoiceGroupLabel,
        includedFeeTypes: coverage.includedFeeTypes,
        costIds: coverage.costIds,
      })),
    };
  });
  const logisticsTotal = logisticsRequirements.length;
  const logisticsCompleted = logisticsTotal - logisticsMissing.length;
  const missingLabels = [
    ...customsMissing.map((type) => (ORDER_DOCUMENT_LABELS as Record<string, string>)[type] || type),
    ...exportMissing.map((type) => (ORDER_DOCUMENT_LABELS as Record<string, string>)[type] || type),
    ...domesticLogisticsMissing.map((item) => item.label),
    ...supplierMissing.map((item) => item.label),
    ...logisticsMissing.map((item) => item.label),
  ].map(displayDocumentLabel).filter((item, index, arr) => arr.indexOf(item) === index);
  const domesticLogisticsTotal = 1;
  const customsTotal = DOMESTIC_LOGISTICS_DOCUMENT_TYPES.length;
  const customsCompleted = customsTotal - customsMissing.length;
  const domesticLogisticsCompleted = domesticLogisticsComplete ? 1 : 0;
  const total = customsTotal + TAX_EXPORT_DOCUMENT_TYPES.length + domesticLogisticsTotal + supplierTotal + logisticsTotal;
  const completed = customsCompleted + exportCompleted + domesticLogisticsCompleted + supplierCompleted + logisticsCompleted;
  const factory = {
    completed: supplierCompleted,
    total: supplierTotal,
    missing: supplierMissing,
    reminders: supplierMissing.filter((item) => item.reminderDue),
    suppliers: supplierEntries,
    missingFactoryCost: !hasFactorySupplierCost,
  };
  const logistics = {
    completed: logisticsCompleted,
    total: logisticsTotal,
    ruleVersion: TAX_REFUND_LOGISTICS_RULE_VERSION,
    missing: logisticsMissing,
    reminders: logisticsMissing.filter((item) => item.reminderDue),
    costs: logisticsRequirementRows.flatMap((item) => item.costs),
    requirements: logisticsRequirementRows,
    missingLogisticsInvoices: logisticsMissing.filter((item) => item.missingBucket === "DOMESTIC_LOGISTICS"),
    missingCustomsInvoices: logisticsMissing.filter((item) => item.missingBucket === "CUSTOMS"),
    missingPortInvoices: logisticsMissing.filter((item) => item.missingBucket === "PORT"),
    missingSeaInvoices: logisticsMissing.filter((item) => item.missingBucket === "SEA"),
  };
  return {
    complete: missingLabels.length === 0,
    total,
    completed,
    missingTypes: [
      ...customsMissing,
      ...exportMissing,
      ...domesticLogisticsMissing.map((item) => item.documentType),
      ...supplierMissing.map((item) => item.documentType),
      ...logisticsMissing.map((item) => item.documentType),
    ],
    missingLabels,
    export: { completed: exportCompleted, total: TAX_EXPORT_DOCUMENT_TYPES.length, missingTypes: exportMissing },
    domesticLogistics: {
      completed: domesticLogisticsCompleted,
      total: domesticLogisticsTotal,
      complete: domesticLogisticsComplete,
      missing: domesticLogisticsMissing,
      info: domesticLogisticsInfo ? serializeDomesticLogisticsInfo(domesticLogisticsInfo) : null,
    },
    customs: {
      completed: customsCompleted,
      total: customsTotal,
      complete: customsMissing.length === 0,
      missingTypes: customsMissing,
    },
    factory,
    supplier: factory,
    logistics,
    text: missingLabels.length === 0 ? "资料完整" : `缺失：${missingLabels.join("、")}`,
  };
}

export function derivedTaxRefundStatus(order: TaxOrderLike | null | undefined, documents: OrderDocumentLike[] = order?.documents || []) {
  const status = order?.taxRefundStatus || "NOT_READY";
  if (["COMPLETED", "ARCHIVED"].includes(status)) return "SUBMITTED";
  if (["SUBMITTED", "PROBLEM"].includes(status)) return status;
  return taxDocumentCompleteness({ ...order, documents }).complete ? "READY" : "NOT_READY";
}

export function taxRefundStatusFromCompleteness(currentStatus: unknown, completeness: TaxRefundCompletenessSummary | null | undefined) {
  const status = String(currentStatus || "");
  if (["COMPLETED", "ARCHIVED"].includes(status)) return "SUBMITTED";
  if (["SUBMITTED", "PROBLEM"].includes(status)) return status;
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
    },
    text: "完整度缓存未生成",
  };
}

export function cachedTaxRefundCompleteness(order: TaxOrderLike = {}): TaxRefundCompletenessSummary {
  const cached = order.taxRefundCompleteness;
  if (cached && typeof cached === "object" && !Array.isArray(cached)) return cached as TaxRefundCompletenessSummary;
  return emptyTaxRefundCompleteness();
}

export function needsTaxRefundCompletenessRefresh(order: TaxOrderLike = {}) {
  const cachedValue = order.taxRefundCompleteness;
  const cached = asRecord(cachedValue);
  if (!cachedValue || typeof cachedValue !== "object" || Array.isArray(cachedValue)) return true;
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
  if (!isSeaFreightRequiredByTradeTerm(order) && hasCachedSeaRequirement) return true;
  if (isSeaFreightRequiredByTradeTerm(order) && !hasCachedSeaRequirement) return true;
  if (!Array.isArray(logistics.requirements)) return true;
  if (Array.isArray(cached.missingLabels) && cached.missingLabels.some((label) => (ORDER_DOCUMENT_TYPES as readonly string[]).includes(String(label)))) return true;
  return false;
}
