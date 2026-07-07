import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  SUPPLIER_DOCUMENT_TYPES,
  cachedTaxRefundCompleteness,
  domesticLogisticsInfoSafeSelect,
  guardedPrismaFindMany,
  includeOrderRelations,
  nonEmpty,
  sanitizeTaxRefundCompletenessText,
  serializeOrder,
  serializeOrderDocument,
  standardFilenameForDocument,
  writeAudit,
} from "./shared";

export type TaxRefundCompletenessOrder = Parameters<typeof cachedTaxRefundCompleteness>[0];
export type TaxRefundSortableOrder = TaxRefundCompletenessOrder & {
  taxRefundStatus?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};
export type TaxRefundActionInput = Record<string, unknown>;
export type StandardFilenameOrder = Parameters<typeof standardFilenameForDocument>[1];
export type QueryLike = URLSearchParams;
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type ActorLike = { id?: string | null; role?: string | null } | null | undefined;
export type TaxRefundListMode = "current" | "archive";
export type TaxRefundListFilters = {
  page: number;
  pageSize: number;
  keyword: string;
  mode: TaxRefundListMode;
  statusFilter: string;
  businessEntityId: string;
  declarationMonthStart: Date | null;
  declarationMonthEnd: Date | null;
};
export const taxRefundLightListSelect = Prisma.validator<Prisma.ReceivableOrderSelect>()({
  id: true,
  orderNo: true,
  blNo: true,
  customerNameSnapshot: true,
  businessEntityId: true,
  businessEntityNameSnapshot: true,
  currency: true,
  customsDeclarationDate: true,
  taxRefundStatus: true,
  taxRefundCompleteness: true,
  taxRefundCompletenessUpdatedAt: true,
  taxRefundOverallCompleteness: true,
  taxRefundCompletenessIssuesSummary: true,
  taxArchived: true,
  taxRefundArchivedAt: true,
  taxRefundArchiveRemark: true,
  taxSubmittedAt: true,
  customer: { select: { name: true, shortName: true } },
  businessEntity: { select: { id: true, name: true, shortName: true, isDefault: true } },
});
export type TaxRefundLightListOrder = Prisma.ReceivableOrderGetPayload<{ select: typeof taxRefundLightListSelect }>;
export const taxRefundDocumentLightSelect = Prisma.validator<Prisma.OrderDocumentSelect>()({
  id: true,
  orderId: true,
  costId: true,
  supplierId: true,
  factoryDocumentRequestId: true,
  relatedModule: true,
  documentType: true,
  fileName: true,
  originalName: true,
  originalFilename: true,
  standardFilename: true,
  fileSize: true,
  mimeType: true,
  uploadStatus: true,
  uploadProgress: true,
  uploadedAt: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: { select: { id: true, name: true } },
  supplier: { select: { id: true, supplierName: true, supplierType: true } },
  cost: { select: { id: true, supplierNameSnapshot: true, costType: true, supplier: { select: { id: true, supplierName: true, supplierType: true } } } },
});
export const taxRefundCostLightSelect = Prisma.validator<Prisma.OrderCostSelect>()({
  id: true,
  orderId: true,
  supplierId: true,
  supplierNameSnapshot: true,
  costType: true,
  vendorName: true,
  currency: true,
  exchangeRate: true,
  exchangeRateDate: true,
  exchangeRateSource: true,
  exchangeRateType: true,
  amount: true,
  amountCny: true,
  status: true,
  voidedAt: true,
  voidReason: true,
  paymentStatus: true,
  costConfirmed: true,
  costConfirmedAt: true,
  paymentDate: true,
  paid: true,
  paidAt: true,
  invoiceStatus: true,
  sourceType: true,
  sourceId: true,
  remark: true,
  createdAt: true,
  updatedAt: true,
  supplier: { select: { id: true, supplierName: true, supplierType: true } },
  documents: {
    where: { deletedAt: null },
    select: taxRefundDocumentLightSelect,
    orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    take: 50,
  },
});
export type TaxRefundDocumentLight = Prisma.OrderDocumentGetPayload<{ select: typeof taxRefundDocumentLightSelect }>;
export type TaxRefundCostLight = Prisma.OrderCostGetPayload<{ select: typeof taxRefundCostLightSelect }>;
export type TaxRefundPackageDocument = Prisma.OrderDocumentGetPayload<{
  include: { uploadedBy: true; cost: { include: { supplier: true } }; supplier: true };
}>;
export type TaxRefundPackageOrder = Prisma.ReceivableOrderGetPayload<{
  include: {
    customer: true;
    businessEntity: true;
    documents: {
      include: { uploadedBy: true; cost: { include: { supplier: true } }; supplier: true };
    };
  };
}>;
export type TaxRefundOrderWithRelations = Prisma.ReceivableOrderGetPayload<{ include: ReturnType<typeof includeOrderRelations> }>;
export type TaxRefundDomesticLogisticsInfo = Prisma.DomesticLogisticsInfoGetPayload<{ select: ReturnType<typeof domesticLogisticsInfoSafeSelect> }>;
export type TaxRefundDomesticTransportItem = TaxRefundDomesticLogisticsInfo["transportItems"][number];
export const TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES = ["报关费", "拖车费", "国内物流费", "国内拖车费", "港杂费", "海运费"];
export const TAX_REFUND_SUPPLIER_DOCUMENT_LIMIT = 160;

