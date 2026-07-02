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
  getExchangeRateSettings,
  getCommissionFormulaSettings,
  guardedPrismaFindMany,
  includeOrderRelations,
  nonEmpty,
  num,
  optional,
  permissionError,
  refreshTaxRefundCompletenessForOrder,
  roundMoney,
  runNonCriticalTask,
  serializeOrder,
  serializeOrderDocument,
  serializeCustomsRecognition,
  standardFilenameForDocument,
  summarizeOrder,
  taxDocumentCompleteness,
  taxRefundStatusFromCompleteness,
  writeAudit,
} from "./shared";
import { canReadDocumentContent } from "./order-documents";
import { orderAccessWhere } from "./order-access";
import { businessEntityFieldsFromOrder, businessEntityWhereFromQuery } from "./business-entities";
import { canReadOcrRawResult, getOcrRawResultByDocumentId, serializeOcrRawResult as serializeStoredOcrRawResult } from "./ocr-raw-results";

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
  businessEntitySortDirection: "" | "asc" | "desc";
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
  documents: {
    where: { deletedAt: null },
    select: taxRefundDocumentLightSelect,
    orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    take: 50,
  },
});
type TaxRefundDocumentLight = Prisma.OrderDocumentGetPayload<{ select: typeof taxRefundDocumentLightSelect }>;
type TaxRefundCostLight = Prisma.OrderCostGetPayload<{ select: typeof taxRefundCostLightSelect }>;
type TaxRefundCustomsItemLight = {
  id: string;
  documentId: string | null;
  declarationNo: string;
  declarationDate: Date | null;
  exportDate: Date | null;
  hsCode: string;
  productName: string;
  quantity: Prisma.Decimal | number | null;
  unit: string | null;
  totalAmount?: Prisma.Decimal | number | null;
  tradeTerm: string | null;
  currency: string | null;
  fobAmount: Prisma.Decimal | number | null;
  exchangeRate: Prisma.Decimal | number | null;
  fobAmountCny: Prisma.Decimal | number | null;
  rawJson?: Prisma.JsonValue | null;
  confirmationStatus: string;
  source: string;
  sortOrder: number;
};
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
const TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES = ["报关费", "拖车费", "国内物流费", "国内拖车费", "港杂费", "海运费"];

function taxRefundDetailBillOfLadingNumbers(order: Pick<TaxRefundOrderWithRelations, "blNo"> & { logisticsBills?: Array<{ billOfLadingNo?: string | null }> }) {
  return [
    nonEmpty(order.blNo),
    ...(order.logisticsBills || []).map((bill) => nonEmpty(bill.billOfLadingNo)),
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);
}

