import { prisma } from "../prisma";
import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import {
  parseCustomsDeclarationPdf,
  type CustomsDeclarationPdfTextParseResult,
} from "../pdf/parse-customs-declaration";
import { CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO } from "../customs-declaration-parser";
import { buildOrderDocumentKey, readR2Object, safeFileName } from "../r2";
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
  customsDeclarationDocumentType,
  isCustomsBatchScopedDocumentType,
  refreshCustomsDeclarationAfterOwnershipChange,
  upsertCustomsDeclarationDocumentLink,
  upsertCustomsDeclarationSupplierLink,
} from "./customs-declaration-ownership";
import { safeRefreshSupplierDocumentRequestCompletion } from "./supplier-document-request-completion";
import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  FACTORY_SUPPLIER_COST_TYPES,
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
  dateFromInput,
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
  requireText,
  resolveStandardFilenameForPersistedDocument,
  runNonCriticalTask,
  SALESPERSON_TAX_REFUND_UPLOAD_DOCUMENT_TYPES,
  scheduleTaxRefundCompletenessRefresh,
  sanitizeForLog,
  serializeCustomsRecognition,
  serializeOrderDocument,
  softDeleteFileAssetBySource,
  standardFilenameForDocument,
  syncCostInvoiceStatus,
  TAX_REFUND_SUPPLIER_TYPES,
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
  customsDeclarationId?: string;
  uploadSource?: string;
};

type AuditRequestLike = Parameters<typeof writeAudit>[0];
type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;

