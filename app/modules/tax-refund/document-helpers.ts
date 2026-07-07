import {
  PRODUCT_SUPPLIER_TYPES,
  TAX_LOGISTICS_INVOICE_COST_TYPES,
  type DocumentCompleteness,
  type TaxCost,
  type TaxDocument,
} from "./model";
import { logisticsInvoiceLabel } from "./target-helpers";

export function factorySupplierCosts(costs: TaxCost[]) {
  return uniqueFactorySupplierCosts(costs.filter((cost) => (
    cost.id
    && cost.supplierId
    && cost.status !== "VOID"
    && (
      PRODUCT_SUPPLIER_TYPES.includes(cost.supplierType || "")
      || ["工厂货款", "原材料货款", "采购货款", "产品货款"].includes(cost.costType || "")
    )
  )));
}

export function factoryCostSupplierKey(cost: TaxCost) {
  return cost.supplierId || cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || cost.id;
}

export function factoryCostOrdinal(cost: TaxCost, factoryCosts: TaxCost[]) {
  const key = factoryCostSupplierKey(cost);
  const sameSupplierCosts = factoryCosts.filter((item) => factoryCostSupplierKey(item) === key);
  return {
    index: Math.max(1, sameSupplierCosts.findIndex((item) => item.id === cost.id) + 1),
    total: sameSupplierCosts.length,
  };
}

