import type { DocumentCompleteness } from "./model";
import {
  factoryDocumentTargetKey,
  logisticsDocumentTargetKey,
  normalizedMissingLabels,
  taxDocumentTargetKey,
  taxDocumentTypeLabel,
  taxSupplierDocumentLabel,
} from "./target-helpers";

export function taxCompletenessTooltipGroups(completeness: DocumentCompleteness, percent: number) {
  const groups = [
    { category: "报关资料", items: [] as string[] },
    { category: "工厂合同", items: [] as string[] },
    { category: "工厂发票", items: [] as string[] },
    { category: "物流费用发票", items: [] as string[] },
    { category: "报关费", items: [] as string[] },
    { category: "拖车费", items: [] as string[] },
    { category: "港杂费", items: [] as string[] },
    { category: "海运费", items: [] as string[] },
  ];
  const groupByCategory = new Map(groups.map((group) => [group.category, group]));
  const pushItem = (category: string, item: string) => {
    const group = groupByCategory.get(category);
    const text = String(item || "").trim();
    if (!group || !text || group.items.includes(text)) return;
    group.items.push(text);
  };

  if (percent >= 100 || Number(completeness.completed || 0) >= Number(completeness.total || 0)) return [];
  [...(completeness.customs?.missingTypes || []), ...(completeness.export?.missingTypes || [])].forEach((documentType) => {
    pushItem("报关资料", taxDocumentTypeLabel(documentType));
  });
  (completeness.supplier?.missing || []).forEach((item) => {
    if (item.missingFactoryCost) {
      pushItem("工厂合同", "产品供应商成本记录");
      return;
    }
    if (item.documentType === "SUPPLIER_PURCHASE_CONTRACT") pushItem("工厂合同", "工厂合同");
    else if (item.documentType === "SUPPLIER_INVOICE") pushItem("工厂发票", "工厂增值税发票");
    else if (item.label) pushItem("工厂发票", item.label);
  });
  (completeness.logistics?.missing || []).forEach((item) => {
    const bucket = String(item.missingBucket || item.requirementKey || "").toUpperCase();
    const label = item.label || item.invoiceLabel || "";
    if (bucket === "CUSTOMS") pushItem("报关费", label || "缺少报关费发票");
    else if (bucket === "TRUCKING" || bucket === "DOMESTIC_LOGISTICS") pushItem("拖车费", label || "缺少拖车发票");
    else if (bucket === "PORT") pushItem("港杂费", label || "缺少港杂费发票");
    else if (bucket === "SEA") pushItem("海运费", label || "缺少海运费发票");
    else pushItem("物流费用发票", label || "物流费用发票");
  });
  if (!groups.some((group) => group.items.length)) {
    normalizedMissingLabels(completeness).forEach((label) => pushItem("报关资料", label));
  }
  return groups.filter((group) => group.items.length);
}

export function taxMissingTargets(completeness: DocumentCompleteness) {
  const targets: Array<{ label: string; targetKey: string }> = [];
  const pushTarget = (label: string, targetKey: string) => {
    const normalizedLabel = String(label || "").trim();
    if (!normalizedLabel) return;
    const key = `${targetKey}:${normalizedLabel}`;
    if (targets.some((target) => `${target.targetKey}:${target.label}` === key)) return;
    targets.push({ label: normalizedLabel, targetKey });
  };

  (completeness.export?.missingTypes || []).forEach((documentType) => {
    pushTarget(taxDocumentTypeLabel(documentType), taxDocumentTargetKey(documentType));
  });
  (completeness.customs?.missingTypes || []).forEach((documentType) => {
    pushTarget(taxDocumentTypeLabel(documentType), taxDocumentTargetKey(documentType));
  });
  (completeness.domesticLogistics?.missing || []).forEach(() => {
    pushTarget("物流信息", "domestic-logistics");
  });
  (completeness.supplier?.missing || []).forEach((item) => {
    if (item.missingFactoryCost) {
      pushTarget("缺少产品供应商成本记录", "factory-section");
      return;
    }
    const documentLabel = taxSupplierDocumentLabel(item.documentType || "");
    const targetKey = item.costId ? factoryDocumentTargetKey(item.costId, item.documentType || "") : "factory-section";
    pushTarget(item.label || (item.supplierName ? `${item.supplierName}${documentLabel}` : documentLabel), targetKey);
  });
  (completeness.logistics?.missing || []).forEach((item) => {
    const targetKey = item.costId ? logisticsDocumentTargetKey(item.costId) : "logistics-section";
    pushTarget(item.label || item.invoiceLabel || "物流费用发票", targetKey);
  });
  return targets;
}
