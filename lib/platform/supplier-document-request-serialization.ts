import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, readR2Object, safeFileName, uploadToR2 } from "../r2";
import { NOTIFICATION_TEMPLATE_TYPES, renderNotificationTemplate, sendNotificationEmail } from "./notification-engine";
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
import { businessEntityFieldsFromOrder } from "./business-entities";
import {
  EXCEL_TEMPLATE_MIME,
  LEGACY_EXCEL_TEMPLATE_MIME,
  MAX_EXCEL_TEMPLATE_BYTES,
  SUPPLIER_DOCUMENT_REQUEST_STATUSES,
  SUPPLIER_DOCUMENT_EMAIL_LABELS,
  SUPPLIER_DOCUMENT_LABELS,
  actorId,
  factoryCostSlotsForSupplierRequest,
  normalizeSupplierReturnDocumentType,
  requiredDocumentTypes,
  supplierDocumentRequestFactoryCostInclude,
  supplierDocumentRequestFactoryCostWhere,
  supplierDocumentRequestInclude,
  uniqueEmails,
  type ActorLike,
  type ExcelUploadFile,
  type FactorySupplierReturnCost,
  type SupplierDocumentRequestInput,
  type SupplierDocumentRequestRow,
} from "./supplier-document-request-types";

export {
  actorId,
  factoryCostSlotsForSupplierRequest,
  normalizeSupplierReturnDocumentType,
  requiredDocumentTypes,
  uniqueEmails,
} from "./supplier-document-request-types";

export async function resolveUniqueFactoryCostForSupplierReturn(orderId: string, supplierId: string, costId = "") {
  if (costId) {
    const cost = await prisma.orderCost.findFirst({
      where: {
        id: costId,
        orderId,
        supplierId,
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
        costType: { in: FACTORY_SUPPLIER_COST_TYPES },
        supplier: { is: { supplierType: { in: TAX_REFUND_SUPPLIER_TYPES } } },
      },
      select: { id: true },
    });
    if (!cost) throw codedError("请选择有效工厂货款资料位。", 400, "FACTORY_COST_SLOT_NOT_FOUND");
    return cost;
  }
  const costs = await prisma.orderCost.findMany({
    where: {
      orderId,
      supplierId,
      deletedAt: null,
      status: { not: ORDER_COST_STATUS_VOID },
      costType: { in: FACTORY_SUPPLIER_COST_TYPES },
      supplier: { is: { supplierType: { in: TAX_REFUND_SUPPLIER_TYPES } } },
    },
    select: { id: true },
    take: 2,
  });
  return costs.length === 1 ? costs[0] : null;
}

export async function loadFactorySupplierReturnCostForRequest(input: SupplierDocumentRequestInput) {
  const costId = nonEmpty(input.costId || input.factoryCostId);
  const orderId = nonEmpty(input.orderId);
  const supplierId = nonEmpty(input.supplierId);
  if (!costId && (!orderId || !supplierId)) {
    throw codedError("请先选择已登记的工厂供应商成本。", 400, "FACTORY_COST_REQUIRED");
  }
  const cost = await prisma.orderCost.findFirst({
    where: supplierDocumentRequestFactoryCostWhere({ costId, orderId, supplierId }),
    include: supplierDocumentRequestFactoryCostInclude(),
    orderBy: [{ createdAt: "desc" }],
  });
  if (!cost) {
    throw codedError("请先在成本管理登记该订单的工厂供应商成本，再创建资料回传任务。", 400, "FACTORY_COST_REQUIRED");
  }
  return cost;
}

export function dateFromInput(value: unknown) {
  const text = nonEmpty(value);
  if (!text) return null;
  const date = new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw codedError("截止日期格式错误", 400, "INVALID_DUE_DATE");
  return date;
}

export function supplierRecipientEmails(supplier: SupplierDocumentRequestRow["supplier"]) {
  return uniqueEmails([
    ...(supplier.operatorUsers || []).map((user) => user.email),
    supplier.email,
  ]);
}

