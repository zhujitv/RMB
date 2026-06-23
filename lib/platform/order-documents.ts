// @ts-nocheck
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, headR2Object, readR2Object, safeFileName, uploadToR2 } from "../r2";
import { parseAndApplyCustomsDocument } from "./customs-recognition";
import {
  canAccessDomesticLogisticsOrder,
  canUseDomesticLogisticsDocumentScope,
  documentOrderListAccessWhere,
  isExternalLogisticsSupplierAccount,
  isInternalLogisticsOperator,
} from "./masters-access";
import { canAccessOrder } from "./order-access";
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
  canWrite,
  codedError,
  effectivePermissions,
  isCustomsDeclarationDocumentType,
  logServerError,
  nextStandardFilenameForUpload,
  normalizeOrderDocumentType,
  normalizeUploadSource,
  permissionError,
  readValidatedPdfUploadFile,
  refreshTaxRefundCompleteness,
  requireText,
  resolveStandardFilenameForPersistedDocument,
  runNonCriticalTask,
  serializeOrderDocument,
  standardFilenameForDocument,
  syncCostInvoiceStatus,
  writeAudit,
} from "./shared";

async function assertDocumentOrder(orderId, actor, documentType = "") {
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

function relatedModuleForDocumentType(documentType) {
  if (SUPPLIER_DOCUMENT_TYPES.includes(documentType)) return "SUPPLIER";
  if (SALES_DOCUMENT_TYPES.includes(documentType)) return "SALES";
  return "EXPORT";
}

function canReadDocument(actor, document) {
  if (!canRead(actor, "documents")) return false;
  if (canUseDomesticLogisticsDocumentScope(actor, document.documentType) && canAccessDomesticLogisticsOrder(actor, document.order)) return true;
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return true;
  if (scope === "OWN") return canAccessOrder(actor, document.order);
  if (scope === "OWN_COST") return document.relatedModule === "SUPPLIER" && document.cost?.createdById === actor.id;
  return false;
}

function isProtectedCustomsDocumentType(documentType = "") {
  return DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(normalizeOrderDocumentType(documentType));
}

function canReadProtectedCustomsDocumentContent(actor, document) {
  if (["管理员", "财务"].includes(actor?.role) || isInternalLogisticsOperator(actor)) return true;
  return Boolean(
    isExternalLogisticsSupplierAccount(actor)
    && canRead(actor, "documents")
    && canRead(actor, "domesticLogistics")
    && canAccessDomesticLogisticsOrder(actor, document.order)
  );
}

export function canReadDocumentContent(actor, document) {
  if (!canReadDocument(actor, document)) return false;
  if (isProtectedCustomsDocumentType(document.documentType)) {
    return canReadProtectedCustomsDocumentContent(actor, document);
  }
  return true;
}

function canModifyDocument(actor, document) {
  if (!canWrite(actor, "documents")) return false;
  if (["SUBMITTED", "COMPLETED", "ARCHIVED"].includes(document.order?.taxRefundStatus)) return false;
  if (actor?.role === "业务员" && isProtectedCustomsDocumentType(document.documentType)) return false;
  if (actor?.role === LOGISTICS_OPERATOR_ROLE && DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(document.documentType)) return false;
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return true;
  if (scope === "OWN") return document.relatedModule !== "SUPPLIER" && canAccessOrder(actor, document.order);
  if (scope === "OWN_COST") return document.relatedModule === "SUPPLIER" && document.cost?.createdById === actor.id;
  return false;
}

function orderDocumentFileInclude() {
  return {
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
  };
}

async function resolveDocumentScope({ orderId, documentType, costId, supplierId }, actor) {
  documentType = normalizeOrderDocumentType(documentType);
  const relatedModule = relatedModuleForDocumentType(documentType);
  const order = await assertDocumentOrder(orderId, actor, documentType);
  if (["SUBMITTED", "COMPLETED", "ARCHIVED"].includes(order.taxRefundStatus)) throw permissionError("已提交退税档案只允许查看和下载资料");
  const scope = effectivePermissions(actor).dataScope;
  if (actor?.role === LOGISTICS_OPERATOR_ROLE && !DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(documentType)) {
    throw permissionError("物流供应商不能上传该类资料");
  }
  if (actor?.role === "财务" && DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(documentType)) {
    throw permissionError("财务只负责查看和下载报关资料，不参与上传");
  }
  if (documentType === "EXPORT_INVOICE" && !["管理员", "财务"].includes(actor?.role)) {
    throw permissionError("出口发票由财务上传，请联系财务人员处理");
  }
  if (actor?.role === "财务" && relatedModule !== "SUPPLIER" && documentType !== "EXPORT_INVOICE") {
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
    if (scope === "OWN_COST" && cost.createdById !== actor.id) throw permissionError("只能维护自己录入成本对应的资料");
    return { order, relatedModule, cost, supplierId: cost.supplierId };
  }
  if (!["ALL", "OWN"].includes(scope) && !(DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(documentType) && canAccessDomesticLogisticsOrder(actor, order))) {
    throw permissionError("无权限上传出口资料或销售合同");
  }
  return { order, relatedModule, cost: null, supplierId: null };
}

export async function listOrderDocuments(query, actor) {
  assertRead(actor, "documents");
  const orderId = query.get("orderId") || "";
  const documentType = normalizeOrderDocumentType(query.get("documentType") || "");
  const relatedModule = query.get("relatedModule") || "";
  const costId = query.get("costId") || "";
  const supplierId = query.get("supplierId") || "";
  const scope = effectivePermissions(actor).dataScope;
  const accessWhere = documentOrderListAccessWhere(actor, documentType);
  const where = {
    deletedAt: null,
    ...(orderId ? { orderId } : {}),
    ...(ORDER_DOCUMENT_TYPES.includes(documentType) ? { documentType } : {}),
    ...(relatedModule ? { relatedModule } : {}),
    ...(costId ? { costId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...accessWhere,
    ...(scope === "OWN_COST" ? { relatedModule: "SUPPLIER", cost: { is: { createdById: actor.id } } } : {}),
  };
  if (orderId) await assertDocumentOrder(orderId, actor, documentType);
  const rows = await prisma.orderDocument.findMany({
    where,
    include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
    orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
  });
  const documentsByOrderId = rows.reduce((acc, document) => {
    acc[document.orderId] ||= [];
    acc[document.orderId].push(document);
    return acc;
  }, {});
  return rows.map((document) => serializeOrderDocument(document, {
    ...(document.order || {}),
    documents: documentsByOrderId[document.orderId] || [],
  }));
}

export async function uploadOrderDocument(request, actor, { orderId, documentType, file, costId = "", supplierId = "", uploadSource = "" }) {
  assertWrite(actor, "documents");
  const uploadInput = assertInputSchema(assertJsonObject({ orderId, documentType, costId, supplierId, uploadSource }), ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA);
  orderId = uploadInput.orderId;
  documentType = uploadInput.documentType;
  costId = uploadInput.costId || "";
  supplierId = uploadInput.supplierId || "";
  uploadSource = uploadInput.uploadSource || "";
  documentType = normalizeOrderDocumentType(documentType);
  if (!ORDER_DOCUMENT_TYPES.includes(documentType)) throw permissionError("请选择有效单证类型", 400);
  const { order, relatedModule, cost, supplierId: resolvedSupplierId } = await resolveDocumentScope({ orderId, documentType, costId, supplierId }, actor);
  const { originalFileName, mimeType, body, fileSize } = await readValidatedPdfUploadFile(file, "document.pdf");
  const { bucket: r2Bucket } = ensureR2Configured();
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
  await uploadToR2({ key: storageKey, body, contentType: mimeType });
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
          documentType,
          fileName: standardFilename,
          originalName: originalFileName,
          originalFilename: originalFileName,
          standardFilename,
          fileSize,
          mimeType,
          r2Bucket,
          storageKey,
          fileUrl: null,
          uploadStatus: "SUCCESS",
          uploadProgress: 100,
          uploadedById: actor.id,
          uploadedAt: new Date(),
        },
        include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
      });
      if (isCustomsDeclarationDocumentType(documentType)) {
        const replaced = await tx.orderDocument.updateMany({
          where: {
            orderId: order.id,
            documentType: "CUSTOMS_ENTRY_FORM",
            id: { not: created.id },
            deletedAt: null,
          },
          data: { deletedAt: new Date() },
        });
        replacedCustomsDocumentCount = replaced.count || 0;
      }
      return created;
    });
  } catch (error) {
    await deleteR2Object(storageKey).catch(() => null);
    const dbError = new Error(`数据库写入失败：${error?.message || "未知错误"}`);
    dbError.status = 500;
    dbError.code = "DATABASE_WRITE_FAILED";
    throw dbError;
  }
  await runNonCriticalTask("成本发票状态同步", () => syncCostInvoiceStatus(document.costId));
  const normalizedUploadSource = normalizeUploadSource(uploadSource, relatedModule);
  document.uploadSource = normalizedUploadSource;
  const uploadAction = isCustomsDeclarationDocumentType(documentType) ? "报关单上传" : "上传文件";
  await runNonCriticalTask("文件上传操作日志写入", () => writeAudit(request, actor, uploadAction, "order_documents", document.id, null, {
    orderNo: order.orderNo,
    fileName: document.standardFilename || document.fileName,
    documentType,
    uploadSource: normalizedUploadSource,
    replacedCustomsDocumentCount,
  }));
  let customsRecognition = null;
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