function serializeTaxRefundOrderForActor(order: unknown, actor: ActorLike) {
  const serialized = serializeOrder(order);
  const role = String(actor?.role || "");
  if (role === "管理员" || role === "财务") return serialized;
  return {
    ...serialized,
    exportTaxRefundCalculations: [],
    exportTaxRefundSummary: {
      estimatedRefundAmount: null,
      calculationStatus: "",
      abnormalReasons: [],
    },
    expectedTaxRefundIncomeCny: null,
    estimatedTaxRefundIncome: null,
  };
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
  if (fallback) return fallback;
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

function rawJsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function serializeTaxRefundCustomsItem(item: TaxRefundCustomsItemLight, fallback: Record<string, unknown> = {}) {
  return {
    id: item.id,
    documentId: item.documentId || "",
    declarationNo: item.declarationNo || "",
    declarationDate: dateToInput(item.declarationDate),
    exportDate: dateToInput(item.exportDate),
    hsCode: item.hsCode || "",
    productName: item.productName || "",
    quantity: item.quantity == null ? null : Number(item.quantity),
    unit: item.unit || "",
    totalAmount: item.totalAmount == null ? null : Number(item.totalAmount),
    tradeTerm: item.tradeTerm || "",
    currency: item.currency || "",
    fobAmount: item.fobAmount == null ? null : Number(item.fobAmount),
    exchangeRate: item.exchangeRate == null ? null : Number(item.exchangeRate),
    fobAmountCny: item.fobAmountCny == null ? null : Number(item.fobAmountCny),
    confirmationStatus: item.confirmationStatus,
    source: item.source,
    sortOrder: item.sortOrder,
  };
}

function serializeCustomsOcrRawResult(task: {
  id?: string;
  status?: string | null;
  validationStatus?: string | null;
  errorMessage?: string | null;
  rawText?: string | null;
  resultJson?: Prisma.JsonValue | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
} | null, items: TaxRefundCustomsItemLight[] = []) {
  const rawItems = items
    .map((item) => rawJsonRecord(item.rawJson))
    .filter((item) => Object.keys(item).length > 0);
  if (!task && !rawItems.length) return null;
  return {
    taskId: task?.id || "",
    status: task?.status || "",
    validationStatus: task?.validationStatus || "",
    errorMessage: task?.errorMessage || "",
    createdAt: task?.createdAt || null,
    updatedAt: task?.updatedAt || null,
    resultJson: task?.resultJson || (rawItems.length ? { customsDeclarationItems: rawItems } : null),
    rawText: task?.rawText || "",
  };
}

function rawResultForDocument(
  rawResults: Array<Prisma.OcrRawResultGetPayload<{}>> = [],
  documentId = "",
) {
  if (!documentId) return null;
  return rawResults.find((row) => row.documentId === documentId) || null;
}

function serializeCustomsRecognitionDocument(
  document: TaxRefundDocumentLight | null,
  order: Record<string, unknown>,
  rawResult: Prisma.OcrRawResultGetPayload<{}> | null = null,
  isCurrent = false,
  canReadRaw = false,
) {
  if (!document) return null;
  const serialized = serializeTaxRefundLightDocument(document, order);
  const raw = canReadRaw ? serializeStoredOcrRawResult(rawResult) : null;
  return {
    ...serialized,
    isCurrent,
    ocrRawResultId: rawResult?.id || "",
    ocrStatus: rawResult?.status || "",
    ocrApiName: rawResult?.apiName || "",
    ocrRecognizedAt: rawResult?.createdAt || null,
    hasRawJson: Boolean(rawResult?.rawJson),
    hasParsedJson: Boolean(rawResult?.parsedJson),
    ocrErrorMessage: rawResult?.errorMessage || "",
    ocrRawResult: raw,
  };
}

function serializeTaxRefundLightCost(cost: TaxRefundCostLight, order: Record<string, unknown> = {}) {
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
    documents: (cost.documents || []).map((document) => serializeTaxRefundLightDocument(document, {
      ...order,
      id: cost.orderId,
      orderNo: String(order.orderNo || ""),
      blNo: String(order.blNo || ""),
      documents: cost.documents || [],
    })),
  };
}

function serializeTaxRefundCalculationRow(row: Record<string, unknown> = {}) {
  const invoiceMatchJson = row.invoiceMatchJson && typeof row.invoiceMatchJson === "object" && !Array.isArray(row.invoiceMatchJson)
    ? row.invoiceMatchJson as Record<string, unknown>
    : {};
  return {
    id: String(row.id || ""),
    declarationItemId: String(row.declarationItemId || ""),
    declarationNo: String(row.declarationNo || ""),
    hsCode: String(row.hsCode || ""),
    productName: String(row.productName || ""),
    declarationDate: row.declarationDate || null,
    fobCurrency: String(row.fobCurrency || ""),
    fobAmount: row.fobAmount == null ? null : Number(row.fobAmount),
    exchangeRate: row.exchangeRate == null ? null : Number(row.exchangeRate),
    declarationAmountCny: row.declarationAmountCny == null ? null : Number(row.declarationAmountCny),
    customsRmbAmount: row.declarationAmountCny == null ? null : Number(row.declarationAmountCny),
    rebateRate: row.rebateRate == null ? null : Number(row.rebateRate),
    vatRate: row.vatRate == null ? null : Number(row.vatRate),
    theoreticalRefundAmount: row.theoreticalRefundAmount == null ? null : Number(row.theoreticalRefundAmount),
    supplierInvoiceAmountWithoutTax: row.supplierInvoiceAmountWithoutTax == null ? null : Number(row.supplierInvoiceAmountWithoutTax),
    availableInputVatAmount: row.availableInputVatAmount == null ? null : Number(row.availableInputVatAmount),
    inputVatAmount: row.availableInputVatAmount == null ? null : Number(row.availableInputVatAmount),
    estimatedRefundAmount: row.estimatedRefundAmount == null ? null : Number(row.estimatedRefundAmount),
    invoiceMatchStatus: String(row.invoiceMatchStatus || ""),
    calculationStatus: String(row.calculationStatus || ""),
    abnormalReasons: Array.isArray(row.abnormalReasons) ? row.abnormalReasons : [],
    invoiceMatch: invoiceMatchJson,
  };
}

