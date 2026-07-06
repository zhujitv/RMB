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
  SUPPLIER_DOCUMENT_LABELS,
  SUPPLIER_DOCUMENT_COST_CANDIDATE_SCAN_LIMIT,
  SUPPLIER_DOCUMENT_REQUEST_STATUSES,
  SUPPLIER_INVOICE_SYNC_COST_LIMIT,
  activeSupplierDocumentRequestPairSet,
  activeSupplierDocumentRequestWhere,
  serializeSupplierDocumentCostCandidate,
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
  serializeSupplierDocument,
  supplierDocumentEmailLabel,
  supplierDocumentRequestOrderLocked,
  supplierDocumentRequestTemplateVariables,
  supplierRecipientEmails,
  uniqueEmails,
  resolveUniqueFactoryCostForSupplierReturn,
} from "./supplier-document-request-serialization";

export async function uploadSupplierDocumentRequestDocument(request: AuditRequestLike, actor: ActorLike, requestId: string, input: SupplierDocumentUploadInput) {
  assertWrite(actor, "supplierDocuments");
  const uploadedById = actorId(actor);
  const row = await loadSupplierDocumentRequest(requestId, actor);
  const documentType = normalizeSupplierReturnDocumentType(nonEmpty(input.documentType)) as OrderDocumentType;
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  if (!requiredTypes.includes(documentType)) {
    throw codedError("该任务不需要上传此类资料。", 400, "DOCUMENT_TYPE_NOT_ALLOWED");
  }
  const uploadedFile = await readManagedUploadFile(input.file, "pdf", "supplier-document.pdf");
  const { originalFileName, mimeType, fileSize } = uploadedFile;
  const standardFilename = `${row.order.orderNo || row.orderId}_${SUPPLIER_DOCUMENT_LABELS[documentType] || documentType}.pdf`;
  const uniqueFactoryCost = await resolveUniqueFactoryCostForSupplierReturn(row.orderId, row.supplierId, nonEmpty(input.costId));
  const storageFileName = safeFileName(`${row.order.orderNo || row.orderId}_${documentType}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.pdf`);
  const storageKey = buildOrderDocumentKey({
    orderId: row.orderId,
    documentType,
    relatedModule: "SUPPLIER",
    supplierId: row.supplierId,
    fileName: storageFileName,
  });
  const storedFile = await uploadManagedFileToStorage({ file: uploadedFile, storageKey, fileName: standardFilename });
  let document;
  try {
    document = await prisma.$transaction(async (tx) => {
      const created = await tx.orderDocument.create({
        data: {
          orderId: row.orderId,
          costId: uniqueFactoryCost?.id || null,
          supplierId: row.supplierId,
          factoryDocumentRequestId: row.id,
          relatedModule: "SUPPLIER",
          documentType,
          fileName: standardFilename,
          originalName: originalFileName,
          originalFilename: originalFileName,
          standardFilename,
          fileSize: storedFile.fileSize || fileSize,
          mimeType: storedFile.mimeType || mimeType,
          r2Bucket: storedFile.bucket,
          storageKey: storedFile.storageKey,
          fileUrl: storedFile.fileUrl,
          uploadStatus: "SUCCESS",
          uploadProgress: 100,
          uploadedById,
          uploadedAt: storedFile.uploadedAt,
        },
        include: { uploadedBy: true, supplier: true },
      });
      await upsertFileAssetForOrderDocument(tx, created);
      await refreshSupplierDocumentRequestStatus(tx, row.id);
      return created;
    });
  } catch (error: unknown) {
    await deleteManagedStoredFile(storedFile.storageKey).catch(() => null);
    throw error;
  }
  scheduleTaxRefundCompletenessRefresh(row.orderId);
  let ocrWarning = "";
  try {
    const ocrTask = await createSupplierDocumentOcrTaskForUpload(document.id);
    if (ocrTask?.id) {
      const completedTask = await runNonCriticalTask("产品供应商回传资料OCR识别", async () => {
        return runSupplierDocumentOcrTask(ocrTask.id);
      }, { context: { documentId: document.id, requestId: row.id, documentType }, slowMs: 3000 });
      if (completedTask?.status === "OCR识别失败，需人工核对") {
        ocrWarning = completedTask.errorMessage || "OCR识别失败，需人工核对或稍后重新识别。";
      }
    } else {
      await refreshSupplierDocumentRequestQualification(row.id);
    }
  } catch (error: unknown) {
    ocrWarning = error instanceof Error ? error.message : "OCR任务创建失败，请稍后重试或联系管理员。";
    logServerError("供应商回传资料上传成功但OCR任务创建失败", error, { documentId: document.id, requestId: row.id, documentType });
  }
  if (documentType === "SUPPLIER_INVOICE") {
    await runNonCriticalTask("成本发票状态同步", async () => {
      const costs = uniqueFactoryCost
        ? [uniqueFactoryCost]
        : await prisma.orderCost.findMany({
            where: {
              orderId: row.orderId,
              supplierId: row.supplierId,
              deletedAt: null,
              status: { not: ORDER_COST_STATUS_VOID },
            },
            select: { id: true },
            take: SUPPLIER_INVOICE_SYNC_COST_LIMIT,
          });
      await Promise.all(costs.map((cost) => syncCostInvoiceStatus(cost.id)));
    });
  }
  await runNonCriticalTask("供应商回传资料日志写入", () => writeAudit(request, actor, "供应商上传回传资料", "order_documents", document.id, null, {
    orderNo: row.order.orderNo,
    supplierId: row.supplierId,
    costId: uniqueFactoryCost?.id || "",
    documentType,
    requestId: row.id,
  }));
  const refreshed = await loadSupplierDocumentRequest(row.id, actor);
  return {
    request: serializeSupplierDocumentRequest(refreshed, actor),
    document: serializeSupplierDocument(document),
    message: ocrWarning ? `上传成功；${ocrWarning}` : "上传成功",
  };
}