async function resolveUnambiguousFactoryCostForCustomsDeclaration(orderId: string) {
  const costs = await prisma.orderCost.findMany({
    where: {
      orderId,
      deletedAt: null,
      costType: { in: FACTORY_SUPPLIER_COST_TYPES },
      supplier: { is: { supplierType: { in: TAX_REFUND_SUPPLIER_TYPES } } },
    },
    select: {
      id: true,
      supplierId: true,
    },
    orderBy: [{ createdAt: "asc" }],
    take: 2,
  });
  return costs.length === 1 ? costs[0] : null;
}
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
  amount?: unknown;
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
  customsDeclarationId?: string;
  uploadSource?: string;
};
type CustomsDeclarationUploadScope = {
  id: string;
  purchaseOrderId?: string | null;
  supplierId?: string | null;
  taxArchived?: boolean | null;
  taxSubmittedAt?: Date | string | null;
  taxRefundArchivedAt?: Date | string | null;
  taxRefundStatus?: string | null;
  suppliers?: Array<{
    purchaseOrderId?: string | null;
    supplierId?: string | null;
    requiredInvoiceAmount?: unknown;
    splitAmount?: unknown;
  }>;
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
      customsDeclarations: {
        where: { deletedAt: null },
        select: { id: true },
        take: 2,
      },
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

function canReadSupplierReturnDocument(actor: ActorLike, document: DocumentLike) {
  if (
    document.relatedModule !== "SUPPLIER"
    || !document.factoryDocumentRequestId
    || !document.supplierId
  ) {
    return false;
  }
  if (
    isProductSupplierOperatorRole(actorRole(actor))
    && document.supplierId === actor?.supplierId
    && canRead(actor, "supplierDocuments")
  ) {
    return true;
  }
  if (["管理员", "财务", "采购"].includes(actorRole(actor)) && (canRead(actor, "documents") || canRead(actor, "supplierDocuments"))) {
    return true;
  }
  if (actorRole(actor) === "业务员" && canRead(actor, "documents") && canAccessOrder(actor, document.order)) {
    return true;
  }
  return false;
}

function canReadDocument(actor: ActorLike, document: DocumentLike) {
  if (canReadSupplierReturnDocument(actor, document)) return true;
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

async function resolveDocumentScope({ orderId, documentType, costId, supplierId, customsDeclarationId = "", uploadSource = "" }: ResolvedDocumentScopeInput, actor: ActorLike) {
  documentType = normalizeOrderDocumentType(documentType);
  const relatedModule = relatedModuleForDocumentType(documentType);
  const order = await assertDocumentOrder(orderId, actor, documentType);
  const batchScopedUpload = isCustomsBatchScopedDocumentType(documentType) && Boolean(customsDeclarationId);
  if (!batchScopedUpload && ["SUBMITTED", "COMPLETED", "ARCHIVED"].includes(order.taxRefundStatus)) {
    throw permissionError("已提交退税档案只允许查看和下载资料");
  }
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

function customsDeclarationAllowsSupplierCost(
  declaration: CustomsDeclarationUploadScope,
  cost: DocumentCostLike | null | undefined,
  supplierId: string | null | undefined,
) {
  const purchaseOrderIds = new Set([
    declaration.purchaseOrderId || "",
    ...(declaration.suppliers || []).map((item) => item.purchaseOrderId || ""),
  ].filter(Boolean));
  const supplierIds = new Set([
    declaration.supplierId || "",
    ...(declaration.suppliers || []).map((item) => item.supplierId || ""),
  ].filter(Boolean));
  if (!purchaseOrderIds.size && !supplierIds.size) return true;
  if (cost?.id && purchaseOrderIds.has(cost.id)) return true;
  return Boolean(supplierId && supplierIds.has(supplierId));
}

function batchSupplierInvoiceAmountForCost(
  declaration: CustomsDeclarationUploadScope | null,
  cost: DocumentCostLike | null | undefined,
  supplierId: string | null | undefined,
) {
  const linkedSupplier = (declaration?.suppliers || []).find((supplier) => {
    const purchaseOrderMatches = !supplier.purchaseOrderId || supplier.purchaseOrderId === cost?.id;
    const supplierMatches = !supplier.supplierId || supplier.supplierId === supplierId;
    return purchaseOrderMatches && supplierMatches;
  });
  const amount = Number(linkedSupplier?.requiredInvoiceAmount || linkedSupplier?.splitAmount || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : Number(cost?.amount || 0) || null;
}

function customsDeclarationUploadLocked(declaration: CustomsDeclarationUploadScope | null | undefined) {
  return Boolean(
    declaration?.taxArchived
    || declaration?.taxSubmittedAt
    || declaration?.taxRefundArchivedAt
    || declaration?.taxRefundStatus === "SUBMITTED",
  );
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

export async function uploadOrderDocument(request: AuditRequestLike, actor: ActorLike, { orderId, documentType, file, costId = "", supplierId = "", customsDeclarationId = "", uploadSource = "" }: OrderDocumentUploadParams) {
  assertWrite(actor, "documents");
  const uploadedById = actorId(actor);
  const uploadInput = assertInputSchema(assertJsonObject({ orderId, documentType, costId, supplierId, customsDeclarationId, uploadSource }), ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA);
  orderId = String(uploadInput.orderId || "");
  documentType = String(uploadInput.documentType || "");
  costId = String(uploadInput.costId || "");
  supplierId = String(uploadInput.supplierId || "");
  customsDeclarationId = String(uploadInput.customsDeclarationId || "");
  uploadSource = String(uploadInput.uploadSource || "");
  documentType = normalizeOrderDocumentType(documentType);
  if (!ORDER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) throw permissionError("请选择有效单证类型", 400);
  const { order, relatedModule, cost, supplierId: resolvedSupplierId } = await resolveDocumentScope({ orderId, documentType, costId, supplierId, customsDeclarationId, uploadSource }, actor);
  const activeDeclarationIds = (order.customsDeclarations || []).map((row) => row.id).filter(Boolean);
  if (!customsDeclarationId && isCustomsBatchScopedDocumentType(documentType) && !isCustomsDeclarationDocumentType(documentType) && activeDeclarationIds.length === 1) {
    customsDeclarationId = activeDeclarationIds[0];
  }
  if (
    !customsDeclarationId
    && isCustomsBatchScopedDocumentType(documentType)
    && !isCustomsDeclarationDocumentType(documentType)
    && activeDeclarationIds.length > 1
  ) {
    throw permissionError("一票提单多次报关时，请先选择具体报关批次后上传该资料。", 400);
  }
  let customsDeclarationScope: CustomsDeclarationUploadScope | null = null;
  if (customsDeclarationId && isCustomsBatchScopedDocumentType(documentType)) {
    customsDeclarationScope = await prisma.customsDeclaration.findFirst({
      where: { id: customsDeclarationId, orderId: order.id, deletedAt: null },
      select: {
        id: true,
        purchaseOrderId: true,
        supplierId: true,
        taxArchived: true,
        taxSubmittedAt: true,
        taxRefundArchivedAt: true,
        taxRefundStatus: true,
        suppliers: {
          where: { deletedAt: null },
          select: {
            purchaseOrderId: true,
            supplierId: true,
            requiredInvoiceAmount: true,
            splitAmount: true,
          },
          take: 200,
        },
      },
    });
    if (!customsDeclarationScope) throw permissionError("请选择有效报关批次", 400);
    if (customsDeclarationUploadLocked(customsDeclarationScope)) {
      throw permissionError("该报关批次已提交退税或已归档，不能继续上传资料。", 400);
    }
    if (
      SUPPLIER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)
      && !customsDeclarationAllowsSupplierCost(customsDeclarationScope, cost, resolvedSupplierId)
    ) {
      throw permissionError("供应商资料与所选报关批次不匹配，请选择正确批次后上传。", 400);
    }
  }
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
  let replacedSupplierDocumentRequestIds: string[] = [];
  try {
    document = await prisma.$transaction(async (tx) => {
      if (customsDeclarationId && isCustomsBatchScopedDocumentType(documentType) && !isCustomsDeclarationDocumentType(documentType)) {
        const replacedAt = new Date();
        const scopedDocumentType = customsDeclarationDocumentType(documentType);
        const previousLinks = await tx.customsDeclarationDocument.findMany({
          where: {
            customsDeclarationId,
            documentType: scopedDocumentType,
            deletedAt: null,
            ...(SUPPLIER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType) ? {
              file: {
                supplierId: resolvedSupplierId || null,
                costId: cost?.id || null,
                deletedAt: null,
              },
            } : {}),
          },
          select: { fileId: true, file: { select: { factoryDocumentRequestId: true } } },
          take: 50,
        });
        const previousFileIds = [...new Set(previousLinks.map((link) => link.fileId).filter(Boolean))];
        replacedSupplierDocumentRequestIds = previousLinks
          .map((link) => link.file?.factoryDocumentRequestId || "")
          .filter((requestId, index, arr) => requestId && arr.indexOf(requestId) === index);
        if (previousFileIds.length) {
          const sharedLinks = await tx.customsDeclarationDocument.findMany({
            where: {
              fileId: { in: previousFileIds },
              customsDeclarationId: { not: customsDeclarationId },
              deletedAt: null,
            },
            select: { fileId: true },
            take: 100,
          });
          const sharedFileIds = new Set(sharedLinks.map((link) => link.fileId));
          const unsharedFileIds = previousFileIds.filter((fileId) => !sharedFileIds.has(fileId));
          await tx.customsDeclarationDocument.updateMany({
            where: { customsDeclarationId, fileId: { in: previousFileIds }, deletedAt: null },
            data: { deletedAt: replacedAt },
          });
          if (unsharedFileIds.length) {
            await tx.orderDocument.updateMany({
              where: { id: { in: unsharedFileIds }, deletedAt: null },
              data: { deletedAt: replacedAt },
            });
          }
          for (const previousFileId of unsharedFileIds) {
            await softDeleteFileAssetBySource(
              tx,
              FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
              previousFileId,
              documentType,
              replacedAt,
            );
          }
        }
      }
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
      if (customsDeclarationId && isCustomsBatchScopedDocumentType(documentType)) {
        await upsertCustomsDeclarationDocumentLink(tx, {
          customsDeclarationId,
          documentId: created.id,
          documentType,
          uploadedByUserId: uploadedById,
          uploadedAt: created.uploadedAt,
        });
        if (SUPPLIER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType) && created.supplierId) {
          await upsertCustomsDeclarationSupplierLink(tx, {
            customsDeclarationId,
            supplierId: created.supplierId,
            purchaseOrderId: created.costId || null,
            requiredInvoiceAmount: batchSupplierInvoiceAmountForCost(customsDeclarationScope, cost, created.supplierId),
            documentType,
            documentId: created.id,
          });
        }
      }
      return created;
    });
  } catch (error: unknown) {
    await deleteManagedStoredFile(storedFile.storageKey).catch(() => null);
    const message = error instanceof Error ? error.message : "未知错误";
    throw codedError(`数据库写入失败：${message}`, 500, "DATABASE_WRITE_FAILED");
  }
  await runNonCriticalTask("成本发票状态同步", () => syncCostInvoiceStatus(document.costId));
  await Promise.all(replacedSupplierDocumentRequestIds.map((requestId) => safeRefreshSupplierDocumentRequestCompletion(requestId)));
  const normalizedUploadSource = normalizeUploadSource(uploadSource, relatedModule);
  (document as typeof document & { uploadSource?: string }).uploadSource = normalizedUploadSource;
  let customsPdfTextParse: CustomsDeclarationPdfTextParseResult | null = null;
  const uploadAction = isCustomsDeclarationDocumentType(documentType) ? "报关单上传" : "上传文件";
  await runNonCriticalTask("文件上传操作日志写入", () => writeAudit(request, actor, uploadAction, "order_documents", document.id, null, {
    orderNo: order.orderNo,
    fileName: document.standardFilename || document.fileName,
    documentType,
    uploadSource: normalizedUploadSource,
  }));
  if (isCustomsDeclarationDocumentType(documentType)) {
    const fallbackFactoryCost = cost?.id ? null : await resolveUnambiguousFactoryCostForCustomsDeclaration(order.id);
    customsPdfTextParse = await parseAndApplyUploadedCustomsDeclarationPdf(request, actor, {
      orderId: order.id,
      orderNo: order.orderNo || "",
      documentId: document.id,
      customsDeclarationId,
      purchaseOrderId: cost?.id || fallbackFactoryCost?.id || null,
      supplierId: resolvedSupplierId || fallbackFactoryCost?.supplierId || null,
      fileName: document.standardFilename || document.fileName || originalFileName,
      pdfBody: body,
    });
  }
  if (["COMMERCIAL_INVOICE", "PACKING_LIST", "CUSTOMS_ENTRY_FORM"].includes(documentType)) {
    await tryAutoShippingDocumentsNotification(request, actor, order.id);
  }
  scheduleTaxRefundCompletenessRefresh(order.id);
  if (customsDeclarationId && isCustomsBatchScopedDocumentType(documentType)) {
    await refreshCustomsDeclarationAfterOwnershipChange(customsDeclarationId);
  }
  const serializedDocument = serializeOrderDocument(document) as ReturnType<typeof serializeOrderDocument> & {
    customsPdfTextParse?: CustomsDeclarationPdfTextParseResult;
    customsDeclarationId?: string;
  };
  if (customsPdfTextParse) serializedDocument.customsPdfTextParse = customsPdfTextParse;
  if (isCustomsDeclarationDocumentType(documentType)) {
    const declaration = await prisma.customsDeclaration.findFirst({
      where: { pdfDocumentId: document.id, deletedAt: null },
      select: { id: true },
    });
    if (declaration) serializedDocument.customsDeclarationId = declaration.id;
  }
  return serializedDocument;
}

async function parseAndApplyUploadedCustomsDeclarationPdf(
  request: AuditRequestLike,
  actor: ActorLike,
  input: {
    orderId: string;
    orderNo: string;
    documentId: string;
    customsDeclarationId?: string | null;
    purchaseOrderId?: string | null;
    supplierId?: string | null;
    fileName: string;
    pdfBody: Buffer | ArrayBuffer | Uint8Array | null | undefined;
  },
) {
  const startedAt = Date.now();
  try {
    const before = await prisma.receivableOrder.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        customerId: true,
        blNo: true,
        taxRefundStatus: true,
        taxRefundCompleteness: true,
        taxRefundCompletenessUpdatedAt: true,
        taxRefundOverallCompleteness: true,
        taxRefundCompletenessIssuesSummary: true,
        taxArchived: true,
        taxRefundArchivedById: true,
        taxRefundArchivedAt: true,
        taxRefundArchiveRemark: true,
        taxSubmittedById: true,
        taxSubmittedAt: true,
        customsDeclarationNo: true,
        customsDeclarationDate: true,
        customsParsedAt: true,
        customsParseStatus: true,
        customsParseMessage: true,
        customsDeclarationParseSource: true,
      },
    });
    const parsed = await parseCustomsDeclarationPdf(input.pdfBody);
    if (!before) throw codedError("订单不存在或已删除", 404, "ORDER_NOT_FOUND");
    const parsedDate = parsed.customsDeclarationDate ? dateFromInput(parsed.customsDeclarationDate) : null;
    const orderData: Prisma.ReceivableOrderUpdateInput = {
      ...(parsed.customsDeclarationNo ? { customsDeclarationNo: parsed.customsDeclarationNo } : {}),
      ...(parsedDate ? { customsDeclarationDate: parsedDate } : {}),
      customsParsedAt: new Date(),
      customsParseStatus: parsed.customsDeclarationParseStatus,
      customsParseMessage: parsed.customsDeclarationParseMessage,
      customsDeclarationParseSource: parsed.customsDeclarationParseSource,
    };
    let replacedCustomsDeclarationPdfDocumentId = "";
    const { updated, declaration } = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.receivableOrder.update({
        where: { id: input.orderId },
        data: orderData,
        select: {
          id: true,
          customsDeclarationNo: true,
          customsDeclarationDate: true,
          customsParsedAt: true,
          customsParseStatus: true,
          customsParseMessage: true,
          customsDeclarationParseSource: true,
        },
      });
      const previousDeclaration = input.customsDeclarationId
        ? await tx.customsDeclaration.findUnique({
          where: { id: input.customsDeclarationId },
          select: {
            declarationNo: true,
            declarationDate: true,
            pdfDocumentId: true,
            purchaseOrderId: true,
            supplierId: true,
            taxRefundStatus: true,
            taxRefundCompleteness: true,
            taxRefundCompletenessUpdatedAt: true,
            taxRefundOverallCompleteness: true,
            taxRefundCompletenessIssuesSummary: true,
            taxArchived: true,
            taxRefundArchivedById: true,
            taxRefundArchivedAt: true,
            taxRefundArchiveRemark: true,
            taxSubmittedById: true,
            taxSubmittedAt: true,
          },
        })
        : null;
      let previousDeclarationPdfDocumentId = previousDeclaration?.pdfDocumentId || "";
      const declarationData = {
        customerId: before.customerId || null,
        billOfLadingNo: before.blNo || null,
        pdfDocumentId: input.documentId,
        purchaseOrderId: input.purchaseOrderId || previousDeclaration?.purchaseOrderId || null,
        supplierId: input.supplierId || previousDeclaration?.supplierId || null,
        ...((parsed.customsDeclarationNo || previousDeclaration?.declarationNo) ? { declarationNo: parsed.customsDeclarationNo || previousDeclaration?.declarationNo } : {}),
        ...((parsedDate || previousDeclaration?.declarationDate) ? { declarationDate: parsedDate || previousDeclaration?.declarationDate } : {}),
        taxRefundStatus: previousDeclaration?.taxRefundStatus || "NOT_READY",
        ...(previousDeclaration?.taxRefundCompleteness != null ? {
          taxRefundCompleteness: previousDeclaration.taxRefundCompleteness as Prisma.InputJsonValue,
        } : {}),
        taxRefundCompletenessUpdatedAt: previousDeclaration?.taxRefundCompletenessUpdatedAt || null,
        taxRefundOverallCompleteness: previousDeclaration?.taxRefundOverallCompleteness ?? null,
        taxRefundCompletenessIssuesSummary: previousDeclaration?.taxRefundCompletenessIssuesSummary || null,
        taxArchived: previousDeclaration ? Boolean(previousDeclaration.taxArchived) : false,
        taxRefundArchivedById: previousDeclaration?.taxRefundArchivedById || null,
        taxRefundArchivedAt: previousDeclaration?.taxRefundArchivedAt || null,
        taxRefundArchiveRemark: previousDeclaration?.taxRefundArchiveRemark || null,
        taxSubmittedById: previousDeclaration?.taxSubmittedById || null,
        taxSubmittedAt: previousDeclaration?.taxSubmittedAt || null,
        status: "ACTIVE",
        source: input.customsDeclarationId ? "UPLOAD" : "PDF_UPLOAD",
        deletedAt: null,
      };
      const savedDeclaration = input.customsDeclarationId
        ? await tx.customsDeclaration.update({
            where: { id: input.customsDeclarationId },
            data: declarationData,
            select: { id: true, declarationNo: true, declarationDate: true },
          })
        : await tx.customsDeclaration.create({
          data: {
            orderId: input.orderId,
            ...declarationData,
          },
          select: { id: true, declarationNo: true, declarationDate: true },
        });
      if (previousDeclarationPdfDocumentId && previousDeclarationPdfDocumentId !== input.documentId) {
        const replacedAt = new Date();
        await tx.orderDocument.updateMany({
          where: { id: previousDeclarationPdfDocumentId, deletedAt: null },
          data: { deletedAt: replacedAt },
        });
        await tx.customsDeclarationDocument.updateMany({
          where: { customsDeclarationId: savedDeclaration.id, fileId: previousDeclarationPdfDocumentId, deletedAt: null },
          data: { deletedAt: replacedAt },
        });
        await softDeleteFileAssetBySource(
          tx,
          FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
          previousDeclarationPdfDocumentId,
          "CUSTOMS_ENTRY_FORM",
          replacedAt,
        );
        replacedCustomsDeclarationPdfDocumentId = previousDeclarationPdfDocumentId;
      }
      await upsertCustomsDeclarationDocumentLink(tx, {
        customsDeclarationId: savedDeclaration.id,
        documentId: input.documentId,
        documentType: "CUSTOMS_ENTRY_FORM",
        uploadedByUserId: actor?.id || null,
        uploadedAt: new Date(),
      });
      if (input.supplierId) {
        await upsertCustomsDeclarationSupplierLink(tx, {
          customsDeclarationId: savedDeclaration.id,
          supplierId: input.supplierId,
          purchaseOrderId: input.purchaseOrderId || null,
        });
      }
      return { updated: updatedOrder, declaration: savedDeclaration };
    });
    console.info("customs-pdf-text-parse", sanitizeForLog({
      orderId: input.orderId,
      orderNo: input.orderNo,
      documentId: input.documentId,
      customsDeclarationId: declaration.id,
      fileName: input.fileName,
      textLength: parsed.textLength,
      parsedDeclarationNo: parsed.customsDeclarationNo,
      parsedDeclarationDate: parsed.customsDeclarationDate,
      parseStatus: parsed.customsDeclarationParseStatus,
      parseFailedReason: parsed.parseFailedReason || "",
      replacedCustomsDeclarationPdfDocumentId,
      durationMs: Date.now() - startedAt,
    }));
    await runNonCriticalTask("报关单PDF文本解析日志写入", () => writeAudit(
      request,
      actor,
      "报关单PDF文本解析",
      "receivable_orders",
      input.orderId,
      serializeCustomsRecognition(before || {}),
      {
        ...serializeCustomsRecognition(updated),
        customsDeclarationId: declaration.id,
        declarationNo: declaration.declarationNo || "",
        declarationDate: declaration.declarationDate || null,
        documentId: input.documentId,
        fileName: input.fileName,
        textLength: parsed.textLength,
        parsedDeclarationNo: parsed.customsDeclarationNo,
        parsedDeclarationDate: parsed.customsDeclarationDate,
        parseFailedReason: parsed.parseFailedReason || "",
      },
    ), { context: { orderId: input.orderId, documentId: input.documentId } });
    await refreshCustomsDeclarationAfterOwnershipChange(declaration.id);
    return parsed;
  } catch (error) {
    const fallbackDeclaration = await persistCustomsDeclarationPdfBindingAfterParseFailure(input, error).catch((fallbackError) => {
      logServerError("报关单PDF解析失败后的子项绑定失败", fallbackError, {
        orderId: input.orderId,
        orderNo: input.orderNo,
        documentId: input.documentId,
        customsDeclarationId: input.customsDeclarationId || "",
        fileName: input.fileName,
      });
      return null;
    });
    logServerError("报关单PDF文本解析失败", error, {
      orderId: input.orderId,
      orderNo: input.orderNo,
      documentId: input.documentId,
      customsDeclarationId: fallbackDeclaration?.id || input.customsDeclarationId || "",
      fileName: input.fileName,
      durationMs: Date.now() - startedAt,
    });
    return null;
  }
}