export async function adminCcEmails() {
  const users = await prisma.user.findMany({
    where: { role: "管理员", isActive: true, approvalStatus: "APPROVED" },
    select: { email: true },
    take: 20,
  });
  return uniqueEmails(users.map((user) => user.email));
}

export function supplierDocumentEmailLabel(type: string) {
  return SUPPLIER_DOCUMENT_EMAIL_LABELS[type] || `${SUPPLIER_DOCUMENT_LABELS[type] || type}（PDF）`;
}

export function paymentVoucherAttachmentFileName(fileName = "", mimeType = "") {
  const lowerName = fileName.toLowerCase();
  const extension = lowerName.endsWith(".png")
    ? "png"
    : lowerName.endsWith(".webp")
      ? "webp"
      : mimeType === "image/png"
        ? "png"
        : mimeType === "image/webp"
          ? "webp"
          : "jpg";
  return `汇款水单.${extension}`;
}

export function isPaidFactorySupplierCost(cost: { paid?: boolean | null; paymentStatus?: string | null }) {
  return Boolean(cost.paid) || cost.paymentStatus === "已支付" || cost.paymentStatus === "部分支付";
}

export async function selectedProductSupplierPaymentVoucherAttachment(cost: FactorySupplierReturnCost) {
  if (!isPaidFactorySupplierCost(cost)) return null;
  const asset = await findActiveFileAssetBySource(
    FILE_ASSET_SOURCE_TABLES.ORDER_COSTS,
    cost.id,
    FILE_ASSET_ROLES.PAYMENT_VOUCHER,
  );
  const storageKey = asset?.storageKey || cost.paymentVoucherStorageKey || "";
  if (!storageKey) return null;
  const content = await readR2Object(storageKey).catch((error) => {
    logServerError("产品供应商资料回传通知付款凭证读取失败", error, { orderId: cost.orderId, supplierId: cost.supplierId || "", costId: cost.id });
    return null;
  });
  if (!content) return null;
  const contentType = asset?.mimeType || cost.paymentVoucherMimeType || "image/jpeg";
  return {
    filename: paymentVoucherAttachmentFileName(asset?.fileName || cost.paymentVoucherFileName || "", contentType),
    content,
    contentType,
  };
}

export async function safeSelectedProductSupplierPaymentVoucherAttachment(cost: FactorySupplierReturnCost) {
  return selectedProductSupplierPaymentVoucherAttachment(cost).catch((error) => {
    logServerError("产品供应商资料回传通知付款凭证附件准备失败，已跳过水单附件", error, {
      orderId: cost.orderId,
      supplierId: cost.supplierId || "",
      costId: cost.id,
    });
    return null;
  });
}

export function supplierDocumentRequestTemplateVariables({
  supplierName,
  orderNo,
  requiredTypes,
  dueDate,
  templateAttached,
  paymentVoucherAttached,
  companyName,
  message,
}: {
  supplierName: string;
  orderNo: string;
  requiredTypes: string[];
  dueDate: Date | null;
  templateAttached: boolean;
  paymentVoucherAttached: boolean;
  companyName: string;
  message?: string | null;
}) {
  const documentLines = requiredTypes.map((type) => `    * ${supplierDocumentEmailLabel(type)}`);
  const sampleInstruction = templateAttached
    ? "1. 本邮件已附上预填好的 Excel 合同样本，请打印合同并加盖公司公章，扫描后回传。"
    : "1. 请登录平台下载预填好的合同样本，打印合同并加盖公司公章，扫描后回传。";
  return {
    supplierName,
    orderNo,
    requiredDocumentLines: documentLines.join("\n"),
    dueDate: dueDate ? dateToInput(dueDate) : "-",
    sampleInstruction,
    paymentVoucherInstruction: paymentVoucherAttached
      ? "5. 已付款的汇款水单已随邮件附件发送，请核对后回传对应资料。"
      : "",
    messageBlock: message ? ["", "补充说明", "", message].join("\n") : "",
    companyName,
  };
}

