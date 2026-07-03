import JSZip from "jszip";
import { prisma } from "../prisma";
import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { readR2Object, safeFileName } from "../r2";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  ARCHIVE_TAX_REFUND_STATUSES,
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  FACTORY_SUPPLIER_COST_TYPES,
  ORDER_DOCUMENT_LABELS,
  ORDER_DOCUMENT_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES,
  TAX_REFUND_STATUS_LABELS,
  TAX_REFUND_STATUSES,
  TAX_EXPORT_DOCUMENT_TYPES,
  assertRead,
  canWrite,
  cachedTaxRefundCompleteness,
  codedError,
  customerFullName,
  customerShortName,
  dateToInput,
  domesticLogisticsInfoSafeSelect,
  getCommissionFormulaSettings,
  guardedPrismaFindMany,
  includeOrderRelations,
  nonEmpty,
  num,
  optional,
  permissionError,
  refreshTaxRefundCompletenessForCustomsDeclaration,
  refreshTaxRefundCompletenessForOrder,
  roundMoney,
  runNonCriticalTask,
  sanitizeTaxRefundCompletenessText,
  serializeOrder,
  serializeOrderDocument,
  standardFilenameForDocument,
  summarizeOrder,
  taxDocumentCompleteness,
  taxRefundStatusFromCompleteness,
  writeAudit,
} from "./shared";
import { canReadDocumentContent } from "./order-documents";
import { orderAccessWhere } from "./order-access";
import { businessEntityFieldsFromOrder, businessEntityWhereFromQuery } from "./business-entities";
import { scheduleRepairTaxRelationsOnStartup } from "./repair-tax-relations";
import { customsDeclarationSupplierCompletenessIssues } from "./customs-declaration-supplier-validation";
import {
  allocateLogisticsCostForCustomsDeclaration,
  logisticsCostMatchesCustomsDeclaration,
} from "./logistics-cost-allocation";

type TaxRefundCompletenessOrder = Parameters<typeof cachedTaxRefundCompleteness>[0];
type TaxRefundSortableOrder = TaxRefundCompletenessOrder & {
  taxRefundStatus?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};
