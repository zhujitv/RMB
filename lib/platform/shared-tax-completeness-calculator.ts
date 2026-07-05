import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  ORDER_DOCUMENT_LABELS,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_EXPORT_DOCUMENT_TYPES,
  TAX_REFUND_LOGISTICS_RULE_VERSION,
  normalizedCostType,
} from "./shared-constants";
import {
  type MissingEntry,
  type OrderDocumentLike,
  type SupplierEntry,
  type TaxOrderLike,
  isActualApprovedLogisticsCost,
  isTaxRefundFactoryCost,
  isTaxRefundLogisticsInvoiceCost,
  displayDocumentLabel,
  logisticsInvoiceRequirementForCost,
  notApplicableLogisticsRequirementsForOrder,
  orderTransportMode,
  successDocument,
  supplierKey,
  supplierNameForCost,
  supplierTypeForCost,
  taxRefundLogisticsInvoiceRequirementsForOrder,
} from "./shared-tax-completeness-types";
import { serializeDomesticLogisticsInfo } from "./shared-serialization";
import {
  logisticsInvoiceGroupCoverages,
  logisticsRequirementMatchesCoverage,
  logisticsRequirementMissingLabel,
  logTaxRefundLogisticsInvoiceDecision,
} from "./shared-tax-logistics-invoices";
import { factoryCostEntryLabel, factoryDocumentMatchesCost } from "./shared-tax-supplier-documents";

export function documentCompleteness(documents: OrderDocumentLike[] = []) {
  return taxDocumentCompleteness({ documents });
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
      const allowLegacySupplierFallback = Boolean(cost);
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
  const notApplicableLogisticsRequirements = notApplicableLogisticsRequirementsForOrder(order);
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
        label: logisticsRequirementMissingLabel(order, requirement),
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
        label: logisticsRequirementMissingLabel(order, requirement),
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
    notApplicableRequirements: notApplicableLogisticsRequirements,
    transportMode: orderTransportMode(order),
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
