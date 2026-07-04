import { canRead, canWrite, type AccessUser } from "./shared-access";
import { SUPPLIER_DOCUMENT_TYPES, TAX_REFUND_SUPPLIER_TYPES, normalizedCostType } from "./shared-constants";
import {
  type CostLike,
  type OrderDocumentLike,
  isTaxRefundLogisticsInvoiceCost,
  numberValue,
  successDocument,
  supplierNameForCost,
} from "./shared-tax-completeness-types";

export function isTaxRefundFactoryDocument(document: OrderDocumentLike) {
  const supplierType = document.supplier?.supplierType || document.cost?.supplier?.supplierType || "";
  return TAX_REFUND_SUPPLIER_TYPES.includes(supplierType);
}

export function isTaxRefundLogisticsInvoiceDocument(document: OrderDocumentLike) {
  return document.documentType === "SUPPLIER_INVOICE" && isTaxRefundLogisticsInvoiceCost(document.cost);
}

export function isTaxRefundSupplierDocument(document: OrderDocumentLike) {
  if (document.documentType === "SUPPLIER_PURCHASE_CONTRACT") return isTaxRefundFactoryDocument(document);
  if (document.documentType === "SUPPLIER_INVOICE") return isTaxRefundFactoryDocument(document) || isTaxRefundLogisticsInvoiceDocument(document);
  return false;
}

export function factoryDocumentMatchesCost(document: OrderDocumentLike, cost: CostLike, allowLegacySupplierFallback = false) {
  if (!successDocument(document)) return false;
  if (!cost.id || !cost.supplierId) return false;
  if (document.relatedModule !== "SUPPLIER") return false;
  if (!SUPPLIER_DOCUMENT_TYPES.includes(document.documentType as never)) return false;
  if (document.costId) return document.costId === cost.id;
  return allowLegacySupplierFallback && document.supplierId === cost.supplierId;
}

export function factoryCostEntryLabel(cost: CostLike, itemIndex: number, sameSupplierCostCount: number) {
  const supplierName = supplierNameForCost(cost);
  const costType = normalizedCostType(String(cost.costType || "")) || "工厂货款";
  const amount = numberValue(cost.amountCny) || numberValue(cost.amount);
  const amountText = amount > 0 ? ` ${cost.currency || "CNY"} ${amount}` : "";
  const itemLabel = sameSupplierCostCount > 1 ? `工厂货款 ${itemIndex}` : costType;
  return `${supplierName} / ${itemLabel}${amountText}`;
}

export function confirmedFactorySupplierMismatch(input: Record<string, unknown> = {}) {
  return input.factorySupplierMismatchConfirmed === true || input.factorySupplierMismatchConfirmed === "true";
}

export function booleanInput(value: unknown, fallback = false) {
  if (value === true || value === "true" || value === "已确认") return true;
  if (value === false || value === "false" || value === "未确认") return false;
  return Boolean(fallback);
}

export function inputHasOwn(input: Record<string, unknown> | null | undefined, key: string) {
  return Object.prototype.hasOwnProperty.call(input || {}, key);
}

export function canConfirmLogisticsCost(actor: AccessUser) {
  return ["管理员", "财务"].includes(String(actor?.role || "")) || (canWrite(actor, "commissions") && canRead(actor, "payments"));
}