export function taxRefundDetailBillOfLadingNumbers(order: Pick<TaxRefundOrderWithRelations, "blNo"> & { logisticsBills?: Array<{ billOfLadingNo?: string | null }> }) {
  return [
    nonEmpty(order.blNo),
    ...(order.logisticsBills || []).map((bill) => nonEmpty(bill.billOfLadingNo)),
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);
}

export function serializeTaxRefundOrderForActor(order: unknown, actor: ActorLike) {
  const serialized = serializeOrder(order);
  return serialized;
}

export function transportItemStableKey(item: TaxRefundDomesticTransportItem) {
  return item.id || [
    item.containerNo,
    item.containerType,
    item.truckPlateNo,
    item.trailerPlateNo,
    item.departureDate instanceof Date ? item.departureDate.toISOString() : item.departureDate,
    item.departurePlace,
    item.arrivalPlace,
    item.cargoName,
  ].map((value) => String(value || "")).join("|");
}

export function exportInvoiceContainerCount(info: TaxRefundDomesticLogisticsInfo) {
  const record = info.exportInvoice && typeof info.exportInvoice === "object" ? info.exportInvoice as Record<string, unknown> : {};
  const remark = record.remark && typeof record.remark === "object" ? record.remark as Record<string, unknown> : {};
  const containers = Array.isArray(remark.containers) ? remark.containers : [];
  return containers.length;
}

export function combineTaxRefundDomesticLogisticsInfos(infos: TaxRefundDomesticLogisticsInfo[]) {
  if (!infos.length) return [];
  const base = infos.find((info) => (info.transportItems || []).length) || infos[0];
  const seen = new Set<string>();
  const transportItems = infos.flatMap((info) => info.transportItems || []).filter((item) => {
    const key = transportItemStableKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [{
    ...base,
    exportInvoice: transportItems.length ? null : base.exportInvoice,
    transportItems,
  }];
}

export function warnIfArchivedLogisticsHasNoTransportItems(order: TaxRefundOrderWithRelations, billOfLadingNumbers: string[], infos: TaxRefundDomesticLogisticsInfo[]) {
  const transportItemCount = infos.reduce((sum, info) => sum + (info.transportItems || []).length, 0);
  const structuredContainerCount = infos.reduce((sum, info) => sum + exportInvoiceContainerCount(info), 0);
  const hasArchivedLogistics = infos.some((info) => (
    nonEmpty(info.remarkText)
    || Boolean(info.exportInvoice)
    || info.submittedAt
  ));
  if (hasArchivedLogistics && transportItemCount === 0 && structuredContainerCount === 0) {
    console.warn("tax-refund-logistics-archived-without-transport-items", {
      orderId: order.id,
      orderNo: order.orderNo,
      billOfLadingNumbers,
    });
  }
}

export async function hydrateTaxRefundOrderLogisticsInfo(order: TaxRefundOrderWithRelations): Promise<TaxRefundOrderWithRelations> {
  const orderBills = await guardedPrismaFindMany<Array<{ billOfLadingNo: string | null }>>(prisma.logisticsBill, "logisticsBill", "lib/platform/tax-refunds.ts:hydrateTaxRefundOrderLogisticsInfo.orderBills", {
    where: { orderId: order.id, deletedAt: null, status: { not: "voided" }, NOT: { billOfLadingNo: "" } },
    select: { billOfLadingNo: true },
    orderBy: [{ createdAt: "asc" }],
    take: 50,
  });
  const billOfLadingNumbers = taxRefundDetailBillOfLadingNumbers({ ...order, logisticsBills: orderBills });
  const relatedOrders = billOfLadingNumbers.length
    ? await guardedPrismaFindMany<Array<{ id: string; domesticLogisticsInfos: TaxRefundDomesticLogisticsInfo[] }>>(prisma.receivableOrder, "receivableOrder", "lib/platform/tax-refunds.ts:hydrateTaxRefundOrderLogisticsInfo.relatedOrders", {
      where: {
        deletedAt: null,
        OR: [
          { id: order.id },
          { blNo: { in: billOfLadingNumbers } },
          { logisticsBills: { some: { deletedAt: null, status: { not: "voided" }, billOfLadingNo: { in: billOfLadingNumbers } } } },
        ],
      },
      select: {
        id: true,
        domesticLogisticsInfos: {
          where: { deletedAt: null },
          select: domesticLogisticsInfoSafeSelect(),
          orderBy: [{ updatedAt: "desc" }],
        },
      },
      take: 100,
    })
    : [{
      id: order.id,
      domesticLogisticsInfos: order.domesticLogisticsInfos || [],
    }];
  const infoById = new Map<string, TaxRefundDomesticLogisticsInfo>();
  for (const info of order.domesticLogisticsInfos || []) infoById.set(info.id, info);
  for (const relatedOrder of relatedOrders) {
    for (const info of relatedOrder.domesticLogisticsInfos || []) infoById.set(info.id, info);
  }
  const infos = [...infoById.values()];
  warnIfArchivedLogisticsHasNoTransportItems(order, billOfLadingNumbers, infos);
  return {
    ...order,
    domesticLogisticsInfos: combineTaxRefundDomesticLogisticsInfos(infos),
  };
}

export function taxRefundCompletenessSummaryText(completeness: ReturnType<typeof cachedTaxRefundCompleteness>, fallback = "") {
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


export function serializeTaxRefundLightDocument(document: TaxRefundDocumentLight, order: Record<string, unknown> = {}) {
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

export function serializeTaxRefundLightCost(cost: TaxRefundCostLight, order: Record<string, unknown> = {}) {
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

export function taxRefundFactoryDocumentMatchesCost(document: TaxRefundDocumentLight, cost: TaxRefundCostLight) {
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
