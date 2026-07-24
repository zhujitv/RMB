import {
  FACTORY_SUPPLIER_COST_TYPES,
  ORDER_DOCUMENT_LABELS,
  SEA_FREIGHT_REQUIREMENT_KEY,
  SEA_FREIGHT_REQUIRED_TRADE_TERMS,
  TAX_REFUND_BASE_LOGISTICS_REQUIREMENT_KEYS,
  TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS,
  TAX_REFUND_SUPPLIER_TYPES,
  isLogisticsGeneratedCostSourceType,
  normalizedCostType,
} from "./shared-constants";
import {
  asRecord,
  type CostLike,
  type NumericLike,
  type OrderDocumentLike,
  type TaxOrderLike,
} from "./shared-tax-completeness-model";

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
  const text = String(value || "").trim().toUpperCase();
  if (text.includes("CIF")) return "CIF";
  if (text.includes("CFR")) return "CFR";
  if (text.includes("FOB")) return "FOB";
  if (text.includes("EXW")) return "EXW";
  return text;
}

export function normalizedTaxRefundTradeTerm(order: TaxOrderLike = {}) {
  const orderRecord = asRecord(order);
  const candidates = [
    order.tradeTerm,
    orderRecord.declarationType,
    orderRecord.customsDeclarationType,
    orderRecord.tradeMode,
    orderRecord.modeOfTrade,
    orderRecord.exportMode,
    orderRecord.customsTradeMode,
  ];
  return candidates.map((value) => normalizedTradeTerm(String(value || ""))).find((value) => (
    value === "FOB" || value === "CIF" || value === "CFR" || value === "EXW"
  )) || normalizedTradeTerm(order.tradeTerm || "");
}

export function isExwTaxRefundOrder(order: TaxOrderLike = {}) {
  return normalizedTaxRefundTradeTerm(order) === "EXW";
}

export function isSeaFreightRequirement(requirement: { key?: string } = {}) {
  return requirement.key === SEA_FREIGHT_REQUIREMENT_KEY;
}

export function isSeaFreightRequiredByTradeTerm(order: TaxOrderLike = {}) {
  return SEA_FREIGHT_REQUIRED_TRADE_TERMS.includes(normalizedTaxRefundTradeTerm(order));
}

export function numberValue(value: NumericLike | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizedTransportMode(value: unknown = "") {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  if (
    ["LCL", "BULK", "BULK_WAREHOUSE", "BULK WAREHOUSE", "WAREHOUSE", "LOOSE", "LOOSE_CARGO", "LOOSE CARGO"].includes(text)
    || text.includes("LCL")
    || text.includes("BULK")
    || text.includes("LOOSE CARGO")
    || text.includes("LESS THAN CONTAINER")
    || text.includes("拼箱")
    || text.includes("散货")
    || text.includes("非整柜")
  ) return "LCL";
  if (["FCL", "FULL_CONTAINER", "FULL CONTAINER", "CONTAINER", "TRUCK", "MULTIMODAL", "整柜", "车辆运输", "多式联运"].includes(text)) return "FCL";
  if (["AIR", "AIR_FREIGHT", "AIR FREIGHT", "空运"].includes(text)) return "AIR";
  if (["EXPRESS", "COURIER", "快递", "快递运输"].includes(text)) return "EXPRESS";
  return text;
}

export function orderTransportMode(order: TaxOrderLike = {}) {
  const domesticLogisticsInfos = [
    ...(order.domesticLogisticsInfos || []),
    ...(order.domesticLogisticsInfo ? [order.domesticLogisticsInfo] : []),
  ];
  const candidates = [
    order.transportType,
    order.shipmentType,
    ...domesticLogisticsInfos.flatMap((info) => [
      info?.transportType,
      info?.transportTypeLabel,
      info?.remarkText,
    ]),
  ];
  const modes = candidates.map(normalizedTransportMode).filter(Boolean);
  return modes.find((mode) => mode === "LCL") || modes[0] || "";
}

export function positiveCostAmount(cost: CostLike = {}) {
  return Math.max(numberValue(cost.amountCny), numberValue(cost.amount)) > 0;
}

export function isActualApprovedLogisticsCost(cost: CostLike = {}) {
	if (!positiveCostAmount(cost)) return false;
	return isLogisticsGeneratedCostSourceType(cost.sourceType) || cost.costConfirmed === true || !cost.sourceType;
}

export function isNonFullContainerTaxRefundOrder(order: TaxOrderLike = {}) {
  return orderTransportMode(order) === "LCL";
}

export function isPortChargesRequirement(requirement: { key?: string } = {}) {
  return requirement.key === "PORT";
}

export function taxRefundLogisticsInvoiceRequirementsForOrder(order: TaxOrderLike = {}, logisticsInvoiceCosts: CostLike[] = []) {
  if (isExwTaxRefundOrder(order)) return [];
  const actualRequirementKeys = new Set(logisticsInvoiceCosts.flatMap((cost) => {
    const requirement = logisticsInvoiceRequirementForCost(cost);
    return requirement?.key ? [requirement.key] : [];
  }));
  const tradeTerm = normalizedTaxRefundTradeTerm(order);
  const tradeTermRequiredKeys = new Set<string>();
  if (["FOB", "CIF", "CFR"].includes(tradeTerm)) {
    TAX_REFUND_BASE_LOGISTICS_REQUIREMENT_KEYS.forEach((key) => tradeTermRequiredKeys.add(key));
  }
  if (isSeaFreightRequiredByTradeTerm(order)) {
    tradeTermRequiredKeys.add(SEA_FREIGHT_REQUIREMENT_KEY);
  }
  const nonFullContainer = isNonFullContainerTaxRefundOrder(order);
  if (nonFullContainer) {
    tradeTermRequiredKeys.delete("PORT");
    actualRequirementKeys.delete("PORT");
  }
  return TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS.filter((requirement) => (
    (!nonFullContainer || !isPortChargesRequirement(requirement))
    && (
      tradeTermRequiredKeys.has(requirement.key)
      || (tradeTerm !== "FOB" && actualRequirementKeys.has(requirement.key))
    )
  ));
}

export function notApplicableLogisticsRequirementsForOrder(order: TaxOrderLike = {}) {
  if (isExwTaxRefundOrder(order)) {
    return [{
      key: "LOGISTICS_INVOICE",
      label: "物流费用发票",
      reason: "EXW 条款下不强制要求物流费用发票",
    }];
  }
  if (!isNonFullContainerTaxRefundOrder(order)) return [];
  return [{
    key: "PORT",
    label: "港杂费",
    reason: "拼箱散货/非整柜出口不强制要求港杂费",
  }];
}