export function formatFactoryCostAmount(cost: TaxCost) {
  const amountCny = Number(cost.amountCny || 0);
  const amount = Number(cost.amount || 0);
  if (amountCny > 0) return `CNY ${amountCny.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  if (amount > 0) return `${cost.currency || "CNY"} ${amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  return "";
}

export function documentMatchesFactoryCostSlot(document: TaxDocument, cost: TaxCost, sameSupplierFactoryCostCount: number) {
  if (document.uploadStatus !== "SUCCESS") return false;
  if (document.costId) return document.costId === cost.id;
  return sameSupplierFactoryCostCount <= 1 && Boolean(cost.supplierId && document.supplierId === cost.supplierId);
}

function factoryCostShadowKey(cost: TaxCost) {
  const amount = Number(cost.amountCny || 0) > 0 ? Number(cost.amountCny || 0) : Number(cost.amount || 0);
  return [
    cost.sourceType && cost.sourceId ? `source:${cost.sourceType}:${cost.sourceId}` : (cost.supplierId || cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || ""),
    cost.costType || "工厂货款",
    cost.currency || "CNY",
    Number.isFinite(amount) ? amount.toFixed(2) : "0.00",
  ].map((value) => String(value || "").trim()).join("|");
}

function successfulFactoryDocumentCount(cost: TaxCost) {
  return (cost.documents || []).filter((document) => (
    document.uploadStatus === "SUCCESS"
    && ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"].includes(document.documentType || "")
    && (document.costId === cost.id || (!document.costId && document.supplierId === cost.supplierId))
  )).length;
}

export function uniqueFactorySupplierCosts(costs: TaxCost[]) {
  const groups = new Map<string, TaxCost[]>();
  costs.forEach((cost) => {
    const key = factoryCostShadowKey(cost);
    groups.set(key, [...(groups.get(key) || []), cost]);
  });
  return [...groups.values()].flatMap((items) => {
    if (items.length <= 1) return items;
    const withDocuments = items
      .map((cost) => ({ cost, score: successfulFactoryDocumentCount(cost) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const withoutDocuments = items.filter((cost) => successfulFactoryDocumentCount(cost) === 0);
    if (withDocuments.length === 1 && withoutDocuments.length > 0) return [withDocuments[0].cost];
    return items;
  });
}

export function logisticsInvoiceCosts(costs: TaxCost[]) {
  return costs.filter((cost) => (
    cost.id
    && cost.supplierId
    && !factorySupplierCosts([cost]).length
    && TAX_LOGISTICS_INVOICE_COST_TYPES.includes(cost.costType || "")
  ));
}

export function normalizedTaxLogisticsCostType(value: unknown) {
  const text = String(value || "").trim();
  if (["国内物流费", "国内拖车费"].includes(text)) return "拖车费";
  if (text === "ENS费") return "ENS";
  return text;
}

export function uniqueTaxDocuments(documents: TaxDocument[]) {
  const seen = new Set<string>();
  return documents.filter((document) => {
    if (!document?.id || seen.has(document.id)) return false;
    seen.add(document.id);
    return true;
  });
}

export function logisticsRequirementMatchesCost(requirement: NonNullable<NonNullable<DocumentCompleteness["logistics"]>["requirements"]>[number], cost: TaxCost) {
  const costId = String(cost.id || "");
  const costType = normalizedTaxLogisticsCostType(cost.costType);
  if (!costId && !costType) return false;
  if ((requirement.costs || []).some((item) => (
    (costId && item.costId === costId)
    || normalizedTaxLogisticsCostType(item.costType || item.costTypeRaw) === costType
  ))) return true;
  if ((requirement.costTypes || []).some((item) => normalizedTaxLogisticsCostType(item) === costType)) return true;
  return (requirement.invoiceGroups || []).some((group) => {
    if (costId && (group.costIds || []).includes(costId)) return true;
    const includedTypes = [
      ...(group.includedFeeTypes || []),
      ...(group.feeTypes || []),
      ...(group.costTypes || []),
    ];
    return includedTypes.some((item) => normalizedTaxLogisticsCostType(item) === costType);
  });
}

export function logisticsInvoiceDocumentsForCost(cost: TaxCost, documents: TaxDocument[], completeness: DocumentCompleteness = {}) {
  const successInvoices = documents.filter((document) => (
    document.documentType === "SUPPLIER_INVOICE"
    && document.uploadStatus === "SUCCESS"
  ));
  const directDocuments = successInvoices.filter((document) => document.costId === cost.id);
  const documentById = new Map(successInvoices.map((document) => [document.id, document]));
  const groupedDocuments = (completeness.logistics?.requirements || [])
    .filter((requirement) => logisticsRequirementMatchesCost(requirement, cost))
    .flatMap((requirement) => (requirement.invoiceGroups || [])
      .map((group) => documentById.get(String(group.documentId || "")))
      .filter((document): document is TaxDocument => Boolean(document)));
  return uniqueTaxDocuments([...directDocuments, ...groupedDocuments]);
}

export function upsertTaxDocument(documents: TaxDocument[], document: TaxDocument) {
  const existing = documents.filter((item) => item.id !== document.id);
  const nextDocuments = document.documentType
    ? existing.filter((item) => !(
      item.documentType === document.documentType
      && item.uploadStatus === "SUCCESS"
      && (item.costId || "") === (document.costId || "")
      && (item.supplierId || "") === (document.supplierId || "")
    ))
    : existing;
  return [document, ...nextDocuments];
}

export function groupDocuments(documents: TaxDocument[]) {
  const groups: Record<string, TaxDocument[]> = {
    出口资料: [],
    报关资料: [],
    工厂资料: [],
    物流资料: [],
    其他资料: [],
  };
  documents.forEach((document) => {
    const type = document.documentType || "";
    if (["BILL_OF_LADING", "COMMERCIAL_INVOICE", "PACKING_LIST", "SALES_CONTRACT", "EXPORT_INVOICE"].includes(type)) {
      groups.出口资料.push(document);
    } else if (["CUSTOMS_ENTRY_FORM", "CUSTOMS_DECLARATION", "RELEASE_NOTICE", "CUSTOMS_POWER_OF_ATTORNEY"].includes(type)) {
      groups.报关资料.push(document);
    } else if (["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"].includes(type) && document.relatedModule === "SUPPLIER" && !document.costType?.includes("费")) {
      groups.工厂资料.push(document);
    } else if (document.relatedModule === "SUPPLIER" || ["CUSTOMS_FEE_INVOICE", "TRUCKING_FEE_INVOICE"].includes(type)) {
      groups.物流资料.push(document);
    } else {
      groups.其他资料.push(document);
    }
  });
  return groups;
}
