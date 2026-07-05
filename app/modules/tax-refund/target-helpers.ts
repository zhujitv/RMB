import {
  TAX_CUSTOMS_UPLOAD_TYPES,
  TAX_EXPORT_UPLOAD_TYPES,
  TAX_FACTORY_UPLOAD_TYPES,
  type DocumentCompleteness,
  type TaxCost,
  type TaxRefundRow,
} from "./model";

export function normalizedMissingLabels(completeness: DocumentCompleteness) {
  const labels = completeness.missingLabels || completeness.missing || [];
  return labels.map((label) => String(label || "").trim()).filter(Boolean);
}

export function taxRefundBillOfLadingNumbers(row: Partial<TaxRefundRow> = {}, fallback: Partial<TaxRefundRow> = {}) {
  const arrayValues = [row.billOfLadingNumbers, fallback.billOfLadingNumbers]
    .find((items) => Array.isArray(items) && items.some((item) => String(item || "").trim()))
    || [];
  const values = arrayValues.length
    ? arrayValues
    : [row.billOfLadingNo, row.blNo, fallback.billOfLadingNo, fallback.blNo];
  return values
    .map((value) => String(value || "").trim())
    .filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
}

export function taxRefundBillOfLadingText(row: Partial<TaxRefundRow> = {}, fallback: Partial<TaxRefundRow> = {}) {
  const numbers = taxRefundBillOfLadingNumbers(row, fallback);
  return numbers.length ? numbers.join(" / ") : "-";
}

export function taxDocumentTargetKey(documentType: string) {
  return `tax-document-${documentType}`;
}

export function taxDocumentTypeLabel(documentType: string) {
  return [...TAX_EXPORT_UPLOAD_TYPES, ...TAX_CUSTOMS_UPLOAD_TYPES].find((type) => type.value === documentType)?.label
    || documentType
    || "资料";
}

export function taxSupplierDocumentLabel(documentType: string) {
  return TAX_FACTORY_UPLOAD_TYPES.find((type) => type.value === documentType)?.label
    || (documentType === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂采购合同" : "")
    || (documentType === "SUPPLIER_INVOICE" ? "工厂增值税发票" : "")
    || "工厂资料";
}

export function logisticsInvoiceLabel(cost: Pick<TaxCost, "costType">) {
  if (["拖车费", "国内物流费", "国内拖车费"].includes(cost.costType || "")) return "拖车费发票";
  if (cost.costType === "报关费") return "报关费发票";
  if (cost.costType === "港杂费") return "港杂费发票";
  if (cost.costType === "海运费") return "海运费发票";
  return "物流发票";
}

export function logisticsDocumentLabel(documentType: string, costType: string) {
  if (documentType === "SUPPLIER_INVOICE") return logisticsInvoiceLabel({ costType });
  return documentType || "物流资料";
}

export function taxTargetKeyFromMissingLabel(label: string) {
  const text = String(label || "").trim();
  const documentLabelMap: Array<[string, string]> = [
    ["提单", "BILL_OF_LADING"],
    ["清关发票", "COMMERCIAL_INVOICE"],
    ["商业发票", "COMMERCIAL_INVOICE"],
    ["装箱单", "PACKING_LIST"],
    ["箱单", "PACKING_LIST"],
    ["出口发票", "EXPORT_INVOICE"],
    ["销售合同", "SALES_CONTRACT"],
    ["报关单", "CUSTOMS_ENTRY_FORM"],
    ["货物报关单", "CUSTOMS_ENTRY_FORM"],
    ["放行通知书", "RELEASE_NOTICE"],
    ["报关委托书", "CUSTOMS_POWER_OF_ATTORNEY"],
  ];
  const matchedDocument = documentLabelMap.find(([keyword]) => text.includes(keyword));
  if (matchedDocument) return taxDocumentTargetKey(matchedDocument[1]);
  if (text.includes("国内物流")) return "domestic-logistics";
  if (text.includes("工厂") || text.includes("采购合同") || text.includes("增值税") || text.includes("进项发票")) return "factory-section";
  if (text.includes("报关费") || text.includes("拖车费") || text.includes("港杂费") || text.includes("海运费") || text.includes("物流")) return "logistics-section";
  return "tax-detail-top";
}

export function factoryDocumentTargetKey(costId: string, documentType: string) {
  return `tax-factory-${costId}-${documentType}`;
}

export function logisticsDocumentTargetKey(costId: string) {
  return `tax-logistics-${costId}-SUPPLIER_INVOICE`;
}

export function taxTargetDomId(key: string) {
  return `tax-target-${String(key || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
