import { prisma } from "../prisma";
import { readR2Object } from "../r2";
import { assertCanDeleteOrderDocumentFile } from "./file-delete-policy";
import {
  FILE_ASSET_SOURCE_TABLES,
  applyFileAssetToOrderDocument,
  codedError,
  findActiveFileAssetBySource,
  isCustomsDeclarationDocumentType,
  invalidatePersistedTaxRefundCompleteness,
  logServerError,
  managedFileMetadata,
  managedPreviewableMimeType,
  mergeFileAssetMetadata,
  permissionError,
  resolveStandardFilenameForPersistedDocument,
  runNonCriticalTask,
  refreshTaxRefundCompleteness,
  scheduleTaxRefundCompletenessRefresh,
  serializeOrderDocument,
  softDeleteFileAssetBySource,
  standardFilenameForDocument,
  syncCostInvoiceStatus,
  writeAudit,
  assertRead,
  assertWrite,
} from "./shared";
import {
  canReadDocumentContent,
  isLogisticsGeneratedCostInvoice,
  orderDocumentFileInclude,
  type ActorLike,
  type AuditRequestLike,
  type DocumentLike,
} from "./order-documents-types";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";

export async function deleteOrderDocument(request: AuditRequestLike, actor: ActorLike, id: string) {
  assertWrite(actor, "documents");
  const before = await prisma.orderDocument.findUnique({
    where: { id },
    include: { order: { include: { customer: true } }, cost: true, supplier: true, uploadedBy: true },
  });
  if (!before || before.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (isLogisticsGeneratedCostInvoice(before.documentType, before.cost)) {
    throw permissionError("物流费用发票请在物流费用模块按发票分组删除或替换，成本管理仅同步查看。", 400);
  }
  assertCanDeleteOrderDocumentFile(actor, before);
  const deletedAt = new Date();
  const document = await prisma.$transaction(async (tx) => {
    const updated = await tx.orderDocument.update({
      where: { id },
      data: { deletedAt },
      include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
    });
    await softDeleteFileAssetBySource(
      tx,
      FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
      id,
      String(before.documentType),
      deletedAt,
    );
    if (before.documentType === "EXPORT_INVOICE") {
      await invalidatePersistedTaxRefundCompleteness(tx, before.orderId);
    }
    return updated;
  });
  if (before.documentType === "EXPORT_INVOICE") {
    try {
      await runNonCriticalTask("出口发票删除后退税完整度重算", async () => {
        const refreshed = await refreshTaxRefundCompleteness(before.orderId);
        if (!refreshed) throw new Error("出口发票已删除，但退税完整度重算未完成，将在下次读取时重试");
        return refreshed;
      }, { context: { orderId: before.orderId, documentId: before.id } }).catch((error) => {
        logServerError("出口发票删除后退税完整度重算任务异常", error, { orderId: before.orderId, documentId: before.id });
        return null;
      });
    } finally {
      invalidateWorkbenchTodosCache();
    }
  }
  if (isCustomsDeclarationDocumentType(before.documentType)) {
    await prisma.receivableOrder.update({
      where: { id: before.orderId },
      data: {
        customsDeclarationNo: null,
        customsDeclarationDate: null,
        customsParsedAt: null,
        customsParseStatus: null,
        customsParseMessage: null,
        customsDeclarationParseSource: null,
      },
    });
  }
  await runNonCriticalTask("成本发票状态同步", () => syncCostInvoiceStatus(before.costId));
  await runNonCriticalTask("文件删除操作日志写入", () => writeAudit(request, actor, "删除文件", "order_documents", id, before, {
    orderNo: before.order?.orderNo,
    fileName: standardFilenameForDocument(before),
    clearedCustomsRecognition: isCustomsDeclarationDocumentType(before.documentType),
  }));
  if (before.documentType !== "EXPORT_INVOICE") scheduleTaxRefundCompletenessRefresh(before.orderId);
  return serializeOrderDocument(document);
}

export async function getOrderDocumentDownload(request: AuditRequestLike, actor: ActorLike, id: string) {
  assertRead(actor, "documents");
  const document = await prisma.orderDocument.findUnique({
    where: { id },
    include: orderDocumentFileInclude(),
  });
  if (!document || document.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (!canReadDocumentContent(actor, document)) throw permissionError("无权限下载该订单单证");
  if (document.uploadStatus !== "SUCCESS") throw permissionError("文件尚未上传成功，不能下载", 400);
  const asset = await findActiveFileAssetBySource(FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS, document.id, String(document.documentType));
  const fileDocument = applyFileAssetToOrderDocument(document, asset);
  if (!fileDocument.storageKey) throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
  const standardFilename = await resolveStandardFilenameForPersistedDocument(fileDocument);
  const body = await readR2Object(fileDocument.storageKey).catch((error) => {
    if (error?.status === 404 || error?.code === "R2_OBJECT_NOT_FOUND") throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
    throw error;
  });
  await runNonCriticalTask("文件下载操作日志写入", () => writeAudit(request, actor, "下载文件", "order_documents", document.id, null, {
    orderNo: document.order?.orderNo,
    fileName: standardFilename,
  }));
  return { body, mimeType: previewableOrderDocumentMimeType(fileDocument), document: serializeOrderDocument({ ...fileDocument, standardFilename }) };
}

export async function getOrderDocumentMetadata(request: AuditRequestLike, actor: ActorLike, id: string) {
  assertRead(actor, "documents");
  const document = await prisma.orderDocument.findUnique({
    where: { id },
    include: orderDocumentFileInclude(),
  });
  if (!document || document.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (!canReadDocumentContent(actor, document)) throw codedError("无权限查看该订单单证", 403, "PERMISSION_DENIED");
  if (document.uploadStatus !== "SUCCESS") throw permissionError("文件尚未上传成功，不能预览", 400);
  const asset = await findActiveFileAssetBySource(FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS, document.id, String(document.documentType));
  const fileDocument = applyFileAssetToOrderDocument(document, asset);
  const standardFilename = await resolveStandardFilenameForPersistedDocument(fileDocument);
  return serializeOrderDocument({ ...fileDocument, standardFilename });
}

export async function getOrderDocumentFileMetadata(_request: AuditRequestLike, actor: ActorLike, id: string) {
  assertRead(actor, "documents");
  const document = await prisma.orderDocument.findUnique({
    where: { id },
    include: orderDocumentFileInclude(),
  });
  if (!document || document.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (!canReadDocumentContent(actor, document)) throw codedError("无权限查看该订单单证", 403, "PERMISSION_DENIED");
  if (document.uploadStatus !== "SUCCESS") throw permissionError("文件尚未上传成功，不能预览", 400);
  const asset = await findActiveFileAssetBySource(FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS, document.id, String(document.documentType));
  const fileDocument = applyFileAssetToOrderDocument(document, asset);
  const standardFilename = await resolveStandardFilenameForPersistedDocument(fileDocument);
  const metadata = {
    id: document.id,
    ...managedFileMetadata({
      fileUrl: fileDocument.fileUrl,
      fileName: standardFilename,
      originalFileName: fileDocument.originalFilename || fileDocument.originalName || fileDocument.fileName,
      mimeType: fileDocument.mimeType,
      fileSize: fileDocument.fileSize,
      uploadedAt: fileDocument.uploadedAt,
      uploadedBy: fileDocument.uploadedBy,
      binding: {
        orderId: fileDocument.orderId,
        costId: fileDocument.costId,
        supplierId: fileDocument.supplierId,
        supplierDocumentRequestId: fileDocument.factoryDocumentRequestId,
        taxRefundDocumentType: fileDocument.documentType,
        orderDocumentId: document.id,
        relatedModule: fileDocument.relatedModule,
      },
    }),
    previewKind: managedPreviewableMimeType(fileDocument.mimeType),
  };
  return mergeFileAssetMetadata(metadata, asset);
}

export async function getOrderDocumentPreviewMetadata(request: AuditRequestLike, actor: ActorLike, id: string) {
  assertRead(actor, "documents");
  const document = await prisma.orderDocument.findUnique({
    where: { id },
    include: orderDocumentFileInclude(),
  });
  if (!document || document.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (!canReadDocumentContent(actor, document)) throw codedError("无权限预览该订单单证", 403, "PERMISSION_DENIED");
  if (document.uploadStatus !== "SUCCESS") throw codedError("文件尚未上传成功，不能预览", 400, "DOCUMENT_NOT_FOUND");
  const asset = await findActiveFileAssetBySource(FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS, document.id, String(document.documentType));
  const fileDocument = applyFileAssetToOrderDocument(document, asset);
  const mimeType = previewableOrderDocumentMimeType(fileDocument);
  if (!isPreviewableOrderDocumentMimeType(mimeType)) {
    throw codedError("该文件类型暂不支持在线预览", 400, "INVALID_FILE_TYPE");
  }
  if (!fileDocument.storageKey) throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
  const standardFilename = await resolveStandardFilenameForPersistedDocument(fileDocument);
  return serializeOrderDocument({ ...fileDocument, standardFilename });
}

export async function getOrderDocumentPreview(request: AuditRequestLike, actor: ActorLike, id: string) {
  assertRead(actor, "documents");
  const document = await prisma.orderDocument.findUnique({
    where: { id },
    include: orderDocumentFileInclude(),
  });
  if (!document || document.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (!canReadDocumentContent(actor, document)) throw codedError("无权限预览该订单单证", 403, "PERMISSION_DENIED");
  if (document.uploadStatus !== "SUCCESS") throw codedError("文件尚未上传成功，不能预览", 400, "DOCUMENT_NOT_FOUND");
  const asset = await findActiveFileAssetBySource(FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS, document.id, String(document.documentType));
  const fileDocument = applyFileAssetToOrderDocument(document, asset);
  const mimeType = previewableOrderDocumentMimeType(fileDocument);
  if (!isPreviewableOrderDocumentMimeType(mimeType)) {
    throw codedError("该文件类型暂不支持在线预览", 400, "INVALID_FILE_TYPE");
  }
  if (!fileDocument.storageKey) throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
  const body = await readR2Object(fileDocument.storageKey).catch((error) => {
    if (error?.status === 404 || error?.code === "R2_OBJECT_NOT_FOUND") throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
    throw error;
  });
  const standardFilename = await resolveStandardFilenameForPersistedDocument(fileDocument);
  await runNonCriticalTask("文件预览操作日志写入", () => writeAudit(request, actor, "预览文件", "order_documents", document.id, null, {
    orderNo: document.order?.orderNo,
    fileName: standardFilename,
  }));
  return { body, mimeType, document: serializeOrderDocument({ ...fileDocument, standardFilename }) };
}

function previewableOrderDocumentMimeType(document: DocumentLike) {
  return String(document?.mimeType || "application/pdf").toLowerCase();
}

function isPreviewableOrderDocumentMimeType(mimeType: unknown) {
  return ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(String(mimeType || "").toLowerCase());
}
