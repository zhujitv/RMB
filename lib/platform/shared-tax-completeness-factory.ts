import {
  ORDER_COST_STATUS_VOID,
  SUPPLIER_DOCUMENT_TYPES,
  normalizedCostType,
} from "./shared-constants";
import {
  type CostLike,
  type MissingEntry,
  type OrderDocumentLike,
  type SupplierEntry,
  type TaxOrderLike,
  successDocument,
  supplierKey,
  supplierNameForCost,
} from "./shared-tax-completeness-types";
import { factoryCostEntryLabel, factoryDocumentMatchesCost } from "./shared-tax-supplier-documents";

export function successTaxRefundDocument(
  document: OrderDocumentLike | null | undefined,
): document is OrderDocumentLike {
  return successDocument(document) && document.cost?.status !== ORDER_COST_STATUS_VOID;
}

function normalizedFactoryCostAmount(cost: CostLike) {
  const amountCny = Number(cost.amountCny || 0);
  const amount = Number(cost.amount || 0);
  const value = amountCny > 0 ? amountCny : amount;
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function factoryCostShadowKey(cost: CostLike) {
  if (cost.sourceType && cost.sourceId) return `source:${cost.sourceType}:${cost.sourceId}`;
  return [
    cost.supplierId || supplierNameForCost(cost),
    normalizedCostType(String(cost.costType || "")),
    cost.currency || "CNY",
    normalizedFactoryCostAmount(cost),
  ].map((value) => String(value || "").trim()).join("|");
}

function successfulFactoryDocumentCount(cost: CostLike, documents: OrderDocumentLike[] = []) {
  return [...(cost.documents || []), ...documents].filter((document) => (
    successDocument(document)
    && SUPPLIER_DOCUMENT_TYPES.includes(document.documentType as never)
    && (document.costId === cost.id || (!document.costId && document.supplierId === cost.supplierId))
  )).length;
}

export function uniqueTaxRefundFactoryCosts(
  costs: CostLike[] = [],
  documents: OrderDocumentLike[] = [],
) {
  const groups = new Map<string, CostLike[]>();
  costs.forEach((cost) => {
    const key = factoryCostShadowKey(cost);
    groups.set(key, [...(groups.get(key) || []), cost]);
  });
  return [...groups.values()].flatMap((items) => {
    if (items.length <= 1) return items;
    const withDocuments = items
      .map((cost) => ({ cost, score: successfulFactoryDocumentCount(cost, documents) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const withoutDocuments = items.filter((cost) => successfulFactoryDocumentCount(cost, documents) === 0);
    if (withDocuments.length === 1 && withoutDocuments.length > 0) return [withDocuments[0].cost];
    return items;
  });
}

function supplierEntryForCost(
  cost: CostLike,
  supplierCostCounts: Record<string, number>,
  supplierCostIndexes: Map<string, number>,
): SupplierEntry {
  const key = supplierKey(cost);
  const itemIndex = (supplierCostIndexes.get(key) || 0) + 1;
  supplierCostIndexes.set(key, itemIndex);
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
    sameSupplierCostCount: supplierCostCounts[key] || 1,
    costIds: cost.id ? [cost.id] : [],
    earliestCostCreatedAt: cost.createdAt,
  };
}

function missingSupplierDocument(
  entry: SupplierEntry,
  type: string,
  cost: CostLike | null,
  daysSinceCostCreated: number,
): MissingEntry {
  return {
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
  };
}

export function factoryTaxDocumentCompleteness(
  order: TaxOrderLike,
  factoryCosts: CostLike[],
  successDocs: OrderDocumentLike[],
) {
  const supplierCostCounts = factoryCosts.reduce<Record<string, number>>((acc, cost) => {
    const key = supplierKey(cost);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const supplierCostIndexes = new Map<string, number>();
  const supplierEntries = factoryCosts.map((cost) => (
    supplierEntryForCost(cost, supplierCostCounts, supplierCostIndexes)
  ));
  const hasFactorySupplierCost = supplierEntries.length > 0;
  const supplierRequirementEntries: SupplierEntry[] = hasFactorySupplierCost
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
    const daysSinceCostCreated = costCreatedAt
      ? Math.floor((Date.now() - costCreatedAt.getTime()) / 86400000)
      : 0;
    SUPPLIER_DOCUMENT_TYPES.forEach((type) => {
      const cost = factoryCosts.find((item) => item.id && item.id === entry.costId) || null;
      const allowLegacySupplierFallback = Boolean(cost) && (entry.sameSupplierCostCount || 0) <= 1;
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
      if (!matchedDocument) {
        supplierMissing.push(missingSupplierDocument(entry, type, cost, daysSinceCostCreated));
      }
    });
  });

  const supplierTotal = Math.max(
    SUPPLIER_DOCUMENT_TYPES.length,
    supplierRequirementEntries.length * SUPPLIER_DOCUMENT_TYPES.length,
  );
  return {
    supplierEntries,
    supplierMissing,
    supplierTotal,
    supplierCompleted: supplierTotal - supplierMissing.length,
    hasFactorySupplierCost,
  };
}
