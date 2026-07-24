import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  ORDER_COST_STATUS_VOID,
  ORDER_DOCUMENT_LABELS,
  TAX_EXPORT_DOCUMENT_TYPES,
  TAX_REFUND_LOGISTICS_RULE_VERSION,
} from "./shared-constants";
import {
  displayDocumentLabel,
  isActualApprovedLogisticsCost,
  isTaxRefundFactoryCost,
  isTaxRefundLogisticsInvoiceCost,
  orderTransportMode,
  type OrderDocumentLike,
  type TaxOrderLike,
} from "./shared-tax-completeness-types";
import { serializeDomesticLogisticsInfo } from "./shared-serialization";
import { logisticsInvoiceGroupCoverages } from "./shared-tax-logistics-invoices";
import {
  factoryTaxDocumentCompleteness,
  successTaxRefundDocument,
  uniqueTaxRefundFactoryCosts,
} from "./shared-tax-completeness-factory";
import { logisticsTaxDocumentCompleteness } from "./shared-tax-completeness-logistics";

export { uniqueTaxRefundFactoryCosts } from "./shared-tax-completeness-factory";

export function documentCompleteness(documents: OrderDocumentLike[] = []) {
  return taxDocumentCompleteness({ documents });
}

export function taxDocumentCompleteness(order: TaxOrderLike = {}) {
  const documents = order.documents || [];
  const activeCosts = (order.costs || []).filter((cost) => (
    !cost.deletedAt && cost.status !== ORDER_COST_STATUS_VOID && cost.supplierId
  ));
  const factoryCosts = uniqueTaxRefundFactoryCosts(
    activeCosts.filter(isTaxRefundFactoryCost),
    documents,
  );
  const logisticsInvoiceCosts = activeCosts.filter((cost) => (
    !isTaxRefundFactoryCost(cost)
    && isTaxRefundLogisticsInvoiceCost(cost)
    && isActualApprovedLogisticsCost(cost)
  ));
  const successDocs = documents.filter(successTaxRefundDocument);
  const hasOrderType = (type: string) => successDocs.some((doc) => (
    doc.documentType === type && !doc.costId && doc.relatedModule !== "SUPPLIER"
  ));
  const domesticLogisticsInfo = (order.domesticLogisticsInfos || [])[0]
    || order.domesticLogisticsInfo
    || null;
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
  const factoryResult = factoryTaxDocumentCompleteness(order, factoryCosts, successDocs);
  const logisticsResult = logisticsTaxDocumentCompleteness(
    order,
    logisticsInvoiceCosts,
    successDocs,
    logisticsInvoiceGroupCoverages(successDocs, logisticsInvoiceCosts),
  );
  const {
    supplierEntries,
    supplierMissing,
    supplierTotal,
    supplierCompleted,
    hasFactorySupplierCost,
  } = factoryResult;
  const {
    logisticsMissing,
    logisticsRequirementRows,
    logisticsTotal,
    logisticsCompleted,
    notApplicableLogisticsRequirements,
  } = logisticsResult;
  const exportCompleted = TAX_EXPORT_DOCUMENT_TYPES.length - exportMissing.length;
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
  const total = customsTotal + TAX_EXPORT_DOCUMENT_TYPES.length
    + domesticLogisticsTotal + supplierTotal + logisticsTotal;
  const completed = customsCompleted + exportCompleted
    + domesticLogisticsCompleted + supplierCompleted + logisticsCompleted;
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
    export: {
      completed: exportCompleted,
      total: TAX_EXPORT_DOCUMENT_TYPES.length,
      missingTypes: exportMissing,
    },
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
