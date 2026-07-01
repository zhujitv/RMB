import { prisma } from "../prisma";
import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { buildOrderDocumentKey, headR2Object, readR2Object, safeFileName } from "../r2";
import { parseAndApplyCustomsDocument } from "./customs-recognition";
import {
  canAccessDomesticLogisticsOrder,
  canUseDomesticLogisticsDocumentScope,
  documentOrderListAccessWhere,
  isExternalLogisticsSupplierAccount,
  isInternalLogisticsOperator,
} from "./masters-access";
import { canAccessOrder } from "./order-access";
import { assertCanDeleteOrderDocumentFile } from "./file-delete-policy";
import { tryAutoShippingDocumentsNotification } from "./shipping-documents";
import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  LOGISTICS_OPERATOR_ROLE,
  ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA,
  ORDER_DOCUMENT_TYPES,
  SALES_DOCUMENT_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  assertInputSchema,
  assertJsonObject,
  assertRead,
  assertWrite,
  canRead,
  codedError,
  effectivePermissions,
  isCustomsDeclarationDocumentType,
  isProductSupplierOperatorRole,
  logServerError,
  nextStandardFilenameForUpload,
  normalizeOrderDocumentType,
  normalizeUploadSource,
  permissionError,
  deleteManagedStoredFile,
  FILE_ASSET_SOURCE_TABLES,
  findActiveFileAssetBySource,
  applyFileAssetToOrderDocument,
  managedFileMetadata,
  managedPreviewableMimeType,
  mergeFileAssetMetadata,
  readManagedUploadFile,
  refreshTaxRefundCompleteness,
  requireText,
  resolveStandardFilenameForPersistedDocument,
  runNonCriticalTask,
  SALESPERSON_TAX_REFUND_UPLOAD_DOCUMENT_TYPES,
  serializeOrderDocument,
  softDeleteFileAssetBySource,
  standardFilenameForDocument,
  syncCostInvoiceStatus,
  uploadManagedFileToStorage,
  upsertFileAssetForOrderDocument,
  writeAudit,
} from "./shared";

type OrderDocumentUploadParams = {
  orderId: string;
  documentType: string;
  file: unknown;
  costId?: string;
  supplierId?: string;
  uploadSource?: string;
};

type AuditRequestLike = Parameters<typeof writeAudit>[0];
type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
type QueryLike = Pick<URLSearchParams, "get">;
type DocumentOrderCostLike = {
  id?: string | null;
  createdById?: string | null;
  deletedAt?: unknown;
} & Record<string, unknown>;
type DocumentOrderDocumentLike = {
  relatedModule?: string | null;
  costId?: string | null;
  cost?: { createdById?: string | null } | null;
} & Record<string, unknown>;
type DocumentOrderLike = {
  id?: string | null;
  orderNo?: string | null;
  blNo?: string | null;
  billOfLadingNo?: string | null;
  taxRefundStatus?: string | null;
  customer?: { salespersonUserId?: string | null } | null;
  logisticsSuppliers?: Array<{ supplierId?: string | null } | null> | null;
  domesticLogisticsInfos?: unknown[] | null;
  costs?: DocumentOrderCostLike[] | null;
  documents?: DocumentOrderDocumentLike[] | null;
} & Record<string, unknown>;
type DocumentCostLike = {
  id?: string | null;
  createdById?: string | null;
  supplierId?: string | null;
  costType?: string | null;
  sourceType?: string | null;
  supplier?: Record<string, unknown> | null;
};
type DocumentLike = {
  id?: string | null;
  orderId?: string | null;
  documentType?: string | null;
  relatedModule?: string | null;
  costId?: string | null;
  supplierId?: string | null;
  factoryDocumentRequestId?: string | null;
  order?: DocumentOrderLike | null;
  cost?: DocumentCostLike | null;
  supplier?: Record<string, unknown> | null;
  uploadedBy?: Record<string, unknown> | null;
  uploadStatus?: string | null;
  storageKey?: string | null;
  mimeType?: string | null;
  standardFilename?: string | null;
  fileName?: string | null;
  originalName?: string | null;
  originalFilename?: string | null;
};
type ResolvedDocumentScopeInput = {
  orderId: string;
  documentType: string;
  costId?: string;
  supplierId?: string;
  uploadSource?: string;
};

function actorId(actor: ActorLike) {
  return requireText(actor?.id, "当前用户");
}

function actorRole(actor: ActorLike) {
  return String(actor?.role || "");
}

