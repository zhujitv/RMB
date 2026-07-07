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
  resolveUniqueFactoryCostForSupplierReturn,
} from "./supplier-document-request-serialization";

export async function resendSupplierDocumentRequestNotice(request: AuditRequestLike, actor: ActorLike, requestId: string) {
  if (actor?.role !== "管理员") throw codedError("只有管理员可以重新发送资料回传催办。", 403, "SUPPLIER_DOCUMENT_RESEND_ADMIN_ONLY");
  assertWrite(actor, "supplierDocuments");
  const row = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    include: supplierDocumentRequestInclude(),
  });
  if (!row) throw codedError("资料回传任务不存在或已删除。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (supplierDocumentRequestOrderLocked(row.order)) {
    throw codedError("该任务对应订单已提交退税或已归档，不能重新发送催办邮件。", 400, "SUPPLIER_DOCUMENT_REQUEST_TAX_ARCHIVED");
  }
  const recipientEmails = jsonStringArray(row.recipientEmails);
  if (!recipientEmails.length) throw codedError("该任务没有可用收件人，不能重新发送。", 400, "SUPPLIER_DOCUMENT_RECIPIENT_REQUIRED");
  const ccEmails = jsonStringArray(row.ccEmails);
  const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  if (row.templateStorageKey) {
    const templateBody = await readR2Object(row.templateStorageKey);
    if (templateBody) {
      attachments.push({
        filename: row.templateOriginalName || row.templateFileName || `${row.order?.orderNo || "合同样本"}.xlsx`,
        content: templateBody,
        contentType: row.templateMimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    }
  }
  const resendFactoryCost = await resolveUniqueFactoryCostForSupplierReturn(row.orderId, row.supplierId, nonEmpty(row.costId)).catch((error) => {
    logServerError("供应商资料回传重发付款凭证成本匹配失败，已跳过水单附件", error, { requestId: row.id, orderId: row.orderId, supplierId: row.supplierId, costId: row.costId || "" });
    return null;
  });
  if (resendFactoryCost?.id) {
    const factoryCost = await loadFactorySupplierReturnCostForRequest({ costId: resendFactoryCost.id, orderId: row.orderId, supplierId: row.supplierId });
    const paymentVoucherAttachment = await safeSelectedProductSupplierPaymentVoucherAttachment(factoryCost);
    if (paymentVoucherAttachment) attachments.push(paymentVoucherAttachment);
  }
  let updated = row;
  try {
    const delivery = await sendNotificationEmail({
      type: NOTIFICATION_TEMPLATE_TYPES.SUPPLIER_DOCUMENT_REQUEST,
      recipientEmails,
      ccEmails,
      variables: { orderNo: row.order?.orderNo || row.orderId, supplierName: row.supplier?.supplierName || "" },
      subjectOverride: row.emailSubject || `资料回传提醒 - ${row.order?.orderNo || row.orderId}`,
      bodyOverride: row.emailBody || row.message || "请登录系统完成资料回传。",
      idempotencyKey: `${row.id}:resend:${Date.now()}`,
      relatedEntityType: "supplier_document_requests",
      relatedEntityId: row.id,
      relatedOrderId: row.orderId,
      context: { supplierId: row.supplierId, resend: true },
      attachments,
    });
    if (delivery.skipped || delivery.sent !== true) {
      throw codedError(delivery.error || "供应商资料回传通知模板已停用，未发送。", 409, "NOTIFICATION_TEMPLATE_DISABLED");
    }
    updated = await prisma.supplierDocumentRequest.update({
      where: { id: row.id },
      data: { sendStatus: "sent", sentAt: new Date(), sendError: null },
      include: supplierDocumentRequestInclude(),
    });
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : "邮件发送失败";
    logServerError("供应商资料回传通知邮件重新发送失败", error, { requestId: row.id, supplierId: row.supplierId, orderId: row.orderId });
    updated = await prisma.supplierDocumentRequest.update({
      where: { id: row.id },
      data: { sendStatus: "failed", sendError: messageText.slice(0, 500) },
      include: supplierDocumentRequestInclude(),
    });
  }
  await runNonCriticalTask("供应商资料回传催办重发日志写入", () => writeAudit(request, actor, "重新发送供应商资料回传催办", "supplier_document_requests", row.id, row, {
    orderNo: row.order?.orderNo || "",
    supplierId: row.supplierId,
    sendStatus: updated.sendStatus,
  }));
  return serializeSupplierDocumentRequest(updated, actor);
}