function exportTaxRefundSummaryFromRows(rows: ReturnType<typeof serializeTaxRefundCalculationRow>[]) {
  return {
    estimatedRefundAmount: rows.reduce((sum, row) => sum + Number(row.estimatedRefundAmount || 0), 0),
    calculationStatus: rows.some((row) => row.calculationStatus === "资料异常") ? "资料异常" : rows.length ? "退税金额已计算" : "",
    abnormalReasons: rows
      .flatMap((row) => row.abnormalReasons.map((reason) => String(reason || "")))
      .filter((reason, index, arr) => reason && arr.indexOf(reason) === index),
  };
}

function taxRefundCompletenessPercent(order: TaxRefundCompletenessOrder = {}) {
  const completeness = cachedTaxRefundCompleteness(order);
  const total = Number(completeness.total || 0);
  if (total <= 0) return 0;
  return Math.round((Number(completeness.completed || 0) / total) * 100);
}

function taxRefundStatusSortRank(status: string = "") {
  return ({
    NO_CUSTOMS: 1,
    CUSTOMS_RECOGNIZED_PENDING_CONFIRM: 2,
    REBATE_RATE_MATCHED: 3,
    SUPPLIER_INVOICE_MATCHED: 4,
    REFUND_CALCULATED: 5,
    NOT_READY: 6,
    PROBLEM: 7,
    READY: 8,
    SUBMITTED: 9,
    REFUND_RECEIVED: 10,
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
  const businessEntitySortDirection = nonEmpty(query.get("businessEntitySortDirection")) === "desc" ? "desc" : nonEmpty(query.get("businessEntitySortDirection")) === "asc" ? "asc" : "";
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
    businessEntitySortDirection,
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

type TaxRefundListResult = {
  orders: TaxRefundLightListOrderDto[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  query: string;
  mode: TaxRefundListMode;
};

export async function listTaxRefundOrders(query: QueryLike, actor: ActorLike): Promise<TaxRefundListResult> {
  assertRead(actor, "taxRefund");
  const filters = taxRefundListFiltersFromQuery(query);
  const where = taxRefundListWhere(filters, actor);
  const skip = (filters.page - 1) * filters.pageSize;
  const orderBy: Prisma.ReceivableOrderOrderByWithRelationInput[] = filters.businessEntitySortDirection
    ? [
      { businessEntity: { name: filters.businessEntitySortDirection } },
      { taxRefundOverallCompleteness: "asc" },
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ]
    : [
      { taxRefundOverallCompleteness: "asc" },
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ];
  const [total, rows] = await Promise.all([
    prisma.receivableOrder.count({ where }),
    guardedPrismaFindMany<Prisma.ReceivableOrderGetPayload<{ select: typeof taxRefundLightListSelect }>[]>(prisma.receivableOrder, "receivableOrder", "lib/platform/tax-refunds.ts:listTaxRefundOrders.rows", {
      where,
      select: taxRefundLightListSelect,
      orderBy,
      skip,
      take: filters.pageSize,
    }),
  ]);
  return {
    orders: rows.map(serializeTaxRefundListOrderLight),
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

export async function getTaxRefundOrderDetail(orderId: string, actor: ActorLike) {
  assertRead(actor, "taxRefund");
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  const orderWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(order);
  const completeness = await refreshTaxRefundCompletenessForOrder(orderWithLogistics);
  const status = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
  return serializeTaxRefundOrderForActor({
    ...orderWithLogistics,
    taxRefundCompleteness: completeness || order.taxRefundCompleteness,
    taxRefundCompletenessUpdatedAt: completeness ? new Date() : order.taxRefundCompletenessUpdatedAt,
    taxRefundStatus: status,
  }, actor);
}

async function getTaxRefundBaseOrder(orderId: string, actor: ActorLike) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      ...taxRefundLightListSelect,
      customsDeclarationNo: true,
      customsDeclarationDate: true,
      customsParseStatus: true,
      customsParseMessage: true,
      customsDeclarationParseSource: true,
      taxRefundArchivedBy: { select: { id: true, name: true } },
      taxSubmittedBy: { select: { id: true, name: true } },
    },
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  return order;
}

function serializeTaxRefundBasicOrder(order: Awaited<ReturnType<typeof getTaxRefundBaseOrder>>) {
  const light = serializeTaxRefundListOrderLight(order);
  return {
    ...light,
    taxRefundArchivedByName: order.taxRefundArchivedBy?.name || "",
    taxSubmittedByName: order.taxSubmittedBy?.name || order.taxRefundArchivedBy?.name || "",
    ...serializeCustomsRecognition(order),
    documentCompleteness: cachedTaxRefundCompleteness(order),
    taxRefundCompletenessUpdatedAt: order.taxRefundCompletenessUpdatedAt || null,
  };
}

async function getTaxRefundBasicSection(orderId: string, actor: ActorLike) {
  return serializeTaxRefundBasicOrder(await getTaxRefundBaseOrder(orderId, actor));
}

async function getTaxRefundCalculationSection(orderId: string, actor: ActorLike) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      currency: true,
      customsDeclarationNo: true,
      customsDeclarationDate: true,
      customerNameSnapshot: true,
      taxRefundStatus: true,
      taxRefundCompleteness: true,
      taxRefundOverallCompleteness: true,
      customer: { select: { name: true, shortName: true } },
      customsDeclarationItems: {
        where: { deletedAt: null },
        select: {
          id: true,
          documentId: true,
          declarationNo: true,
          declarationDate: true,
          exportDate: true,
          hsCode: true,
          productName: true,
          quantity: true,
          unit: true,
          totalAmount: true,
          tradeTerm: true,
          currency: true,
          fobAmount: true,
          exchangeRate: true,
          fobAmountCny: true,
          confirmationStatus: true,
          source: true,
          sortOrder: true,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 200,
      },
      exportTaxRefundCalculations: {
        where: { deletedAt: null },
        select: {
          id: true,
          declarationItemId: true,
          declarationNo: true,
          hsCode: true,
          productName: true,
          declarationDate: true,
          fobCurrency: true,
          fobAmount: true,
          exchangeRate: true,
          declarationAmountCny: true,
          rebateRate: true,
          vatRate: true,
          theoreticalRefundAmount: true,
          supplierInvoiceAmountWithoutTax: true,
          availableInputVatAmount: true,
          estimatedRefundAmount: true,
          invoiceMatchStatus: true,
          calculationStatus: true,
          abnormalReasons: true,
          invoiceMatchJson: true,
        },
        orderBy: [{ createdAt: "asc" }],
        take: 200,
      },
    },
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  const calculations = (order.exportTaxRefundCalculations || []).map((row) => serializeTaxRefundCalculationRow(row as Record<string, unknown>));
  const role = String(actor?.role || "");
  const canReadAmount = role === "管理员" || role === "财务";
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    currency: order.currency,
    customerName: customerShortName(order.customer) || customerFullName(order.customer, order.customerNameSnapshot),
    customsDeclarationNo: order.customsDeclarationNo || "",
    customsDeclarationDate: dateToInput(order.customsDeclarationDate),
    declarationDate: dateToInput(order.customsDeclarationDate),
    taxRefundStatus: taxRefundStatusFromCompleteness(order.taxRefundStatus, cachedTaxRefundCompleteness(order)),
    customsDeclarationItems: (order.customsDeclarationItems || []).map((item) => ({
      id: item.id,
      documentId: item.documentId || "",
      declarationNo: item.declarationNo || "",
      declarationDate: dateToInput(item.declarationDate),
      exportDate: dateToInput(item.exportDate),
      hsCode: item.hsCode || "",
      productName: item.productName || "",
      quantity: item.quantity == null ? null : Number(item.quantity),
      unit: item.unit || "",
      totalAmount: item.totalAmount == null ? null : Number(item.totalAmount),
      tradeTerm: item.tradeTerm || "",
      currency: item.currency || "",
      fobAmount: item.fobAmount == null ? null : Number(item.fobAmount),
      exchangeRate: item.exchangeRate == null ? null : Number(item.exchangeRate),
      fobAmountCny: item.fobAmountCny == null ? null : Number(item.fobAmountCny),
      confirmationStatus: item.confirmationStatus,
      source: item.source,
      sortOrder: item.sortOrder,
    })),
    exportTaxRefundCalculations: canReadAmount ? calculations : [],
    exportTaxRefundSummary: canReadAmount ? exportTaxRefundSummaryFromRows(calculations) : {
      estimatedRefundAmount: null,
      calculationStatus: "",
      abnormalReasons: [],
    },
  };
}

async function getTaxRefundDocumentSection(orderId: string, actor: ActorLike, documentTypes: string[]) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      customerNameSnapshot: true,
      customer: { select: { name: true, shortName: true } },
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
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerName: customerShortName(order.customer) || customerFullName(order.customer, order.customerNameSnapshot),
    documents: (order.documents || []).map((document) => serializeTaxRefundLightDocument(document, order as Record<string, unknown>)),
  };
}