export async function readValidatedExcelTemplate(file: unknown): Promise<ExcelUploadFile | null> {
  if (!file || !(file instanceof File) || !file.size) return null;
  const originalFileName = safeFileName(file.name || "factory-document-template.xlsx");
  const lowerName = originalFileName.toLowerCase();
  const isXlsx = lowerName.endsWith(".xlsx");
  const isXls = lowerName.endsWith(".xls");
  if (!isXlsx && !isXls) {
    throw codedError("合同样本仅支持 .xls 或 .xlsx Excel 文件，不能上传其它格式。", 400, "INVALID_TEMPLATE_TYPE");
  }
  if (Number(file.size || 0) > MAX_EXCEL_TEMPLATE_BYTES) {
    throw codedError("合同样本文件大小不能超过 4MB", 413, "TEMPLATE_FILE_TOO_LARGE");
  }
  const body = Buffer.from(await file.arrayBuffer());
  if (body.byteLength > MAX_EXCEL_TEMPLATE_BYTES) {
    throw codedError("合同样本文件大小不能超过 4MB", 413, "TEMPLATE_FILE_TOO_LARGE");
  }
  const signature = body.subarray(0, 4).toString("hex");
  if ((isXlsx && signature !== "504b0304") || (isXls && signature !== "d0cf11e0")) {
    throw codedError("合同样本格式错误，只能上传有效 .xls 或 .xlsx 文件。", 400, "INVALID_TEMPLATE_SIGNATURE");
  }
  return {
    originalFileName,
    mimeType: file.type || (isXls ? LEGACY_EXCEL_TEMPLATE_MIME : EXCEL_TEMPLATE_MIME),
    body,
    fileSize: Number(file.size || body.byteLength),
  };
}

export function serializeSupplierDocumentRequest(row: SupplierDocumentRequestRow, actor: ActorLike) {
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  const documents = (row.documents || [])
    .filter((document) => requiredTypes.includes(normalizeSupplierReturnDocumentType(document.documentType) as OrderDocumentType))
    .map((document) => serializeSupplierDocument(document));
  const factoryCostSlots = factoryCostSlotsForSupplierRequest(row);
  const canDelete = actor?.role === "管理员" && !supplierDocumentRequestOrderLocked(row.order);
  const taxRefundDocumentCount = documents.filter((document) => document.uploadStatus === "SUCCESS").length;
  return {
    id: row.id,
    orderId: row.orderId,
    purchaseOrderNo: row.purchaseOrderNo || row.order?.orderNo || "",
    orderNo: row.order?.orderNo || "",
    ...businessEntityFieldsFromOrder(row.order),
    supplierId: row.supplierId,
    supplierName: isProductSupplierOperatorRole(actor?.role) ? "" : (row.supplier?.supplierName || ""),
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
    completedByName: isProductSupplierOperatorRole(actor?.role) ? "" : (row.completedBy?.name || ""),
    requestedByName: isProductSupplierOperatorRole(actor?.role) ? "" : (row.requestedBy?.name || ""),
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

export async function refreshSupplierDocumentRequestStatus(tx: Prisma.TransactionClient, requestId: string) {
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
  const uploadedTypes = new Set(row.documents.map((document) => normalizeSupplierReturnDocumentType(document.documentType)));
  const nextStatus = uploadedTypes.size ? "部分上传" : "待上传";
  return tx.supplierDocumentRequest.update({
    where: { id: requestId },
    data: { status: nextStatus, completedAt: null, completedById: null },
  });
}

export function supplierDocumentRequestOrderLocked(order: SupplierDocumentRequestRow["order"] | null | undefined) {
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
  if (!row) throw codedError("资料回传任务不存在或无权限访问。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (isProductSupplierOperatorRole(actor?.role) && !row.supplier.allowFactoryDocumentUpload) {
    throw codedError("该供应商未开启资料回传权限。", 403, "SUPPLIER_DOCUMENT_UPLOAD_DISABLED");
  }
  await safeRefreshSupplierDocumentRequestCompletion(row.id);
  const refreshed = await prisma.supplierDocumentRequest.findFirst({
    where,
    include: supplierDocumentRequestInclude(),
  });
  if (!refreshed) throw codedError("资料回传任务不存在或无权限访问。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  return refreshed || row;
}

export function jsonStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}
