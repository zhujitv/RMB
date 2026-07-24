import type { OrderDocumentType } from "../generated/prisma/client.js";
import { businessEntityFieldsFromOrder } from "./business-entities";
import {
  dateToInput,
  isProductSupplierOperatorRole,
  serializeOrderDocument,
} from "./shared";
import {
  SUPPLIER_DOCUMENT_REQUEST_STATUSES,
  SUPPLIER_DOCUMENT_LABELS,
  factoryCostSlotsForSupplierRequest,
  normalizeSupplierReturnDocumentType,
  requiredDocumentTypes,
  type ActorLike,
  type SupplierDocumentRequestRow,
} from "./supplier-document-request-types";
import { supplierDocumentRequestOrderLocked } from "./supplier-document-request-state";

export function serializeSupplierDocumentRequest(
  row: SupplierDocumentRequestRow,
  actor: ActorLike,
) {
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  const documents = (row.documents || [])
    .filter((document) => requiredTypes.includes(
      normalizeSupplierReturnDocumentType(document.documentType) as OrderDocumentType,
    ))
    .map((document) => serializeSupplierDocument(document));
  const factoryCostSlots = factoryCostSlotsForSupplierRequest(row);
  const canDelete = actor?.role === "管理员" && !supplierDocumentRequestOrderLocked(row.order);
  const taxRefundDocumentCount = documents.filter((document) => (
    document.uploadStatus === "SUCCESS"
  )).length;
  return {
    id: row.id,
    orderId: row.orderId,
    purchaseOrderNo: row.purchaseOrderNo || row.order?.orderNo || "",
    orderNo: row.order?.orderNo || "",
    ...businessEntityFieldsFromOrder(row.order),
    supplierId: row.supplierId,
    supplierName: isProductSupplierOperatorRole(actor?.role)
      ? ""
      : (row.supplier?.supplierName || ""),
    requiredDocumentTypes: requiredTypes,
    requiredDocumentLabels: requiredTypes.map((type) => SUPPLIER_DOCUMENT_LABELS[type] || type),
    factoryCostSlots,
    status: SUPPLIER_DOCUMENT_REQUEST_STATUSES.includes(row.status) ? row.status : "待上传",
    dueDate: dateToInput(row.dueDate),
    message: row.message || "",
    templateFileName: row.templateOriginalName || row.templateFileName || "",
    hasTemplate: Boolean(row.templateStorageKey),
    sendStatus: row.sendStatus || "pending",
    sendError: row.sendError || "",
    sentAt: row.sentAt,
    completedAt: row.completedAt,
    completedByName: isProductSupplierOperatorRole(actor?.role)
      ? ""
      : (row.completedBy?.name || ""),
    requestedByName: isProductSupplierOperatorRole(actor?.role)
      ? ""
      : (row.requestedBy?.name || ""),
    canDelete,
    hasTaxRefundDocuments: taxRefundDocumentCount > 0,
    taxRefundDocumentCount,
    documents,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeSupplierDocument(document: unknown) {
  const row = serializeOrderDocument(document);
  return {
    id: row.id,
    orderId: row.orderId,
    costId: row.costId,
    supplierId: row.supplierId,
    factoryDocumentRequestId: row.factoryDocumentRequestId,
    relatedModule: row.relatedModule,
    documentType: row.documentType,
    documentTypeLabel: row.documentTypeLabel,
    fileName: row.fileName,
    fileUrl: row.fileUrl,
    displayFileName: row.displayFileName,
    downloadFileName: row.downloadFileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    uploadStatus: row.uploadStatus,
    uploadStatusLabel: row.uploadStatusLabel,
    source: row.source,
    uploadedByName: row.uploadedByName,
    uploadedAt: row.uploadedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