async function getTaxRefundCustomsDocumentsSection(orderId: string, actor: ActorLike) {
  const canReadRaw = canReadOcrRawResult(actor);
  const [basic, documents, customsItems, customsDocuments] = await Promise.all([
    getTaxRefundBasicSection(orderId, actor),
    getTaxRefundDocumentSection(orderId, actor, DOMESTIC_LOGISTICS_DOCUMENT_TYPES),
    guardedPrismaFindMany<TaxRefundCustomsItemLight[]>(prisma.exportCustomsDeclarationItem, "exportCustomsDeclarationItem", "lib/platform/tax-refunds.ts:getTaxRefundCustomsDocumentsSection.customsItems", {
      where: { orderId, deletedAt: null },
      select: {
        id: true,
        documentId: true,
        declarationNo: true,
        declarationDate: true,
        exportDate: true,
        hsCode: true,
        productName: true,
        quantity: true,
        unit: true,
        totalAmount: true,
        tradeTerm: true,
        currency: true,
        fobAmount: true,
        exchangeRate: true,
        fobAmountCny: true,
        rawJson: true,
        confirmationStatus: true,
        source: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: 200,
    }),
    guardedPrismaFindMany<TaxRefundDocumentLight[]>(prisma.orderDocument, "orderDocument", "lib/platform/tax-refunds.ts:getTaxRefundCustomsDocumentsSection.customsDocuments", {
      where: { orderId, deletedAt: null, documentType: "CUSTOMS_ENTRY_FORM", uploadStatus: "SUCCESS" },
      select: taxRefundDocumentLightSelect,
      orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }],
      take: 20,
    }),
  ]);
  const serializedItems = (customsItems || []).map((item) => serializeTaxRefundCustomsItem(item, basic));
  const currentCustomsDocument = customsDocuments[0] || null;
  const customsDocumentIds = customsDocuments.map((document) => document.id).filter(Boolean);
  const [currentRawResult, ocrRawRows] = canReadRaw
    ? await Promise.all([
      currentCustomsDocument?.id ? getOcrRawResultByDocumentId(currentCustomsDocument.id) : Promise.resolve(null),
      customsDocumentIds.length
        ? guardedPrismaFindMany<Prisma.OcrRawResultGetPayload<{}>[]>(prisma.ocrRawResult, "ocrRawResult", "lib/platform/tax-refunds.ts:getTaxRefundCustomsDocumentsSection.ocrRawResults", {
          where: { documentId: { in: customsDocumentIds }, documentType: { in: ["CUSTOMS_ENTRY_FORM", "CUSTOMS_DECLARATION"] } },
          orderBy: [{ createdAt: "desc" }],
          take: 100,
        })
        : Promise.resolve([]),
    ])
    : [null, []];
  const ocrRawResults = [
    ...(currentRawResult ? [currentRawResult] : []),
    ...ocrRawRows.filter((row) => row.id !== currentRawResult?.id),
  ];
  const historicalCustomsDocuments = customsDocuments.slice(1);
  const currentItemRawFallback = (customsItems || []).filter((item) => item.documentId === currentCustomsDocument?.id);
  return {
    ...documents,
    ...basic,
    customsDeclarationNo: basic.customsDeclarationNo || "",
    customsDeclarationDate: basic.customsDeclarationDate || null,
    declarationDate: basic.declarationDate || null,
    customsParseStatusLabel: basic.customsParseStatusLabel || "",
    customsParseSourceLabel: basic.customsParseSourceLabel || "",
    customsParseMessage: basic.customsParseMessage || "",
    customsDeclarationItems: serializedItems,
    currentCustomsDocument: serializeCustomsRecognitionDocument(currentCustomsDocument, basic, currentRawResult, true, canReadRaw),
    historicalCustomsDocuments: historicalCustomsDocuments.map((document) => (
      serializeCustomsRecognitionDocument(document, basic, rawResultForDocument(ocrRawResults, document.id), false, canReadRaw)
    )).filter(Boolean),
    customsOcrCallLogs: canReadRaw
      ? ocrRawResults.map((row) => serializeStoredOcrRawResult(row)).filter(Boolean)
      : [],
    customsOcrRawResult: canReadRaw
      ? serializeStoredOcrRawResult(currentRawResult) || serializeCustomsOcrRawResult(null, currentItemRawFallback)
      : null,
  };
}