export async function deleteOrderDocument(request, actor, id) {
  assertWrite(actor, "documents");
  const before = await prisma.orderDocument.findUnique({
    where: { id },
    include: { order: { include: { customer: true } }, cost: true, supplier: true, uploadedBy: true },
  });
  if (!before || before.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (!canModifyDocument(actor, before)) throw permissionError("无权限删除该订单单证");
  const document = await prisma.orderDocument.update({
    where: { id },
    data: { deletedAt: new Date() },
    include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
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

export async function getOrderDocumentDownload(request, actor, id) {
  assertRead(actor, "documents");
  const document = await prisma.orderDocument.findUnique({
    where: { id },
    include: orderDocumentFileInclude(),
  });
  if (!document || document.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (!canReadDocumentContent(actor, document)) throw permissionError("无权限下载该订单单证");
  if (document.uploadStatus !== "SUCCESS") throw permissionError("文件尚未上传成功，不能下载", 400);
  if (!document.storageKey) throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
  const standardFilename = await resolveStandardFilenameForPersistedDocument(document);
  const body = await readR2Object(document.storageKey).catch((error) => {
    if (error?.status === 404 || error?.code === "R2_OBJECT_NOT_FOUND") throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
    throw error;
  });
  await runNonCriticalTask("文件下载操作日志写入", () => writeAudit(request, actor, "下载文件", "order_documents", document.id, null, {
    orderNo: document.order?.orderNo,
    fileName: standardFilename,
  }));
  return { body, mimeType: "application/pdf", document: serializeOrderDocument({ ...document, standardFilename }) };
}

export async function getOrderDocumentMetadata(request, actor, id) {
  assertRead(actor, "documents");
  const document = await prisma.orderDocument.findUnique({
    where: { id },
    include: orderDocumentFileInclude(),
  });
  if (!document || document.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (!canReadDocumentContent(actor, document)) throw codedError("无权限查看该订单单证", 403, "PERMISSION_DENIED");
  if (document.uploadStatus !== "SUCCESS") throw permissionError("文件尚未上传成功，不能预览", 400);
  const standardFilename = await resolveStandardFilenameForPersistedDocument(document);
  return serializeOrderDocument({ ...document, standardFilename });
}

export async function getOrderDocumentPreviewMetadata(request, actor, id) {
  assertRead(actor, "documents");
  const document = await prisma.orderDocument.findUnique({
    where: { id },
    include: orderDocumentFileInclude(),
  });
  if (!document || document.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (!canReadDocumentContent(actor, document)) throw codedError("无权限预览该订单单证", 403, "PERMISSION_DENIED");
  if (document.uploadStatus !== "SUCCESS") throw codedError("文件尚未上传成功，不能预览", 400, "DOCUMENT_NOT_FOUND");
  const mimeType = String(document.mimeType || "application/pdf").toLowerCase();
  if (mimeType !== "application/pdf") {
    throw codedError("该文件类型暂不支持在线预览", 400, "INVALID_FILE_TYPE");
  }
  if (!document.storageKey) throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
  await headR2Object(document.storageKey).catch((error) => {
    if (error?.status === 404 || error?.code === "R2_OBJECT_NOT_FOUND") throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
    throw error;
  });
  const standardFilename = await resolveStandardFilenameForPersistedDocument(document);
  return serializeOrderDocument({ ...document, standardFilename });
}

export async function getOrderDocumentPreview(request, actor, id) {
  assertRead(actor, "documents");
  const document = await prisma.orderDocument.findUnique({
    where: { id },
    include: orderDocumentFileInclude(),
  });
  if (!document || document.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (!canReadDocumentContent(actor, document)) throw codedError("无权限预览该订单单证", 403, "PERMISSION_DENIED");
  if (document.uploadStatus !== "SUCCESS") throw codedError("文件尚未上传成功，不能预览", 400, "DOCUMENT_NOT_FOUND");
  const mimeType = String(document.mimeType || "application/pdf").toLowerCase();
  if (mimeType !== "application/pdf") {
    throw codedError("该文件类型暂不支持在线预览", 400, "INVALID_FILE_TYPE");
  }
  if (!document.storageKey) throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
  const body = await readR2Object(document.storageKey).catch((error) => {
    if (error?.status === 404 || error?.code === "R2_OBJECT_NOT_FOUND") throw codedError("文件不存在或已删除", 404, "R2_OBJECT_NOT_FOUND");
    throw error;
  });
  const standardFilename = await resolveStandardFilenameForPersistedDocument(document);
  await runNonCriticalTask("文件预览操作日志写入", () => writeAudit(request, actor, "预览文件", "order_documents", document.id, null, {
    orderNo: document.order?.orderNo,
    fileName: standardFilename,
  }));
  return { body, mimeType: "application/pdf", document: serializeOrderDocument({ ...document, standardFilename }) };
}