async function assertDocumentOrder(orderId: string, actor: ActorLike, documentType = "") {
  assertRead(actor, "documents");
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: {
      customer: true,
      createdBy: true,
      salesperson: true,
      logisticsSuppliers: { select: { supplierId: true } },
      costs: { where: { deletedAt: null }, select: { createdById: true, deletedAt: true } },
    },
  });
  if (!order) throw permissionError("请选择有效应收订单", 400);
  if (!canAccessOrder(actor, order) && !(canUseDomesticLogisticsDocumentScope(actor, documentType) && canAccessDomesticLogisticsOrder(actor, order))) {
    throw permissionError("无权限访问该订单单证");
  }
  return order;
}

function relatedModuleForDocumentType(documentType: string) {
  if (SUPPLIER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) return "SUPPLIER";
  if (SALES_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) return "SALES";
  return "EXPORT";
}

function canReadDocument(actor: ActorLike, document: DocumentLike) {
  if (
    isProductSupplierOperatorRole(actorRole(actor))
    && document.relatedModule === "SUPPLIER"
    && document.factoryDocumentRequestId
    && document.supplierId
    && document.supplierId === actor?.supplierId
    && canRead(actor, "supplierDocuments")
  ) {
    return true;
  }
  if (!canRead(actor, "documents")) return false;
  if (canUseDomesticLogisticsDocumentScope(actor, String(document.documentType || "")) && canAccessDomesticLogisticsOrder(actor, document.order)) return true;
  if (
    actorRole(actor) === LOGISTICS_OPERATOR_ROLE
    && document.relatedModule === "SUPPLIER"
    && document.factoryDocumentRequestId
    && document.supplierId
    && document.supplierId === actor?.supplierId
  ) {
    return true;
  }
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return true;
  if (scope === "OWN") return canAccessOrder(actor, document.order);
  if (scope === "OWN_COST") return document.relatedModule === "SUPPLIER" && document.cost?.createdById === actor?.id;
  return false;
}

function isProtectedCustomsDocumentType(documentType: unknown = "") {
  return DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(normalizeOrderDocumentType(String(documentType || "")) as OrderDocumentType);
}

function isTaxRefundUploadSource(uploadSource: unknown = "") {
  return String(uploadSource || "").trim().toUpperCase() === "REACT_TAX_REFUND";
}

function canReadProtectedCustomsDocumentContent(actor: ActorLike, document: DocumentLike) {
  if (["管理员", "财务"].includes(actorRole(actor)) || isInternalLogisticsOperator(actor)) return true;
  if (actorRole(actor) === "业务员" && canRead(actor, "documents") && canAccessOrder(actor, document.order)) return true;
  return Boolean(
    isExternalLogisticsSupplierAccount(actor)
    && canRead(actor, "documents")
    && canRead(actor, "domesticLogistics")
    && canAccessDomesticLogisticsOrder(actor, document.order)
  );
}

export function canReadDocumentContent(actor: ActorLike, document: DocumentLike) {
  if (!canReadDocument(actor, document)) return false;
  if (isProtectedCustomsDocumentType(document.documentType)) {
    return canReadProtectedCustomsDocumentContent(actor, document);
  }
  return true;
}

function orderDocumentFileInclude() {
  return Prisma.validator<Prisma.OrderDocumentInclude>()({
    order: {
      include: {
        customer: true,
        logisticsSuppliers: { select: { supplierId: true } },
        domesticLogisticsInfos: {
          include: {
            transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
          },
        },
      },
    },
    cost: { include: { supplier: true } },
    supplier: true,
    uploadedBy: true,
  });
}

