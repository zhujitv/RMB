// @ts-nocheck
import { canRead, canWrite } from "./shared-access";
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
import { serializeDomesticLogisticsInfo } from "./shared-serialization";

export function documentCompleteness(documents = []) {
  return taxDocumentCompleteness({ documents });
}

export function successDocument(doc) {
  return doc && !doc.deletedAt && doc.uploadStatus === "SUCCESS";
}

export function displayDocumentLabel(value) {
  return ORDER_DOCUMENT_LABELS[value] || value || "";
}

export function supplierKey(cost) {
  return cost.supplierId || `vendor:${cost.supplierNameSnapshot || cost.vendorName || cost.id}`;
}

export function supplierNameForCost(cost) {
  return cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "未命名供应商";
}

export function supplierTypeForCost(cost) {
  return cost.supplierType || cost.supplier?.supplierType || "";
}

export function isTaxRefundFactoryCost(cost) {
  return FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType) && TAX_REFUND_SUPPLIER_TYPES.includes(supplierTypeForCost(cost));
}

export function isTaxRefundLogisticsInvoiceCost(cost) {
  return Boolean(cost?.supplierId && logisticsInvoiceRequirementForCost(cost));
}

export function logisticsInvoiceRequirementForCost(cost = {}) {
  return TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS.find((item) => item.costTypes.includes(cost.costType)) || null;
}

export function normalizedTradeTerm(value = "") {
  return String(value || "").trim().toUpperCase();
}

export function isSeaFreightRequirement(requirement = {}) {
  return requirement.key === SEA_FREIGHT_REQUIREMENT_KEY;
}

export function isSeaFreightRequiredByTradeTerm(order = {}) {
  return SEA_FREIGHT_REQUIRED_TRADE_TERMS.includes(normalizedTradeTerm(order.tradeTerm));
}

export function taxRefundLogisticsInvoiceRequirementsForOrder(order = {}, logisticsInvoiceCosts = []) {
  const hasSeaFreightCost = logisticsInvoiceCosts.some((cost) => normalizedCostType(cost.costType) === "海运费");
  return TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS.filter((requirement) => (
    !isSeaFreightRequirement(requirement)
    || isSeaFreightRequiredByTradeTerm(order)
    || hasSeaFreightCost
  ));
}

export function logisticsInvoiceLabelForCost(cost = {}) {
  return logisticsInvoiceRequirementForCost(cost)?.label || "物流资料";
}

export function isTaxRefundFactoryDocument(document) {
  const supplierType = document.supplier?.supplierType || document.cost?.supplier?.supplierType || "";
  return TAX_REFUND_SUPPLIER_TYPES.includes(supplierType);
}

export function isTaxRefundLogisticsInvoiceDocument(document) {
  return document.documentType === "SUPPLIER_INVOICE" && isTaxRefundLogisticsInvoiceCost(document.cost);
}

export function isTaxRefundSupplierDocument(document) {
  if (document.documentType === "SUPPLIER_PURCHASE_CONTRACT") return isTaxRefundFactoryDocument(document);
  if (document.documentType === "SUPPLIER_INVOICE") return isTaxRefundFactoryDocument(document) || isTaxRefundLogisticsInvoiceDocument(document);
  return false;
}

export function confirmedFactorySupplierMismatch(input = {}) {
  return input.factorySupplierMismatchConfirmed === true || input.factorySupplierMismatchConfirmed === "true";
}

export function booleanInput(value, fallback = false) {
  if (value === true || value === "true" || value === "已确认") return true;
  if (value === false || value === "false" || value === "未确认") return false;
  return Boolean(fallback);
}

export function inputHasOwn(input, key) {
  return Object.prototype.hasOwnProperty.call(input || {}, key);
}

export function canConfirmLogisticsCost(actor) {
  return ["管理员", "财务"].includes(actor?.role) || (canWrite(actor, "commissions") && canRead(actor, "payments"));
}

