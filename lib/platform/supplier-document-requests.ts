import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, readR2Object, safeFileName, uploadToR2 } from "../r2";
import { NOTIFICATION_TEMPLATE_TYPES, renderNotificationTemplate, sendNotificationEmail } from "./notification-engine";
import {
  createSupplierDocumentOcrTaskForUpload,
  refreshSupplierDocumentRequestQualification,
  runSupplierDocumentOcrTask,
  serializeSupplierDocumentOcrTask,
} from "./supplier-document-ocr";
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

type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
} | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type QueryLike = Pick<URLSearchParams, "get">;
type SupplierDocumentRequestInput = Record<string, unknown>;
type SupplierDocumentUploadInput = {
  documentType: string;
  file: unknown;
  costId?: string;
};
type ExcelUploadFile = {
  originalFileName: string;
  mimeType: string;
  body: Buffer;
  fileSize: number;
};
type SupplierDocumentRequestRow = Prisma.SupplierDocumentRequestGetPayload<{
  include: ReturnType<typeof supplierDocumentRequestInclude>;
}>;
type SupplierDocumentWithOptionalOcr = SupplierDocumentRequestRow["documents"][number] & {
  ocrTasks?: unknown[];
};
type SupplierDocumentRequestWithOptionalOcr = Omit<SupplierDocumentRequestRow, "documents"> & {
  documents: SupplierDocumentWithOptionalOcr[];
};

const SUPPLIER_DOCUMENT_REQUEST_STATUSES = ["待上传", "部分上传", "已完成", "已关闭"];
const SUPPLIER_DOCUMENT_LABELS: Record<string, string> = {
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同",
  SUPPLIER_INVOICE: "工厂增值税发票",
  PURCHASE_CONTRACT: "工厂采购合同",
  VAT_INVOICE: "工厂增值税发票",
};
const SUPPLIER_DOCUMENT_EMAIL_LABELS: Record<string, string> = {
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同（盖章扫描件，PDF）",
  SUPPLIER_INVOICE: "工厂增值税发票（PDF）",
  PURCHASE_CONTRACT: "工厂采购合同（盖章扫描件，PDF）",
  VAT_INVOICE: "工厂增值税发票（PDF）",
};
const MAX_EXCEL_TEMPLATE_BYTES = 5 * 1024 * 1024;
const EXCEL_TEMPLATE_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SUPPLIER_INVOICE_SYNC_COST_LIMIT = 100;