async function persistCustomsDeclarationPdfBindingAfterParseFailure(
  input: {
    orderId: string;
    documentId: string;
    customsDeclarationId?: string | null;
    purchaseOrderId?: string | null;
    supplierId?: string | null;
  },
  error: unknown,
) {
  const before = await prisma.receivableOrder.findUnique({
    where: { id: input.orderId },
    select: { id: true, customerId: true, blNo: true },
  });
  if (!before) return null;
  const failureMessage = error instanceof Error ? error.message : String(error || "报关单 PDF 文本解析失败");
  let replacedCustomsDeclarationPdfDocumentId = "";
  const declaration = await prisma.$transaction(async (tx) => {
    const previousDeclaration = input.customsDeclarationId
      ? await tx.customsDeclaration.findUnique({
        where: { id: input.customsDeclarationId },
        select: {
          declarationNo: true,
          declarationDate: true,
          pdfDocumentId: true,
          purchaseOrderId: true,
          supplierId: true,
          taxRefundStatus: true,
          taxRefundCompleteness: true,
          taxRefundCompletenessUpdatedAt: true,
          taxRefundOverallCompleteness: true,
          taxRefundCompletenessIssuesSummary: true,
          taxArchived: true,
          taxRefundArchivedById: true,
          taxRefundArchivedAt: true,
          taxRefundArchiveRemark: true,
          taxSubmittedById: true,
          taxSubmittedAt: true,
        },
      })
      : null;
    const declarationData = {
      customerId: before.customerId || null,
      billOfLadingNo: before.blNo || null,
      pdfDocumentId: input.documentId,
      purchaseOrderId: input.purchaseOrderId || previousDeclaration?.purchaseOrderId || null,
      supplierId: input.supplierId || previousDeclaration?.supplierId || null,
      ...(previousDeclaration?.declarationNo ? { declarationNo: previousDeclaration.declarationNo } : {}),
      ...(previousDeclaration?.declarationDate ? { declarationDate: previousDeclaration.declarationDate } : {}),
      taxRefundStatus: previousDeclaration?.taxRefundStatus || "NOT_READY",
      ...(previousDeclaration?.taxRefundCompleteness != null ? {
        taxRefundCompleteness: previousDeclaration.taxRefundCompleteness as Prisma.InputJsonValue,
      } : {}),
      taxRefundCompletenessUpdatedAt: previousDeclaration?.taxRefundCompletenessUpdatedAt || null,
      taxRefundOverallCompleteness: previousDeclaration?.taxRefundOverallCompleteness ?? null,
      taxRefundCompletenessIssuesSummary: previousDeclaration?.taxRefundCompletenessIssuesSummary || null,
      taxArchived: previousDeclaration ? Boolean(previousDeclaration.taxArchived) : false,
      taxRefundArchivedById: previousDeclaration?.taxRefundArchivedById || null,
      taxRefundArchivedAt: previousDeclaration?.taxRefundArchivedAt || null,
      taxRefundArchiveRemark: previousDeclaration?.taxRefundArchiveRemark || null,
      taxSubmittedById: previousDeclaration?.taxSubmittedById || null,
      taxSubmittedAt: previousDeclaration?.taxSubmittedAt || null,
      status: "ACTIVE",
      source: input.customsDeclarationId ? "UPLOAD_PARSE_FAILED" : "PDF_UPLOAD_PARSE_FAILED",
      deletedAt: null,
    };
    const savedDeclaration = input.customsDeclarationId
      ? await tx.customsDeclaration.update({
        where: { id: input.customsDeclarationId },
        data: declarationData,
        select: { id: true },
      })
      : await tx.customsDeclaration.create({
        data: {
          orderId: input.orderId,
          ...declarationData,
        },
        select: { id: true },
      });
    if (previousDeclaration?.pdfDocumentId && previousDeclaration.pdfDocumentId !== input.documentId) {
      const replacedAt = new Date();
      await tx.orderDocument.updateMany({
        where: { id: previousDeclaration.pdfDocumentId, deletedAt: null },
        data: { deletedAt: replacedAt },
      });
      await tx.customsDeclarationDocument.updateMany({
        where: { customsDeclarationId: savedDeclaration.id, fileId: previousDeclaration.pdfDocumentId, deletedAt: null },
        data: { deletedAt: replacedAt },
      });
      await softDeleteFileAssetBySource(
        tx,
        FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
        previousDeclaration.pdfDocumentId,
        "CUSTOMS_ENTRY_FORM",
        replacedAt,
      );
      replacedCustomsDeclarationPdfDocumentId = previousDeclaration.pdfDocumentId;
    }
    await upsertCustomsDeclarationDocumentLink(tx, {
      customsDeclarationId: savedDeclaration.id,
      documentId: input.documentId,
      documentType: "CUSTOMS_ENTRY_FORM",
    });
    if (input.supplierId) {
      await upsertCustomsDeclarationSupplierLink(tx, {
        customsDeclarationId: savedDeclaration.id,
        supplierId: input.supplierId,
        purchaseOrderId: input.purchaseOrderId || null,
      });
    }
    await tx.receivableOrder.update({
      where: { id: input.orderId },
      data: {
        customsParsedAt: new Date(),
        customsParseStatus: "FAILED",
        customsParseMessage: "报关单 PDF 文本解析失败，请手工填写报关单号和申报日期。",
        customsDeclarationParseSource: CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
      },
    });
    return savedDeclaration;
  });
  console.info("customs-pdf-text-parse-fallback-binding", sanitizeForLog({
    orderId: input.orderId,
    documentId: input.documentId,
    customsDeclarationId: declaration.id,
    replacedCustomsDeclarationPdfDocumentId,
    parseFailedReason: failureMessage,
  }));
  return declaration;
}

