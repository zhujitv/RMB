import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { includeOrderRelations } from "./shared-order-relations";
import {
  sanitizeTaxRefundCompletenessText,
  taxDocumentCompleteness,
  taxRefundStatusFromCompleteness,
} from "./shared-tax-completeness";
import { hasCostBusinessDocument } from "./business-documents";
import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  FACTORY_SUPPLIER_COST_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_EXPORT_DOCUMENT_TYPES,
  runNonCriticalTask,
} from "./shared-constants";
import { customsDeclarationSupplierCompletenessIssues } from "./customs-declaration-supplier-validation";
import {
  allocateLogisticsCostForCustomsDeclaration,
  logisticsCostMatchesCustomsDeclaration,
} from "./logistics-cost-allocation";

type TaxRefundCompletenessOrder = Prisma.ReceivableOrderGetPayload<{ include: ReturnType<typeof includeOrderRelations> }>;
type TaxRefundCompletenessResult = ReturnType<typeof taxDocumentCompleteness>;

const TAX_REFUND_COMPLETENESS_BATCH_CONCURRENCY = 3;
const pendingTaxRefundCompletenessRefreshes = new Map<string, Promise<TaxRefundCompletenessResult | null>>();
const pendingCustomsDeclarationCompletenessRefreshes = new Map<string, Promise<TaxRefundCompletenessResult | null>>();
const TAX_REFUND_BATCH_OWNED_DOCUMENT_TYPES = new Set([
  ...DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  "COMMERCIAL_INVOICE",
  "PACKING_LIST",
  "SALES_CONTRACT",
  ...SUPPLIER_DOCUMENT_TYPES,
]);

function isTaxRefundBatchOwnedDocumentType(documentType: unknown) {
  return TAX_REFUND_BATCH_OWNED_DOCUMENT_TYPES.has(String(documentType || ""));
}

function normalizedOrderId(orderId: string | null | undefined) {
  return String(orderId || "").trim();
}

async function loadTaxRefundCompletenessOrder(orderId: string) {
  return prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: includeOrderRelations(),
  });
}

function safeCompletenessJson(value: unknown) {
  try {
    return JSON.stringify(value || null);
  } catch {
    return "";
  }
}

