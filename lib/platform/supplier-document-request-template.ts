import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, readR2Object, safeFileName, uploadToR2 } from "../r2";
import { NOTIFICATION_TEMPLATE_TYPES, renderNotificationTemplate, sendNotificationEmail } from "./notification-engine";
import { safeRefreshSupplierDocumentRequestCompletion } from "./supplier-document-request-completion";
import {
  DEFAULT_COMPANY_PROFILE_SETTINGS,
  FACTORY_SUPPLIER_COST_TYPES,
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
  EXCEL_TEMPLATE_MIME,
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
import { generateSupplierTaxContractXlsx } from "./supplier-tax-contract-xlsx";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import {
  normalizeSupplierTaxContractDraftValues,
  supplierTaxContractSupplierName,
} from "./supplier-tax-contract-values";

function normalizedTaxContractTemplateDraft(row: SupplierDocumentRequestRow) {
  const draft = row.contractApproved || row.contractDraft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft) || row.contractStatus === "LEGACY") return null;
  const supplierName = row.supplier ? supplierTaxContractSupplierName(row.supplier) : "";
  return normalizeSupplierTaxContractDraftValues(draft as Record<string, unknown>, { supplierName }) as unknown as SupplierTaxContractDraft;
}

export async function getSupplierDocumentRequestTemplate(request: AuditRequestLike, actor: ActorLike, requestId: string) {
  assertRead(actor, "supplierDocuments");
  const row = await loadSupplierDocumentRequest(requestId, actor);
  const taxContractDraft = normalizedTaxContractTemplateDraft(row);
  if (taxContractDraft) {
    const body = await generateSupplierTaxContractXlsx(taxContractDraft);
    await runNonCriticalTask("合同样本下载日志写入", () => writeAudit(request, actor, "下载供应商合同样本", "supplier_document_requests", row.id, null, {
      orderNo: row.order.orderNo,
      supplierId: row.supplierId,
      regeneratedFromContractDraft: true,
    }));
    return {
      body,
      mimeType: EXCEL_TEMPLATE_MIME,
      fileName: row.templateOriginalName || row.templateFileName || `${taxContractDraft.contractNo || row.order.orderNo || "退税合同"}.xlsx`,
    };
  }
  if (!row.templateStorageKey) {
    throw codedError("该任务没有合同样本文件。", 404, "TEMPLATE_NOT_FOUND");
  }
  const asset = await findActiveFileAssetBySource(
    FILE_ASSET_SOURCE_TABLES.SUPPLIER_DOCUMENT_REQUESTS,
    row.id,
    FILE_ASSET_ROLES.SUPPLIER_REQUEST_TEMPLATE,
  );
  const storageKey = asset?.storageKey || row.templateStorageKey;
  const body = await readR2Object(storageKey).catch((error) => {
    if (error?.status === 404 || ["STORAGE_OBJECT_NOT_FOUND", "R2_OBJECT_NOT_FOUND"].includes(String(error?.code || ""))) {
      throw codedError("合同样本文件不存在或已删除。", 404, "TEMPLATE_NOT_FOUND");
    }
    throw error;
  });
  await runNonCriticalTask("合同样本下载日志写入", () => writeAudit(request, actor, "下载供应商合同样本", "supplier_document_requests", row.id, null, {
    orderNo: row.order.orderNo,
    supplierId: row.supplierId,
  }));
  return {
    body,
    mimeType: asset?.mimeType || row.templateMimeType || EXCEL_TEMPLATE_MIME,
    fileName: asset?.fileName || row.templateOriginalName || row.templateFileName || "factory-document-template.xlsx",
  };
}

export async function getSupplierDocumentRequestTemplateMetadata(_request: AuditRequestLike, actor: ActorLike, requestId: string) {
  assertRead(actor, "supplierDocuments");
  const row = await loadSupplierDocumentRequest(requestId, actor);
  if (!row.templateStorageKey) {
    throw codedError("该任务没有合同样本文件。", 404, "TEMPLATE_NOT_FOUND");
  }
  const asset = await findActiveFileAssetBySource(
    FILE_ASSET_SOURCE_TABLES.SUPPLIER_DOCUMENT_REQUESTS,
    row.id,
    FILE_ASSET_ROLES.SUPPLIER_REQUEST_TEMPLATE,
  );
  const mimeType = asset?.mimeType || row.templateMimeType || EXCEL_TEMPLATE_MIME;
  const fileName = asset?.fileName || row.templateOriginalName || row.templateFileName || "factory-document-template.xlsx";
  const metadata = {
    id: row.id,
    ...managedFileMetadata({
      fileName,
      originalFileName: asset?.originalFileName || row.templateOriginalName || row.templateFileName,
      mimeType,
      fileSize: row.templateFileSize,
      uploadedAt: asset?.uploadedAt || row.createdAt,
      binding: {
        orderId: row.orderId,
        supplierId: row.supplierId,
        supplierDocumentRequestId: row.id,
        relatedModule: "SUPPLIER_REQUEST_TEMPLATE",
      },
    }),
    previewKind: managedPreviewableMimeType(mimeType),
  };
  return mergeFileAssetMetadata(metadata, asset);
}
