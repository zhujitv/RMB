import {
  SUPPLIER_DOCUMENT_TYPES,
  cachedTaxRefundCompleteness,
  sanitizeTaxRefundCompletenessText,
  serializeOrder,
  serializeOrderDocument,
} from "./shared";
import type {
  ActorLike,
  TaxRefundCostLight,
  TaxRefundDocumentLight,
} from "./tax-refunds-model";

export function serializeTaxRefundOrderForActor(order: unknown, actor: ActorLike) {
  const serialized = serializeOrder(order);
  return serialized;
}

export function taxRefundCompletenessSummaryText(
  completeness: ReturnType<typeof cachedTaxRefundCompleteness>,
  fallback = "",
) {
  const sanitizedFallback = sanitizeTaxRefundCompletenessText(fallback);
  if (sanitizedFallback) return sanitizedFallback;
  const labels = Array.isArray(completeness.missingLabels)
    ? completeness.missingLabels.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (labels.length) return labels.slice(0, 30).join(" / ");
  return String(completeness.text || "");
}

export function taxRefundOverallCompletenessPercent(order: {
  taxRefundOverallCompleteness?: number | null;
  taxRefundCompleteness?: unknown;
}) {
  if (order.taxRefundOverallCompleteness != null) {
    const value = Number(order.taxRefundOverallCompleteness);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  }
  const completeness = cachedTaxRefundCompleteness(order);
  const total = Number(completeness.total || 0);
  if (total <= 0) return 0;
  return Math.round((Number(completeness.completed || 0) / total) * 100);
}

export function serializeTaxRefundLightDocument(
  document: TaxRefundDocumentLight,
  order: Record<string, unknown> = {},
) {
  const serialized = serializeOrderDocument(document, order);
  return {
    id: serialized.id,
    fileId: serialized.id,
    orderId: serialized.orderId,
    costId: serialized.costId,
    supplierId: serialized.supplierId,
    relatedModule: serialized.relatedModule,
    documentType: serialized.documentType,
    documentTypeLabel: serialized.documentTypeLabel,
    supplierName: serialized.supplierName,
    costType: serialized.costType,
    fileName: serialized.fileName,
    uploadedBy: serialized.uploadedByName,
    uploadedByName: serialized.uploadedByName,
    uploadedAt: serialized.uploadedAt,
    recognitionStatus: serialized.uploadStatusLabel,
    uploadStatus: serialized.uploadStatus,
    uploadStatusLabel: serialized.uploadStatusLabel,
    previewUrl: `/api/order-documents/${encodeURIComponent(String(serialized.id || ""))}/preview`,
    downloadUrl: `/api/order-documents/${encodeURIComponent(String(serialized.id || ""))}/download`,
  };
}

export function serializeTaxRefundLightCost(
  cost: TaxRefundCostLight,
  order: Record<string, unknown> = {},
) {
  return {
    id: cost.id,
    supplierId: cost.supplierId || "",
    supplierName: cost.supplierNameSnapshot || cost.supplier?.supplierName || "",
    supplierNameSnapshot: cost.supplierNameSnapshot || "",
    vendorName: cost.vendorName || "",
    supplierType: cost.supplier?.supplierType || "",
    costType: cost.costType,
    amount: Number(cost.amount || 0),
    amountCny: Number(cost.amountCny || 0),
    currency: cost.currency,
    status: cost.status,
    invoiceStatus: cost.invoiceStatus,
    sourceType: cost.sourceType,
    sourceId: cost.sourceId || "",
    documents: (cost.documents || []).map((document) => serializeTaxRefundLightDocument(document, {
      ...order,
      id: cost.orderId,
      orderNo: String(order.orderNo || ""),
      blNo: String(order.blNo || ""),
      documents: cost.documents || [],
    })),
  };
}

export function uniqueTaxRefundDocuments<T extends { id?: string | null }>(documents: T[] = []) {
  const seen = new Set<string>();
  return documents.filter((document) => {
    if (!document?.id || seen.has(document.id)) return false;
    seen.add(document.id);
    return true;
  });
}

export function taxRefundFactoryDocumentMatchesCost(
  document: TaxRefundDocumentLight,
  cost: TaxRefundCostLight,
) {
  if (document.uploadStatus !== "SUCCESS") return false;
  if (document.orderId !== cost.orderId) return false;
  if (!SUPPLIER_DOCUMENT_TYPES.includes(document.documentType)) return false;
  if (document.relatedModule !== "SUPPLIER" && !document.factoryDocumentRequestId) return false;
  if (document.costId) return document.costId === cost.id;
  if (!document.supplierId || !cost.supplierId) return false;
  return document.supplierId === cost.supplierId;
}

export function withHistoricalSupplierDocuments(
  costs: TaxRefundCostLight[] = [],
  documents: TaxRefundDocumentLight[] = [],
) {
  if (!documents.length) return costs;
  return costs.map((cost) => ({
    ...cost,
    documents: uniqueTaxRefundDocuments([
      ...(cost.documents || []),
      ...documents.filter((document) => taxRefundFactoryDocumentMatchesCost(document, cost)),
    ]),
  }));
}
