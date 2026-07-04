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
  assertSupplierDocumentRequestCostAvailable,
  activeSupplierDocumentRequestPairSet,
  duplicateSupplierDocumentRequestError,
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
  supplierDocumentEmailLabel,
  supplierDocumentRequestOrderLocked,
  supplierDocumentRequestTemplateVariables,
  supplierRecipientEmails,
  uniqueEmails,
} from "./supplier-document-request-serialization";

export async function createSupplierDocumentRequest(request: AuditRequestLike, actor: ActorLike, input: SupplierDocumentRequestInput, templateFile: unknown) {
  if (actor?.role !== "管理员") throw codedError("只有管理员可以发送资料回传催办。", 403, "SUPPLIER_DOCUMENT_NOTICE_ADMIN_ONLY");
  assertWrite(actor, "supplierDocuments");
  const requestedById = actorId(actor);
  const requiredTypes = requiredDocumentTypes(input.requiredDocumentTypes);
  const dueDate = dateFromInput(input.dueDate);
  const message = nonEmpty(input.message).slice(0, 1000);
  const [factoryCost, template] = await Promise.all([
    loadFactorySupplierReturnCostForRequest(input),
    readValidatedExcelTemplate(templateFile),
  ]);
  if (!template) throw codedError("请上传回传表格 Excel。", 400, "TEMPLATE_FILE_REQUIRED");
  const order = factoryCost.order;
  const supplier = factoryCost.supplier;
  if (!order) throw codedError("请选择有效订单。", 404, "ORDER_NOT_FOUND");
  if (!supplier) throw codedError("请选择有效供应商。", 404, "SUPPLIER_NOT_FOUND");
  if (supplier.status !== "启用") throw codedError("供应商已停用，不能通知回传资料。", 400, "SUPPLIER_DISABLED");
  if (!isProductSupplierType(supplier.supplierType)) throw codedError("资料回传只允许通知产品供应商。", 400, "SUPPLIER_TYPE_NOT_ALLOWED");
  if (!supplier.allowFactoryDocumentUpload) throw codedError("该供应商未开启资料回传权限，请先到系统设置开启。", 400, "SUPPLIER_DOCUMENT_UPLOAD_DISABLED");
  await assertSupplierDocumentRequestCostAvailable(factoryCost);

  const recipients = supplierRecipientEmails({ ...supplier, operatorUsers: supplier.operatorUsers });
  if (!recipients.length) throw codedError("供应商未配置有效邮箱或绑定账号邮箱，不能发送回传通知。", 400, "SUPPLIER_EMAIL_REQUIRED");
  const ccEmails = await adminCcEmails();
  let templateStorageKey = "";
  let templateBucket = "";
  let templateFileName = "";
  const { bucket } = ensureR2Configured();
  templateBucket = bucket;
  const templateExtension = template.originalFileName.toLowerCase().endsWith(".xls") ? "xls" : "xlsx";
  templateFileName = safeFileName(`factory-document-template-${order.orderNo || order.id}-${Date.now()}.${templateExtension}`);
  templateStorageKey = buildOrderDocumentKey({
    orderId: order.id,
    documentType: "SUPPLIER_PURCHASE_CONTRACT_TEMPLATE",
    relatedModule: "SUPPLIER",
    supplierId: supplier.id,
    fileName: templateFileName,
  });
  await uploadToR2({ key: templateStorageKey, body: template.body, contentType: template.mimeType });

  const companyProfile = await runNonCriticalTask("公司资料读取", () => getCompanyProfileSettings());
  const companyName = companyProfile?.companyNameZh || DEFAULT_COMPANY_PROFILE_SETTINGS.companyNameZh;
  const paymentVoucherAttachment = await safeSelectedProductSupplierPaymentVoucherAttachment(factoryCost);
  const templateVariables = supplierDocumentRequestTemplateVariables({
    supplierName: supplier.supplierName,
    orderNo: order.orderNo || order.id,
    requiredTypes,
    dueDate,
    templateAttached: true,
    paymentVoucherAttached: Boolean(paymentVoucherAttachment),
    companyName,
    message,
  });
  const renderedEmail = await renderNotificationTemplate(NOTIFICATION_TEMPLATE_TYPES.SUPPLIER_DOCUMENT_REQUEST, templateVariables);
  const subject = renderedEmail.subject;
  const body = renderedEmail.body;

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      await assertSupplierDocumentRequestCostAvailable(factoryCost, tx);
      const saved = await tx.supplierDocumentRequest.create({
        data: {
          orderId: order.id,
          supplierId: supplier.id,
          costId: factoryCost.id,
          requestedById,
          requiredDocumentTypes: requiredTypes,
          status: "待上传",
          dueDate,
          message: message || null,
          templateFileName,
          templateOriginalName: template.originalFileName,
          templateMimeType: template.mimeType,
          templateFileSize: template.fileSize,
          templateStorageKey,
          templateBucket,
          recipientEmails: recipients,
          ccEmails,
          sendStatus: "pending",
          emailSubject: subject,
          emailBody: body,
        },
        include: supplierDocumentRequestInclude(),
      });
      await upsertFileAssetForSupplierRequestTemplate(tx, saved);
      return saved;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 15000,
    });
  } catch (error: unknown) {
    if (templateStorageKey) await deleteR2Object(templateStorageKey).catch(() => null);
    if (["P2002", "P2034"].includes(String((error as { code?: string })?.code || ""))) {
      throw duplicateSupplierDocumentRequestError();
    }
    throw error;
  }

  try {
    const attachments = [
      { filename: template.originalFileName, content: template.body, contentType: template.mimeType },
      ...(paymentVoucherAttachment ? [paymentVoucherAttachment] : []),
    ];
    const delivery = await sendNotificationEmail({
      type: NOTIFICATION_TEMPLATE_TYPES.SUPPLIER_DOCUMENT_REQUEST,
      recipientEmails: recipients,
      ccEmails,
      variables: templateVariables,
      subjectOverride: subject,
      bodyOverride: body,
      idempotencyKey: created.id,
      relatedEntityType: "supplier_document_requests",
      relatedEntityId: created.id,
      relatedOrderId: order.id,
      context: { supplierId: supplier.id, requiredDocumentTypes: requiredTypes },
      attachments,
    });
    if (delivery.skipped || delivery.sent !== true) {
      throw codedError(delivery.error || "供应商资料回传通知模板已停用，未发送。", 409, "NOTIFICATION_TEMPLATE_DISABLED");
    }
    created = await prisma.supplierDocumentRequest.update({
      where: { id: created.id },
      data: { sendStatus: "sent", sentAt: new Date(), sendError: null },
      include: supplierDocumentRequestInclude(),
    });
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : "邮件发送失败";
    logServerError("供应商资料回传通知邮件发送失败", error, { requestId: created.id, supplierId: supplier.id, orderId: order.id });
    created = await prisma.supplierDocumentRequest.update({
      where: { id: created.id },
      data: { sendStatus: "failed", sendError: messageText.slice(0, 500) },
      include: supplierDocumentRequestInclude(),
    });
  }

  await runNonCriticalTask("供应商资料回传通知日志写入", () => writeAudit(request, actor, "通知供应商回传资料", "supplier_document_requests", created.id, null, {
    orderNo: order.orderNo,
    costId: factoryCost.id,
    supplierId: supplier.id,
    requiredDocumentTypes: requiredTypes,
    sendStatus: created.sendStatus,
  }));
  return serializeSupplierDocumentRequest(created, actor);
}