function taxRefundOverallCompletenessValue(completeness: TaxRefundCompletenessResult | null | undefined) {
  const total = Number((completeness as Record<string, unknown> | null | undefined)?.total || 0);
  const completed = Number((completeness as Record<string, unknown> | null | undefined)?.completed || 0);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

function taxRefundCompletenessIssuesSummary(completeness: TaxRefundCompletenessResult | null | undefined) {
  const record = (completeness && typeof completeness === "object" && !Array.isArray(completeness))
    ? completeness as Record<string, unknown>
    : {};
  const labels = Array.isArray(record.missingLabels)
    ? record.missingLabels.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const sanitizedLabels = labels.map(sanitizeTaxRefundCompletenessText).filter(Boolean);
  if (sanitizedLabels.length) return sanitizedLabels.slice(0, 30).join(" / ");
  const text = sanitizeTaxRefundCompletenessText(record.text);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

async function computeAndPersistTaxRefundCompleteness(order: TaxRefundCompletenessOrder) {
  const completeness = JSON.parse(JSON.stringify(taxDocumentCompleteness(order))) as TaxRefundCompletenessResult;
  const status = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
  const completenessChanged = safeCompletenessJson(order.taxRefundCompleteness) !== safeCompletenessJson(completeness);
  const statusChanged = status !== order.taxRefundStatus;
  const overallCompleteness = taxRefundOverallCompletenessValue(completeness);
  const issuesSummary = taxRefundCompletenessIssuesSummary(completeness);
  if (
    !completenessChanged
    && !statusChanged
    && order.taxRefundCompletenessUpdatedAt
    && order.taxRefundOverallCompleteness === overallCompleteness
    && String(order.taxRefundCompletenessIssuesSummary || "") === issuesSummary
  ) {
    return completeness;
  }
  await prisma.receivableOrder.update({
    where: { id: order.id },
    data: {
      taxRefundCompleteness: completeness as Prisma.InputJsonValue,
      taxRefundCompletenessUpdatedAt: new Date(),
      taxRefundOverallCompleteness: overallCompleteness,
      taxRefundCompletenessIssuesSummary: issuesSummary,
      ...(statusChanged ? { taxRefundStatus: status } : {}),
    },
  });
  return completeness;
}

const customsDeclarationCompletenessInclude = Prisma.validator<Prisma.CustomsDeclarationInclude>()({
  order: { include: includeOrderRelations() },
  purchaseOrder: true,
  supplier: true,
  pdfDocument: {
    include: {
      uploadedBy: true,
      cost: { include: { supplier: true } },
      supplier: true,
      logisticsExpenseInvoices: {
        where: { deletedAt: null },
        include: { bill: true, cost: true, supplier: true },
      },
    },
  },
  documents: {
    where: { deletedAt: null },
    include: {
      file: {
        include: {
          uploadedBy: true,
          cost: { include: { supplier: true } },
          supplier: true,
          logisticsExpenseInvoices: {
            where: { deletedAt: null },
            include: { bill: true, cost: true, supplier: true },
          },
        },
      },
    },
    orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
  },
  suppliers: {
    where: { deletedAt: null },
    include: {
      supplier: true,
      purchaseOrder: { include: { supplier: true } },
      contractFile: {
        include: {
          uploadedBy: true,
          cost: { include: { supplier: true } },
          supplier: true,
          logisticsExpenseInvoices: {
            where: { deletedAt: null },
            include: { bill: true, cost: true, supplier: true },
          },
        },
      },
      vatInvoiceFile: {
        include: {
          uploadedBy: true,
          cost: { include: { supplier: true } },
          supplier: true,
          logisticsExpenseInvoices: {
            where: { deletedAt: null },
            include: { bill: true, cost: true, supplier: true },
          },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  },
});
type CustomsDeclarationCompletenessRow = Prisma.CustomsDeclarationGetPayload<{ include: typeof customsDeclarationCompletenessInclude }>;

function uniqueById<T extends { id?: string | null }>(rows: T[] = []) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const id = String(row?.id || "");
    if (!id) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function declarationSupplierIds(declaration: unknown) {
  const row = declaration && typeof declaration === "object" ? declaration as {
    supplierId?: string | null;
    suppliers?: Array<{ supplierId?: string | null }> | null;
  } : {};
  return new Set([
    row.supplierId || "",
    ...(row.suppliers || []).map((supplier) => supplier.supplierId || ""),
  ].filter(Boolean));
}

function uniqueSupplierFallbackIds(row: CustomsDeclarationCompletenessRow, supplierIds: Set<string>) {
  if (!supplierIds.size) return new Set<string>();
  const declarations = Array.isArray(row.order?.customsDeclarations)
    ? row.order.customsDeclarations.filter((declaration) => declaration?.id)
    : [];
  if (declarations.length <= 1) return new Set(supplierIds);
  const currentSupplierIds = declarationSupplierIds(row);
  const supplierDeclarationCount = new Map<string, number>();
  for (const declaration of declarations) {
    for (const supplierId of declarationSupplierIds(declaration)) {
      supplierDeclarationCount.set(supplierId, (supplierDeclarationCount.get(supplierId) || 0) + 1);
    }
  }
  return new Set([...supplierIds].filter((supplierId) => (
    currentSupplierIds.has(supplierId)
    && supplierDeclarationCount.get(supplierId) === 1
  )));
}

function orderHasMultipleCustomsDeclarations(row: CustomsDeclarationCompletenessRow) {
  const declarations = Array.isArray(row.order?.customsDeclarations)
    ? row.order.customsDeclarations.filter((declaration) => declaration?.id)
    : [];
  return declarations.length > 1;
}

function scopedDeclarationDocuments(row: CustomsDeclarationCompletenessRow) {
  const linkedDocuments = (row.documents || [])
    .map((item) => item.file)
    .filter((document): document is NonNullable<typeof document> => Boolean(document && !document.deletedAt && document.uploadStatus === "SUCCESS"));
  const supplierDocuments = (row.suppliers || [])
    .flatMap((supplier) => [supplier.contractFile, supplier.vatInvoiceFile])
    .filter((document): document is NonNullable<typeof document> => Boolean(document && !document.deletedAt && document.uploadStatus === "SUCCESS"));
  const explicitDocuments = uniqueById([
    ...(row.pdfDocument && !row.pdfDocument.deletedAt ? [row.pdfDocument] : []),
    ...linkedDocuments,
    ...supplierDocuments,
  ]);
  const explicitDocumentIds = new Set(explicitDocuments.map((document) => document.id));
  const declarationOwnsScopedDocuments = Boolean(
    row.pdfDocumentId
    || row.documents?.length
    || row.suppliers?.length
    || orderHasMultipleCustomsDeclarations(row)
  );
  const purchaseOrderIds = new Set([
    row.purchaseOrderId || "",
    ...(row.suppliers || []).map((supplier) => supplier.purchaseOrderId || ""),
  ].filter(Boolean));
  const supplierIds = new Set([
    row.supplierId || "",
    ...(row.suppliers || []).map((supplier) => supplier.supplierId || ""),
  ].filter(Boolean));
  const fallbackSupplierIds = uniqueSupplierFallbackIds(row, supplierIds);
  const fallbackDocuments = (row.order.documents || []).filter((document) => {
    if (!document || document.deletedAt || document.uploadStatus !== "SUCCESS") return false;
    if (explicitDocumentIds.has(document.id)) return false;
    if (document.documentType === "CUSTOMS_ENTRY_FORM") return Boolean(row.pdfDocumentId && document.id === row.pdfDocumentId);
    if (isTaxRefundBatchOwnedDocumentType(document.documentType) && declarationOwnsScopedDocuments) return false;
    if ([...DOMESTIC_LOGISTICS_DOCUMENT_TYPES, ...TAX_EXPORT_DOCUMENT_TYPES].includes(document.documentType)) return true;
    if (!SUPPLIER_DOCUMENT_TYPES.includes(document.documentType)) return false;
    if (document.costId && purchaseOrderIds.has(document.costId)) return true;
    if (document.supplierId && fallbackSupplierIds.has(document.supplierId)) return true;
    return false;
  });
  return uniqueById([...explicitDocuments, ...fallbackDocuments]);
}

function scopedDeclarationCosts(row: CustomsDeclarationCompletenessRow) {
  const purchaseOrderIds = new Set([
    row.purchaseOrderId || "",
    ...(row.suppliers || []).map((supplier) => supplier.purchaseOrderId || ""),
  ].filter(Boolean));
  const supplierIds = new Set([
    row.supplierId || "",
    ...(row.suppliers || []).map((supplier) => supplier.supplierId || ""),
  ].filter(Boolean));
  const fallbackSupplierIds = uniqueSupplierFallbackIds(row, supplierIds);
  return (row.order.costs || []).filter((cost) => {
    if (!cost || cost.deletedAt) return false;
    const isFactory = FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType);
    if (!isFactory) {
      return logisticsCostMatchesCustomsDeclaration(cost, row, row.order);
    }
    if (cost.id && purchaseOrderIds.has(cost.id)) return true;
    if (fallbackSupplierIds.size) return Boolean(cost.supplierId && fallbackSupplierIds.has(cost.supplierId));
    return false;
  }).map((cost) => {
    if (FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType)) return cost;
    const allocatedCost = allocateLogisticsCostForCustomsDeclaration(cost, row, row.order);
    const invoiceDocument = allocatedCost.generatedLogisticsExpense?.invoiceDocument;
    if (!invoiceDocument) return allocatedCost;
    return {
      ...allocatedCost,
      documents: uniqueById([...(allocatedCost.documents || []), invoiceDocument]),
    };
  });
}

async function loadCustomsDeclarationCompletenessRow(customsDeclarationId: string) {
  return prisma.customsDeclaration.findFirst({
    where: { id: customsDeclarationId, deletedAt: null, order: { is: { deletedAt: null } } },
    include: customsDeclarationCompletenessInclude,
  });
}

async function computeAndPersistCustomsDeclarationCompleteness(row: CustomsDeclarationCompletenessRow) {
  const scopedOrder = {
    ...row.order,
    id: row.orderId,
    blNo: row.billOfLadingNo || row.order.blNo,
    customsDeclarationNo: row.declarationNo || row.order.customsDeclarationNo,
    customsDeclarationDate: row.declarationDate || row.order.customsDeclarationDate,
    taxRefundStatus: row.taxRefundStatus,
    taxRefundCompleteness: row.taxRefundCompleteness,
    customsDeclarationSupplierIssues: customsDeclarationSupplierCompletenessIssues(row.suppliers || []),
    documents: scopedDeclarationDocuments(row),
    costs: scopedDeclarationCosts(row),
  };
  const completeness = JSON.parse(JSON.stringify(taxDocumentCompleteness(scopedOrder))) as TaxRefundCompletenessResult;
  const status = taxRefundStatusFromCompleteness(row.taxRefundStatus, completeness);
  const overallCompleteness = taxRefundOverallCompletenessValue(completeness);
  const issuesSummary = taxRefundCompletenessIssuesSummary(completeness);
  await prisma.customsDeclaration.update({
    where: { id: row.id },
    data: {
      taxRefundCompleteness: completeness as Prisma.InputJsonValue,
      taxRefundCompletenessUpdatedAt: new Date(),
      taxRefundOverallCompleteness: overallCompleteness,
      taxRefundCompletenessIssuesSummary: issuesSummary,
      ...(status !== row.taxRefundStatus ? { taxRefundStatus: status } : {}),
    },
  });
  return completeness;
}

function runDedupedTaxRefundCompletenessRefresh(
  orderId: string,
  task: () => Promise<TaxRefundCompletenessResult | null>,
) {
  const pending = pendingTaxRefundCompletenessRefreshes.get(orderId);
  if (pending) return pending;
  const promise = task().finally(() => {
    pendingTaxRefundCompletenessRefreshes.delete(orderId);
  });
  pendingTaxRefundCompletenessRefreshes.set(orderId, promise);
  return promise;
}

async function refreshCustomsDeclarationCompletenessForOrder(orderId: string) {
  const declarations = await prisma.customsDeclaration.findMany({
    where: { orderId, deletedAt: null },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }],
    take: 200,
  });
  if (!declarations.length) return;
  const results = await Promise.allSettled(
    declarations.map((declaration) => refreshTaxRefundCompletenessForCustomsDeclaration(declaration.id)),
  );
  const failedCount = results.filter((result) => result.status === "rejected").length;
  if (failedCount) {
    console.warn("[tax-refund.completeness.batch-refresh-failed]", {
      orderId,
      declarationCount: declarations.length,
      failedCount,
    });
  }
}

export async function refreshTaxRefundCompletenessForOrder(order: TaxRefundCompletenessOrder | null | undefined) {
  const orderId = normalizedOrderId(order?.id);
  if (!orderId || !order) return null;
  return runDedupedTaxRefundCompletenessRefresh(orderId, async () => {
    const completeness = await computeAndPersistTaxRefundCompleteness(order);
    await refreshCustomsDeclarationCompletenessForOrder(orderId);
    return completeness;
  });
}

export async function refreshTaxRefundCompleteness(orderId: string | null | undefined) {
  const id = normalizedOrderId(orderId);
  if (!id) return null;
  return runDedupedTaxRefundCompletenessRefresh(id, async () => {
    const order = await loadTaxRefundCompletenessOrder(id);
    if (!order) return null;
    const completeness = await computeAndPersistTaxRefundCompleteness(order);
    await refreshCustomsDeclarationCompletenessForOrder(id);
    return completeness;
  });
}

export async function refreshTaxRefundCompletenessForCustomsDeclaration(customsDeclarationId: string | null | undefined) {
  const id = normalizedOrderId(customsDeclarationId);
  if (!id) return null;
  const pending = pendingCustomsDeclarationCompletenessRefreshes.get(id);
  if (pending) return pending;
  const promise = (async () => {
    const row = await loadCustomsDeclarationCompletenessRow(id);
    if (!row) return null;
    return computeAndPersistCustomsDeclarationCompleteness(row);
  })().finally(() => {
    pendingCustomsDeclarationCompletenessRefreshes.delete(id);
  });
  pendingCustomsDeclarationCompletenessRefreshes.set(id, promise);
  return promise;
}

export async function refreshTaxRefundCompletenessBatch(
  orderIds: Array<string | null | undefined>,
  options: { concurrency?: number } = {},
) {
  const ids = [...new Set(orderIds.map(normalizedOrderId).filter(Boolean))];
  const results = new Map<string, TaxRefundCompletenessResult | null>();
  if (!ids.length) return results;
  const concurrency = Math.min(
    Math.max(1, Math.round(options.concurrency || TAX_REFUND_COMPLETENESS_BATCH_CONCURRENCY)),
    TAX_REFUND_COMPLETENESS_BATCH_CONCURRENCY,
  );
  let index = 0;
  async function worker() {
    while (index < ids.length) {
      const orderId = ids[index++];
      if (!orderId) continue;
      results.set(orderId, await refreshTaxRefundCompleteness(orderId));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
  return results;
}

export function scheduleTaxRefundCompletenessRefresh(orderId: string | null | undefined, label = "退税资料完整度刷新") {
  const id = normalizedOrderId(orderId);
  if (!id) return;
  void runNonCriticalTask(label, () => refreshTaxRefundCompleteness(id), { context: { orderId: id } });
}

export function scheduleTaxRefundCompletenessRefreshForCustomsDeclaration(customsDeclarationId: string | null | undefined, label = "报关批次退税完整度刷新") {
  const id = normalizedOrderId(customsDeclarationId);
  if (!id) return;
  void runNonCriticalTask(label, () => refreshTaxRefundCompletenessForCustomsDeclaration(id), {
    context: { customsDeclarationId: id },
  });
}

export function scheduleTaxRefundCompletenessRefreshBatch(
  orderIds: Array<string | null | undefined>,
  label = "退税资料完整度批量刷新",
) {
  const ids = [...new Set(orderIds.map(normalizedOrderId).filter(Boolean))];
  if (!ids.length) return;
  void runNonCriticalTask(label, () => refreshTaxRefundCompletenessBatch(ids), {
    context: { orderCount: ids.length, sampleOrderIds: ids.slice(0, 10) },
  });
}

export async function syncCostInvoiceStatus(costId: string | null | undefined) {
  if (!costId) return null;
  const cost = await prisma.orderCost.findFirst({
    where: { id: costId, deletedAt: null },
    select: { id: true, orderId: true, supplierId: true, sourceType: true, invoiceStatus: true },
  });
  if (!cost) return null;
  const invoiceCount = await prisma.orderDocument.count({
    where: {
      costId,
      documentType: "SUPPLIER_INVOICE",
      uploadStatus: "SUCCESS",
      deletedAt: null,
    },
  });
  const hasSupplierReturnInvoice = await hasCostBusinessDocument(cost, "SUPPLIER_INVOICE");
  if (cost.sourceType === "LOGISTICS_EXPENSE") {
    const invoiceStatus = invoiceCount > 0 || hasSupplierReturnInvoice ? "已收到" : (cost.invoiceStatus || "未通知");
    return prisma.orderCost.update({
      where: { id: costId },
      data: { invoiceStatus },
    });
  }
  const invoiceStatus = invoiceCount > 0 || hasSupplierReturnInvoice ? "已收到" : "未收到";
  return prisma.orderCost.update({
    where: { id: costId },
    data: { invoiceStatus },
  });
}
