import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  FILE_ASSET_ROLES,
  FILE_ASSET_SOURCE_TABLES,
  ORDER_COST_STATUS_VOID,
  assertRead,
  assertWrite,
  codedError,
  isProductSupplierOperatorRole,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  softDeleteFileAssetBySource,
  syncCostInvoiceStatus,
  writeAudit,
} from "./shared";
import {
  SUPPLIER_INVOICE_SYNC_COST_LIMIT,
  supplierDocumentRequestInclude,
  type ActorLike,
  type AuditRequestLike,
} from "./supplier-document-request-types";
import {
  actorId,
  loadSupplierDocumentRequest,
  serializeSupplierDocumentRequest,
  supplierDocumentRequestOrderLocked,
} from "./supplier-document-request-serialization";
import { refreshSupplierTaxContractParties } from "./supplier-tax-contract-parties";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";

function pendingContractDraft(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("合同草稿不存在，请重新创建任务。", 409, "SUPPLIER_TAX_CONTRACT_DRAFT_MISSING");
  }
  return value as unknown as SupplierTaxContractDraft;
}

export async function getSupplierDocumentRequestDetail(id: string, actor: ActorLike) {
  assertRead(actor, "supplierDocuments");
  const row = await loadSupplierDocumentRequest(id, actor);
  if (row.contractStatus !== "PENDING_REVIEW" || isProductSupplierOperatorRole(actor?.role)) {
    return serializeSupplierDocumentRequest(row, actor);
  }
  const contractDraft = await refreshSupplierTaxContractParties(pendingContractDraft(row.contractDraft));
  return serializeSupplierDocumentRequest({
    ...row,
    contractDraft: contractDraft as unknown as Prisma.JsonValue,
  }, actor);
}

export async function deleteSupplierDocumentRequest(
  request: AuditRequestLike,
  actor: ActorLike,
  requestId: string,
) {
  if (actor?.role !== "管理员") {
    throw codedError(
      "只有管理员可以删除资料回传任务。",
      403,
      "SUPPLIER_DOCUMENT_DELETE_ADMIN_ONLY",
    );
  }
  assertWrite(actor, "supplierDocuments");
  const deletedById = actorId(actor);
  const row = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    include: supplierDocumentRequestInclude(),
  });
  if (!row) {
    throw codedError(
      "资料回传任务不存在或已删除。",
      404,
      "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND",
    );
  }
  if (supplierDocumentRequestOrderLocked(row.order)) {
    throw codedError(
      "该任务对应订单已提交退税或已归档，不能删除资料回传任务。",
      400,
      "SUPPLIER_DOCUMENT_REQUEST_TAX_ARCHIVED",
    );
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
  const deletedSupplierInvoice = activeDocuments.some((document) => (
    document.documentType === "SUPPLIER_INVOICE"
  ));

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
      const ids = [...new Set([
        ...affectedCostIds,
        ...costs.map((cost) => cost.id),
      ].filter(Boolean))];
      await Promise.all(ids.map((costId) => syncCostInvoiceStatus(costId)));
    });
  }
  await runNonCriticalTask("资料回传任务删除日志写入", () => writeAudit(
    request,
    actor,
    "删除资料回传任务",
    "supplier_document_requests",
    row.id,
    row,
    {
      orderNo: row.order?.orderNo,
      supplierId: row.supplierId,
      deletedDocumentIds: activeDocumentIds,
      deletedTaxRefundDocumentIds,
      deletedById,
    },
  ));
  return {
    id: row.id,
    deletedDocumentIds: activeDocumentIds,
    deletedTaxRefundDocumentIds,
    taxRefundCompletenessRecalculated: deletedTaxRefundDocumentIds.length > 0,
  };
}