async function getTaxRefundCostDocumentSection(orderId: string, actor: ActorLike, type: "factory" | "logistics") {
  const costTypes = type === "factory" ? FACTORY_SUPPLIER_COST_TYPES : TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES;
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      taxRefundCompleteness: true,
      taxRefundCompletenessUpdatedAt: true,
      costs: {
        where: { deletedAt: null, costType: { in: costTypes } },
        select: taxRefundCostLightSelect,
        orderBy: [{ createdAt: "desc" }],
        take: 80,
      },
    },
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  const costs = (order.costs || []).map((cost) => serializeTaxRefundLightCost(cost, order as Record<string, unknown>));
  const documents = costs.flatMap((cost) => cost.documents || []);
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    documentCompleteness: cachedTaxRefundCompleteness(order),
    taxRefundCompletenessUpdatedAt: order.taxRefundCompletenessUpdatedAt || null,
    costs,
    documents,
  };
}

async function getTaxRefundLogisticsDocumentsSection(orderId: string, actor: ActorLike) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      taxRefundCompleteness: true,
      taxRefundCompletenessUpdatedAt: true,
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
  const costs = (order.costs || []).map((cost) => serializeTaxRefundLightCost(cost, order as Record<string, unknown>));
  const documents = costs.flatMap((cost) => cost.documents || []);
  const domesticLogisticsInfo = combineTaxRefundDomesticLogisticsInfos(order.domesticLogisticsInfos || [])[0] || null;
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    documentCompleteness: cachedTaxRefundCompleteness(order),
    taxRefundCompletenessUpdatedAt: order.taxRefundCompletenessUpdatedAt || null,
    domesticLogisticsInfo: domesticLogisticsInfo ? serializeOrder({ id: order.id, domesticLogisticsInfos: [domesticLogisticsInfo] }).domesticLogisticsInfo : null,
    costs,
    documents,
  };
}

