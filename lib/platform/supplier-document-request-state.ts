import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { codedError, isProductSupplierOperatorRole } from "./shared";
import { safeRefreshSupplierDocumentRequestCompletion } from "./supplier-document-request-completion";
import {
  normalizeSupplierReturnDocumentType,
  supplierDocumentRequestInclude,
  type ActorLike,
  type SupplierDocumentRequestRow,
} from "./supplier-document-request-types";

export async function refreshSupplierDocumentRequestStatus(
  tx: Prisma.TransactionClient,
  requestId: string,
) {
  const row = await tx.supplierDocumentRequest.findUnique({
    where: { id: requestId },
    include: {
      documents: {
        where: { deletedAt: null, uploadStatus: "SUCCESS" },
        select: { documentType: true },
      },
    },
  });
  if (!row) return null;
  const uploadedTypes = new Set(row.documents.map((document) => (
    normalizeSupplierReturnDocumentType(document.documentType)
  )));
  const nextStatus = uploadedTypes.size ? "部分上传" : "待上传";
  return tx.supplierDocumentRequest.update({
    where: { id: requestId },
    data: { status: nextStatus, completedAt: null, completedById: null },
  });
}

export function supplierDocumentRequestOrderLocked(
  order: SupplierDocumentRequestRow["order"] | null | undefined,
) {
  return Boolean(
    order?.taxArchived
    || order?.isArchived
    || order?.taxSubmittedAt
    || order?.taxRefundArchivedAt
    || order?.taxRefundStatus === "SUBMITTED",
  );
}

export async function loadSupplierDocumentRequest(id: string, actor: ActorLike) {
  const where: Prisma.SupplierDocumentRequestWhereInput = {
    id,
    deletedAt: null,
    ...(isProductSupplierOperatorRole(actor?.role)
      ? { supplierId: actor?.supplierId || "__no_supplier_bound__" }
      : {}),
  };
  const row = await prisma.supplierDocumentRequest.findFirst({
    where,
    include: supplierDocumentRequestInclude(),
  });
  if (!row) {
    throw codedError(
      "资料回传任务不存在或无权限访问。",
      404,
      "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND",
    );
  }
  if (isProductSupplierOperatorRole(actor?.role) && !row.supplier.allowFactoryDocumentUpload) {
    throw codedError(
      "该供应商未开启资料回传权限。",
      403,
      "SUPPLIER_DOCUMENT_UPLOAD_DISABLED",
    );
  }
  await safeRefreshSupplierDocumentRequestCompletion(row.id);
  const refreshed = await prisma.supplierDocumentRequest.findFirst({
    where,
    include: supplierDocumentRequestInclude(),
  });
  if (!refreshed) {
    throw codedError(
      "资料回传任务不存在或无权限访问。",
      404,
      "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND",
    );
  }
  return refreshed || row;
}

export function jsonStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}
