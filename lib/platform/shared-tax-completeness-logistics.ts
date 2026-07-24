import { normalizedCostType } from "./shared-constants";
import {
  type CostLike,
  type LogisticsInvoiceCoverage,
  type MissingEntry,
  type OrderDocumentLike,
  type TaxOrderLike,
  notApplicableLogisticsRequirementsForOrder,
  supplierNameForCost,
  supplierTypeForCost,
  taxRefundLogisticsInvoiceRequirementsForOrder,
} from "./shared-tax-completeness-types";
import {
  documentUploadedFileExists,
  logisticsRequirementMatchesCoverage,
  logisticsRequirementMissingLabel,
  logTaxRefundLogisticsInvoiceDecision,
} from "./shared-tax-logistics-invoices";

function missingLogisticsCost(requirement: {
  key: string;
  label: string;
}, order: TaxOrderLike): MissingEntry {
  return {
    requirementKey: requirement.key,
    documentType: "SUPPLIER_INVOICE",
    invoiceLabel: requirement.label,
    label: logisticsRequirementMissingLabel(order, requirement),
    missingCost: true,
    missingBucket: requirement.key,
  };
}

function missingLogisticsInvoice(
  requirement: { key: string; label: string },
  order: TaxOrderLike,
  cost: CostLike,
): MissingEntry {
  const costCreatedAt = cost.createdAt ? new Date(cost.createdAt) : null;
  const daysSinceCostCreated = costCreatedAt
    ? Math.floor((Date.now() - costCreatedAt.getTime()) / 86400000)
    : 0;
  return {
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
  };
}

export function logisticsTaxDocumentCompleteness(
  order: TaxOrderLike,
  logisticsInvoiceCosts: CostLike[],
  successDocs: OrderDocumentLike[],
  logisticsInvoiceCoverages: LogisticsInvoiceCoverage[],
) {
  const logisticsMissing: MissingEntry[] = [];
  const logisticsRequirements = taxRefundLogisticsInvoiceRequirementsForOrder(order, logisticsInvoiceCosts);
  const notApplicableLogisticsRequirements = notApplicableLogisticsRequirementsForOrder(order);
  const logisticsRequirementRows = logisticsRequirements.map((requirement) => {
    const costs = logisticsInvoiceCosts.filter((cost) => (
      requirement.costTypes.includes(normalizedCostType(String(cost.costType || "")))
    ));
    const directCompleted = costs.some((cost) => successDocs.some((doc) => (
      doc.documentType === "SUPPLIER_INVOICE"
      && doc.relatedModule === "SUPPLIER"
      && doc.costId === cost.id
      && documentUploadedFileExists(doc)
    )));
    const matchedCoverages = logisticsInvoiceCoverages.filter((coverage) => (
      logisticsRequirementMatchesCoverage(requirement, coverage)
    ));
    const matchedUploadedCoverages = matchedCoverages.filter((coverage) => coverage.uploadedFileUrl);
    const completed = directCompleted || matchedUploadedCoverages.length > 0;
    logTaxRefundLogisticsInvoiceDecision({
      order,
      requirement,
      costs,
      directCompleted,
      matchedCoverages: matchedUploadedCoverages,
      completed,
    });
    if (!costs.length) {
      logisticsMissing.push(missingLogisticsCost(requirement, order));
    } else if (!completed) {
      logisticsMissing.push(missingLogisticsInvoice(requirement, order, costs[0]));
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
      invoiceGroups: matchedUploadedCoverages.map((coverage) => ({
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
  return {
    logisticsMissing,
    logisticsRequirementRows,
    logisticsTotal,
    logisticsCompleted: logisticsTotal - logisticsMissing.length,
    notApplicableLogisticsRequirements,
  };
}