export type TaxRefundDetailSection =
  | "basic"
  | "calculation"
  | "export-documents"
  | "customs-documents"
  | "factory-documents"
  | "logistics-documents";

export async function getTaxRefundOrderDetailSection(orderId: string, actor: ActorLike, section: TaxRefundDetailSection) {
  assertRead(actor, "taxRefund");
  if (section === "basic") return getTaxRefundBasicSection(orderId, actor);
  if (section === "calculation") return getTaxRefundCalculationSection(orderId, actor);
  if (section === "export-documents") return getTaxRefundDocumentSection(orderId, actor, TAX_EXPORT_DOCUMENT_TYPES);
  if (section === "customs-documents") return getTaxRefundCustomsDocumentsSection(orderId, actor);
  if (section === "factory-documents") return getTaxRefundCostDocumentSection(orderId, actor, "factory");
  if (section === "logistics-documents") return getTaxRefundLogisticsDocumentsSection(orderId, actor);
  throw codedError("未知退税资料详情分段", 400, "INVALID_TAX_REFUND_DETAIL_SECTION");
}

export async function refreshTaxRefundCompletenessNow(request: AuditRequestLike, actor: ActorLike, orderId: string) {
  if (!canWrite(actor, "taxRefund")) throw permissionError("没有权限重新计算退税完整度", 403);
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);

  const orderWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(order);
  const beforeCompleteness = order.taxRefundCompleteness || null;
  const completeness = await refreshTaxRefundCompletenessForOrder(orderWithLogistics);
  const status = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
  const serialized = serializeOrder({
    ...orderWithLogistics,
    taxRefundCompleteness: completeness || order.taxRefundCompleteness,
    taxRefundCompletenessUpdatedAt: completeness ? new Date() : order.taxRefundCompletenessUpdatedAt,
    taxRefundStatus: status,
  });

  await runNonCriticalTask("退税完整度手动重算日志写入", () => writeAudit(
    request,
    actor,
    "手动重算退税完整度",
    "receivable_orders",
    order.id,
    { orderNo: order.orderNo, taxRefundCompleteness: beforeCompleteness },
    { orderNo: order.orderNo, taxRefundCompleteness: completeness, taxRefundStatus: status },
  ), { context: { orderId: order.id } });

  return serialized;
}

