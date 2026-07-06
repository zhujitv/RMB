import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, readR2Object, safeFileName, uploadToR2 } from "../r2";
import { NOTIFICATION_TEMPLATE_TYPES, renderNotificationTemplate, sendNotificationEmail } from "./notification-engine";
import {
  createSupplierDocumentOcrTaskForUpload,
  reconcileStaleSupplierDocumentOcrTasks,
  refreshSupplierDocumentRequestQualification,
  runSupplierDocumentOcrTask,
  serializeSupplierDocumentOcrTask,
} from "./supplier-document-ocr";
import { safeRefreshSupplierDocumentRequestCompletion } from "./supplier-document-request-completion";
import {
  DEFAULT_COMPANY_PROFILE_SETTINGS,
  FACTORY_SUPPLIER_COST_TYPES,
  ORDER_COST_STATUS_VOID,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_REFUND_SUPPLIER_TYPES,
  assertRead,
  assertWrite,
  codedError,
  dateToInput,
  deleteManagedStoredFile,
  FILE_ASSET_ROLES,
  FILE_ASSET_SOURCE_TABLES,
  findActiveFileAssetBySource,
  getCompanyProfileSettings,
  logServerError,
  managedFileMetadata,
  managedPreviewableMimeType,
  mergeFileAssetMetadata,
  nonEmpty,
  normalizeEmail,
  pageParams,
  pageResult,
  readManagedUploadFile,
  requireText,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  serializeOrderDocument,
  softDeleteFileAssetBySource,
  syncCostInvoiceStatus,
  isProductSupplierOperatorRole,
  isProductSupplierType,
  uploadManagedFileToStorage,
  upsertFileAssetForOrderDocument,
  upsertFileAssetForSupplierRequestTemplate,
  validEmail,
  writeAudit,
} from "./shared";
import {
  SUPPLIER_DOCUMENT_COST_CANDIDATE_LIMIT,
  SUPPLIER_DOCUMENT_COST_CANDIDATE_SCAN_LIMIT,
  SUPPLIER_DOCUMENT_REQUEST_STATUSES,
  SUPPLIER_INVOICE_SYNC_COST_LIMIT,
  activeSupplierDocumentRequestPairSet,
  serializeSupplierDocumentCostCandidate,
  supplierDocumentRequestOccupiedCostSet,
  supplierDocumentRequestFactoryCostInclude,
  supplierDocumentRequestFactoryCostWhere,
  supplierDocumentRequestInclude,
  supplierDocumentRequestPairKey,
  type ActorLike,
  type AuditRequestLike,
  type FactorySupplierReturnCost,
  type QueryLike,
  type SupplierDocumentRequestInput,
  type SupplierDocumentRequestRow,
  type SupplierDocumentUploadInput,
} from "./supplier-document-request-types";
import {
  actorId,
  adminCcEmails,
  attachSupplierDocumentOcrTasks,
  dateFromInput,
  factoryCostSlotsForSupplierRequest,
  jsonStringArray,
  loadFactorySupplierReturnCostForRequest,
  loadSupplierDocumentRequest,
  normalizeSupplierReturnDocumentType,
  readValidatedExcelTemplate,
  refreshSupplierDocumentRequestStatus,
  requiredDocumentTypes,
  safeSelectedProductSupplierPaymentVoucherAttachment,
  serializeSupplierDocumentRequest,
  supplierDocumentEmailLabel,
  supplierDocumentRequestOrderLocked,
  supplierDocumentRequestTemplateVariables,
  supplierRecipientEmails,
  uniqueEmails,
} from "./supplier-document-request-serialization";

