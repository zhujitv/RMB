import { LOGISTICS_FEE_COST_SOURCE_TYPE, normalizedCostType, SEA_FREIGHT_REQUIREMENT_KEY } from "./shared-constants";
import { logisticsInvoiceGroupForExpense } from "./logistics-invoice-groups";
import {
  type CostLike,
  type LogisticsExpenseInvoiceLike,
  type LogisticsInvoiceCoverage,
  type OrderDocumentLike,
  type TaxOrderLike,
  isTaxRefundLogisticsInvoiceCost,
  logisticsInvoiceRequirementForCost,
  normalizedTaxRefundTradeTerm,
  supplierNameForCost,
} from "./shared-tax-completeness-types";

export function logisticsInvoiceLabelForCost(cost: CostLike = {}) {
  return logisticsInvoiceRequirementForCost(cost)?.label || "物流资料";
}

export function logisticsInvoiceGroupForCost(cost: CostLike = {}) {
  return logisticsInvoiceGroupForExpense({
    costType: normalizedCostType(String(cost.costType || "")),
    currency: cost.currency,
  });
}

export function uniqueNormalizedCostTypes(costs: CostLike[] = []) {
  return [...new Set(costs
    .map((cost) => normalizedCostType(String(cost.costType || "")))
    .filter(Boolean))];
}

export function logisticsExpenseInvoiceCostLike(expense: LogisticsExpenseInvoiceLike = {}, costsById: Map<string, CostLike> = new Map()): CostLike {
  const matchedCost = expense.costId ? costsById.get(expense.costId) : null;
  return {
    ...(matchedCost || {}),
    id: expense.costId || matchedCost?.id || expense.cost?.id || expense.id || "",
    supplierId: expense.supplierId || matchedCost?.supplierId || expense.cost?.supplierId || "",
    supplierNameSnapshot: expense.supplierNameSnapshot || matchedCost?.supplierNameSnapshot || expense.cost?.supplierNameSnapshot || "",
    vendorName: matchedCost?.vendorName || expense.cost?.vendorName || "",
    supplierType: matchedCost?.supplierType || expense.cost?.supplierType || "",
    supplier: expense.supplier || matchedCost?.supplier || expense.cost?.supplier || null,
    costType: expense.costType || matchedCost?.costType || expense.cost?.costType || "",
    amount: expense.amount ?? matchedCost?.amount ?? expense.cost?.amount ?? 0,
    amountCny: expense.amountCny ?? matchedCost?.amountCny ?? expense.cost?.amountCny ?? 0,
    currency: expense.currency || matchedCost?.currency || expense.cost?.currency || "CNY",
		sourceType: matchedCost?.sourceType || expense.cost?.sourceType || LOGISTICS_FEE_COST_SOURCE_TYPE,
    sourceId: expense.id || matchedCost?.sourceId || expense.cost?.sourceId || "",
    costConfirmed: matchedCost?.costConfirmed ?? true,
    createdAt: matchedCost?.createdAt || expense.cost?.createdAt || null,
    deletedAt: expense.deletedAt || matchedCost?.deletedAt || expense.cost?.deletedAt || null,
  };
}

export function documentUploadedFileExists(document: OrderDocumentLike = {}) {
  return Boolean(document.fileUrl || document.storageKey);
}

export function logisticsInvoiceGroupCoverages(documents: OrderDocumentLike[] = [], logisticsInvoiceCosts: CostLike[] = []) {
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
      const linkedInvoiceCosts = (document.logisticsExpenseInvoices || [])
        .filter((expense) => !expense.deletedAt)
        .map((expense) => logisticsExpenseInvoiceCostLike(expense, costsById))
        .filter(isTaxRefundLogisticsInvoiceCost);
      const primaryCost = linkedInvoiceCosts[0] || documentCost;
      if (!primaryCost || !isTaxRefundLogisticsInvoiceCost(primaryCost)) return null;
      const group = logisticsInvoiceGroupForCost(primaryCost);
      if (!group) return null;
      const fallbackGroupCosts = logisticsInvoiceCosts.filter((cost) => (
        logisticsInvoiceGroupForCost(cost)?.key === group.key
        && (!primaryCost.supplierId || !cost.supplierId || cost.supplierId === primaryCost.supplierId)
      ));
      const groupCosts = linkedInvoiceCosts.length ? linkedInvoiceCosts : fallbackGroupCosts;
      const billOfLadingNo = (document.logisticsExpenseInvoices || [])
        .map((expense) => String(expense.bill?.billOfLadingNo || "").trim())
        .find(Boolean) || "";
      return {
        documentId: document.id || "",
        documentFileName: document.fileName || "",
        logisticsExpenseId: primaryCost.sourceId || primaryCost.id || "",
        invoiceGroupId: group.key,
        invoiceGroupLabel: group.label,
        includedFeeTypes: uniqueNormalizedCostTypes(groupCosts.length ? groupCosts : [primaryCost]),
        costIds: groupCosts.map((cost) => cost.id || "").filter(Boolean),
        supplierName: supplierNameForCost(primaryCost),
        billOfLadingNo,
        uploadedFileUrl: documentUploadedFileExists(document),
      };
    })
    .filter((item): item is LogisticsInvoiceCoverage => Boolean(item));
}

