import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  FACTORY_SUPPLIER_COST_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_REFUND_SUPPLIER_TYPES,
  codedError,
  nonEmpty,
  normalizeEmail,
  requireText,
  validEmail,
} from "./shared";
import {
  type ActorLike,
  type SupplierDocumentRequestCostOccupancy,
  type SupplierDocumentRequestOccupancyClient,
  type SupplierDocumentRequestRow,
  DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_CODE,
  DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_MESSAGE,
  duplicateSupplierDocumentRequestError,
  supplierDocumentRequestPairKey,
} from "./supplier-document-request-definitions";

export async function activeSupplierDocumentRequestPairSet(
  costs: Array<{ orderId?: string | null; supplierId?: string | null }>,
  options: { legacyWithoutCostOnly?: boolean } = {},
) {
  const orderIds = [...new Set(costs.map((cost) => cost.orderId || "").filter(Boolean))];
  const supplierIds = [...new Set(costs.map((cost) => cost.supplierId || "").filter(Boolean))];
  if (!orderIds.length || !supplierIds.length) return new Set<string>();
  const requests = await prisma.supplierDocumentRequest.findMany({
    where: {
      orderId: { in: orderIds },
      supplierId: { in: supplierIds },
      deletedAt: null,
      NOT: { status: "DELETED" },
      ...(options.legacyWithoutCostOnly ? { costId: null } : {}),
    },
    select: { orderId: true, supplierId: true },
    take: 500,
  });
  return new Set(requests.map((row) => supplierDocumentRequestPairKey(row.orderId, row.supplierId)));
}

function costIdsFrom(costs: Array<{ id?: string | null }>) {
  return [...new Set(costs.map((cost) => cost.id || "").filter(Boolean))];
}

export async function supplierDocumentRequestOccupiedCostSet(
  costs: Array<{ id?: string | null }>,
  client: SupplierDocumentRequestOccupancyClient = prisma,
) {
  const costIds = costIdsFrom(costs);
  if (!costIds.length) return new Set<string>();
  const [requestRows, documentRows, assetRows] = await Promise.all([
    client.supplierDocumentRequest.findMany({
      where: {
        costId: { in: costIds },
        deletedAt: null,
        NOT: { status: "DELETED" },
      },
      select: { costId: true },
      distinct: ["costId"],
    }),
    client.orderDocument.findMany({
      where: {
        costId: { in: costIds },
        relatedModule: "SUPPLIER",
        documentType: { in: SUPPLIER_DOCUMENT_TYPES },
        uploadStatus: "SUCCESS",
        deletedAt: null,
      },
      select: { costId: true },
      distinct: ["costId"],
    }),
    client.fileAsset.findMany({
      where: {
        costId: { in: costIds },
        relatedModule: "SUPPLIER",
        fileRole: { in: SUPPLIER_DOCUMENT_TYPES },
        isDeleted: false,
        deletedAt: null,
      },
      select: { costId: true },
      distinct: ["costId"],
    }),
  ]);
  return new Set([
    ...requestRows.map((row) => row.costId || "").filter(Boolean),
    ...documentRows.map((row) => row.costId || "").filter(Boolean),
    ...assetRows.map((row) => row.costId || "").filter(Boolean),
  ]);
}