export async function deleteOrderDocument(request: AuditRequestLike, actor: ActorLike, id: string) {
  assertWrite(actor, "documents");
  const before = await prisma.orderDocument.findUnique({
    where: { id },
    include: {
      order: { include: { customer: true } },
      cost: true,
      supplier: true,
      uploadedBy: true,
      customsDeclarationDocuments: {
        where: { deletedAt: null },
        include: {
          customsDeclaration: {
            select: {
              taxArchived: true,
              taxSubmittedAt: true,
              taxRefundArchivedAt: true,
              taxRefundStatus: true,
            },
          },
        },
      },
    },
  });
  if (!before || before.deletedAt) throw codedError("文件不存在或已删除", 404, "DOCUMENT_NOT_FOUND");
  if (isLogisticsGeneratedCostInvoice(before.documentType, before.cost)) {
    throw permissionError("物流费用发票请在物流费用模块按发票分组删除或替换，成本管理仅同步查看。", 400);
  }
  assertCanDeleteOrderDocumentFile(actor, before);
  const deletedAt = new Date();
  let clearedCustomsRecognition = false;
  let deletedCustomsDeclarationCount = 0;
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
    await tx.customsDeclarationDocument.updateMany({
      where: { fileId: id, deletedAt: null },
      data: { deletedAt },
    });
    if (before.documentType === "SUPPLIER_PURCHASE_CONTRACT") {
      await tx.customsDeclarationSupplier.updateMany({
        where: { contractFileId: id, deletedAt: null },
        data: {
          contractFileId: null,
          contractAmount: null,
          validationStatus: "PENDING",
          validationMessage: "缺少供应商采购合同",
          manualApprovedByUserId: null,
          manualApprovedAt: null,
          manualApprovalReason: null,
        },
      });
    }
    if (before.documentType === "SUPPLIER_INVOICE") {
      await tx.customsDeclarationSupplier.updateMany({
        where: { vatInvoiceFileId: id, deletedAt: null },
        data: {
          vatInvoiceFileId: null,
          vatInvoiceAmount: null,
          validationStatus: "PENDING",
          validationMessage: "缺少供应商增值税发票",
          manualApprovedByUserId: null,
          manualApprovedAt: null,
          manualApprovalReason: null,
        },
      });
    }
    if (isCustomsDeclarationDocumentType(before.documentType)) {
      const deletedDeclarations = await tx.customsDeclaration.updateMany({
        where: { pdfDocumentId: id, deletedAt: null },
        data: {
          pdfDocumentId: null,
          status: "DELETED",
          deletedAt,
        },
      });
      deletedCustomsDeclarationCount = deletedDeclarations.count || 0;
      const remainingDeclaration = await tx.customsDeclaration.findFirst({
        where: {
          orderId: before.orderId,
          deletedAt: null,
          OR: [
            { pdfDocumentId: { not: null } },
            { declarationNo: { not: null } },
            { declarationDate: { not: null } },
          ],
        },
        select: { declarationNo: true, declarationDate: true },
        orderBy: [{ updatedAt: "desc" }],
      });
      await tx.receivableOrder.update({
        where: { id: before.orderId },
        data: remainingDeclaration
          ? {
            customsDeclarationNo: remainingDeclaration.declarationNo || null,
            customsDeclarationDate: remainingDeclaration.declarationDate || null,
          }
          : {
            customsDeclarationNo: null,
            customsDeclarationDate: null,
            customsParsedAt: null,
            customsParseStatus: null,
            customsParseMessage: null,
            customsDeclarationParseSource: null,
          },
      });
      clearedCustomsRecognition = !remainingDeclaration;
    }
    return updated;
  });
  await runNonCriticalTask("成本发票状态同步", () => syncCostInvoiceStatus(before.costId));
  await runNonCriticalTask("文件删除操作日志写入", () => writeAudit(request, actor, "删除文件", "order_documents", id, before, {
    orderNo: before.order?.orderNo,
    fileName: standardFilenameForDocument(before),
    deletedCustomsDeclarationCount,
    clearedCustomsRecognition,
  }));
  scheduleTaxRefundCompletenessRefresh(before.orderId);
  const affectedDeclarations = await prisma.customsDeclarationDocument.findMany({
    where: { fileId: id },
    select: { customsDeclarationId: true },
    take: 20,
  }).catch(() => []);
  await Promise.all([...new Set(affectedDeclarations.map((row) => row.customsDeclarationId))].map((customsDeclarationId) => (
    refreshCustomsDeclarationAfterOwnershipChange(customsDeclarationId, "文件删除后报关批次完整度刷新")
  )));
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
