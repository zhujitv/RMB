import type { Prisma } from "../generated/prisma/client.js";

export const repairDocumentInclude = {
  order: { select: { id: true, orderNo: true } },
  supplier: { select: { id: true, supplierName: true } },
  cost: { select: { id: true, orderId: true, supplierId: true, supplierNameSnapshot: true, costType: true } },
  factoryDocumentRequest: {
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      costId: true,
      status: true,
      deletedAt: true,
      order: { select: { id: true, orderNo: true } },
      supplier: { select: { id: true, supplierName: true } },
    },
  },
} satisfies Prisma.OrderDocumentInclude;

export type RepairDocument = Prisma.OrderDocumentGetPayload<{ include: typeof repairDocumentInclude }>;
export type RepairCost = Prisma.OrderCostGetPayload<{
  select: {
    id: true;
    orderId: true;
    supplierId: true;
    supplierNameSnapshot: true;
    vendorName: true;
    costType: true;
  };
}>;

export type TaxRelationRepairIssue = {
  documentId: string;
  orderId: string;
  orderNo: string;
  supplierId: string;
  supplierName: string;
  documentType: string;
  reason: string;
};

export type TaxRelationRepairStats = {
  scanned: number;
  repaired: number;
  unable: number;
  refreshedOrders: number;
  syncedCosts: number;
  issues: TaxRelationRepairIssue[];
};

export type RepairTaxRelationOptions = {
  orderIds?: string[];
  orderNos?: string[];
  limit?: number;
  dryRun?: boolean;
  source?: string;
};

function normalizedText(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

export function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function resolvedOrderId(document: RepairDocument) {
  return document.orderId || document.factoryDocumentRequest?.orderId || document.cost?.orderId || "";
}

export function resolvedOrderNo(document: RepairDocument) {
  return document.order?.orderNo || document.factoryDocumentRequest?.order?.orderNo || "";
}

export function resolvedSupplierId(document: RepairDocument) {
  return document.supplierId || document.factoryDocumentRequest?.supplierId || document.cost?.supplierId || "";
}

export function resolvedSupplierName(document: RepairDocument) {
  return document.supplier?.supplierName || document.factoryDocumentRequest?.supplier?.supplierName
    || document.cost?.supplierNameSnapshot || "";
}

export function costKey(orderId: string, supplierId: string) {
  return `${orderId}:${supplierId}`;
}

export function costNameKey(orderId: string, supplierName: string) {
  return `${orderId}:${normalizedText(supplierName)}`;
}

export function pushCost<T extends RepairCost>(map: Map<string, T[]>, key: string, cost: T) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(cost);
}

export function documentIsUploaded(document: RepairDocument) {
  return document.uploadStatus === "SUCCESS" || Boolean(document.storageKey && document.fileName);
}

export function resolveRepairCost(
  document: RepairDocument,
  costsById: Map<string, RepairCost>,
  costsByOrderSupplier: Map<string, RepairCost[]>,
  costsByOrderSupplierName: Map<string, RepairCost[]>,
) {
  const existingCost = document.costId ? costsById.get(document.costId) || null : null;
  if (existingCost) return { cost: existingCost, reason: "" };
  const requestCost = document.factoryDocumentRequest?.costId
    ? costsById.get(document.factoryDocumentRequest.costId) || null
    : null;
  if (requestCost) return { cost: requestCost, reason: "" };
  const orderId = resolvedOrderId(document);
  const supplierId = resolvedSupplierId(document);
  const supplierName = resolvedSupplierName(document);
  const bySupplier = supplierId ? costsByOrderSupplier.get(costKey(orderId, supplierId)) || [] : [];
  if (bySupplier.length === 1) return { cost: bySupplier[0], reason: "" };
  if (bySupplier.length > 1) return { cost: null, reason: "multiple factory costs for supplier" };
  const byName = supplierName ? costsByOrderSupplierName.get(costNameKey(orderId, supplierName)) || [] : [];
  if (byName.length === 1) return { cost: byName[0], reason: "" };
  if (byName.length > 1) return { cost: null, reason: "multiple factory costs for supplier name" };
  if (document.factoryDocumentRequest?.costId) return { cost: null, reason: "purchaseOrderId mismatch" };
  return { cost: null, reason: supplierId || supplierName ? "factory cost missing" : "supplierId missing" };
}

export function issueFor(document: RepairDocument, reason: string): TaxRelationRepairIssue {
  return {
    documentId: document.id,
    orderId: resolvedOrderId(document),
    orderNo: resolvedOrderNo(document),
    supplierId: resolvedSupplierId(document),
    supplierName: resolvedSupplierName(document),
    documentType: document.documentType,
    reason,
  };
}