export function taxDocumentCompleteness(order = {}) {
  const documents = order.documents || [];
  const activeCosts = (order.costs || []).filter((cost) => !cost.deletedAt && cost.supplierId);
  const factoryCosts = activeCosts.filter(isTaxRefundFactoryCost);
  const logisticsInvoiceCosts = activeCosts.filter((cost) => !isTaxRefundFactoryCost(cost) && isTaxRefundLogisticsInvoiceCost(cost));
  const successDocs = documents.filter(successDocument);
  const hasOrderType = (type) => successDocs.some((doc) => doc.documentType === type && !doc.costId && doc.relatedModule !== "SUPPLIER");
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
  const supplierEntries = Object.values(factoryCosts.reduce((acc, cost) => {
    const key = supplierKey(cost);
    acc[key] ||= {
      key,
      supplierId: cost.supplierId,
      supplierName: supplierNameForCost(cost),
      costIds: [],
      earliestCostCreatedAt: cost.createdAt,
    };
    acc[key].costIds.push(cost.id);
    if (cost.createdAt && (!acc[key].earliestCostCreatedAt || cost.createdAt < acc[key].earliestCostCreatedAt)) {
      acc[key].earliestCostCreatedAt = cost.createdAt;
    }
    return acc;
  }, {}));
  const hasFactorySupplierCost = supplierEntries.length > 0;
  const supplierRequirementEntries = hasFactorySupplierCost
    ? supplierEntries
    : [{
        key: "__missing_factory_supplier__",
        supplierId: "",
        supplierName: "未录入工厂供应商",
        costIds: [],
        earliestCostCreatedAt: null,
        missingFactoryCost: true,
      }];
  const supplierMissing = [];
  supplierRequirementEntries.forEach((entry) => {
    const costCreatedAt = entry.earliestCostCreatedAt ? new Date(entry.earliestCostCreatedAt) : null;
    const daysSinceCostCreated = costCreatedAt ? Math.floor((Date.now() - costCreatedAt.getTime()) / 86400000) : 0;
    SUPPLIER_DOCUMENT_TYPES.forEach((type) => {
      const exists = entry.missingFactoryCost ? false : successDocs.some((doc) => (
        doc.documentType === type
        && doc.relatedModule === "SUPPLIER"
        && (doc.supplierId === entry.supplierId || entry.costIds.includes(doc.costId))
      ));
      if (!exists) {
        supplierMissing.push({
          supplierId: entry.supplierId,
          supplierName: entry.supplierName,
          documentType: type,
          label: entry.missingFactoryCost
            ? "缺少工厂供应商成本记录"
            : `${supplierEntries.length > 1 ? entry.supplierName : ""}${type === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂合同" : "工厂发票"}`,
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
  const logisticsMissing = [];
  const logisticsRequirements = taxRefundLogisticsInvoiceRequirementsForOrder(order, logisticsInvoiceCosts);
  const logisticsRequirementRows = logisticsRequirements.map((requirement) => {
    const costs = logisticsInvoiceCosts.filter((cost) => requirement.costTypes.includes(cost.costType));
    const completed = costs.some((cost) => successDocs.some((doc) => (
      doc.documentType === "SUPPLIER_INVOICE"
      && doc.relatedModule === "SUPPLIER"
      && doc.costId === cost.id
    )));
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
        costType: normalizedCostType(cost.costType),
        costTypeRaw: cost.costType,
        amount: Number(cost.amount || 0),
        amountCny: Number(cost.amountCny || 0),
        currency: cost.currency || "CNY",
        documentType: "SUPPLIER_INVOICE",
        invoiceLabel: requirement.label,
        missingBucket: requirement.key,
        label: requirement.label,
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
        costType: normalizedCostType(cost.costType),
        costTypeRaw: cost.costType,
        amount: Number(cost.amount || 0),
        amountCny: Number(cost.amountCny || 0),
        currency: cost.currency || "CNY",
        invoiceLabel: requirement.label,
      })),
    };
  });
  const logisticsTotal = logisticsRequirements.length;
  const logisticsCompleted = logisticsTotal - logisticsMissing.length;
  const missingLabels = [
    ...customsMissing.map((type) => ORDER_DOCUMENT_LABELS[type] || type),
    ...exportMissing.map((type) => ORDER_DOCUMENT_LABELS[type] || type),
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

export function derivedTaxRefundStatus(order, documents = order?.documents || []) {
  const status = order?.taxRefundStatus || "NOT_READY";
  if (["COMPLETED", "ARCHIVED"].includes(status)) return "SUBMITTED";
  if (["SUBMITTED", "PROBLEM"].includes(status)) return status;
  return taxDocumentCompleteness({ ...order, documents }).complete ? "READY" : "NOT_READY";
}

export function taxRefundStatusFromCompleteness(currentStatus, completeness) {
  if (["COMPLETED", "ARCHIVED"].includes(currentStatus)) return "SUBMITTED";
  if (["SUBMITTED", "PROBLEM"].includes(currentStatus)) return currentStatus;
  return completeness?.complete ? "READY" : "NOT_READY";
}

export function emptyTaxRefundCompleteness() {
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
      total: 3,
      ruleVersion: TAX_REFUND_LOGISTICS_RULE_VERSION,
      missing: [],
      reminders: [],
      costs: [],
      requirements: TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS.filter((item) => item.key !== SEA_FREIGHT_REQUIREMENT_KEY).map((item) => ({
        key: item.key,
        label: item.label,
        missingCostLabel: item.missingCostLabel,
        costTypes: item.costTypes,
        completed: false,
        costs: [],
      })),
      missingLogisticsInvoices: [],
      missingCustomsInvoices: [],
      missingPortInvoices: [],
    },
    text: "完整度缓存未生成",
  };
}

export function cachedTaxRefundCompleteness(order = {}) {
  const cached = order.taxRefundCompleteness;
  if (cached && typeof cached === "object" && !Array.isArray(cached)) return cached;
  return emptyTaxRefundCompleteness();
}

export function needsTaxRefundCompletenessRefresh(order = {}) {
  const cached = order.taxRefundCompleteness;
  if (!cached || typeof cached !== "object" || Array.isArray(cached)) return true;
  if (Number(cached?.supplier?.total || 0) < SUPPLIER_DOCUMENT_TYPES.length) return true;
  if (typeof cached?.supplier?.missingFactoryCost === "undefined") return true;
  if (!cached.factory) return true;
  if (!cached.logistics || !Array.isArray(cached.logistics.missing)) return true;
  if (cached.logistics?.ruleVersion !== TAX_REFUND_LOGISTICS_RULE_VERSION) return true;
  if (Number(cached?.export?.total || 0) < TAX_EXPORT_DOCUMENT_TYPES.length) return true;
  if (!cached.customs || Number(cached?.customs?.total || 0) !== DOMESTIC_LOGISTICS_DOCUMENT_TYPES.length) return true;
  if (!cached.domesticLogistics || Number(cached?.domesticLogistics?.total || 0) !== 1) return true;
  const cachedLogisticsRequirements = Array.isArray(cached?.logistics?.requirements) ? cached.logistics.requirements : [];
  const hasCachedSeaRequirement = cachedLogisticsRequirements.some((item) => item?.key === SEA_FREIGHT_REQUIREMENT_KEY);
  if (!isSeaFreightRequiredByTradeTerm(order) && hasCachedSeaRequirement) return true;
  if (isSeaFreightRequiredByTradeTerm(order) && !hasCachedSeaRequirement) return true;
  if (Number(cached?.logistics?.total || 0) < 3) return true;
  if (!Array.isArray(cached?.logistics?.requirements)) return true;
  if ((cached.missingLabels || []).some((label) => ORDER_DOCUMENT_TYPES.includes(label))) return true;
  return false;
}
