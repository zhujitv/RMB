import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, readR2Object, safeFileName, uploadToR2 } from "../r2";
import { sendShippingDocumentsEmail } from "./shipping-documents";
import {
  FACTORY_SUPPLIER_OPERATOR_ROLE,
  SUPPLIER_DOCUMENT_TYPES,
  assertRead,
  assertWrite,
  codedError,
  dateToInput,
  logServerError,
  nonEmpty,
  normalizeEmail,
  readValidatedPdfUploadFile,
  refreshTaxRefundCompleteness,
  requireText,
  runNonCriticalTask,
  serializeOrderDocument,
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

const SUPPLIER_DOCUMENT_REQUEST_STATUSES = ["待上传", "部分上传", "已完成", "已关闭"];
const SUPPLIER_DOCUMENT_LABELS: Record<string, string> = {
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同",
  SUPPLIER_INVOICE: "工厂增值税发票",
};
const MAX_EXCEL_TEMPLATE_BYTES = 5 * 1024 * 1024;
const EXCEL_TEMPLATE_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function supplierDocumentRequestInclude() {
  return Prisma.validator<Prisma.SupplierDocumentRequestInclude>()({
    order: { select: { id: true, orderNo: true } },
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
      include: { uploadedBy: true, supplier: true },
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
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item): item is OrderDocumentType => SUPPLIER_DOCUMENT_TYPES.includes(item as OrderDocumentType));
  const unique = types.filter((item, index, arr) => arr.indexOf(item) === index);
  if (!unique.length) {
    throw codedError("请至少选择一种需要供应商回传的资料。", 400, "SUPPLIER_DOCUMENT_TYPE_REQUIRED");
  }
  return unique;
}

function dateFromInput(value: unknown) {
  const text = nonEmpty(value);
  if (!text) return null;
  const date = new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw codedError("截止日期格式错误", 400, "INVALID_DUE_DATE");
  return date;
}

function appEntryUrl() {
  return process.env.NEXT_PUBLIC_APP_URL
    || process.env.APP_URL
    || process.env.NEXTAUTH_URL
    || "";
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

function serializeSupplierDocumentRequest(row: SupplierDocumentRequestRow, actor: ActorLike) {
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  const documents = (row.documents || [])
    .filter((document) => requiredTypes.includes(document.documentType))
    .map((document) => serializeSupplierDocument(document));
  return {
    id: row.id,
    orderId: row.orderId,
    orderNo: row.order?.orderNo || "",
    supplierId: row.supplierId,
    supplierName: actor?.role === FACTORY_SUPPLIER_OPERATOR_ROLE ? "" : (row.supplier?.supplierName || ""),
    requiredDocumentTypes: requiredTypes,
    requiredDocumentLabels: requiredTypes.map((type) => SUPPLIER_DOCUMENT_LABELS[type] || type),
    status: SUPPLIER_DOCUMENT_REQUEST_STATUSES.includes(row.status) ? row.status : "待上传",
    dueDate: dateToInput(row.dueDate),
    message: row.message || "",
    templateFileName: row.templateOriginalName || row.templateFileName || "",
    hasTemplate: Boolean(row.templateStorageKey),
    sendStatus: row.sendStatus || "pending",
    sendError: row.sendError || "",
    sentAt: row.sentAt,
    requestedByName: actor?.role === FACTORY_SUPPLIER_OPERATOR_ROLE ? "" : (row.requestedBy?.name || ""),
    documents,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeSupplierDocument(document: unknown) {
  const row = serializeOrderDocument(document);
  return {
    id: row.id,
    orderId: row.orderId,
    supplierId: row.supplierId,
    factoryDocumentRequestId: row.factoryDocumentRequestId,
    relatedModule: row.relatedModule,
    documentType: row.documentType,
    documentTypeLabel: row.documentTypeLabel,
    fileName: row.fileName,
    displayFileName: row.displayFileName,
    downloadFileName: row.downloadFileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    uploadStatus: row.uploadStatus,
    uploadStatusLabel: row.uploadStatusLabel,
    uploadedByName: row.uploadedByName,
    uploadedAt: row.uploadedAt,
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
  const uploadedTypes = new Set(row.documents.map((document) => document.documentType));
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

async function loadSupplierDocumentRequest(id: string, actor: ActorLike) {
  const where: Prisma.SupplierDocumentRequestWhereInput = {
    id,
    deletedAt: null,
    ...(actor?.role === FACTORY_SUPPLIER_OPERATOR_ROLE
      ? { supplierId: actor.supplierId || "__no_supplier_bound__" }
      : {}),
  };
  const row = await prisma.supplierDocumentRequest.findFirst({
    where,
    include: supplierDocumentRequestInclude(),
  });
  if (!row) throw codedError("资料回传任务不存在或无权限访问。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (actor?.role === FACTORY_SUPPLIER_OPERATOR_ROLE && !row.supplier.allowFactoryDocumentUpload) {
    throw codedError("该供应商未开启资料回传权限。", 403, "SUPPLIER_DOCUMENT_UPLOAD_DISABLED");
  }
  return row;
}

export async function listSupplierDocumentRequests(query: QueryLike, actor: ActorLike) {
  assertRead(actor, "supplierDocuments");
  const status = nonEmpty(query.get("status"));
  const keyword = nonEmpty(query.get("keyword") || query.get("q"));
  const where: Prisma.SupplierDocumentRequestWhereInput = {
    deletedAt: null,
    ...(SUPPLIER_DOCUMENT_REQUEST_STATUSES.includes(status) ? { status } : {}),
    ...(actor?.role === FACTORY_SUPPLIER_OPERATOR_ROLE
      ? {
          supplierId: actor.supplierId || "__no_supplier_bound__",
          supplier: { allowFactoryDocumentUpload: true, status: "启用", deletedAt: null },
        }
      : {}),
    ...(keyword && actor?.role !== FACTORY_SUPPLIER_OPERATOR_ROLE
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
  const rows = await prisma.supplierDocumentRequest.findMany({
    where,
    include: supplierDocumentRequestInclude(),
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
  return rows.map((row) => serializeSupplierDocumentRequest(row, actor));
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
  if (supplier.supplierType !== "工厂供应商") throw codedError("资料回传只允许通知工厂供应商。", 400, "SUPPLIER_TYPE_NOT_ALLOWED");
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

  const subject = `NEXTWOOD 工厂资料回传通知：${order.orderNo}`;
  const uploadUrl = appEntryUrl();
  const body = [
    `${supplier.supplierName}：`,
    "",
    `订单号：${order.orderNo || order.id}`,
    `需要回传资料：${requiredTypes.map((type) => SUPPLIER_DOCUMENT_LABELS[type] || type).join("、")}`,
    dueDate ? `截止日期：${dateToInput(dueDate)}` : "",
    "",
    "请登录 NEXTWOOD 供应链协同平台，在“资料回传”中下载合同样本，盖章扫描后上传 PDF；增值税发票也请上传 PDF。",
    uploadUrl ? `平台入口：${uploadUrl}` : "",
    template ? "本邮件已附上预填 Excel 合同样本，请下载填写/盖章后回传扫描件。" : "",
    message ? `备注：${message}` : "",
    "",
    "本通知不包含客户信息，请按订单号处理。",
  ].filter((line) => line !== "").join("\n");

  let created;
  try {
    created = await prisma.supplierDocumentRequest.create({
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
  } catch (error: unknown) {
    if (templateStorageKey) await deleteR2Object(templateStorageKey).catch(() => null);
    throw error;
  }

  try {
    await sendShippingDocumentsEmail({
      recipientEmails: recipients,
      ccEmails,
      subject,
      body,
      notificationId: created.id,
      attachments: template ? [{ filename: template.originalFileName, content: template.body, contentType: template.mimeType }] : [],
    });
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
  const documentType = nonEmpty(input.documentType).toUpperCase() as OrderDocumentType;
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  if (!requiredTypes.includes(documentType)) {
    throw codedError("该任务不需要上传此类资料。", 400, "DOCUMENT_TYPE_NOT_ALLOWED");
  }
  const { originalFileName, mimeType, body, fileSize } = await readValidatedPdfUploadFile(input.file, "supplier-document.pdf");
  const { bucket: r2Bucket } = ensureR2Configured();
  const standardFilename = `${row.order.orderNo || row.orderId}_${SUPPLIER_DOCUMENT_LABELS[documentType] || documentType}.pdf`;
  const storageFileName = safeFileName(`${row.order.orderNo || row.orderId}_${documentType}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.pdf`);
  const storageKey = buildOrderDocumentKey({
    orderId: row.orderId,
    documentType,
    relatedModule: "SUPPLIER",
    supplierId: row.supplierId,
    fileName: storageFileName,
  });
  await uploadToR2({ key: storageKey, body, contentType: mimeType });
  let document;
  try {
    document = await prisma.$transaction(async (tx) => {
      const created = await tx.orderDocument.create({
        data: {
          orderId: row.orderId,
          costId: null,
          supplierId: row.supplierId,
          factoryDocumentRequestId: row.id,
          relatedModule: "SUPPLIER",
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
          uploadedById,
          uploadedAt: new Date(),
        },
        include: { uploadedBy: true, supplier: true },
      });
      await refreshSupplierDocumentRequestStatus(tx, row.id);
      return created;
    });
  } catch (error: unknown) {
    await deleteR2Object(storageKey).catch(() => null);
    throw error;
  }
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(row.orderId));
  await runNonCriticalTask("供应商回传资料日志写入", () => writeAudit(request, actor, "供应商上传回传资料", "order_documents", document.id, null, {
    orderNo: row.order.orderNo,
    supplierId: row.supplierId,
    documentType,
    requestId: row.id,
  }));
  const refreshed = await loadSupplierDocumentRequest(row.id, actor);
  return {
    request: serializeSupplierDocumentRequest(refreshed, actor),
    document: serializeSupplierDocument(document),
  };
}

export async function getSupplierDocumentRequestTemplate(request: AuditRequestLike, actor: ActorLike, requestId: string) {
  assertRead(actor, "supplierDocuments");
  const row = await loadSupplierDocumentRequest(requestId, actor);
  if (!row.templateStorageKey) {
    throw codedError("该任务没有合同样本文件。", 404, "TEMPLATE_NOT_FOUND");
  }
  const body = await readR2Object(row.templateStorageKey).catch((error) => {
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
    mimeType: row.templateMimeType || EXCEL_TEMPLATE_MIME,
    fileName: row.templateOriginalName || row.templateFileName || "factory-document-template.xlsx",
  };
}