export async function updateTaxRefundStatus(request: AuditRequestLike, actor: ActorLike, orderId: string, status: string, input: TaxRefundActionInput = {}) {
  if (!canWrite(actor, "taxRefund")) throw permissionError("没有权限修改退税状态", 403);
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  if (!TAX_REFUND_STATUSES.includes(status)) throw permissionError("请选择有效退税状态", 400);
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!before) throw permissionError("应收订单不存在或已删除", 404);
  const beforeWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(before);
  const beforeArchived = Boolean(before.taxArchived || before.taxRefundStatus === "SUBMITTED" || before.taxRefundArchivedAt);
  if (beforeArchived && status !== "SUBMITTED" && input.cancelArchive !== true) {
    throw permissionError("已提交退税档案只允许查看和下载资料。", 400);
  }
  const completeness = taxDocumentCompleteness(beforeWithLogistics);
  const calculationMissing = Array.isArray((completeness as Record<string, unknown>).calculation && ((completeness as Record<string, unknown>).calculation as Record<string, unknown>).missing)
    ? (((completeness as Record<string, unknown>).calculation as Record<string, unknown>).missing as unknown[])
    : [];
  if (status === "SUBMITTED" && calculationMissing.length) {
    const error = codedError("退税计算或供应商发票一致性校验存在异常，无法提交退税。", 400, "TAX_REFUND_CALCULATION_EXCEPTION");
    error.details = {
      missingLabels: calculationMissing.map((item) => String((item as Record<string, unknown>)?.label || item || "")).filter(Boolean),
    };
    throw error;
  }
  if (status === "SUBMITTED" && before.taxRefundStatus === "SUBMITTED" && beforeArchived) {
    throw codedError("该订单已提交退税并归档，不能重复提交。", 400, "TAX_REFUND_ALREADY_SUBMITTED");
  }
  const settings = await getExchangeRateSettings();
  const forceSubmit = status === "SUBMITTED"
    && actor?.role === "管理员"
    && settings.allowAdminIncompleteTaxSubmit === true
    && input.forceSubmit === true;
  if (["READY", "SUBMITTED"].includes(status) && !completeness.complete && !forceSubmit) {
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
  if (forceSubmit && !optional(input.forceReason)) {
    throw codedError("强制提交退税必须填写原因。", 400, "FORCE_SUBMIT_REASON_REQUIRED");
  }
  const archiveRemark = optional(input.archiveRemark || input.remark);
  const now = new Date();
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data: {
      taxRefundStatus: status,
      updatedById: actorId,
      ...(status === "SUBMITTED" ? {
        taxArchived: true,
        taxRefundArchivedById: actorId,
        taxRefundArchivedAt: now,
        taxRefundArchiveRemark: forceSubmit ? optional(input.forceReason) : archiveRemark,
        taxSubmittedById: actorId,
        taxSubmittedAt: now,
      } : {}),
    },
    include: includeOrderRelations(),
  });
  await writeAudit(
    request,
    actor,
    status === "SUBMITTED" ? "提交退税并归档" : "修改退税状态",
    "receivable_orders",
    order.id,
    {
      orderNo: before.orderNo,
      taxRefundStatus: before.taxRefundStatus,
      taxArchived: beforeArchived,
    },
    {
      orderNo: order.orderNo,
      taxRefundStatus: order.taxRefundStatus,
      taxArchived: Boolean(order.taxArchived),
      forceSubmit,
      forceReason: forceSubmit ? optional(input.forceReason) : undefined,
    },
  ).catch(() => null);
  return serializeOrder(await hydrateTaxRefundOrderLogisticsInfo(order));
}

