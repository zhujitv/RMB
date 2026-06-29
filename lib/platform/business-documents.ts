import { prisma } from "../prisma";
import { SUPPLIER_DOCUMENT_TYPES } from "./shared-constants";

export const SUPPLIER_RETURN_DOCUMENT_SOURCE = "SUPPLIER_RETURN";

type BusinessDocumentLike = {
  id?: string | null;
  orderId?: string | null;
  costId?: string | null;
  supplierId?: string | null;
  factoryDocumentRequestId?: string | null;
  relatedModule?: string | null;
  documentType?: string | null;
  uploadStatus?: string | null;
  deletedAt?: Date | string | null;
};

type CostDocumentCarrier = {
  id?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  documents?: BusinessDocumentLike[] | null;
};

export const UNIFIED_BUSINESS_DOCUMENT_TYPES = [
  "SUPPLIER_PURCHASE_CONTRACT",
  "SUPPLIER_CONTRACT",
  "SUPPLIER_INVOICE",
  "SUPPLIER_VAT_INVOICE",
  "LOGISTICS_INVOICE",
  "CUSTOMS_ENTRY_FORM",
  "CUSTOMS_DECLARATION",
  "RELEASE_NOTICE",
  "CUSTOMS_POWER_OF_ATTORNEY",
  "TAX_REFUND_DOCUMENT",
] as const;

export function businessDocumentSource(document: BusinessDocumentLike = {}) {
  if (document.factoryDocumentRequestId) return SUPPLIER_RETURN_DOCUMENT_SOURCE;
  if (document.costId) return "COST";
  return document.relatedModule || "ORDER";
}

function withBusinessDocumentSource<T extends BusinessDocumentLike>(document: T): T & { source: string } {
  return {
    ...document,
    source: businessDocumentSource(document),
  };
}

function successBusinessDocument(document: BusinessDocumentLike = {}) {
  return document.uploadStatus === "SUCCESS" && !document.deletedAt;
}

export function costBusinessDocumentTypes(cost: CostDocumentCarrier = {}) {
  return cost.orderId && cost.supplierId ? SUPPLIER_DOCUMENT_TYPES : [];
}

export function businessDocumentMatchesCost(cost: CostDocumentCarrier, document: BusinessDocumentLike, documentType?: string) {
  if (!successBusinessDocument(document)) return false;
  if (!cost.orderId || !cost.supplierId) return false;
  if (document.orderId !== cost.orderId || document.supplierId !== cost.supplierId) return false;
  if (document.relatedModule !== "SUPPLIER") return false;
  if (documentType && document.documentType !== documentType) return false;
  return costBusinessDocumentTypes(cost).includes(document.documentType as never);
}

export async function getBusinessDocuments(orderId: string) {
  if (!orderId) return [];
  const rows = await prisma.orderDocument.findMany({
    where: {
      orderId,
      deletedAt: null,
    },
    include: {
      uploadedBy: true,
      supplier: true,
      cost: { include: { supplier: true } },
    },
    orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
  });
  return rows.map(withBusinessDocumentSource);
}

export function mergeCostBusinessDocuments<T extends CostDocumentCarrier>(
  cost: T,
  businessDocuments: BusinessDocumentLike[] = [],
) {
  const existing = cost.documents || [];
  const seen = new Set(existing.map((document) => document.id).filter(Boolean));
  const matched = businessDocuments
    .filter((document) => businessDocumentMatchesCost(cost, document))
    .filter((document) => {
      if (!document.id || seen.has(document.id)) return false;
      seen.add(document.id);
      return true;
    })
    .map(withBusinessDocumentSource);
  const documents = [
    ...existing.map(withBusinessDocumentSource),
    ...matched,
  ];
  return {
    ...cost,
    documents,
  };
}

export async function attachBusinessDocumentsToCosts<T extends CostDocumentCarrier>(costs: T[] = []) {
  const orderIds = [...new Set(costs.map((cost) => cost.orderId).filter((id): id is string => Boolean(id)))];
  if (!orderIds.length) return costs;
  const documents = await prisma.orderDocument.findMany({
    where: {
      orderId: { in: orderIds },
      relatedModule: "SUPPLIER",
      documentType: { in: SUPPLIER_DOCUMENT_TYPES },
      uploadStatus: "SUCCESS",
      deletedAt: null,
    },
    include: {
      uploadedBy: true,
      supplier: true,
      cost: { include: { supplier: true } },
    },
    orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
  });
  const documentsByOrderId = documents.reduce<Map<string, BusinessDocumentLike[]>>((acc, document) => {
    const key = document.orderId || "";
    if (!key) return acc;
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(withBusinessDocumentSource(document));
    return acc;
  }, new Map());
  return costs.map((cost) => {
    const merged = mergeCostBusinessDocuments(cost, documentsByOrderId.get(cost.orderId || "") || []);
    logMissingCostBusinessDocuments(merged);
    return merged;
  });
}

export async function attachBusinessDocumentsToCost<T extends CostDocumentCarrier>(cost: T | null | undefined) {
  if (!cost) return cost;
  const [merged] = await attachBusinessDocumentsToCosts([cost]);
  return merged;
}

export async function attachBusinessDocumentsToCostOrders<T extends { costs?: CostDocumentCarrier[] | null }>(orders: T[] = []) {
  const costs = orders.flatMap((order) => order.costs || []);
  const mergedCosts = await attachBusinessDocumentsToCosts(costs);
  const costsById = new Map(mergedCosts.map((cost) => [cost.id || "", cost]));
  return orders.map((order) => ({
    ...order,
    costs: (order.costs || []).map((cost) => costsById.get(cost.id || "") || cost),
  }));
}

export async function successfulSupplierInvoicePairs() {
  const rows = await prisma.orderDocument.findMany({
    where: {
      documentType: "SUPPLIER_INVOICE",
      relatedModule: "SUPPLIER",
      uploadStatus: "SUCCESS",
      deletedAt: null,
      supplierId: { not: null },
    },
    select: { orderId: true, supplierId: true },
  });
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const orderId = row.orderId || "";
    const supplierId = row.supplierId || "";
    const key = `${orderId}:${supplierId}`;
    if (!orderId || !supplierId || seen.has(key)) return [];
    seen.add(key);
    return [{ orderId, supplierId }];
  });
}

export async function hasCostBusinessDocument(cost: CostDocumentCarrier, documentType: string) {
  if (!cost.orderId || !cost.supplierId || !documentType) return false;
  const count = await prisma.orderDocument.count({
    where: {
      orderId: cost.orderId,
      supplierId: cost.supplierId,
      documentType: documentType as never,
      relatedModule: "SUPPLIER",
      uploadStatus: "SUCCESS",
      deletedAt: null,
    },
  });
  return count > 0;
}

function logMissingCostBusinessDocuments(cost: CostDocumentCarrier) {
  const expectedTypes = costBusinessDocumentTypes(cost);
  if (!expectedTypes.length) return;
  expectedTypes.forEach((documentType) => {
    const matched = (cost.documents || []).filter((document) => businessDocumentMatchesCost(cost, document, documentType));
    if (matched.length) return;
    console.info("cost-document-missing-check", {
      orderId: cost.orderId || "",
      orderNo: (cost as Record<string, unknown>).orderNo || ((cost as Record<string, unknown>).order as Record<string, unknown> | undefined)?.orderNo || "",
      supplierId: cost.supplierId || "",
      expectedDocumentType: documentType,
      actualMatchedAttachmentsCount: matched.length,
      matchedAttachmentIds: matched.map((document) => document.id).filter(Boolean),
    });
  });
}