export async function listSupplierDocumentRequests(query: QueryLike, actor: ActorLike) {
  assertRead(actor, "supplierDocuments");
  const status = nonEmpty(query.get("status"));
  const keyword = nonEmpty(query.get("keyword") || query.get("q"));
  const { page, pageSize } = pageParams(query, 10, 50);
  const where: Prisma.SupplierDocumentRequestWhereInput = {
    deletedAt: null,
    ...(SUPPLIER_DOCUMENT_REQUEST_STATUSES.includes(status) ? { status } : {}),
    ...(isProductSupplierOperatorRole(actor?.role)
      ? {
          supplierId: actor?.supplierId || "__no_supplier_bound__",
          supplier: { allowFactoryDocumentUpload: true, status: "启用", deletedAt: null },
        }
      : {}),
    ...(keyword && !isProductSupplierOperatorRole(actor?.role)
      ? {
          OR: [
            { order: { orderNo: { contains: keyword, mode: "insensitive" } } },
            { supplier: { supplierName: { contains: keyword, mode: "insensitive" } } },
          ],
        }
      : keyword
        ? { order: { orderNo: { contains: keyword, mode: "insensitive" } } }
        : {}),
  };
  const [total, pendingCount, rows] = await Promise.all([
    prisma.supplierDocumentRequest.count({ where }),
    prisma.supplierDocumentRequest.count({
      where: {
        ...where,
        status: { not: "已完成" },
      },
    }),
    prisma.supplierDocumentRequest.findMany({
      where,
      include: supplierDocumentRequestInclude(),
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const reconciledRows = await Promise.all(rows.map(async (row) => {
    const refreshed = await safeRefreshSupplierDocumentRequestCompletion(row.id);
    return refreshed ? { ...row, status: refreshed.status, completedAt: refreshed.completedAt, completedById: refreshed.completedById } : row;
  }));
  const rowsWithOcr = await attachSupplierDocumentOcrTasks(reconciledRows);
  return {
    ...pageResult(rowsWithOcr.map((row) => serializeSupplierDocumentRequest(row, actor)), total, page, pageSize),
    summary: { pendingCount },
  };
}

export async function deleteSupplierDocumentRequest(request: AuditRequestLike, actor: ActorLike, requestId: string) {
  if (actor?.role !== "管理员") {
    throw codedError("只有管理员可以删除资料回传任务。", 403, "SUPPLIER_DOCUMENT_DELETE_ADMIN_ONLY");
  }
  const deletedById = actorId(actor);
  const row = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    include: supplierDocumentRequestInclude(),
  });
  if (!row) {
    throw codedError("资料回传任务不存在或已删除。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  }
  if (supplierDocumentRequestOrderLocked(row.order)) {
    throw codedError("该任务对应订单已提交退税或已归档，不能删除资料回传任务。", 400, "SUPPLIER_DOCUMENT_REQUEST_TAX_ARCHIVED");
  }

  const now = new Date();
  const activeDocuments = (row.documents || []).filter((document) => !document.deletedAt);
  const activeDocumentIds = activeDocuments.map((document) => document.id);
  const deletedTaxRefundDocumentIds = activeDocuments
    .filter((document) => document.uploadStatus === "SUCCESS")
    .map((document) => document.id);
  const affectedCostIds = activeDocuments
    .map((document) => document.costId || "")
    .filter((id, index, ids) => id && ids.indexOf(id) === index);
  const deletedSupplierInvoice = activeDocuments.some((document) => document.documentType === "SUPPLIER_INVOICE");

  await prisma.$transaction(async (tx) => {
    if (activeDocumentIds.length) {
      await tx.orderDocument.updateMany({
        where: { id: { in: activeDocumentIds }, deletedAt: null },
        data: { deletedAt: now },
      });
    }
    await tx.supplierDocumentRequest.update({
      where: { id: row.id },
      data: {
        deletedAt: now,
        deletedById,
        status: "DELETED",
        completedAt: null,
        completedById: null,
      },
    });
    if (row.templateStorageKey) {
      await softDeleteFileAssetBySource(
        tx,
        FILE_ASSET_SOURCE_TABLES.SUPPLIER_DOCUMENT_REQUESTS,
        row.id,
        FILE_ASSET_ROLES.SUPPLIER_REQUEST_TEMPLATE,
        now,
      );
    }
    for (const document of activeDocuments) {
      await softDeleteFileAssetBySource(
        tx,
        FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
        document.id,
        String(document.documentType || "ORDER_DOCUMENT"),
        now,
      );
    }
  });

  scheduleTaxRefundCompletenessRefresh(row.orderId, "资料回传任务删除后退税完整度刷新");
  if (deletedSupplierInvoice) {
    await runNonCriticalTask("资料回传任务删除后成本发票状态同步", async () => {
      const costs = await prisma.orderCost.findMany({
        where: {
          orderId: row.orderId,
          supplierId: row.supplierId,
          deletedAt: null,
          status: { not: ORDER_COST_STATUS_VOID },
        },
        select: { id: true },
        take: SUPPLIER_INVOICE_SYNC_COST_LIMIT,
      });
      const ids = [...new Set([...affectedCostIds, ...costs.map((cost) => cost.id)].filter(Boolean))];
      await Promise.all(ids.map((costId) => syncCostInvoiceStatus(costId)));
    });
  }
  await runNonCriticalTask("资料回传任务删除日志写入", () => writeAudit(request, actor, "删除资料回传任务", "supplier_document_requests", row.id, row, {
    orderNo: row.order?.orderNo,
    supplierId: row.supplierId,
    deletedDocumentIds: activeDocumentIds,
    deletedTaxRefundDocumentIds,
    deletedById,
  }));
  return {
    id: row.id,
    deletedDocumentIds: activeDocumentIds,
    deletedTaxRefundDocumentIds,
    taxRefundCompletenessRecalculated: deletedTaxRefundDocumentIds.length > 0,
  };
}

export async function listSupplierDocumentRequestCostCandidates(query: QueryLike, actor: ActorLike) {
  if (actor?.role !== "管理员") throw codedError("只有管理员可以发起资料回传通知。", 403, "SUPPLIER_DOCUMENT_NOTICE_ADMIN_ONLY");
  assertWrite(actor, "supplierDocuments");
  const keyword = nonEmpty(query.get("q") || query.get("keyword"));
  const costs = await prisma.orderCost.findMany({
    where: supplierDocumentRequestFactoryCostWhere({ keyword }),
    include: supplierDocumentRequestFactoryCostInclude(),
    orderBy: [{ createdAt: "desc" }],
    take: SUPPLIER_DOCUMENT_COST_CANDIDATE_SCAN_LIMIT,
  });
  const [occupiedCostIds, legacyExistingPairs] = await Promise.all([
    supplierDocumentRequestOccupiedCostSet(costs),
    activeSupplierDocumentRequestPairSet(costs, { legacyWithoutCostOnly: true }),
  ]);
  return costs
    .filter((cost) => !occupiedCostIds.has(cost.id))
    .filter((cost) => !legacyExistingPairs.has(supplierDocumentRequestPairKey(cost.orderId, cost.supplierId || "")))
    .slice(0, SUPPLIER_DOCUMENT_COST_CANDIDATE_LIMIT)
    .map((cost) => serializeSupplierDocumentCostCandidate(cost));
}