export function logisticsRequirementMatchesCoverage(requirement: { costTypes?: string[] } = {}, coverage: LogisticsInvoiceCoverage) {
  const requiredTypes = new Set((requirement.costTypes || []).map((type) => normalizedCostType(String(type || ""))).filter(Boolean));
  return coverage.includedFeeTypes.some((costType) => requiredTypes.has(costType));
}

export function logisticsRequirementMissingLabel(order: TaxOrderLike = {}, requirement: { key?: string; missingCostLabel?: string; label?: string } = {}) {
  if (requirement.key === SEA_FREIGHT_REQUIREMENT_KEY && normalizedTaxRefundTradeTerm(order) === "CIF") {
    return "CIF订单缺少海运费发票";
  }
  return requirement.missingCostLabel || (requirement.label ? `缺少${requirement.label}` : "缺少物流费用发票");
}

export function logTaxRefundLogisticsInvoiceDecision({
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
  const candidateLogisticsExpenseIds = costs.map((cost) => cost.sourceId || cost.id || "").filter(Boolean);
  const candidateInvoiceGroupIds = [...new Set(costs.map((cost) => logisticsInvoiceGroupForCost(cost)?.key || "").filter(Boolean))];
  const candidateIncludedFeeTypes = uniqueNormalizedCostTypes(costs);
  const directTruckingCompleted = directCompleted && truckingCosts.some((cost) => (
    cost.id && matchedCoverages.some((coverage) => coverage.costIds.includes(cost.id || ""))
  ));
  const truckingCoveredByGroup = matchedCoverages.some((coverage) => coverage.includedFeeTypes.includes("拖车费"));
  const orderRecord = order as Record<string, unknown>;
  const supplierNames = [...new Set([
    ...costs.map(supplierNameForCost),
    ...matchedCoverages.map((coverage) => coverage.supplierName),
  ].map((item) => String(item || "").trim()).filter(Boolean))];
  const billOfLadingNumbers = [...new Set([
    String(order.blNo || order.billOfLadingNo || "").trim(),
    ...matchedCoverages.map((coverage) => coverage.billOfLadingNo),
  ].map((item) => String(item || "").trim()).filter(Boolean))];
  const invoiceGroupNames = [...new Set(matchedCoverages.map((coverage) => coverage.invoiceGroupLabel).filter(Boolean))];
  console.info("tax-refund-logistics-invoice-decision", {
    orderId: orderRecord.id || "",
    orderNo: orderRecord.orderNo || "",
    billOfLadingNo: billOfLadingNumbers.join(" / "),
    supplierName: supplierNames.join(" / "),
    requirementKey: requirement.key || "",
    requirementLabel: requirement.label || "",
    taxRefundDocumentType: requirement.label || requirement.key || "物流资料",
    taxRefundDocumentTypeMatched: completed,
    logisticsExpenseIds: matchedCoverages.map((coverage) => coverage.logisticsExpenseId).filter(Boolean),
    candidateLogisticsExpenseIds,
    invoiceGroupIds: matchedCoverages.map((coverage) => coverage.invoiceGroupId).filter(Boolean),
    invoiceGroupName: invoiceGroupNames.join(" / "),
    candidateInvoiceGroupIds,
    invoiceGroups: matchedCoverages.map((coverage) => ({
      documentId: coverage.documentId,
      fileName: coverage.documentFileName,
      logisticsExpenseId: coverage.logisticsExpenseId,
      invoiceGroupId: coverage.invoiceGroupId,
      invoiceGroupName: coverage.invoiceGroupLabel,
      supplierName: coverage.supplierName,
      billOfLadingNo: coverage.billOfLadingNo,
      includedFeeTypes: coverage.includedFeeTypes,
      uploadedFileUrl: coverage.uploadedFileUrl,
    })),
    includedFeeTypes: [...new Set(matchedCoverages.flatMap((coverage) => coverage.includedFeeTypes))],
    uploadedFileUrl: matchedCoverages.some((coverage) => coverage.uploadedFileUrl),
    candidateIncludedFeeTypes,
    costIds: costs.map((cost) => cost.id || "").filter(Boolean),
    directCostInvoiceMatched: directCompleted,
    "拖车费": directTruckingCompleted || truckingCoveredByGroup,
    completed,
  });
}