export async function cancelTaxRefundArchive(request: AuditRequestLike, actor: ActorLike, orderId: string, nextStatus = "NOT_READY", input: TaxRefundActionInput = {}) {
  if (actor?.role !== "管理员") throw permissionError("只有管理员可以取消归档。", 403);
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const restoredStatus = TAX_REFUND_STATUSES.includes(nextStatus) && nextStatus !== "SUBMITTED" ? nextStatus : "NOT_READY";
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!before) throw permissionError("应收订单不存在或已删除", 404);
  const beforeWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(before);
  const completeness = taxDocumentCompleteness(beforeWithLogistics);
  const finalStatus = restoredStatus === "READY" && !completeness.complete ? "NOT_READY" : restoredStatus;
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
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
  await writeAudit(
    request,
    actor,
    "取消归档",
    "receivable_orders",
    order.id,
    {
      orderNo: before.orderNo,
      taxRefundStatus: before.taxRefundStatus,
      taxArchived: Boolean(before.taxArchived || before.taxRefundArchivedAt),
    },
    {
      orderNo: order.orderNo,
      taxRefundStatus: order.taxRefundStatus,
      taxArchived: false,
      remark: optional(input.remark),
    },
  ).catch(() => null);
  return serializeOrder(await hydrateTaxRefundOrderLogisticsInfo(order));
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

function taxPackageName(order: TaxRefundPackageOrder) {
  return `退税资料_${safeFileName(order.orderNo || "订单")}_${safeFileName(order.blNo || "待发货")}_${safeFileName(order.customerNameSnapshot || order.customer?.name || "客户")}.zip`;
}

function supplierArchiveFileName(document: TaxRefundPackageDocument, _index: number, _total: number, order: StandardFilenameOrder = {}) {
  const supplierName = document.supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.supplier?.supplierName || "未命名供应商";
  const isLogisticsInvoice = isTaxRefundLogisticsInvoiceDocument(document);
  const folder = isLogisticsInvoice ? "物流资料" : "供应商资料";
  return `${folder}/${safeFileName(supplierName)}/${standardFilenameForDocument(document, order)}`;
}

function isTaxRefundLogisticsInvoiceDocument(document: TaxRefundPackageDocument) {
  return document?.relatedModule === "SUPPLIER" && document?.documentType && /_INVOICE$/.test(document.documentType);
}

function isTaxRefundSupplierDocument(document: TaxRefundPackageDocument) {
  return document?.relatedModule === "SUPPLIER";
}

export async function buildTaxRefundPackage(request: AuditRequestLike, actor: ActorLike, orderId: string, documentType = "") {
  assertRead(actor, "taxRefund");
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: {
      customer: true,
      businessEntity: true,
      documents: {
        where: { deletedAt: null, uploadStatus: "SUCCESS" },
        include: { uploadedBy: true, cost: { include: { supplier: true } }, supplier: true },
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
  await writeAudit(request, actor, documentType ? "下载单证分类ZIP" : "下载ZIP", "receivable_orders", order.id, null, {
    orderNo: order.orderNo,
    documentType: documentType || "ALL",
    fileCount: documents.length,
  }).catch(() => null);
  return { buffer, fileName: taxPackageName(order) };
}
