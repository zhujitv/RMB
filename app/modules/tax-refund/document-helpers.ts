import {
  PRODUCT_SUPPLIER_TYPES,
  TAX_LOGISTICS_INVOICE_COST_TYPES,
  type DocumentCompleteness,
  type TaxCost,
  type TaxDocument,
} from "./model";
import { logisticsInvoiceLabel } from "./target-helpers";

export function factorySupplierCosts(costs: TaxCost[]) {
  return costs.filter((cost) => (
    cost.id
    && cost.supplierId
    && (
      PRODUCT_SUPPLIER_TYPES.includes(cost.supplierType || "")
      || ["工厂货款", "原材料货款", "采购货款", "产品货款"].includes(cost.costType || "")
    )
  ));
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

export function documentMatchesFactoryCostSlot(document: TaxDocument, cost: TaxCost, _sameSupplierFactoryCostCount: number) {
  if (document.uploadStatus !== "SUCCESS") return false;
  if (document.costId) return document.costId === cost.id;
  return Boolean(cost.supplierId && document.supplierId === cost.supplierId);
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
