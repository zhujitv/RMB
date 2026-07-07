import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, readR2Object, safeFileName, uploadToR2 } from "../r2";
import { NOTIFICATION_TEMPLATE_TYPES, renderNotificationTemplate, sendNotificationEmail } from "./notification-engine";
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
  supplierDocumentRequestListSelect,
  supplierDocumentRequestPairKey,
  type ActorLike,
  type AuditRequestLike,
  type FactorySupplierReturnCost,
  type QueryLike,
  type SupplierDocumentRequestInput,
  type SupplierDocumentRequestListRow,
  type SupplierDocumentRequestRow,
  type SupplierDocumentUploadInput,
} from "./supplier-document-request-types";
import {
  actorId,
  adminCcEmails,
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

function supplierDocumentRequestListWhere(query: QueryLike, actor: ActorLike): Prisma.SupplierDocumentRequestWhereInput {
  const status = nonEmpty(query.get("status"));
  const keyword = nonEmpty(query.get("keyword") || query.get("q"));
  return {
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
            { purchaseOrderNo: { contains: keyword, mode: "insensitive" } },
            { supplier: { supplierName: { contains: keyword, mode: "insensitive" } } },
          ],
        }
      : keyword
        ? { purchaseOrderNo: { contains: keyword, mode: "insensitive" } }
        : {}),
  };
}

function serializeSupplierDocumentRequestListItem(
  row: SupplierDocumentRequestListRow,
  actor: ActorLike,
  uploadedCount: number,
) {
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  return {
    id: row.id,
    purchaseOrderNo: row.purchaseOrderNo || "",
    supplierName: isProductSupplierOperatorRole(actor?.role) ? "" : (row.supplier?.supplierName || ""),
    status: SUPPLIER_DOCUMENT_REQUEST_STATUSES.includes(row.status) ? row.status : "待上传",
    dueDate: dateToInput(row.dueDate),
    requiredDocumentTypes: requiredTypes,
    uploadedCount,
    requiredCount: requiredTypes.length,
    updatedAt: row.updatedAt,
  };
}

async function supplierDocumentRequestUploadedCounts(rows: SupplierDocumentRequestListRow[]) {
  const requestIds = rows.map((row) => row.id).filter(Boolean);
  if (!requestIds.length) return new Map<string, number>();
  const requiredTypesByRequestId = new Map(
    rows.map((row) => [row.id, new Set(requiredDocumentTypes(row.requiredDocumentTypes).map((type) => normalizeSupplierReturnDocumentType(type)))])
  );
  const uploadedGroups = await prisma.orderDocument.groupBy({
    by: ["factoryDocumentRequestId", "documentType"],
    where: {
      factoryDocumentRequestId: { in: requestIds },
      deletedAt: null,
      uploadStatus: "SUCCESS",
    },
  });
  const uploadedTypesByRequestId = new Map<string, Set<string>>();
  for (const group of uploadedGroups) {
    const requestId = group.factoryDocumentRequestId || "";
    if (!requestId) continue;
    const documentType = normalizeSupplierReturnDocumentType(group.documentType);
    const requiredTypes = requiredTypesByRequestId.get(requestId);
    if (!requiredTypes?.has(documentType)) continue;
    const uploadedTypes = uploadedTypesByRequestId.get(requestId) || new Set<string>();
    uploadedTypes.add(documentType);
    uploadedTypesByRequestId.set(requestId, uploadedTypes);
  }
  return new Map([...uploadedTypesByRequestId.entries()].map(([requestId, uploadedTypes]) => [requestId, uploadedTypes.size]));
}

export async function listSupplierDocumentRequests(query: QueryLike, actor: ActorLike) {
  assertRead(actor, "supplierDocuments");
  const { page, pageSize } = pageParams(query, 10, 50);
  const where = supplierDocumentRequestListWhere(query, actor);
  const [total, rows] = await Promise.all([
    prisma.supplierDocumentRequest.count({ where }),
    prisma.supplierDocumentRequest.findMany({
      where,
      select: supplierDocumentRequestListSelect(),
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const uploadedCounts = await supplierDocumentRequestUploadedCounts(rows);
  return {
    ...pageResult(rows.map((row) => serializeSupplierDocumentRequestListItem(row, actor, uploadedCounts.get(row.id) || 0)), total, page, pageSize),
  };
}

export async function getSupplierDocumentRequestStats(query: QueryLike, actor: ActorLike) {
  assertRead(actor, "supplierDocuments");
  const where = supplierDocumentRequestListWhere(query, actor);
  const [totalCount, pendingCount] = await Promise.all([
    prisma.supplierDocumentRequest.count({ where }),
    prisma.supplierDocumentRequest.count({
      where: {
        ...where,
        status: { not: "已完成" },
      },
    }),
  ]);
  return { totalCount, pendingCount };
}

export async function getSupplierDocumentRequestDetail(id: string, actor: ActorLike) {
  assertRead(actor, "supplierDocuments");
  const row = await loadSupplierDocumentRequest(id, actor);
  return serializeSupplierDocumentRequest(row, actor);
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