async function resolveDocumentScope({ orderId, documentType, costId, supplierId, uploadSource = "" }: ResolvedDocumentScopeInput, actor: ActorLike) {
  documentType = normalizeOrderDocumentType(documentType);
  const relatedModule = relatedModuleForDocumentType(documentType);
  const order = await assertDocumentOrder(orderId, actor, documentType);
  if (["SUBMITTED", "COMPLETED", "ARCHIVED"].includes(order.taxRefundStatus)) throw permissionError("已提交退税档案只允许查看和下载资料");
  const scope = effectivePermissions(actor).dataScope;
  if (
    actorRole(actor) === "业务员"
    && isTaxRefundUploadSource(uploadSource)
    && !SALESPERSON_TAX_REFUND_UPLOAD_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)
  ) {
    throw permissionError("业务员在退税资料中只能上传本人客户的提单、装箱单、清关发票和销售合同");
  }
  if (actorRole(actor) === LOGISTICS_OPERATOR_ROLE && !DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) {
    throw permissionError("物流供应商不能上传该类资料");
  }
  if (actorRole(actor) === "财务" && DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) {
    throw permissionError("财务只负责查看和下载报关资料，不参与上传");
  }
  if (documentType === "EXPORT_INVOICE" && !["管理员", "财务"].includes(actorRole(actor))) {
    throw permissionError("出口发票由财务上传，请联系财务人员处理");
  }
  if (actorRole(actor) === "财务" && relatedModule !== "SUPPLIER" && documentType !== "EXPORT_INVOICE") {
    throw permissionError("财务只负责查看和整理出口资料，不参与上传");
  }
  if (relatedModule === "SUPPLIER") {
    if (!["ALL", "OWN_COST"].includes(scope)) throw permissionError("无权限上传供应商资料");
    const cost = await prisma.orderCost.findFirst({
      where: {
        id: requireText(costId, "成本记录"),
        orderId: order.id,
        deletedAt: null,
      },
      include: { order: true, supplier: true },
    });
    if (!cost) throw permissionError("请选择有效供应商成本记录", 400);
    if (!cost.supplierId) throw permissionError("该成本记录未关联供应商，不能上传供应商资料", 400);
    if (supplierId && supplierId !== cost.supplierId) throw permissionError("供应商与成本记录不匹配", 400);
    if (scope === "OWN_COST" && cost.createdById !== actor?.id) throw permissionError("只能维护自己录入成本对应的资料");
    return { order, relatedModule, cost, supplierId: cost.supplierId };
  }
  if (!["ALL", "OWN"].includes(scope) && !(DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(documentType as OrderDocumentType) && canAccessDomesticLogisticsOrder(actor, order))) {
    throw permissionError("无权限上传出口资料或销售合同");
  }
  return { order, relatedModule, cost: null, supplierId: null };
}