function supplierDocumentRequestInclude() {
  return Prisma.validator<Prisma.SupplierDocumentRequestInclude>()({
    order: {
      select: {
        id: true,
        orderNo: true,
        costs: {
          where: { deletedAt: null },
          include: { supplier: true },
          orderBy: [{ createdAt: "asc" }],
        },
      },
    },
    supplier: {
      include: {
        operatorUsers: {
          where: { isActive: true, approvalStatus: "APPROVED" },
          select: { email: true, name: true },
        },
      },
    },
    requestedBy: { select: { id: true, name: true, email: true } },
    documents: {
      where: { deletedAt: null },
      include: {
        uploadedBy: true,
        supplier: true,
        cost: { include: { supplier: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    },
  });
}

function actorId(actor: ActorLike) {
  return requireText(actor?.id, "当前用户");
}

function uniqueEmails(values: unknown[] = []) {
  return values
    .map((value) => normalizeEmail(value))
    .filter((email) => email && validEmail(email))
    .filter((email, index, arr) => arr.indexOf(email) === index);
}

function requiredDocumentTypes(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const types = raw
    .map(normalizeSupplierReturnDocumentType)
    .filter((item): item is OrderDocumentType => SUPPLIER_DOCUMENT_TYPES.includes(item as OrderDocumentType));
  const unique = types.filter((item, index, arr) => arr.indexOf(item) === index);
  if (!unique.length) {
    throw codedError("请至少选择一种需要供应商回传的资料。", 400, "SUPPLIER_DOCUMENT_TYPE_REQUIRED");
  }
  return unique;
}

function normalizeSupplierReturnDocumentType(value: unknown) {
  const type = String(value || "").trim().toUpperCase();
  if (["SUPPLIER_PURCHASE_CONTRACT", "PURCHASE_CONTRACT", "FACTORY_PURCHASE_CONTRACT", "FACTORY_CONTRACT"].includes(type)) {
    return "SUPPLIER_PURCHASE_CONTRACT";
  }
  if (["SUPPLIER_INVOICE", "VAT_INVOICE", "SUPPLIER_VAT_INVOICE", "FACTORY_INVOICE", "FACTORY_VAT_INVOICE"].includes(type)) {
    return "SUPPLIER_INVOICE";
  }
  return type;
}

function factoryCostSlotsForSupplierRequest(row: Pick<SupplierDocumentRequestRow, "orderId" | "supplierId" | "order">) {
  return (row.order.costs || [])
    .filter((cost) => (
      cost.orderId === row.orderId
      && cost.supplierId === row.supplierId
      && FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType)
      && TAX_REFUND_SUPPLIER_TYPES.includes(cost.supplier?.supplierType || "")
    ))
    .map((cost, index) => ({
      id: cost.id,
      supplierId: cost.supplierId || "",
      supplierName: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "",
      costType: cost.costType,
      amount: Number(cost.amount || 0),
      amountCny: Number(cost.amountCny || 0),
      currency: cost.currency || "CNY",
      label: `工厂货款 ${index + 1}`,
    }));
}

async function resolveUniqueFactoryCostForSupplierReturn(orderId: string, supplierId: string, costId = "") {
  if (costId) {
    const cost = await prisma.orderCost.findFirst({
      where: {
        id: costId,
        orderId,
        supplierId,
        deletedAt: null,
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
      costType: { in: FACTORY_SUPPLIER_COST_TYPES },
      supplier: { is: { supplierType: { in: TAX_REFUND_SUPPLIER_TYPES } } },
    },
    select: { id: true },
    take: 2,
  });
  return costs.length === 1 ? costs[0] : null;
}

function dateFromInput(value: unknown) {
  const text = nonEmpty(value);
  if (!text) return null;
  const date = new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw codedError("截止日期格式错误", 400, "INVALID_DUE_DATE");
  return date;
}

function supplierRecipientEmails(supplier: SupplierDocumentRequestRow["supplier"]) {
  return uniqueEmails([
    ...(supplier.operatorUsers || []).map((user) => user.email),
    supplier.email,
  ]);
}

async function adminCcEmails() {
  const users = await prisma.user.findMany({
    where: { role: "管理员", isActive: true, approvalStatus: "APPROVED" },
    select: { email: true },
    take: 20,
  });
  return uniqueEmails(users.map((user) => user.email));
}

function supplierDocumentEmailLabel(type: string) {
  return SUPPLIER_DOCUMENT_EMAIL_LABELS[type] || `${SUPPLIER_DOCUMENT_LABELS[type] || type}（PDF）`;
}

function paymentVoucherAttachmentFileName(fileName = "", mimeType = "") {
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

async function latestProductSupplierPaymentVoucherAttachment(orderId: string, supplierId: string) {
  const where = {
    orderId,
    supplierId,
    deletedAt: null,
    sourceType: { not: "LOGISTICS_EXPENSE" },
    costType: { in: FACTORY_SUPPLIER_COST_TYPES },
    paymentVoucherStorageKey: { not: null },
  } as Prisma.OrderCostWhereInput;
  const orderBy = [
    { paymentVoucherUploadedAt: "desc" },
    { updatedAt: "desc" },
  ] as Prisma.OrderCostOrderByWithRelationInput[];
  const cost = await prisma.orderCost.findFirst({ where, orderBy });
  const voucherCost = cost as typeof cost & {
    paymentVoucherStorageKey?: string | null;
    paymentVoucherFileName?: string | null;
    paymentVoucherMimeType?: string | null;
  };
  if (!voucherCost?.paymentVoucherStorageKey) return null;
  const asset = await findActiveFileAssetBySource(
    FILE_ASSET_SOURCE_TABLES.ORDER_COSTS,
    voucherCost.id,
    FILE_ASSET_ROLES.PAYMENT_VOUCHER,
  );
  const storageKey = asset?.storageKey || voucherCost.paymentVoucherStorageKey;
  const content = await readR2Object(storageKey).catch((error) => {
    logServerError("产品供应商资料回传通知付款凭证读取失败", error, { orderId, supplierId, costId: cost?.id || "" });
    return null;
  });
  if (!content) return null;
  const contentType = asset?.mimeType || voucherCost.paymentVoucherMimeType || "image/jpeg";
  return {
    filename: paymentVoucherAttachmentFileName(asset?.fileName || voucherCost.paymentVoucherFileName || "", contentType),
    content,
    contentType,
  };
}

function supplierDocumentRequestTemplateVariables({
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

async function readValidatedExcelTemplate(file: unknown): Promise<ExcelUploadFile | null> {
  if (!file || !(file instanceof File) || !file.size) return null;
  const originalFileName = safeFileName(file.name || "factory-document-template.xlsx");
  const lowerName = originalFileName.toLowerCase();
  if (!lowerName.endsWith(".xlsx")) {
    throw codedError("合同样本仅支持 .xlsx Excel 文件，不能上传含宏或其它格式。", 400, "INVALID_TEMPLATE_TYPE");
  }
  if (Number(file.size || 0) > MAX_EXCEL_TEMPLATE_BYTES) {
    throw codedError("合同样本文件大小不能超过 5MB", 413, "TEMPLATE_FILE_TOO_LARGE");
  }
  const body = Buffer.from(await file.arrayBuffer());
  if (body.byteLength > MAX_EXCEL_TEMPLATE_BYTES) {
    throw codedError("合同样本文件大小不能超过 5MB", 413, "TEMPLATE_FILE_TOO_LARGE");
  }
  const signature = body.subarray(0, 4).toString("hex");
  if (signature !== "504b0304") {
    throw codedError("合同样本格式错误，只能上传有效 .xlsx 文件。", 400, "INVALID_TEMPLATE_SIGNATURE");
  }
  return {
    originalFileName,
    mimeType: file.type || EXCEL_TEMPLATE_MIME,
    body,
    fileSize: Number(file.size || body.byteLength),
  };
}

function serializeSupplierDocumentRequest(row: SupplierDocumentRequestWithOptionalOcr, actor: ActorLike) {
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  const documents = (row.documents || [])
    .filter((document) => requiredTypes.includes(normalizeSupplierReturnDocumentType(document.documentType) as OrderDocumentType))
    .map((document) => serializeSupplierDocument(document));
  const factoryCostSlots = factoryCostSlotsForSupplierRequest(row);
  const canDelete = actor?.role === "管理员"
    && row.status === "待上传"
    && !supplierDocumentRequestHasStartedUpload(row);
  return {
    id: row.id,
    orderId: row.orderId,
    orderNo: row.order?.orderNo || "",
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
    requestedByName: isProductSupplierOperatorRole(actor?.role) ? "" : (row.requestedBy?.name || ""),
    canDelete,
    documents,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function attachSupplierDocumentOcrTasks(rows: SupplierDocumentRequestRow[]): Promise<SupplierDocumentRequestWithOptionalOcr[]> {
  const documentIds = rows
    .flatMap((row) => row.documents || [])
    .map((document) => document.id)
    .filter(Boolean);
  if (!documentIds.length) {
    return rows.map((row) => ({
      ...row,
      documents: (row.documents || []).map((document) => ({ ...document, ocrTasks: [] })),
    }));
  }
  try {
    const tasks = await prisma.ocrTask.findMany({
      where: { documentId: { in: documentIds } },
      include: { results: true },
      orderBy: [{ createdAt: "desc" }],
      take: Math.min(Math.max(documentIds.length * 3, 20), 500),
    });
    const latestByDocumentId = new Map<string, unknown>();
    for (const task of tasks) {
      if (!latestByDocumentId.has(task.documentId)) latestByDocumentId.set(task.documentId, task);
    }
    return rows.map((row) => ({
      ...row,
      documents: (row.documents || []).map((document) => ({
        ...document,
        ocrTasks: latestByDocumentId.has(document.id) ? [latestByDocumentId.get(document.id)] : [],
      })),
    }));
  } catch (error: unknown) {
    logServerError("供应商资料回传OCR状态读取失败，已跳过OCR附加信息", error, { documentCount: documentIds.length });
    return rows.map((row) => ({
      ...row,
      documents: (row.documents || []).map((document) => ({ ...document, ocrTasks: [] })),
    }));
  }
}

function serializeSupplierDocument(document: unknown) {
  const row = serializeOrderDocument(document);
  const documentRecord = document as { ocrTasks?: unknown[] } | null | undefined;
  const ocrTask = Array.isArray(documentRecord?.ocrTasks)
    ? serializeSupplierDocumentOcrTask(documentRecord.ocrTasks[0] as Parameters<typeof serializeSupplierDocumentOcrTask>[0])
    : null;
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
    ocrTask,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function refreshSupplierDocumentRequestStatus(tx: Prisma.TransactionClient, requestId: string) {
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
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  const uploadedTypes = new Set(row.documents.map((document) => normalizeSupplierReturnDocumentType(document.documentType)));
  const nextStatus = requiredTypes.every((type) => uploadedTypes.has(type))
    ? "已完成"
    : uploadedTypes.size
      ? "部分上传"
      : "待上传";
  return tx.supplierDocumentRequest.update({
    where: { id: requestId },
    data: { status: nextStatus },
  });
}

function supplierDocumentRequestHasStartedUpload(row: Pick<SupplierDocumentRequestRow, "documents">) {
  return (row.documents || []).some((document) => {
    if (document.deletedAt) return false;
    const uploadStatus = String(document.uploadStatus || "PENDING");
    const uploadProgress = Number(document.uploadProgress || 0);
    return uploadStatus !== "PENDING" || uploadProgress > 0;
  });
}

async function loadSupplierDocumentRequest(id: string, actor: ActorLike) {
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
  const [rowWithOcr] = await attachSupplierDocumentOcrTasks([row]);
  return rowWithOcr;
}

export async function listSupplierDocumentRequests(query: QueryLike, actor: ActorLike) {
  assertRead(actor, "supplierDocuments");
  const status = nonEmpty(query.get("status"));
  const keyword = nonEmpty(query.get("keyword") || query.get("q"));
  const { page, pageSize } = pageParams(query, 10, 50);
  const where: Prisma.SupplierDocumentRequestWhereInput = {
    deletedAt: null,
    ...(SUPPLIER_DOCUMENT_REQUEST_STATUSES.includes(status) ? { status } : {}),
    ...(isProductSupplierOperatorRole(actor?.role)
      ? {
          supplierId: actor?.supplierId || "__no_supplier_bound__",
          supplier: { allowFactoryDocumentUpload: true, status: "启用", deletedAt: null },
        }
      : {}),
    ...(keyword && !isProductSupplierOperatorRole(actor?.role)
      ? {
          OR: [
            { order: { orderNo: { contains: keyword, mode: "insensitive" } } },
            { supplier: { supplierName: { contains: keyword, mode: "insensitive" } } },
          ],
        }
      : keyword
        ? { order: { orderNo: { contains: keyword, mode: "insensitive" } } }
        : {}),
  };
  const [total, pendingCount, rows] = await Promise.all([
    prisma.supplierDocumentRequest.count({ where }),
    prisma.supplierDocumentRequest.count({
      where: {
        ...where,
        status: { not: "已完成" },
      },
    }),
    prisma.supplierDocumentRequest.findMany({
      where,
      include: supplierDocumentRequestInclude(),
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const rowsWithOcr = await attachSupplierDocumentOcrTasks(rows);
  return {
    ...pageResult(rowsWithOcr.map((row) => serializeSupplierDocumentRequest(row, actor)), total, page, pageSize),
    summary: { pendingCount },
  };
}

export async function deleteSupplierDocumentRequest(request: AuditRequestLike, actor: ActorLike, requestId: string) {
  if (actor?.role !== "管理员") {
    throw codedError("只有管理员可以删除资料回传任务。", 403, "SUPPLIER_DOCUMENT_DELETE_ADMIN_ONLY");
  }
  const row = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    include: supplierDocumentRequestInclude(),
  });
  if (!row) {
    throw codedError("资料回传任务不存在或已删除。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  }
  if (row.status !== "待上传" || supplierDocumentRequestHasStartedUpload(row)) {
    throw codedError("该任务已开始回传资料，无法删除。", 400, "SUPPLIER_DOCUMENT_REQUEST_STARTED");
  }

  const now = new Date();
  const pendingDocumentIds = (row.documents || [])
    .filter((document) => !document.deletedAt
      && String(document.uploadStatus || "PENDING") === "PENDING"
      && Number(document.uploadProgress || 0) === 0)
    .map((document) => document.id);

  await prisma.$transaction(async (tx) => {
    if (pendingDocumentIds.length) {
      await tx.orderDocument.updateMany({
        where: { id: { in: pendingDocumentIds }, deletedAt: null },
        data: { deletedAt: now },
      });
    }
    await tx.supplierDocumentRequest.update({
      where: { id: row.id },
      data: { deletedAt: now, status: "已关闭" },
    });
    if (row.templateStorageKey) {
      await softDeleteFileAssetBySource(
        tx,
        FILE_ASSET_SOURCE_TABLES.SUPPLIER_DOCUMENT_REQUESTS,
        row.id,
        FILE_ASSET_ROLES.SUPPLIER_REQUEST_TEMPLATE,
        now,
      );
    }
    for (const documentId of pendingDocumentIds) {
      await softDeleteFileAssetBySource(
        tx,
        FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
        documentId,
        "SUPPLIER_PURCHASE_CONTRACT",
        now,
      );
      await softDeleteFileAssetBySource(
        tx,
        FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
        documentId,
        "SUPPLIER_INVOICE",
        now,
      );
    }
  });

  if (row.templateStorageKey) {
    await runNonCriticalTask("资料回传合同样本文件删除", () => deleteR2Object(row.templateStorageKey || ""));
  }
  await runNonCriticalTask("资料回传任务删除日志写入", () => writeAudit(request, actor, "删除资料回传任务", "supplier_document_requests", row.id, row, {
    orderNo: row.order?.orderNo,
    supplierId: row.supplierId,
    pendingDocumentIds,
  }));
  return { id: row.id, deletedDocumentIds: pendingDocumentIds };
}

export async function createSupplierDocumentRequest(request: AuditRequestLike, actor: ActorLike, input: SupplierDocumentRequestInput, templateFile: unknown) {
  assertWrite(actor, "taxRefund");
  const requestedById = actorId(actor);
  const orderId = requireText(input.orderId, "订单");
  const supplierId = requireText(input.supplierId, "供应商");
  const requiredTypes = requiredDocumentTypes(input.requiredDocumentTypes);
  const dueDate = dateFromInput(input.dueDate);
  const message = nonEmpty(input.message).slice(0, 1000);
  const [order, supplier, template] = await Promise.all([
    prisma.receivableOrder.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, orderNo: true },
    }),
    prisma.supplier.findFirst({
      where: { id: supplierId, deletedAt: null },
      include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { email: true, name: true } } },
    }),
    readValidatedExcelTemplate(templateFile),
  ]);
  if (!order) throw codedError("请选择有效订单。", 404, "ORDER_NOT_FOUND");
  if (!supplier) throw codedError("请选择有效供应商。", 404, "SUPPLIER_NOT_FOUND");
  if (supplier.status !== "启用") throw codedError("供应商已停用，不能通知回传资料。", 400, "SUPPLIER_DISABLED");
  if (!isProductSupplierType(supplier.supplierType)) throw codedError("资料回传只允许通知产品供应商。", 400, "SUPPLIER_TYPE_NOT_ALLOWED");
  if (!supplier.allowFactoryDocumentUpload) throw codedError("该供应商未开启资料回传权限，请先到系统设置开启。", 400, "SUPPLIER_DOCUMENT_UPLOAD_DISABLED");

  const recipients = supplierRecipientEmails({ ...supplier, operatorUsers: supplier.operatorUsers });
  if (!recipients.length) throw codedError("供应商未配置有效邮箱或绑定账号邮箱，不能发送回传通知。", 400, "SUPPLIER_EMAIL_REQUIRED");
  const ccEmails = await adminCcEmails();
  let templateStorageKey = "";
  let templateBucket = "";
  let templateFileName = "";
  if (template) {
    const { bucket } = ensureR2Configured();
    templateBucket = bucket;
    templateFileName = safeFileName(`factory-document-template-${order.orderNo || order.id}-${Date.now()}.xlsx`);
    templateStorageKey = buildOrderDocumentKey({
      orderId: order.id,
      documentType: "SUPPLIER_PURCHASE_CONTRACT_TEMPLATE",
      relatedModule: "SUPPLIER",
      supplierId: supplier.id,
      fileName: templateFileName,
    });
    await uploadToR2({ key: templateStorageKey, body: template.body, contentType: template.mimeType });
  }

  const companyProfile = await runNonCriticalTask("公司资料读取", () => getCompanyProfileSettings());
  const companyName = companyProfile?.companyNameZh || DEFAULT_COMPANY_PROFILE_SETTINGS.companyNameZh;
  const paymentVoucherAttachment = await latestProductSupplierPaymentVoucherAttachment(order.id, supplier.id);
  const templateVariables = supplierDocumentRequestTemplateVariables({
    supplierName: supplier.supplierName,
    orderNo: order.orderNo || order.id,
    requiredTypes,
    dueDate,
    templateAttached: Boolean(template),
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
      const saved = await tx.supplierDocumentRequest.create({
        data: {
          orderId: order.id,
          supplierId: supplier.id,
          requestedById,
          requiredDocumentTypes: requiredTypes,
          status: "待上传",
          dueDate,
          message: message || null,
          templateFileName: templateFileName || null,
          templateOriginalName: template?.originalFileName || null,
          templateMimeType: template?.mimeType || null,
          templateFileSize: template?.fileSize || null,
          templateStorageKey: templateStorageKey || null,
          templateBucket: templateBucket || null,
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
    });
  } catch (error: unknown) {
    if (templateStorageKey) await deleteR2Object(templateStorageKey).catch(() => null);
    throw error;
  }

  try {
    const attachments = [
      ...(template ? [{ filename: template.originalFileName, content: template.body, contentType: template.mimeType }] : []),
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
    supplierId: supplier.id,
    requiredDocumentTypes: requiredTypes,
    sendStatus: created.sendStatus,
  }));
  return serializeSupplierDocumentRequest(created, actor);
}

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
      void runNonCriticalTask("产品供应商回传资料OCR识别", async () => {
        await runSupplierDocumentOcrTask(ocrTask.id);
      }, { context: { documentId: document.id, requestId: row.id, documentType }, slowMs: 3000 });
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

export async function getSupplierDocumentRequestTemplate(request: AuditRequestLike, actor: ActorLike, requestId: string) {
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
  const storageKey = asset?.storageKey || row.templateStorageKey;
  const body = await readR2Object(storageKey).catch((error) => {
    if (error?.status === 404 || error?.code === "R2_OBJECT_NOT_FOUND") {
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
      storageKey: asset?.storageKey || row.templateStorageKey,
      bucket: asset?.bucket || row.templateBucket,
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