type TaxRefundActionInput = Record<string, unknown>;
type StandardFilenameOrder = Parameters<typeof standardFilenameForDocument>[1];
type QueryLike = URLSearchParams;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type ActorLike = { id?: string | null; role?: string | null } | null | undefined;
type TaxRefundListMode = "current" | "archive";
type TaxRefundListFilters = {
  page: number;
  pageSize: number;
  keyword: string;
  mode: TaxRefundListMode;
  statusFilter: string;
  businessEntityId: string;
  declarationMonthStart: Date | null;
  declarationMonthEnd: Date | null;
};
const taxRefundLightListSelect = Prisma.validator<Prisma.ReceivableOrderSelect>()({
  id: true,
  orderNo: true,
  blNo: true,
  customerNameSnapshot: true,
  businessEntityId: true,
  businessEntityNameSnapshot: true,
  currency: true,
  customsDeclarationNo: true,
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
  businessEntity: { select: { id: true, name: true, shortName: true } },
});
type TaxRefundLightListOrder = Prisma.ReceivableOrderGetPayload<{ select: typeof taxRefundLightListSelect }>;
const taxRefundCustomsDeclarationListSelect = Prisma.validator<Prisma.CustomsDeclarationSelect>()({
  id: true,
  orderId: true,
  billOfLadingNo: true,
  declarationNo: true,
  declarationDate: true,
  declarationAmount: true,
  containerCount: true,
  purchaseOrderId: true,
  supplierId: true,
  pdfDocumentId: true,
  taxRefundStatus: true,
  taxRefundCompleteness: true,
  taxRefundCompletenessUpdatedAt: true,
  taxRefundOverallCompleteness: true,
  taxRefundCompletenessIssuesSummary: true,
  taxArchived: true,
  taxRefundArchivedAt: true,
  taxRefundArchiveRemark: true,
  taxSubmittedAt: true,
  updatedAt: true,
  createdAt: true,
  supplier: { select: { id: true, supplierName: true, supplierType: true } },
  purchaseOrder: { select: { id: true, supplierNameSnapshot: true, supplier: { select: { id: true, supplierName: true, supplierType: true } } } },
  suppliers: {
    where: { deletedAt: null },
    select: {
      supplierId: true,
      supplier: { select: { id: true, supplierName: true, supplierType: true } },
      purchaseOrder: { select: { id: true, supplierNameSnapshot: true, supplier: { select: { id: true, supplierName: true, supplierType: true } } } },
    },
    take: 20,
  },
  order: { select: taxRefundLightListSelect },
});
type TaxRefundCustomsDeclarationListRow = Prisma.CustomsDeclarationGetPayload<{ select: typeof taxRefundCustomsDeclarationListSelect }>;
const taxRefundDocumentLightSelect = Prisma.validator<Prisma.OrderDocumentSelect>()({
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
const taxRefundCostLightSelect = Prisma.validator<Prisma.OrderCostSelect>()({
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
  generatedLogisticsExpense: {
    select: {
      customsDeclarationId: true,
      allocationMethod: true,
      allocatedAmount: true,
      invoiceDocument: { select: taxRefundDocumentLightSelect },
    },
  },
  documents: {
    where: { deletedAt: null },
    select: taxRefundDocumentLightSelect,
    orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    take: 50,
  },
});
type TaxRefundDocumentLight = Prisma.OrderDocumentGetPayload<{ select: typeof taxRefundDocumentLightSelect }>;
type TaxRefundCostLight = Prisma.OrderCostGetPayload<{ select: typeof taxRefundCostLightSelect }>;
type TaxRefundPackageDocument = Prisma.OrderDocumentGetPayload<{
  include: { uploadedBy: true; cost: { include: { supplier: true } }; supplier: true };
}>;
type TaxRefundPackageOrder = Prisma.ReceivableOrderGetPayload<{
  include: {
    customer: true;
    businessEntity: true;
    documents: {
      include: { uploadedBy: true; cost: { include: { supplier: true } }; supplier: true };
    };
  };
}>;
type TaxRefundOrderWithRelations = Prisma.ReceivableOrderGetPayload<{ include: ReturnType<typeof includeOrderRelations> }>;
type TaxRefundDomesticLogisticsInfo = Prisma.DomesticLogisticsInfoGetPayload<{ select: ReturnType<typeof domesticLogisticsInfoSafeSelect> }>;
type TaxRefundDomesticTransportItem = TaxRefundDomesticLogisticsInfo["transportItems"][number];
const TAX_REFUND_SUPPLIER_DOCUMENT_LIMIT = 160;
const TAX_REFUND_BATCH_OWNED_DOCUMENT_TYPES = new Set<OrderDocumentType>([
  ...DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  "COMMERCIAL_INVOICE",
  "PACKING_LIST",
  "SALES_CONTRACT",
  ...SUPPLIER_DOCUMENT_TYPES,
]);

function isTaxRefundBatchOwnedDocumentType(documentType: unknown) {
  return TAX_REFUND_BATCH_OWNED_DOCUMENT_TYPES.has(String(documentType || "") as OrderDocumentType);
}

function taxRefundOrderHasMultipleDeclarations(order: Record<string, unknown>) {
  const declarations = Array.isArray(order.customsDeclarations)
    ? order.customsDeclarations.filter((item) => Boolean(item && typeof item === "object" && (item as { id?: string }).id))
    : [];
  return declarations.length > 1;
}

function taxRefundDeclarationHasScopedOwnership(declaration: TaxRefundRecordDeclaration | null, order: Record<string, unknown> = {}) {
  return Boolean(
    declaration?.pdfDocumentId
    || declaration?.documents?.length
    || declaration?.suppliers?.length
    || taxRefundOrderHasMultipleDeclarations(order)
  );
}

function taxRefundLogisticsCostMatchesDeclaration(
  cost: { generatedLogisticsExpense?: { customsDeclarationId?: string | null; allocationMethod?: string | null; allocatedAmount?: unknown } | null },
  declaration: TaxRefundRecordDeclaration | null,
  order: Record<string, unknown>,
) {
  return logisticsCostMatchesCustomsDeclaration(cost, declaration, order);
}

function scopeTaxRefundOrderForDeclaration<T extends Record<string, unknown>>(order: T, declaration: TaxRefundRecordDeclaration | null) {
  if (!declaration) return order;
  const purchaseOrderIds = taxRefundDeclarationPurchaseOrderIds(declaration);
  const supplierIds = taxRefundDeclarationSupplierIds(declaration);
  const fallbackSupplierIds = taxRefundUniqueSupplierFallbackIds(order, declaration, supplierIds);
  const linkedFileIds = taxRefundDeclarationLinkedFileIds(declaration);
  const linkedDocuments = taxRefundDeclarationLinkedDocuments(declaration);
  const costs = Array.isArray(order.costs) ? order.costs : [];
  const scopedFactoryCostIds = new Set<string>();
  const scopedCosts = costs.filter((cost) => {
    const record = cost && typeof cost === "object" ? cost as Record<string, unknown> : {};
    if (!record || record.deletedAt) return false;
    const isFactoryCost = FACTORY_SUPPLIER_COST_TYPES.includes(String(record.costType || ""));
    if (!isFactoryCost) {
      const generatedLogisticsExpense = record.generatedLogisticsExpense && typeof record.generatedLogisticsExpense === "object"
        ? record.generatedLogisticsExpense as Record<string, unknown>
        : {};
      return taxRefundLogisticsCostMatchesDeclaration({
        generatedLogisticsExpense: {
          customsDeclarationId: String(generatedLogisticsExpense.customsDeclarationId || ""),
          allocationMethod: String(generatedLogisticsExpense.allocationMethod || ""),
          allocatedAmount: generatedLogisticsExpense.allocatedAmount,
        },
      }, declaration, order);
    }
    const matchedByPurchaseOrder = purchaseOrderIds.has(String(record.id || ""));
    const matchedBySupplier = fallbackSupplierIds.has(String(record.supplierId || ""));
    if (matchedByPurchaseOrder || matchedBySupplier) {
      if (record.id) scopedFactoryCostIds.add(String(record.id));
      return true;
    }
    return false;
  }).map((cost) => {
    const record = cost && typeof cost === "object" ? cost as Record<string, unknown> : {};
    if (FACTORY_SUPPLIER_COST_TYPES.includes(String(record.costType || ""))) return cost;
    const allocatedCost = allocateLogisticsCostForCustomsDeclaration(cost, declaration, order);
    const allocatedRecord = allocatedCost && typeof allocatedCost === "object" ? allocatedCost as Record<string, unknown> : {};
    const generated = allocatedRecord.generatedLogisticsExpense && typeof allocatedRecord.generatedLogisticsExpense === "object"
      ? allocatedRecord.generatedLogisticsExpense as Record<string, unknown>
      : {};
    const invoiceDocument = generated.invoiceDocument && typeof generated.invoiceDocument === "object"
      ? generated.invoiceDocument as { id?: string | null }
      : null;
    if (!invoiceDocument?.id) return allocatedCost;
    const costDocuments = Array.isArray(allocatedRecord.documents)
      ? allocatedRecord.documents as Array<{ id?: string | null }>
      : [];
    return {
      ...allocatedRecord,
      documents: uniqueTaxRefundDocuments([...costDocuments, invoiceDocument]),
    } as typeof allocatedCost;
  });
  const documents = Array.isArray(order.documents) ? order.documents : [];
  const scopedDocuments = documents.filter((document) => {
    const record = document && typeof document === "object" ? document as Record<string, unknown> : {};
    if (!record || record.deletedAt) return false;
    const documentType = String(record.documentType || "");
    if (linkedFileIds.has(String(record.id || ""))) return true;
    if (documentType === "CUSTOMS_ENTRY_FORM") return Boolean(declaration.pdfDocumentId && record.id === declaration.pdfDocumentId);
    if (isTaxRefundBatchOwnedDocumentType(documentType) && taxRefundDeclarationHasScopedOwnership(declaration, order)) return false;
    if (!SUPPLIER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) return true;
    if (!scopedFactoryCostIds.size) return false;
    if (record.costId) return scopedFactoryCostIds.has(String(record.costId));
    return fallbackSupplierIds.has(String(record.supplierId || ""));
  });
  return {
    ...order,
    customsDeclarationSupplierIssues: customsDeclarationSupplierCompletenessIssues(declaration.suppliers || []),
    costs: scopedCosts,
    documents: uniqueTaxRefundDocuments([...linkedDocuments, ...scopedDocuments]),
  };
}

function cachedTaxRefundCompletenessForDeclaration(
  order: TaxRefundCompletenessOrder,
  declaration: TaxRefundRecordDeclaration | null,
) {
  if (!declaration) return cachedTaxRefundCompleteness(order);
  return cachedTaxRefundCompleteness({
    taxRefundCompleteness: declaration.taxRefundCompleteness || null,
  });
}

function taxRefundDetailBillOfLadingNumbers(order: Pick<TaxRefundOrderWithRelations, "blNo"> & { logisticsBills?: Array<{ billOfLadingNo?: string | null }> }) {
  return [
    nonEmpty(order.blNo),
    ...(order.logisticsBills || []).map((bill) => nonEmpty(bill.billOfLadingNo)),
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);
}

function serializeTaxRefundOrderForActor(order: unknown, actor: ActorLike) {
  const serialized = serializeOrder(order);
  const record = order && typeof order === "object" ? order as Record<string, unknown> : {};
  if (record.customsDeclarationId) {
    return {
      ...serialized,
      id: String(record.customsDeclarationId || serialized.id || ""),
      orderId: String(record.orderId || serialized.id || ""),
      customsDeclarationId: String(record.customsDeclarationId || ""),
      purchaseOrderId: String(record.purchaseOrderId || ""),
      supplierId: String(record.supplierId || ""),
      supplierName: String(record.supplierName || ""),
    };
  }
  return serialized;
}

function transportItemStableKey(item: TaxRefundDomesticTransportItem) {
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

function exportInvoiceContainerCount(info: TaxRefundDomesticLogisticsInfo) {
  const record = info.exportInvoice && typeof info.exportInvoice === "object" ? info.exportInvoice as Record<string, unknown> : {};
  const remark = record.remark && typeof record.remark === "object" ? record.remark as Record<string, unknown> : {};
  const containers = Array.isArray(remark.containers) ? remark.containers : [];
  return containers.length;
}

function combineTaxRefundDomesticLogisticsInfos(infos: TaxRefundDomesticLogisticsInfo[]) {
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

function warnIfArchivedLogisticsHasNoTransportItems(order: TaxRefundOrderWithRelations, billOfLadingNumbers: string[], infos: TaxRefundDomesticLogisticsInfo[]) {
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

async function hydrateTaxRefundOrderLogisticsInfo(order: TaxRefundOrderWithRelations): Promise<TaxRefundOrderWithRelations> {
  const orderBills = await guardedPrismaFindMany<Array<{ billOfLadingNo: string | null }>>(prisma.logisticsBill, "logisticsBill", "lib/platform/tax-refunds.ts:hydrateTaxRefundOrderLogisticsInfo.orderBills", {
    where: { orderId: order.id, deletedAt: null, NOT: { billOfLadingNo: "" } },
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
          { logisticsBills: { some: { deletedAt: null, billOfLadingNo: { in: billOfLadingNumbers } } } },
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

function taxRefundCompletenessSummaryText(completeness: ReturnType<typeof cachedTaxRefundCompleteness>, fallback = "") {
  const sanitizedFallback = sanitizeTaxRefundCompletenessText(fallback);
  if (sanitizedFallback) return sanitizedFallback;
  const labels = Array.isArray(completeness.missingLabels)
    ? completeness.missingLabels.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (labels.length) return labels.slice(0, 30).join(" / ");
  return String(completeness.text || "");
}

function taxRefundOverallCompletenessPercent(order: {
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

export function serializeTaxRefundListOrderLight(order: TaxRefundLightListOrder) {
  const completeness = cachedTaxRefundCompleteness(order);
  const overallCompleteness = taxRefundOverallCompletenessPercent(order);
  const refundStatus = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
  const fullCustomerName = customerFullName(order.customer, order.customerNameSnapshot);
  const shortCustomerName = customerShortName(order.customer);
  const businessEntityFields = businessEntityFieldsFromOrder(order);
  const completenessIssuesSummary = taxRefundCompletenessSummaryText(completeness, order.taxRefundCompletenessIssuesSummary || "");
  return {
    id: order.id,
    orderNo: order.orderNo,
    billOfLadingNo: order.blNo || "",
    blNo: order.blNo || "",
    customerShortName: shortCustomerName || fullCustomerName,
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    businessEntityId: order.businessEntityId || "",
    businessEntityName: businessEntityFields.businessEntityDisplayName || businessEntityFields.businessEntityName || "",
    businessEntityShortName: businessEntityFields.businessEntityShortName || "",
    businessEntityDisplayName: businessEntityFields.businessEntityDisplayName || "",
    declarationDate: dateToInput(order.customsDeclarationDate),
    customsDeclarationDate: dateToInput(order.customsDeclarationDate),
    overallCompleteness,
    completenessUpdatedAt: order.taxRefundCompletenessUpdatedAt || null,
    completenessIssuesSummary,
    refundStatus,
    taxRefundStatus: refundStatus,
    taxRefundStatusLabel: (TAX_REFUND_STATUS_LABELS as Record<string, string>)[refundStatus] || refundStatus,
    taxArchived: Boolean(order.taxArchived || refundStatus === "SUBMITTED" || order.taxRefundArchivedAt),
    taxRefundArchivedAt: order.taxRefundArchivedAt || null,
    taxRefundArchiveRemark: order.taxRefundArchiveRemark || "",
    taxSubmittedAt: order.taxSubmittedAt || order.taxRefundArchivedAt || null,
  };
}

export type TaxRefundLightListOrderDto = ReturnType<typeof serializeTaxRefundListOrderLight>;

function declarationCompletenessInput(row: TaxRefundCustomsDeclarationListRow) {
  return {
    ...row.order,
    blNo: row.billOfLadingNo || row.order.blNo || "",
    customsDeclarationNo: row.declarationNo || row.order.customsDeclarationNo || "",
    customsDeclarationDate: row.declarationDate || row.order.customsDeclarationDate || null,
    taxRefundStatus: row.taxRefundStatus || row.order.taxRefundStatus,
    taxRefundCompleteness: row.taxRefundCompleteness || null,
    taxRefundCompletenessUpdatedAt: row.taxRefundCompletenessUpdatedAt || null,
    taxRefundOverallCompleteness: row.taxRefundOverallCompleteness ?? null,
    taxRefundCompletenessIssuesSummary: row.taxRefundCompletenessIssuesSummary || "",
    taxArchived: row.taxArchived,
    taxRefundArchivedAt: row.taxRefundArchivedAt,
    taxRefundArchiveRemark: row.taxRefundArchiveRemark,
    taxSubmittedAt: row.taxSubmittedAt,
  };
}

export function serializeTaxRefundListCustomsDeclarationLight(row: TaxRefundCustomsDeclarationListRow) {
  const order = declarationCompletenessInput(row);
  const completeness = cachedTaxRefundCompleteness(order);
  const overallCompleteness = taxRefundOverallCompletenessPercent(order);
  const refundStatus = taxRefundStatusFromCompleteness(row.taxRefundStatus || row.order.taxRefundStatus, completeness);
  const fullCustomerName = customerFullName(row.order.customer, row.order.customerNameSnapshot);
  const shortCustomerName = customerShortName(row.order.customer);
  const businessEntityFields = businessEntityFieldsFromOrder(row.order);
  const completenessIssuesSummary = taxRefundCompletenessSummaryText(completeness, row.taxRefundCompletenessIssuesSummary || "");
  const supplierNames = [
    row.supplier?.supplierName || row.purchaseOrder?.supplierNameSnapshot || row.purchaseOrder?.supplier?.supplierName || "",
    ...(row.suppliers || []).map((supplier) => (
      supplier.supplier?.supplierName
      || supplier.purchaseOrder?.supplierNameSnapshot
      || supplier.purchaseOrder?.supplier?.supplierName
      || ""
    )),
  ].map((name) => String(name || "").trim()).filter((name, index, arr) => name && arr.indexOf(name) === index);
  const supplierName = supplierNames.length > 3
    ? `${supplierNames.slice(0, 3).join("、")} 等 ${supplierNames.length} 家`
    : supplierNames.join("、");
  const billOfLadingNo = row.billOfLadingNo || row.order.blNo || "";
  return {
    id: row.id,
    customsDeclarationId: row.id,
    orderId: row.orderId,
    orderNo: row.order.orderNo,
    billOfLadingNo,
    blNo: billOfLadingNo,
    billOfLadingNumbers: billOfLadingNo ? [billOfLadingNo] : [],
    customsDeclarationNo: row.declarationNo || "",
    declarationNo: row.declarationNo || "",
    customerShortName: shortCustomerName || fullCustomerName,
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    supplierId: row.supplierId || row.purchaseOrder?.supplier?.id || "",
    supplierName,
    supplierCount: supplierNames.length,
    supplierNames,
    purchaseOrderId: row.purchaseOrderId || "",
    businessEntityId: row.order.businessEntityId || "",
    businessEntityName: businessEntityFields.businessEntityDisplayName || businessEntityFields.businessEntityName || "",
    businessEntityShortName: businessEntityFields.businessEntityShortName || "",
    businessEntityDisplayName: businessEntityFields.businessEntityDisplayName || "",
    declarationDate: dateToInput(row.declarationDate),
    customsDeclarationDate: dateToInput(row.declarationDate),
    overallCompleteness,
    completenessUpdatedAt: row.taxRefundCompletenessUpdatedAt || null,
    completenessIssuesSummary,
    refundStatus,
    taxRefundStatus: refundStatus,
    taxRefundStatusLabel: (TAX_REFUND_STATUS_LABELS as Record<string, string>)[refundStatus] || refundStatus,
    taxArchived: Boolean(row.taxArchived || refundStatus === "SUBMITTED" || row.taxRefundArchivedAt),
    taxRefundArchivedAt: row.taxRefundArchivedAt || null,
    taxRefundArchiveRemark: row.taxRefundArchiveRemark || "",
    taxSubmittedAt: row.taxSubmittedAt || row.taxRefundArchivedAt || null,
    pdfDocumentId: row.pdfDocumentId || "",
  };
}

export type TaxRefundCustomsDeclarationListDto = ReturnType<typeof serializeTaxRefundListCustomsDeclarationLight>;

function serializeTaxRefundLightDocument(document: TaxRefundDocumentLight, order: Record<string, unknown> = {}) {
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

function serializeTaxRefundLightCost(cost: TaxRefundCostLight, order: Record<string, unknown> = {}) {
  const costDocuments = uniqueTaxRefundDocuments([
    ...(cost.documents || []),
    ...(cost.generatedLogisticsExpense?.invoiceDocument ? [cost.generatedLogisticsExpense.invoiceDocument] : []),
  ]);
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
    invoiceStatus: cost.invoiceStatus,
    sourceType: cost.sourceType,
    sourceId: cost.sourceId || "",
    documents: costDocuments.map((document) => serializeTaxRefundLightDocument(document, {
      ...order,
      id: cost.orderId,
      orderNo: String(order.orderNo || ""),
      blNo: String(order.blNo || ""),
      documents: costDocuments,
    })),
  };
}

function uniqueTaxRefundDocuments<T extends { id?: string | null }>(documents: T[] = []) {
  const seen = new Set<string>();
  return documents.filter((document) => {
    if (!document?.id || seen.has(document.id)) return false;
    seen.add(document.id);
    return true;
  });
}

function taxRefundDeclarationPurchaseOrderIds(declaration: TaxRefundRecordDeclaration | null) {
  return new Set([
    declaration?.purchaseOrderId || "",
    ...(declaration?.suppliers || []).map((supplier) => supplier.purchaseOrderId || ""),
  ].filter(Boolean));
}

function taxRefundDeclarationSupplierIds(declaration: TaxRefundRecordDeclaration | null) {
  return new Set([
    declaration?.supplierId || declaration?.purchaseOrder?.supplier?.id || "",
    ...(declaration?.suppliers || []).flatMap((supplier) => [
      supplier.supplierId || "",
      supplier.purchaseOrder?.supplier?.id || "",
    ]),
  ].filter(Boolean));
}

function taxRefundDeclarationSupplierIdSet(declaration: unknown) {
  const row = declaration && typeof declaration === "object" ? declaration as {
    supplierId?: string | null;
    purchaseOrder?: { supplier?: { id?: string | null } | null } | null;
    suppliers?: Array<{
      supplierId?: string | null;
      purchaseOrder?: { supplier?: { id?: string | null } | null } | null;
    }> | null;
  } : {};
  return new Set([
    row.supplierId || row.purchaseOrder?.supplier?.id || "",
    ...(row.suppliers || []).flatMap((supplier) => [
      supplier.supplierId || "",
      supplier.purchaseOrder?.supplier?.id || "",
    ]),
  ].filter(Boolean));
}

function taxRefundUniqueSupplierFallbackIds(
  order: Record<string, unknown>,
  declaration: TaxRefundRecordDeclaration | null,
  supplierIds: Set<string>,
) {
  if (!declaration || !supplierIds.size) return new Set<string>();
  const declarations = Array.isArray(order.customsDeclarations)
    ? order.customsDeclarations.filter((item) => Boolean(item && typeof item === "object" && (item as { id?: string }).id))
    : [];
  if (declarations.length <= 1) return new Set(supplierIds);
  const currentSupplierIds = taxRefundDeclarationSupplierIdSet(declaration);
  const supplierDeclarationCount = new Map<string, number>();
  for (const item of declarations) {
    for (const supplierId of taxRefundDeclarationSupplierIdSet(item)) {
      supplierDeclarationCount.set(supplierId, (supplierDeclarationCount.get(supplierId) || 0) + 1);
    }
  }
  return new Set([...supplierIds].filter((supplierId) => (
    currentSupplierIds.has(supplierId)
    && supplierDeclarationCount.get(supplierId) === 1
  )));
}

function taxRefundDeclarationLinkedFileIds(declaration: TaxRefundRecordDeclaration | null) {
  const ids = [
    declaration?.pdfDocumentId || "",
    ...(declaration?.documents || []).map((document) => document.fileId || document.file?.id || ""),
    ...(declaration?.suppliers || []).flatMap((supplier) => [
      supplier.contractFileId || supplier.contractFile?.id || "",
      supplier.vatInvoiceFileId || supplier.vatInvoiceFile?.id || "",
    ]),
  ];
  return new Set(ids.filter(Boolean));
}

function taxRefundDeclarationLinkedDocuments(declaration: TaxRefundRecordDeclaration | null) {
  if (!declaration) return [] as TaxRefundDocumentLight[];
  const documents = [
    ...(declaration.documents || []).map((document) => document.file),
    ...(declaration.suppliers || []).flatMap((supplier) => [supplier.contractFile, supplier.vatInvoiceFile]),
  ].filter((document): document is TaxRefundDocumentLight => Boolean(document && document.uploadStatus === "SUCCESS"));
  return uniqueTaxRefundDocuments(documents);
}

function taxRefundDeclarationDocumentTypesForSection(declaration: TaxRefundRecordDeclaration | null, documentTypes: string[] = []) {
  const documentTypeSet = new Set(documentTypes);
  return taxRefundDeclarationLinkedDocuments(declaration).filter((document) => documentTypeSet.has(document.documentType));
}

function taxRefundFactoryDocumentMatchesCost(document: TaxRefundDocumentLight, cost: TaxRefundCostLight) {
  if (document.uploadStatus !== "SUCCESS") return false;
  if (document.orderId !== cost.orderId) return false;
  if (!SUPPLIER_DOCUMENT_TYPES.includes(document.documentType)) return false;
  if (document.relatedModule !== "SUPPLIER" && !document.factoryDocumentRequestId) return false;
  if (document.costId) return document.costId === cost.id;
  if (!document.supplierId || !cost.supplierId) return false;
  return document.supplierId === cost.supplierId;
}

function withHistoricalSupplierDocuments(
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

function taxRefundCompletenessPercent(order: TaxRefundCompletenessOrder = {}) {
  const completeness = cachedTaxRefundCompleteness(order);
  const total = Number(completeness.total || 0);
  if (total <= 0) return 0;
  return Math.round((Number(completeness.completed || 0) / total) * 100);
}

function taxRefundStatusSortRank(status: string = "") {
  return ({
    NOT_READY: 1,
    PROBLEM: 2,
    READY: 3,
    SUBMITTED: 4,
    REFUND_RECEIVED: 5,
  } as Record<string, number>)[status] || 5;
}

function dateSortValue(value: unknown) {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function sortTaxRefundOrders(a: TaxRefundSortableOrder = {}, b: TaxRefundSortableOrder = {}) {
  const percentDiff = taxRefundCompletenessPercent(a) - taxRefundCompletenessPercent(b);
  if (percentDiff) return percentDiff;
  const aStatus = taxRefundStatusFromCompleteness(a.taxRefundStatus, cachedTaxRefundCompleteness(a));
  const bStatus = taxRefundStatusFromCompleteness(b.taxRefundStatus, cachedTaxRefundCompleteness(b));
  const statusDiff = taxRefundStatusSortRank(aStatus) - taxRefundStatusSortRank(bStatus);
  if (statusDiff) return statusDiff;
  const updatedDiff = dateSortValue(b.updatedAt) - dateSortValue(a.updatedAt);
  if (updatedDiff) return updatedDiff;
  return dateSortValue(b.createdAt) - dateSortValue(a.createdAt);
}

function taxRefundListFiltersFromQuery(query: QueryLike): TaxRefundListFilters {
  const page = Math.max(1, Math.round(num(query.get("page"), 1)));
  const pageSize = Math.min(100, Math.max(1, Math.round(num(query.get("pageSize"), 20))));
  const keyword = nonEmpty(query.get("keyword"));
  const mode = nonEmpty(query.get("mode")) === "archive" ? "archive" : "current";
  const statusFilter = nonEmpty(query.get("status"));
  const businessEntityId = nonEmpty(query.get("businessEntityId") || query.get("businessEntity"));
  const declarationStartMonth = nonEmpty(query.get("declarationStartMonth"));
  const declarationEndMonth = nonEmpty(query.get("declarationEndMonth"));
  const declarationStart = declarationStartMonth && /^\d{4}-\d{2}$/.test(declarationStartMonth) ? new Date(`${declarationStartMonth}-01T00:00:00.000Z`) : null;
  const declarationEnd = declarationEndMonth && /^\d{4}-\d{2}$/.test(declarationEndMonth) ? new Date(`${declarationEndMonth}-01T00:00:00.000Z`) : null;
  return {
    page,
    pageSize,
    keyword,
    mode,
    statusFilter,
    businessEntityId,
    declarationMonthStart: declarationStart || null,
    declarationMonthEnd: declarationEnd ? new Date(Date.UTC(declarationEnd.getUTCFullYear(), declarationEnd.getUTCMonth() + 1, 1)) : null,
  };
}

function taxRefundKeywordWhere(keyword: string): Prisma.ReceivableOrderWhereInput {
  const statusMatches = keyword
    ? Object.entries(TAX_REFUND_STATUS_LABELS)
      .filter(([status, label]) => status.toLowerCase().includes(keyword.toLowerCase()) || label.toLowerCase().includes(keyword.toLowerCase()))
      .map(([status]) => status)
    : [];
  return keyword ? {
    OR: [
      { orderNo: { contains: keyword, mode: "insensitive" } },
      { blNo: { contains: keyword, mode: "insensitive" } },
      { logisticsBills: { some: { deletedAt: null, billOfLadingNo: { contains: keyword, mode: "insensitive" } } } },
      { customsDeclarationNo: { contains: keyword, mode: "insensitive" } },
      { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
      { taxRefundStatus: { contains: keyword, mode: "insensitive" } },
      { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
      { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
      { salesperson: { is: { name: { contains: keyword, mode: "insensitive" } } } },
      ...(statusMatches.length ? [{ taxRefundStatus: { in: statusMatches } }] : []),
    ],
  } : {};
}

function taxRefundDeclarationKeywordWhere(keyword: string): Prisma.CustomsDeclarationWhereInput {
  const statusMatches = keyword
    ? Object.entries(TAX_REFUND_STATUS_LABELS)
      .filter(([status, label]) => status.toLowerCase().includes(keyword.toLowerCase()) || label.toLowerCase().includes(keyword.toLowerCase()))
      .map(([status]) => status)
    : [];
  return keyword ? {
    OR: [
      { id: keyword },
      { declarationNo: { contains: keyword, mode: "insensitive" } },
      { billOfLadingNo: { contains: keyword, mode: "insensitive" } },
      { taxRefundStatus: { contains: keyword, mode: "insensitive" } },
      { supplier: { is: { supplierName: { contains: keyword, mode: "insensitive" } } } },
      { purchaseOrder: { is: { supplierNameSnapshot: { contains: keyword, mode: "insensitive" } } } },
      { purchaseOrder: { is: { supplier: { is: { supplierName: { contains: keyword, mode: "insensitive" } } } } } },
      { order: { is: { orderNo: { contains: keyword, mode: "insensitive" } } } },
      { order: { is: { blNo: { contains: keyword, mode: "insensitive" } } } },
      { order: { is: { customerNameSnapshot: { contains: keyword, mode: "insensitive" } } } },
      { order: { is: { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } } } },
      { order: { is: { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } } } },
      ...(statusMatches.length ? [{ taxRefundStatus: { in: statusMatches } }] : []),
    ],
  } : {};
}

function taxRefundListWhere(filters: TaxRefundListFilters, actor: ActorLike): Prisma.ReceivableOrderWhereInput {
  return {
    deletedAt: null,
    AND: [
      orderAccessWhere(actor),
      taxRefundKeywordWhere(filters.keyword),
      businessEntityWhereFromQuery(filters.businessEntityId),
      ...(filters.mode === "archive"
        ? [{ OR: [{ taxArchived: true }, { taxRefundStatus: { in: ARCHIVE_TAX_REFUND_STATUSES } }] }]
        : [{ taxArchived: false }, { taxRefundStatus: { in: ACTIVE_TAX_REFUND_STATUSES } }]),
      ...(TAX_REFUND_STATUSES.includes(filters.statusFilter) ? [{ taxRefundStatus: filters.statusFilter }] : []),
      ...(filters.declarationMonthStart || filters.declarationMonthEnd ? [{
        customsDeclarationDate: {
          ...(filters.declarationMonthStart ? { gte: filters.declarationMonthStart } : {}),
          ...(filters.declarationMonthEnd ? { lt: filters.declarationMonthEnd } : {}),
        },
      }] : []),
    ],
  };
}

function taxRefundDeclarationListWhere(filters: TaxRefundListFilters, actor: ActorLike): Prisma.CustomsDeclarationWhereInput {
  const orderWhere: Prisma.ReceivableOrderWhereInput = {
    deletedAt: null,
    AND: [
      orderAccessWhere(actor),
      businessEntityWhereFromQuery(filters.businessEntityId),
    ],
  };
  return {
    deletedAt: null,
    AND: [
      taxRefundDeclarationKeywordWhere(filters.keyword),
      { order: { is: orderWhere } },
      ...(filters.mode === "archive"
        ? [{ OR: [{ taxArchived: true }, { taxRefundStatus: { in: ARCHIVE_TAX_REFUND_STATUSES } }] }]
        : [{ taxArchived: false }, { taxRefundStatus: { in: ACTIVE_TAX_REFUND_STATUSES } }]),
      ...(TAX_REFUND_STATUSES.includes(filters.statusFilter) ? [{ taxRefundStatus: filters.statusFilter }] : []),
      ...(filters.declarationMonthStart || filters.declarationMonthEnd ? [{
        declarationDate: {
          ...(filters.declarationMonthStart ? { gte: filters.declarationMonthStart } : {}),
          ...(filters.declarationMonthEnd ? { lt: filters.declarationMonthEnd } : {}),
        },
      }] : []),
    ],
  };
}

type TaxRefundListResult = {
  orders: TaxRefundCustomsDeclarationListDto[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  query: string;
  mode: TaxRefundListMode;
};

function taxRefundListOrderBy(): Prisma.ReceivableOrderOrderByWithRelationInput[] {
  const orderBy: Prisma.ReceivableOrderOrderByWithRelationInput[] = [
    { taxRefundOverallCompleteness: { sort: "asc", nulls: "first" } },
  ];
  orderBy.push({ updatedAt: "desc" }, { createdAt: "desc" });
  return orderBy;
}

function taxRefundDeclarationListOrderBy(): Prisma.CustomsDeclarationOrderByWithRelationInput[] {
  return [
    { taxRefundOverallCompleteness: { sort: "asc", nulls: "first" } },
    { declarationDate: { sort: "desc", nulls: "last" } },
    { updatedAt: "desc" },
    { createdAt: "desc" },
  ];
}

export async function listTaxRefundOrders(query: QueryLike, actor: ActorLike): Promise<TaxRefundListResult> {
  assertRead(actor, "taxRefund");
  const filters = taxRefundListFiltersFromQuery(query);
  const where = taxRefundDeclarationListWhere(filters, actor);
  const skip = (filters.page - 1) * filters.pageSize;
  const orderBy = taxRefundDeclarationListOrderBy();
  const [total, rows] = await Promise.all([
    prisma.customsDeclaration.count({ where }),
    guardedPrismaFindMany<TaxRefundCustomsDeclarationListRow[]>(prisma.customsDeclaration, "customsDeclaration", "lib/platform/tax-refunds.ts:listTaxRefundOrders.rows", {
      where,
      select: taxRefundCustomsDeclarationListSelect,
      orderBy,
      skip,
      take: filters.pageSize,
    }),
  ]);
  return {
    orders: rows.map(serializeTaxRefundListCustomsDeclarationLight),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    },
    query: filters.keyword,
    mode: filters.mode,
  };
}

const taxRefundRecordDeclarationSelect = Prisma.validator<Prisma.CustomsDeclarationSelect>()({
  id: true,
  orderId: true,
  billOfLadingNo: true,
  declarationNo: true,
  declarationDate: true,
  declarationAmount: true,
  containerCount: true,
  purchaseOrderId: true,
  supplierId: true,
  pdfDocumentId: true,
  taxRefundStatus: true,
  taxRefundCompleteness: true,
  taxRefundCompletenessUpdatedAt: true,
  taxRefundOverallCompleteness: true,
  taxRefundCompletenessIssuesSummary: true,
  taxArchived: true,
  taxRefundArchivedById: true,
  taxRefundArchivedAt: true,
  taxRefundArchiveRemark: true,
  taxSubmittedById: true,
  taxSubmittedAt: true,
  supplier: { select: { id: true, supplierName: true } },
  purchaseOrder: { select: { id: true, supplierNameSnapshot: true, supplier: { select: { id: true, supplierName: true } } } },
  documents: {
    where: { deletedAt: null },
    select: {
      documentType: true,
      fileId: true,
      file: { select: taxRefundDocumentLightSelect },
    },
    take: 120,
  },
  suppliers: {
    where: { deletedAt: null },
    select: {
      supplierId: true,
      purchaseOrderId: true,
      requiredInvoiceAmount: true,
      vatInvoiceAmount: true,
      contractAmount: true,
      splitAmount: true,
      contractFileId: true,
      vatInvoiceFileId: true,
      validationStatus: true,
      validationMessage: true,
      supplier: { select: { id: true, supplierName: true } },
      purchaseOrder: { select: { id: true, supplierNameSnapshot: true, supplier: { select: { id: true, supplierName: true } } } },
      contractFile: { select: taxRefundDocumentLightSelect },
      vatInvoiceFile: { select: taxRefundDocumentLightSelect },
    },
    take: 120,
  },
});
type TaxRefundRecordDeclaration = Prisma.CustomsDeclarationGetPayload<{ select: typeof taxRefundRecordDeclarationSelect }>;

async function resolveTaxRefundRecordContext(recordId: string, actor: ActorLike) {
  const declaration = await prisma.customsDeclaration.findFirst({
    where: {
      id: recordId,
      deletedAt: null,
      order: { is: { deletedAt: null, ...orderAccessWhere(actor) } },
    },
    select: taxRefundRecordDeclarationSelect,
  });
  if (declaration) return { recordId, orderId: declaration.orderId, declaration };
  return { recordId, orderId: recordId, declaration: null };
}

function decorateTaxRefundOrderWithDeclaration<T extends Record<string, unknown>>(order: T, declaration: TaxRefundRecordDeclaration | null) {
  if (!declaration) return order;
  const supplierName = declaration.supplier?.supplierName
    || declaration.purchaseOrder?.supplierNameSnapshot
    || declaration.purchaseOrder?.supplier?.supplierName
    || "";
  return {
    ...order,
    id: declaration.id,
    orderId: declaration.orderId,
    customsDeclarationId: declaration.id,
    billOfLadingNo: declaration.billOfLadingNo || String(order.blNo || ""),
    blNo: declaration.billOfLadingNo || String(order.blNo || ""),
    customsDeclarationNo: declaration.declarationNo || "",
    customsDeclarationDate: declaration.declarationDate || null,
    customsDeclarationAmount: declaration.declarationAmount == null ? null : Number(declaration.declarationAmount || 0),
    declarationAmount: declaration.declarationAmount == null ? null : Number(declaration.declarationAmount || 0),
    customsDeclarationContainerCount: declaration.containerCount ?? null,
    containerCount: declaration.containerCount ?? null,
    taxRefundStatus: declaration.taxRefundStatus || String(order.taxRefundStatus || "NOT_READY"),
    taxRefundCompleteness: declaration.taxRefundCompleteness || null,
    taxRefundCompletenessUpdatedAt: declaration.taxRefundCompletenessUpdatedAt || null,
    taxRefundOverallCompleteness: declaration.taxRefundOverallCompleteness ?? null,
    taxRefundCompletenessIssuesSummary: declaration.taxRefundCompletenessIssuesSummary || "",
    taxArchived: declaration.taxArchived,
    taxRefundArchivedById: declaration.taxRefundArchivedById || "",
    taxRefundArchivedAt: declaration.taxRefundArchivedAt || null,
    taxRefundArchiveRemark: declaration.taxRefundArchiveRemark || "",
    taxSubmittedById: declaration.taxSubmittedById || "",
    taxSubmittedAt: declaration.taxSubmittedAt || declaration.taxRefundArchivedAt || null,
    purchaseOrderId: declaration.purchaseOrderId || "",
    supplierId: declaration.supplierId || declaration.purchaseOrder?.supplier?.id || "",
    supplierName,
  };
}

async function refreshTaxRefundRecordDeclarationForRead(declaration: TaxRefundRecordDeclaration | null) {
  if (!declaration) return declaration;
  const completeness = await refreshTaxRefundCompletenessForCustomsDeclaration(declaration.id);
  if (!completeness) return declaration;
  return {
    ...declaration,
    taxRefundCompleteness: completeness,
    taxRefundCompletenessUpdatedAt: new Date(),
    taxRefundOverallCompleteness: taxRefundOverallCompletenessPercent({ taxRefundCompleteness: completeness }),
    taxRefundCompletenessIssuesSummary: taxRefundCompletenessSummaryText(completeness),
    taxRefundStatus: taxRefundStatusFromCompleteness(declaration.taxRefundStatus, completeness),
  } as TaxRefundRecordDeclaration;
}

function isArchivedCustomsDeclaration(row: {
  taxArchived?: boolean | null;
  taxRefundArchivedAt?: Date | string | null;
  taxRefundStatus?: string | null;
}) {
  return Boolean(
    row.taxArchived
    || row.taxRefundArchivedAt
    || ARCHIVE_TAX_REFUND_STATUSES.includes(String(row.taxRefundStatus || "")),
  );
}

function activeDeclarationAggregateStatus(rows: Array<{ taxRefundStatus?: string | null }>) {
  const statuses = rows.map((row) => String(row.taxRefundStatus || "NOT_READY"));
  if (!statuses.length) return "NOT_READY";
  if (statuses.some((status) => status === "PROBLEM")) return "PROBLEM";
  if (statuses.every((status) => status === "READY")) return "READY";
  return "NOT_READY";
}

async function syncOrderTaxArchiveFromDeclarations(orderId: string, actorId: string, now = new Date()) {
  const declarations = await prisma.customsDeclaration.findMany({
    where: { orderId, deletedAt: null },
    select: {
      taxArchived: true,
      taxRefundStatus: true,
      taxRefundArchivedById: true,
      taxRefundArchivedAt: true,
      taxSubmittedById: true,
      taxSubmittedAt: true,
    },
    orderBy: [{ taxRefundArchivedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 200,
  });
  if (!declarations.length) {
    return prisma.receivableOrder.findFirst({
      where: { id: orderId, deletedAt: null },
      include: includeOrderRelations(),
    });
  }
  const activeDeclarations = declarations.filter((row) => !isArchivedCustomsDeclaration(row));
  if (activeDeclarations.length) {
    return prisma.receivableOrder.update({
      where: { id: orderId },
      data: {
        taxArchived: false,
        taxRefundArchivedById: null,
        taxRefundArchivedAt: null,
        taxRefundArchiveRemark: null,
        taxSubmittedById: null,
        taxSubmittedAt: null,
        taxRefundStatus: activeDeclarationAggregateStatus(activeDeclarations),
        updatedById: actorId,
      },
      include: includeOrderRelations(),
    });
  }
  const latestArchived = declarations.find((row) => isArchivedCustomsDeclaration(row)) || declarations[0];
  const allRefundReceived = declarations.every((row) => row.taxRefundStatus === "REFUND_RECEIVED");
  return prisma.receivableOrder.update({
    where: { id: orderId },
    data: {
      taxArchived: true,
      taxRefundStatus: allRefundReceived ? "REFUND_RECEIVED" : "SUBMITTED",
      taxRefundArchivedById: latestArchived?.taxRefundArchivedById || actorId,
      taxRefundArchivedAt: latestArchived?.taxRefundArchivedAt || now,
      taxRefundArchiveRemark: null,
      taxSubmittedById: latestArchived?.taxSubmittedById || latestArchived?.taxRefundArchivedById || actorId,
      taxSubmittedAt: latestArchived?.taxSubmittedAt || latestArchived?.taxRefundArchivedAt || now,
      updatedById: actorId,
    },
    include: includeOrderRelations(),
  });
}

export async function getTaxRefundOrderDetail(orderId: string, actor: ActorLike) {
  assertRead(actor, "taxRefund");
  const context = await resolveTaxRefundRecordContext(orderId, actor);
  const order = await prisma.receivableOrder.findFirst({
    where: { id: context.orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  const orderWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(order);
  const scopedOrder = scopeTaxRefundOrderForDeclaration(orderWithLogistics as unknown as Record<string, unknown>, context.declaration);
  const completeness = context.declaration
    ? await refreshTaxRefundCompletenessForCustomsDeclaration(context.declaration.id) || cachedTaxRefundCompletenessForDeclaration(order, context.declaration)
    : await refreshTaxRefundCompletenessForOrder(orderWithLogistics);
  const refreshedAt = completeness ? new Date() : null;
  const decoratedOrder = decorateTaxRefundOrderWithDeclaration(scopedOrder, context.declaration);
  const status = taxRefundStatusFromCompleteness(String(decoratedOrder.taxRefundStatus || order.taxRefundStatus), completeness);
  return serializeTaxRefundOrderForActor({
    ...scopedOrder,
    ...decoratedOrder,
    taxRefundCompleteness: completeness || context.declaration?.taxRefundCompleteness || order.taxRefundCompleteness,
    taxRefundCompletenessUpdatedAt: refreshedAt || context.declaration?.taxRefundCompletenessUpdatedAt || order.taxRefundCompletenessUpdatedAt,
    taxRefundStatus: status,
  }, actor);
}

async function getTaxRefundBaseOrder(orderId: string, actor: ActorLike) {
  const context = await resolveTaxRefundRecordContext(orderId, actor);
  const order = await prisma.receivableOrder.findFirst({
    where: { id: context.orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      ...taxRefundLightListSelect,
      customsDeclarationNo: true,
      customsDeclarationDate: true,
      taxRefundArchivedBy: { select: { id: true, name: true } },
      taxSubmittedBy: { select: { id: true, name: true } },
    },
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  const declaration = await refreshTaxRefundRecordDeclarationForRead(context.declaration);
  return decorateTaxRefundOrderWithDeclaration(order as unknown as Record<string, unknown>, declaration) as typeof order & Record<string, unknown>;
}

function serializeTaxRefundBasicOrder(order: Awaited<ReturnType<typeof getTaxRefundBaseOrder>>) {
  const light = order.customsDeclarationId
    ? {
      ...serializeTaxRefundListOrderLight(order),
      id: String(order.customsDeclarationId),
      orderId: String(order.orderId || ""),
      customsDeclarationId: String(order.customsDeclarationId),
      billOfLadingNo: String(order.billOfLadingNo || order.blNo || ""),
      blNo: String(order.billOfLadingNo || order.blNo || ""),
      customsDeclarationNo: String(order.customsDeclarationNo || ""),
      declarationDate: dateToInput(order.customsDeclarationDate as Date | null),
      customsDeclarationDate: dateToInput(order.customsDeclarationDate as Date | null),
      customsDeclarationAmount: order.customsDeclarationAmount == null ? null : Number(order.customsDeclarationAmount || 0),
      declarationAmount: order.declarationAmount == null ? null : Number(order.declarationAmount || 0),
      customsDeclarationContainerCount: order.customsDeclarationContainerCount == null ? null : Number(order.customsDeclarationContainerCount || 0),
      containerCount: order.containerCount == null ? null : Number(order.containerCount || 0),
      supplierId: String(order.supplierId || ""),
      supplierName: String(order.supplierName || ""),
      purchaseOrderId: String(order.purchaseOrderId || ""),
    }
    : serializeTaxRefundListOrderLight(order);
  return {
    ...light,
    taxRefundArchivedByName: order.taxRefundArchivedBy?.name || "",
    taxSubmittedByName: order.taxSubmittedBy?.name || order.taxRefundArchivedBy?.name || "",
    customsDeclarationNo: order.customsDeclarationNo || "",
    customsDeclarationDate: dateToInput(order.customsDeclarationDate),
    customsDeclarationAmount: order.customsDeclarationAmount == null ? null : Number(order.customsDeclarationAmount || 0),
    declarationAmount: order.declarationAmount == null ? null : Number(order.declarationAmount || 0),
    customsDeclarationContainerCount: order.customsDeclarationContainerCount == null ? null : Number(order.customsDeclarationContainerCount || 0),
    containerCount: order.containerCount == null ? null : Number(order.containerCount || 0),
    documentCompleteness: cachedTaxRefundCompleteness(order),
    taxRefundCompletenessUpdatedAt: order.taxRefundCompletenessUpdatedAt || null,
  };
}

async function getTaxRefundBasicSection(orderId: string, actor: ActorLike) {
  return serializeTaxRefundBasicOrder(await getTaxRefundBaseOrder(orderId, actor));
}

async function getTaxRefundDocumentSection(orderId: string, actor: ActorLike, documentTypes: string[]) {
  const context = await resolveTaxRefundRecordContext(orderId, actor);
  const order = await prisma.receivableOrder.findFirst({
    where: { id: context.orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      customerNameSnapshot: true,
      customer: { select: { name: true, shortName: true } },
      customsDeclarations: {
        where: { deletedAt: null },
        select: { id: true },
        take: 100,
      },
      documents: {
        where: {
          deletedAt: null,
          documentType: { in: documentTypes as OrderDocumentType[] },
        },
        select: taxRefundDocumentLightSelect,
        orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
        take: 80,
      },
    },
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  const declarationDocuments = taxRefundDeclarationDocumentTypesForSection(context.declaration, documentTypes);
  const declarationDocumentIds = new Set(declarationDocuments.map((document) => document.id));
  const declarationOwnsScopedDocuments = taxRefundDeclarationHasScopedOwnership(context.declaration, order as unknown as Record<string, unknown>);
  const filteredDocuments = context.declaration
    ? uniqueTaxRefundDocuments([
      ...declarationDocuments,
      ...(order.documents || []).filter((document) => {
        if (declarationDocumentIds.has(document.id)) return false;
        if (!isTaxRefundBatchOwnedDocumentType(document.documentType)) return true;
        if (document.documentType === "CUSTOMS_ENTRY_FORM") return Boolean(context.declaration?.pdfDocumentId && document.id === context.declaration.pdfDocumentId);
        return !declarationOwnsScopedDocuments;
      }),
    ])
    : (order.documents || []);
  return {
    id: context.declaration?.id || order.id,
    orderId: order.id,
    customsDeclarationId: context.declaration?.id || "",
    orderNo: order.orderNo,
    blNo: context.declaration?.billOfLadingNo || order.blNo || "",
    billOfLadingNo: context.declaration?.billOfLadingNo || order.blNo || "",
    customerName: customerShortName(order.customer) || customerFullName(order.customer, order.customerNameSnapshot),
    documents: filteredDocuments.map((document) => serializeTaxRefundLightDocument(document, order as Record<string, unknown>)),
  };
}

async function getTaxRefundCustomsDocumentsSection(orderId: string, actor: ActorLike) {
  const [basic, documents] = await Promise.all([
    getTaxRefundBasicSection(orderId, actor),
    getTaxRefundDocumentSection(orderId, actor, DOMESTIC_LOGISTICS_DOCUMENT_TYPES),
  ]);
  return {
    ...documents,
    ...basic,
    customsDeclarationNo: basic.customsDeclarationNo || "",
    customsDeclarationDate: basic.customsDeclarationDate || null,
    declarationDate: basic.declarationDate || null,
  };
}

async function getTaxRefundCostDocumentSection(orderId: string, actor: ActorLike, type: "factory" | "logistics") {
  const context = await resolveTaxRefundRecordContext(orderId, actor);
  const costTypes = type === "factory" ? FACTORY_SUPPLIER_COST_TYPES : TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES;
  const declarationPurchaseOrderIds = taxRefundDeclarationPurchaseOrderIds(context.declaration);
  const declarationSupplierIds = taxRefundDeclarationSupplierIds(context.declaration);
  const order = await prisma.receivableOrder.findFirst({
    where: { id: context.orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      taxRefundCompleteness: true,
      taxRefundCompletenessUpdatedAt: true,
      customsDeclarations: {
        where: { deletedAt: null },
        select: {
          id: true,
          supplierId: true,
          purchaseOrderId: true,
          declarationAmount: true,
          containerCount: true,
          suppliers: {
            where: { deletedAt: null },
            select: { supplierId: true, purchaseOrderId: true, requiredInvoiceAmount: true, vatInvoiceAmount: true, contractAmount: true, splitAmount: true },
            take: 200,
          },
        },
        take: 100,
      },
      costs: {
        where: { deletedAt: null, costType: { in: costTypes } },
        select: taxRefundCostLightSelect,
        orderBy: [{ createdAt: "desc" }],
        take: 200,
      },
      ...(type === "factory" ? {
        documents: {
          where: {
            deletedAt: null,
            documentType: { in: SUPPLIER_DOCUMENT_TYPES },
            OR: [
              { relatedModule: "SUPPLIER" },
              { factoryDocumentRequestId: { not: null } },
              { costId: { not: null } },
            ],
          },
          select: taxRefundDocumentLightSelect,
          orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
          take: TAX_REFUND_SUPPLIER_DOCUMENT_LIMIT,
        },
      } : {}),
    },
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  const fallbackSupplierIds = taxRefundUniqueSupplierFallbackIds(order as unknown as Record<string, unknown>, context.declaration, declarationSupplierIds);
  let orderCosts = ((order.costs || []) as TaxRefundCostLight[]).filter((cost) => {
    if (type === "factory" && context.declaration) {
      if (declarationPurchaseOrderIds.has(cost.id)) return true;
      if (fallbackSupplierIds.size) return Boolean(cost.supplierId && fallbackSupplierIds.has(cost.supplierId));
      return false;
    }
    if (type !== "logistics" || !context.declaration) return true;
    return taxRefundLogisticsCostMatchesDeclaration(cost, context.declaration, order as unknown as Record<string, unknown>);
  }).map((cost) => {
    if (type !== "logistics" || !context.declaration) return cost;
    return allocateLogisticsCostForCustomsDeclaration(cost, context.declaration, order as unknown as Record<string, unknown>);
  });
  if (type === "factory" && context.declaration && taxRefundDeclarationHasScopedOwnership(context.declaration, order as unknown as Record<string, unknown>)) {
    const linkedFileIds = taxRefundDeclarationLinkedFileIds(context.declaration);
    orderCosts = orderCosts.map((cost) => ({
      ...cost,
      documents: (cost.documents || []).filter((document) => linkedFileIds.has(document.id)),
    }));
  }
  const declarationSupplierDocuments = taxRefundDeclarationDocumentTypesForSection(context.declaration, SUPPLIER_DOCUMENT_TYPES);
  const historicalDocuments = (
    type === "factory"
      ? (declarationSupplierDocuments.length || taxRefundDeclarationHasScopedOwnership(context.declaration, order as unknown as Record<string, unknown>)
        ? declarationSupplierDocuments
        : "documents" in order && Array.isArray(order.documents) ? order.documents : [])
      : []
  ) as unknown as TaxRefundDocumentLight[];
  const costRows = type === "factory"
    ? withHistoricalSupplierDocuments(orderCosts, historicalDocuments)
    : orderCosts;
  const costs = costRows.map((cost) => serializeTaxRefundLightCost(cost, order as Record<string, unknown>));
  const documents = uniqueTaxRefundDocuments(costs.flatMap((cost) => cost.documents || []));
  return {
    id: context.declaration?.id || order.id,
    orderId: order.id,
    customsDeclarationId: context.declaration?.id || "",
    orderNo: order.orderNo,
    blNo: context.declaration?.billOfLadingNo || order.blNo || "",
    billOfLadingNo: context.declaration?.billOfLadingNo || order.blNo || "",
    documentCompleteness: cachedTaxRefundCompletenessForDeclaration(order, context.declaration),
    taxRefundCompletenessUpdatedAt: context.declaration?.taxRefundCompletenessUpdatedAt || order.taxRefundCompletenessUpdatedAt || null,
    costs,
    documents,
  };
}

async function getTaxRefundLogisticsDocumentsSection(orderId: string, actor: ActorLike) {
  const context = await resolveTaxRefundRecordContext(orderId, actor);
  const order = await prisma.receivableOrder.findFirst({
    where: { id: context.orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      taxRefundCompleteness: true,
      taxRefundCompletenessUpdatedAt: true,
      customsDeclarations: {
        where: { deletedAt: null },
        select: {
          id: true,
          declarationAmount: true,
          containerCount: true,
          suppliers: {
            where: { deletedAt: null },
            select: { requiredInvoiceAmount: true, vatInvoiceAmount: true, contractAmount: true, splitAmount: true },
            take: 200,
          },
        },
        take: 100,
      },
      domesticLogisticsInfos: {
        where: { deletedAt: null },
        select: domesticLogisticsInfoSafeSelect(),
        orderBy: [{ updatedAt: "desc" }],
        take: 5,
      },
      costs: {
        where: { deletedAt: null, costType: { in: TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES } },
        select: taxRefundCostLightSelect,
        orderBy: [{ createdAt: "desc" }],
        take: 80,
      },
    },
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  const scopedLogisticsCosts = (order.costs || []).filter((cost) => {
    if (!context.declaration) return true;
    return taxRefundLogisticsCostMatchesDeclaration(cost, context.declaration, order as unknown as Record<string, unknown>);
  }).map((cost) => {
    if (!context.declaration) return cost;
    return allocateLogisticsCostForCustomsDeclaration(cost, context.declaration, order as unknown as Record<string, unknown>);
  });
  const costs = scopedLogisticsCosts.map((cost) => serializeTaxRefundLightCost(cost, order as Record<string, unknown>));
  const documents = costs.flatMap((cost) => cost.documents || []);
  const domesticLogisticsInfo = combineTaxRefundDomesticLogisticsInfos(order.domesticLogisticsInfos || [])[0] || null;
  return {
    id: context.declaration?.id || order.id,
    orderId: order.id,
    customsDeclarationId: context.declaration?.id || "",
    orderNo: order.orderNo,
    blNo: context.declaration?.billOfLadingNo || order.blNo || "",
    billOfLadingNo: context.declaration?.billOfLadingNo || order.blNo || "",
    documentCompleteness: cachedTaxRefundCompletenessForDeclaration(order, context.declaration),
    taxRefundCompletenessUpdatedAt: context.declaration?.taxRefundCompletenessUpdatedAt || order.taxRefundCompletenessUpdatedAt || null,
    domesticLogisticsInfo: domesticLogisticsInfo ? serializeOrder({ id: order.id, domesticLogisticsInfos: [domesticLogisticsInfo] }).domesticLogisticsInfo : null,
    costs,
    documents,
  };
}

export type TaxRefundDetailSection =
  | "basic"
  | "export-documents"
  | "customs-documents"
  | "factory-documents"
  | "logistics-documents";

export async function getTaxRefundOrderDetailSection(orderId: string, actor: ActorLike, section: TaxRefundDetailSection) {
  assertRead(actor, "taxRefund");
  scheduleRepairTaxRelationsOnStartup();
  if (section === "basic") return getTaxRefundBasicSection(orderId, actor);
  if (section === "export-documents") return getTaxRefundDocumentSection(orderId, actor, TAX_EXPORT_DOCUMENT_TYPES);
  if (section === "customs-documents") return getTaxRefundCustomsDocumentsSection(orderId, actor);
  if (section === "factory-documents") return getTaxRefundCostDocumentSection(orderId, actor, "factory");
  if (section === "logistics-documents") return getTaxRefundLogisticsDocumentsSection(orderId, actor);
  throw codedError("未知退税资料详情分段", 400, "INVALID_TAX_REFUND_DETAIL_SECTION");
}

export async function refreshTaxRefundCompletenessNow(request: AuditRequestLike, actor: ActorLike, orderId: string) {
  if (!canWrite(actor, "taxRefund")) throw permissionError("没有权限重新计算退税完整度", 403);
  const context = await resolveTaxRefundRecordContext(orderId, actor);
  const order = await prisma.receivableOrder.findFirst({
    where: { id: context.orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);

  const orderWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(order);
  const beforeCompleteness = order.taxRefundCompleteness || null;
  const scopedOrder = scopeTaxRefundOrderForDeclaration(orderWithLogistics as unknown as Record<string, unknown>, context.declaration);
  const completeness = context.declaration
    ? taxDocumentCompleteness(scopedOrder)
    : await refreshTaxRefundCompletenessForOrder(orderWithLogistics);
  const status = taxRefundStatusFromCompleteness(context.declaration?.taxRefundStatus || order.taxRefundStatus, completeness);
  if (context.declaration && completeness) {
    await prisma.customsDeclaration.update({
      where: { id: context.declaration.id },
      data: {
        taxRefundCompleteness: completeness as Prisma.InputJsonValue,
        taxRefundCompletenessUpdatedAt: new Date(),
        taxRefundOverallCompleteness: taxRefundOverallCompletenessPercent({ taxRefundCompleteness: completeness }),
        taxRefundCompletenessIssuesSummary: taxRefundCompletenessSummaryText(completeness),
        taxRefundStatus: status,
      },
    });
  }
  const decoratedOrder = decorateTaxRefundOrderWithDeclaration(scopedOrder, context.declaration);
  const serialized = serializeTaxRefundOrderForActor({
    ...scopedOrder,
    ...decoratedOrder,
    taxRefundCompleteness: completeness || order.taxRefundCompleteness,
    taxRefundCompletenessUpdatedAt: completeness ? new Date() : order.taxRefundCompletenessUpdatedAt,
    taxRefundStatus: status,
  }, actor);

  await runNonCriticalTask("退税完整度手动重算日志写入", () => writeAudit(
    request,
    actor,
    "手动重算退税完整度",
    "receivable_orders",
    context.declaration?.id || order.id,
    { orderNo: order.orderNo, taxRefundCompleteness: beforeCompleteness },
    { orderNo: order.orderNo, customsDeclarationId: context.declaration?.id || "", taxRefundCompleteness: completeness, taxRefundStatus: status },
  ), { context: { orderId: order.id, customsDeclarationId: context.declaration?.id || "" } });

  return serialized;
}

export async function updateTaxRefundStatus(request: AuditRequestLike, actor: ActorLike, orderId: string, status: string, input: TaxRefundActionInput = {}) {
  if (!canWrite(actor, "taxRefund")) throw permissionError("没有权限修改退税状态", 403);
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  if (!TAX_REFUND_STATUSES.includes(status)) throw permissionError("请选择有效退税状态", 400);
  const context = await resolveTaxRefundRecordContext(orderId, actor);
  const before = await prisma.receivableOrder.findFirst({
    where: { id: context.orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!before) throw permissionError("应收订单不存在或已删除", 404);
  const beforeWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(before);
  const scopedBefore = scopeTaxRefundOrderForDeclaration(beforeWithLogistics as unknown as Record<string, unknown>, context.declaration);
  const beforeArchived = context.declaration
    ? Boolean(context.declaration.taxArchived || context.declaration.taxRefundStatus === "SUBMITTED" || context.declaration.taxRefundArchivedAt)
    : Boolean(before.taxArchived || before.taxRefundStatus === "SUBMITTED" || before.taxRefundArchivedAt);
  const beforeSubmitted = context.declaration
    ? Boolean(context.declaration.taxSubmittedAt || context.declaration.taxRefundStatus === "SUBMITTED" || context.declaration.taxArchived || context.declaration.taxRefundArchivedAt)
    : Boolean(before.taxSubmittedAt || before.taxRefundStatus === "SUBMITTED" || before.taxArchived || before.taxRefundArchivedAt);
  if (beforeArchived && !["SUBMITTED", "REFUND_RECEIVED"].includes(status) && input.cancelArchive !== true) {
    throw permissionError("已提交退税档案只允许查看和下载资料。", 400);
  }
  const completeness = taxDocumentCompleteness(scopedBefore);
  if (status === "REFUND_RECEIVED" && !beforeSubmitted) {
    throw codedError("请先提交退税并归档，再登记已收到退税款。", 400, "TAX_REFUND_SUBMISSION_REQUIRED");
  }
  if (status === "SUBMITTED" && (context.declaration?.taxRefundStatus || before.taxRefundStatus) === "SUBMITTED" && beforeArchived) {
    throw codedError("该订单已提交退税并归档，不能重复提交。", 400, "TAX_REFUND_ALREADY_SUBMITTED");
  }
  if (["READY", "SUBMITTED"].includes(status) && !completeness.complete) {
    const error = codedError("资料尚未完整，无法提交退税。", 400, "TAX_REFUND_COMPLETENESS_REQUIRED");
    error.details = {
      completed: Number(completeness.completed || 0),
      total: Number(completeness.total || 0),
      percent: Number(completeness.total || 0) > 0
        ? Math.round((Number(completeness.completed || 0) / Number(completeness.total || 0)) * 100)
        : 0,
      missingLabels: completeness.missingLabels || [],
      text: completeness.text || "",
    };
    throw error;
  }
  const archiveRemark = optional(input.archiveRemark || input.remark);
  const now = new Date();
  let updatedDeclaration: TaxRefundRecordDeclaration | null = context.declaration;
  let order = before;
  if (context.declaration) {
    updatedDeclaration = await prisma.customsDeclaration.update({
      where: { id: context.declaration.id },
      data: {
        taxRefundStatus: status,
        taxRefundCompleteness: completeness as Prisma.InputJsonValue,
        taxRefundCompletenessUpdatedAt: now,
        taxRefundOverallCompleteness: taxRefundOverallCompletenessPercent({ taxRefundCompleteness: completeness }),
        taxRefundCompletenessIssuesSummary: taxRefundCompletenessSummaryText(completeness),
        ...(status === "SUBMITTED" ? {
          taxArchived: true,
          taxRefundArchivedById: actorId,
          taxRefundArchivedAt: now,
          taxRefundArchiveRemark: archiveRemark,
          taxSubmittedById: actorId,
          taxSubmittedAt: now,
        } : {}),
        ...(status === "REFUND_RECEIVED" ? {
          taxArchived: true,
        } : {}),
      },
      select: taxRefundRecordDeclarationSelect,
    });
  } else {
    order = await prisma.receivableOrder.update({
      where: { id: context.orderId },
      data: {
        taxRefundStatus: status,
        updatedById: actorId,
        ...(status === "SUBMITTED" ? {
          taxArchived: true,
          taxRefundArchivedById: actorId,
          taxRefundArchivedAt: now,
          taxRefundArchiveRemark: archiveRemark,
          taxSubmittedById: actorId,
          taxSubmittedAt: now,
        } : {}),
        ...(status === "REFUND_RECEIVED" ? {
          taxArchived: true,
        } : {}),
      },
      include: includeOrderRelations(),
    });
  }
  if (context.declaration) {
    const syncedOrder = await syncOrderTaxArchiveFromDeclarations(context.orderId, actorId, now);
    if (syncedOrder) order = syncedOrder;
  }
  await writeAudit(
    request,
    actor,
    status === "SUBMITTED" ? "提交退税并归档" : "修改退税状态",
    context.declaration ? "customs_declarations" : "receivable_orders",
    context.declaration?.id || order.id,
    {
      orderNo: before.orderNo,
      customsDeclarationId: context.declaration?.id || "",
      declarationNo: context.declaration?.declarationNo || "",
      taxRefundStatus: before.taxRefundStatus,
      taxArchived: beforeArchived,
    },
    {
      orderNo: order.orderNo,
      customsDeclarationId: updatedDeclaration?.id || "",
      declarationNo: updatedDeclaration?.declarationNo || "",
      taxRefundStatus: context.declaration ? updatedDeclaration?.taxRefundStatus : order.taxRefundStatus,
      taxArchived: context.declaration ? Boolean(updatedDeclaration?.taxArchived) : Boolean(order.taxArchived),
    },
  ).catch(() => null);
  const orderWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(order);
  return serializeTaxRefundOrderForActor(decorateTaxRefundOrderWithDeclaration(
    scopeTaxRefundOrderForDeclaration(orderWithLogistics as unknown as Record<string, unknown>, updatedDeclaration),
    updatedDeclaration,
  ), actor);
}

export async function cancelTaxRefundArchive(request: AuditRequestLike, actor: ActorLike, orderId: string, nextStatus = "NOT_READY", input: TaxRefundActionInput = {}) {
  if (actor?.role !== "管理员") throw permissionError("只有管理员可以取消归档。", 403);
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const restoredStatus = TAX_REFUND_STATUSES.includes(nextStatus) && nextStatus !== "SUBMITTED" ? nextStatus : "NOT_READY";
  const context = await resolveTaxRefundRecordContext(orderId, actor);
  const before = await prisma.receivableOrder.findFirst({
    where: { id: context.orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!before) throw permissionError("应收订单不存在或已删除", 404);
  const beforeWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(before);
  const completeness = taxDocumentCompleteness(scopeTaxRefundOrderForDeclaration(beforeWithLogistics as unknown as Record<string, unknown>, context.declaration));
  const finalStatus = restoredStatus === "READY" && !completeness.complete ? "NOT_READY" : restoredStatus;
  let updatedDeclaration: TaxRefundRecordDeclaration | null = context.declaration;
  let order = before;
  if (context.declaration) {
    updatedDeclaration = await prisma.customsDeclaration.update({
      where: { id: context.declaration.id },
      data: {
        taxArchived: false,
        taxRefundArchivedById: null,
        taxRefundArchivedAt: null,
        taxRefundArchiveRemark: optional(input.remark),
        taxSubmittedById: null,
        taxSubmittedAt: null,
        taxRefundStatus: finalStatus,
      },
      select: taxRefundRecordDeclarationSelect,
    });
  } else {
    order = await prisma.receivableOrder.update({
      where: { id: context.orderId },
      data: {
        taxArchived: false,
        taxRefundArchivedById: null,
        taxRefundArchivedAt: null,
        taxRefundArchiveRemark: optional(input.remark),
        taxSubmittedById: null,
        taxSubmittedAt: null,
        taxRefundStatus: finalStatus,
        updatedById: actorId,
      },
      include: includeOrderRelations(),
    });
  }
  if (context.declaration) {
    const syncedOrder = await syncOrderTaxArchiveFromDeclarations(context.orderId, actorId);
    if (syncedOrder) order = syncedOrder;
  }
  await writeAudit(
    request,
    actor,
    "取消归档",
    context.declaration ? "customs_declarations" : "receivable_orders",
    context.declaration?.id || order.id,
    {
      orderNo: before.orderNo,
      customsDeclarationId: context.declaration?.id || "",
      declarationNo: context.declaration?.declarationNo || "",
      taxRefundStatus: context.declaration?.taxRefundStatus || before.taxRefundStatus,
      taxArchived: context.declaration
        ? Boolean(context.declaration.taxArchived || context.declaration.taxRefundArchivedAt)
        : Boolean(before.taxArchived || before.taxRefundArchivedAt),
    },
    {
      orderNo: order.orderNo,
      customsDeclarationId: updatedDeclaration?.id || "",
      declarationNo: updatedDeclaration?.declarationNo || "",
      taxRefundStatus: context.declaration ? updatedDeclaration?.taxRefundStatus : order.taxRefundStatus,
      taxArchived: false,
      remark: optional(input.remark),
    },
  ).catch(() => null);
  const orderWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(order);
  return serializeTaxRefundOrderForActor(decorateTaxRefundOrderWithDeclaration(
    scopeTaxRefundOrderForDeclaration(orderWithLogistics as unknown as Record<string, unknown>, updatedDeclaration),
    updatedDeclaration,
  ), actor);
}

export async function settleCommission(request: AuditRequestLike, actor: ActorLike, orderId: string, input: TaxRefundActionInput = {}) {
  if (!canWrite(actor, "commissions")) {
    throw codedError("没有权限结算业务员提成。", 403, "PERMISSION_DENIED");
  }
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!before) throw codedError("应收订单不存在或已删除。", 404, "ORDER_NOT_FOUND");
  if (["已结算", "SETTLED"].includes(before.commissionStatus)) {
    throw codedError("该订单业务员提成已结算，不能重复结算。", 400, "COMMISSION_ALREADY_SETTLED");
  }
  const commissionFormulaSettings = await getCommissionFormulaSettings();
  const summary = summarizeOrder(before, commissionFormulaSettings);
  if (summary.commissionRate <= 0) {
    throw codedError("提成比例未设置，不能结算业务员提成。", 400, "COMMISSION_RATE_NOT_SET");
  }
  if (!summary.realSalespersonSet) {
    throw codedError("未分配真实业务员，不能结算业务员提成。", 400, "SALESPERSON_NOT_SET");
  }
  if (summary.arrivedOutstandingCny > 0 || !["已收齐", "多收款"].includes(before.status)) {
    throw codedError("当前订单货款尚未全部到账，不能结算业务员提成。", 400, "ORDER_NOT_FULLY_PAID");
  }
  if (!summary.taxLogisticsCostsComplete) {
    const missingText = (Array.isArray(summary.taxLogisticsMissingLabels) ? summary.taxLogisticsMissingLabels : []).join("、") || "物流费用";
    throw codedError(`退税资料中的物流费用未完整，缺少：${missingText}。不能结算业务员提成。`, 400, "TAX_LOGISTICS_COSTS_INCOMPLETE");
  }
  if (!summary.allCostsConfirmed) {
    throw codedError("当前订单成本尚未全部确认完成，不能结算业务员提成。", 400, "COST_NOT_CONFIRMED");
  }
  if (!summary.logisticsCostConfirmed) {
    throw codedError("当前订单物流成本尚未确认完成，不能结算业务员提成。", 400, "LOGISTICS_COST_NOT_CONFIRMED");
  }
  const paidAmountCny = roundMoney(summary.arrivedPaymentsCny);
  const logisticsCostCny = roundMoney(summary.confirmedLogisticsCostCny);
  const commissionBaseCny = roundMoney(summary.settleableCommissionBaseCny);
  const commissionAmountCny = roundMoney((commissionBaseCny * summary.commissionRate) / 100);
  if (commissionAmountCny <= 0) {
    throw codedError("提成金额为 0，不能结算，请检查提成比例和成本数据。", 400, "COMMISSION_AMOUNT_ZERO");
  }
  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      await tx.commissionSettlement.create({
        data: {
          orderId,
          salespersonUserId: before.salespersonUserId,
          commissionRate: summary.commissionRate,
          paidAmountCny,
          logisticsCostCny,
          commissionBaseCny,
          commissionAmountCny,
          settledById: actorId,
          remark: optional(input.remark),
        },
      });
      return tx.receivableOrder.update({
        where: { id: orderId },
        data: {
          commissionStatus: "SETTLED",
          commissionSettledById: actorId,
          commissionSettledAt: new Date(),
          commissionSettlementRemark: optional(input.remark),
          updatedById: actorId,
        },
        include: includeOrderRelations(),
      });
    });
  } catch {
    throw codedError("数据库写入失败，业务员提成未结算。", 500, "DATABASE_ERROR");
  }
  await writeAudit(request, actor, "结算业务员提成", "receivable_orders", order.id, before, order).catch(() => null);
  return serializeOrder(order);
}

function taxPackageName(order: TaxRefundPackageOrder, declaration: TaxRefundRecordDeclaration | null = null) {
  const declarationSuffix = declaration?.declarationNo ? `_${safeFileName(declaration.declarationNo)}` : "";
  const billOfLadingNo = declaration?.billOfLadingNo || order.blNo || "待发货";
  return `退税资料_${safeFileName(order.orderNo || "订单")}_${safeFileName(billOfLadingNo)}${declarationSuffix}_${safeFileName(order.customerNameSnapshot || order.customer?.name || "客户")}.zip`;
}

function supplierArchiveFileName(document: TaxRefundPackageDocument, _index: number, _total: number, order: StandardFilenameOrder = {}) {
  const supplierName = document.supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.supplier?.supplierName || "未命名供应商";
  const isLogisticsInvoice = isTaxRefundLogisticsInvoiceDocument(document);
  const folder = isLogisticsInvoice ? "物流资料" : "供应商资料";
  return `${folder}/${safeFileName(supplierName)}/${standardFilenameForDocument(document, order)}`;
}

function isTaxRefundLogisticsInvoiceDocument(document: TaxRefundPackageDocument) {
  return Boolean(
    document?.relatedModule === "SUPPLIER"
    && document?.documentType
    && !SUPPLIER_DOCUMENT_TYPES.includes(document.documentType)
    && /_INVOICE$/.test(document.documentType)
  );
}

function isTaxRefundSupplierDocument(document: TaxRefundPackageDocument) {
  return document?.relatedModule === "SUPPLIER";
}

function packageDocumentMatchesDeclaration(
  document: TaxRefundPackageDocument,
  declaration: TaxRefundRecordDeclaration | null,
  order: Record<string, unknown>,
) {
  if (!declaration) return true;
  const linkedFileIds = taxRefundDeclarationLinkedFileIds(declaration);
  if (linkedFileIds.size && linkedFileIds.has(document.id)) return true;
  if (linkedFileIds.size && [
    "CUSTOMS_ENTRY_FORM",
    "RELEASE_NOTICE",
    "CUSTOMS_POWER_OF_ATTORNEY",
    "COMMERCIAL_INVOICE",
    "PACKING_LIST",
    "SALES_CONTRACT",
    ...SUPPLIER_DOCUMENT_TYPES,
  ].includes(document.documentType)) return false;
  if (document.documentType === "CUSTOMS_ENTRY_FORM") return Boolean(declaration.pdfDocumentId && document.id === declaration.pdfDocumentId);
  if (isTaxRefundBatchOwnedDocumentType(document.documentType) && taxRefundDeclarationHasScopedOwnership(declaration, order)) return false;
  if (!SUPPLIER_DOCUMENT_TYPES.includes(document.documentType)) return true;
  const purchaseOrderIds = taxRefundDeclarationPurchaseOrderIds(declaration);
  const supplierIds = taxRefundDeclarationSupplierIds(declaration);
  if (purchaseOrderIds.has(String(document.costId || ""))) return true;
  const fallbackSupplierIds = taxRefundUniqueSupplierFallbackIds(order, declaration, supplierIds);
  if (fallbackSupplierIds.size) {
    return fallbackSupplierIds.has(String(document.supplierId || ""))
      || fallbackSupplierIds.has(String(document.cost?.supplierId || ""));
  }
  return false;
}

export async function buildTaxRefundPackage(request: AuditRequestLike, actor: ActorLike, orderId: string, documentType = "") {
  assertRead(actor, "taxRefund");
  const context = await resolveTaxRefundRecordContext(orderId, actor);
  const order = await prisma.receivableOrder.findFirst({
    where: { id: context.orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: {
      customer: true,
      businessEntity: true,
      documents: {
        where: { deletedAt: null, uploadStatus: "SUCCESS" },
        include: { uploadedBy: true, cost: { include: { supplier: true } }, supplier: true },
      },
      customsDeclarations: {
        where: { deletedAt: null },
        select: {
          id: true,
          supplierId: true,
          purchaseOrderId: true,
          suppliers: {
            where: { deletedAt: null },
            select: { supplierId: true, purchaseOrderId: true },
            take: 200,
          },
        },
        take: 100,
      },
    },
  });
  if (!order) throw permissionError("应收订单不存在或已删除", 404);
  const selectedTypes: OrderDocumentType[] = ORDER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)
    ? [documentType as OrderDocumentType]
    : ORDER_DOCUMENT_TYPES;
  const documents = order.documents
    .filter((document) => (
      selectedTypes.includes(document.documentType)
      && packageDocumentMatchesDeclaration(document, context.declaration, order as unknown as Record<string, unknown>)
      && (!SUPPLIER_DOCUMENT_TYPES.includes(document.documentType) || isTaxRefundSupplierDocument(document))
      && canReadDocumentContent(actor, { ...document, order })
    ))
    .sort((a, b) => ORDER_DOCUMENT_TYPES.indexOf(a.documentType) - ORDER_DOCUMENT_TYPES.indexOf(b.documentType) || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  if (!documents.length) throw permissionError("没有可下载的 PDF 单证", 404);
  const zip = new JSZip();
  for (const type of selectedTypes) {
    const typeDocs = documents.filter((document) => document.documentType === type);
    if (SUPPLIER_DOCUMENT_TYPES.includes(type)) {
      const groups: (typeof typeDocs)[] = Object.values(typeDocs.reduce<Record<string, typeof typeDocs>>((acc, document) => {
        const supplierName = document.supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.supplier?.supplierName || "未命名供应商";
        acc[supplierName] ||= [];
        acc[supplierName].push(document);
        return acc;
      }, {}));
      for (const group of groups) {
        for (let index = 0; index < group.length; index += 1) {
          const document = group[index];
          zip.file(supplierArchiveFileName(document, index, group.length, order), await readR2Object(document.storageKey));
        }
      }
    } else {
      const folder = DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(type) ? "报关资料" : "出口资料";
      for (let index = 0; index < typeDocs.length; index += 1) {
        const document = typeDocs[index];
        zip.file(`${folder}/${standardFilenameForDocument(document, order)}`, await readR2Object(document.storageKey));
      }
    }
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await writeAudit(request, actor, documentType ? "下载单证分类ZIP" : "下载ZIP", context.declaration ? "customs_declarations" : "receivable_orders", context.declaration?.id || order.id, null, {
    orderNo: order.orderNo,
    customsDeclarationId: context.declaration?.id || "",
    declarationNo: context.declaration?.declarationNo || "",
    documentType: documentType || "ALL",
    fileCount: documents.length,
  }).catch(() => null);
  return { buffer, fileName: taxPackageName(order, context.declaration) };
}