export async function listOrderDocuments(query: QueryLike, actor: ActorLike) {
  assertRead(actor, "documents");
  const orderId = query.get("orderId") || "";
  const documentType = normalizeOrderDocumentType(query.get("documentType") || "");
  const relatedModule = query.get("relatedModule") || "";
  const costId = query.get("costId") || "";
  const supplierId = query.get("supplierId") || "";
  const scope = effectivePermissions(actor).dataScope;
  const accessWhere = documentOrderListAccessWhere(actor, documentType);
  const where: Prisma.OrderDocumentWhereInput = {
    deletedAt: null,
    ...(orderId ? { orderId } : {}),
    ...(ORDER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType) ? { documentType: documentType as OrderDocumentType } : {}),
    ...(relatedModule ? { relatedModule } : {}),
    ...(costId ? { costId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...accessWhere,
    ...(scope === "OWN_COST" ? { relatedModule: "SUPPLIER", cost: { is: { createdById: actor?.id || "__no_user__" } } } : {}),
  };
  if (orderId) await assertDocumentOrder(orderId, actor, documentType);
  const rows = await prisma.orderDocument.findMany({
    where,
    include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
    orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    take: orderId ? 200 : 1000,
  });
  const documentsByOrderId = rows.reduce<Record<string, typeof rows>>((acc, document) => {
    acc[document.orderId] ||= [];
    acc[document.orderId].push(document);
    return acc;
  }, {});
  return rows.map((document) => serializeOrderDocument(document, {
    ...(document.order || {}),
    documents: documentsByOrderId[document.orderId] || [],
  }));
}

export async function uploadOrderDocument(request: AuditRequestLike, actor: ActorLike, { orderId, documentType, file, costId = "", supplierId = "", uploadSource = "" }: OrderDocumentUploadParams) {
  assertWrite(actor, "documents");
  const uploadedById = actorId(actor);
  const uploadInput = assertInputSchema(assertJsonObject({ orderId, documentType, costId, supplierId, uploadSource }), ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA);
  orderId = String(uploadInput.orderId || "");
  documentType = String(uploadInput.documentType || "");
  costId = String(uploadInput.costId || "");
  supplierId = String(uploadInput.supplierId || "");
  uploadSource = String(uploadInput.uploadSource || "");
  documentType = normalizeOrderDocumentType(documentType);
  if (!ORDER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) throw permissionError("请选择有效单证类型", 400);
  const { order, relatedModule, cost, supplierId: resolvedSupplierId } = await resolveDocumentScope({ orderId, documentType, costId, supplierId, uploadSource }, actor);
  if (isLogisticsGeneratedCostInvoice(documentType, cost)) {
    throw permissionError("物流费用发票请在物流费用模块按发票分组上传，成本管理仅同步查看。", 400);
  }
  const uploadedFile = await readManagedUploadFile(file, "pdf", "document.pdf");
  const { originalFileName, mimeType, body, fileSize } = uploadedFile;
  const standardFilename = await nextStandardFilenameForUpload(order, documentType, {
    cost,
    costId: cost?.id || "",
    supplierId: resolvedSupplierId || "",
    relatedModule,
  });
  const storageFileName = safeFileName(`${order.orderNo || order.id}_${documentType}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.pdf`);
  const storageKey = buildOrderDocumentKey({
    orderId: order.id,
    documentType,
    fileName: storageFileName,
    relatedModule,
    supplierId: resolvedSupplierId || "",
  });
  const storedFile = await uploadManagedFileToStorage({ file: uploadedFile, storageKey, fileName: standardFilename });
  let document;
  let replacedCustomsDocumentCount = 0;
  try {
    document = await prisma.$transaction(async (tx) => {
      const created = await tx.orderDocument.create({
        data: {
          orderId: order.id,
          costId: cost?.id || null,
          supplierId: resolvedSupplierId || null,
          relatedModule,
          documentType: documentType as OrderDocumentType,
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
        include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
      });
      await upsertFileAssetForOrderDocument(tx, created);
      if (isCustomsDeclarationDocumentType(documentType)) {
        const replacedAt = new Date();
        const replacedDocuments = await tx.orderDocument.findMany({
          where: {
            orderId: order.id,
            documentType: "CUSTOMS_ENTRY_FORM",
            id: { not: created.id },
            deletedAt: null,
          },
          select: { id: true, documentType: true },
          take: 20,
        });
        const replaced = await tx.orderDocument.updateMany({
          where: {
            orderId: order.id,
            documentType: "CUSTOMS_ENTRY_FORM",
            id: { not: created.id },
            deletedAt: null,
          },
          data: { deletedAt: replacedAt },
        });
        for (const replacedDocument of replacedDocuments) {
          await softDeleteFileAssetBySource(
            tx,
            FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
            replacedDocument.id,
            String(replacedDocument.documentType),
            replacedAt,
          );
        }
        replacedCustomsDocumentCount = replaced.count || 0;
      }
      return created;
    });
  } catch (error: unknown) {
    await deleteManagedStoredFile(storedFile.storageKey).catch(() => null);
    const message = error instanceof Error ? error.message : "未知错误";
    throw codedError(`数据库写入失败：${message}`, 500, "DATABASE_WRITE_FAILED");
  }
  await runNonCriticalTask("成本发票状态同步", () => syncCostInvoiceStatus(document.costId));
  const normalizedUploadSource = normalizeUploadSource(uploadSource, relatedModule);
  (document as typeof document & { uploadSource?: string }).uploadSource = normalizedUploadSource;
  const uploadAction = isCustomsDeclarationDocumentType(documentType) ? "报关单上传" : "上传文件";
  await runNonCriticalTask("文件上传操作日志写入", () => writeAudit(request, actor, uploadAction, "order_documents", document.id, null, {
    orderNo: order.orderNo,
    fileName: document.standardFilename || document.fileName,
    documentType,
    uploadSource: normalizedUploadSource,
    replacedCustomsDocumentCount,
  }));
  let customsRecognition: Record<string, unknown> | null = null;
  if (isCustomsDeclarationDocumentType(documentType)) {
    customsRecognition = await parseAndApplyCustomsDocument(request, actor, document, body, {
      allowManualFailure: true,
      replaceWithParsedFields: true,
      clearFieldsOnFailure: true,
      returnDetails: true,
    }).catch((error) => {
      logServerError("报关单自动识别异常", error, {
        orderId: order.id,
        documentId: document.id,
      });
      return {
        attempted: true,
        documentId: document.id,
        orderId: order.id,
        documentType,
        customsDeclarationNo: "",
        customsDeclarationDate: "",
        customsParseStatus: "FAILED",
        customsParseStatusLabel: "识别失败",
        customsParseMessage: "未识别成功，请手工填写报关单号和申报日期",
        applied: false,
        requiresConfirmation: false,
        conflictFields: [],
      };
    });
  }
  if (["COMMERCIAL_INVOICE", "PACKING_LIST", "CUSTOMS_ENTRY_FORM"].includes(documentType)) {
    await tryAutoShippingDocumentsNotification(request, actor, order.id);
  }
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(order.id));
  return {
    ...serializeOrderDocument(document),
    ...(customsRecognition ? { customsRecognition } : {}),
  };
}

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
    return updated;
  });
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
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(before.orderId));
  return serializeOrderDocument(document);
}

function isLogisticsGeneratedCostInvoice(documentType: string | null | undefined, cost: DocumentCostLike | null | undefined) {
  return documentType === "SUPPLIER_INVOICE" && cost?.sourceType === "LOGISTICS_EXPENSE";
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
      storageKey: fileDocument.storageKey,
      r2Bucket: fileDocument.r2Bucket,
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
  await headR2Object(fileDocument.storageKey).catch((error) => {
    if (error?.status === 404 || error?.code === "R2_OBJECT_NOT_FOUND") throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
    throw error;
  });
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