export async function supplierDocumentRequestCostOccupancy(
  cost: { id?: string | null; orderId?: string | null; supplierId?: string | null },
  client: SupplierDocumentRequestOccupancyClient = prisma,
): Promise<SupplierDocumentRequestCostOccupancy> {
  const costId = nonEmpty(cost.id);
  const orderId = nonEmpty(cost.orderId);
  const supplierId = nonEmpty(cost.supplierId);
  if (!costId) return { occupied: false };
  const [requestRow, documentRow, assetRow, legacyRequestRow] = await Promise.all([
    client.supplierDocumentRequest.findFirst({
      where: {
        costId,
        deletedAt: null,
        NOT: { status: "DELETED" },
      },
      select: { id: true },
    }),
    client.orderDocument.findFirst({
      where: {
        costId,
        relatedModule: "SUPPLIER",
        documentType: { in: SUPPLIER_DOCUMENT_TYPES },
        uploadStatus: "SUCCESS",
        deletedAt: null,
      },
      select: { id: true },
    }),
    client.fileAsset.findFirst({
      where: {
        costId,
        relatedModule: "SUPPLIER",
        fileRole: { in: SUPPLIER_DOCUMENT_TYPES },
        isDeleted: false,
        deletedAt: null,
      },
      select: { id: true },
    }),
    orderId && supplierId
      ? client.supplierDocumentRequest.findFirst({
          where: {
            orderId,
            supplierId,
            costId: null,
            deletedAt: null,
            NOT: { status: "DELETED" },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  if (requestRow?.id) return { occupied: true, source: "REQUEST", sourceId: requestRow.id };
  if (documentRow?.id) return { occupied: true, source: "DOCUMENT", sourceId: documentRow.id };
  if (assetRow?.id) return { occupied: true, source: "FILE_ASSET", sourceId: assetRow.id };
  if (legacyRequestRow?.id) return { occupied: true, source: "LEGACY_REQUEST", sourceId: legacyRequestRow.id };
  return { occupied: false };
}

export async function assertSupplierDocumentRequestCostAvailable(
  cost: { id?: string | null; orderId?: string | null; supplierId?: string | null },
  client: SupplierDocumentRequestOccupancyClient = prisma,
) {
  const occupancy = await supplierDocumentRequestCostOccupancy(cost, client);
  if (occupancy.occupied) throw duplicateSupplierDocumentRequestError();
  return occupancy;
}

export function actorId(actor: ActorLike) {
  return requireText(actor?.id, "当前用户");
}

export function uniqueEmails(values: unknown[] = []) {
  return values
    .map((value) => normalizeEmail(value))
    .filter((email) => email && validEmail(email))
    .filter((email, index, arr) => arr.indexOf(email) === index);
}

export function requiredDocumentTypes(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const types = raw
    .map(normalizeSupplierReturnDocumentType)
    .filter((item): item is OrderDocumentType => SUPPLIER_DOCUMENT_TYPES.includes(item as OrderDocumentType));
  const unique = types.filter((item, index, arr) => arr.indexOf(item) === index);
  if (!unique.length) {
    throw codedError("请至少选择一种需要供应商回传的资料。", 400, "SUPPLIER_DOCUMENT_TYPE_REQUIRED");
  }
  return unique;
}

export function normalizeSupplierReturnDocumentType(value: unknown) {
  const type = String(value || "").trim().toUpperCase();
  if (["SUPPLIER_PURCHASE_CONTRACT", "PURCHASE_CONTRACT", "FACTORY_PURCHASE_CONTRACT", "FACTORY_CONTRACT"].includes(type)) {
    return "SUPPLIER_PURCHASE_CONTRACT";
  }
  if (["SUPPLIER_INVOICE", "VAT_INVOICE", "SUPPLIER_VAT_INVOICE", "FACTORY_INVOICE", "FACTORY_VAT_INVOICE"].includes(type)) {
    return "SUPPLIER_INVOICE";
  }
  return type;
}

export function factoryCostSlotsForSupplierRequest(row: Pick<SupplierDocumentRequestRow, "orderId" | "supplierId" | "order">) {
  return (row.order.costs || [])
    .filter((cost) => (
      cost.orderId === row.orderId
      && cost.supplierId === row.supplierId
      && FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType)
      && TAX_REFUND_SUPPLIER_TYPES.includes(cost.supplier?.supplierType || "")
    ))
    .map((cost, index) => ({
      id: cost.id,
      supplierId: cost.supplierId || "",
      supplierName: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "",
      costType: cost.costType,
      amount: Number(cost.amount || 0),
      amountCny: Number(cost.amountCny || 0),
      currency: cost.currency || "CNY",
      label: `工厂货款 ${index + 1}`,
    }));
}
