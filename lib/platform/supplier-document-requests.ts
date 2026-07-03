import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, readR2Object, safeFileName, uploadToR2 } from "../r2";
import { NOTIFICATION_TEMPLATE_TYPES, renderNotificationTemplate, sendNotificationEmail } from "./notification-engine";
import {
  refreshCustomsDeclarationAfterOwnershipChange,
  upsertCustomsDeclarationDocumentLink,
  upsertCustomsDeclarationSupplierLink,
} from "./customs-declaration-ownership";
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
type FactorySupplierReturnCost = Prisma.OrderCostGetPayload<{
  include: ReturnType<typeof supplierDocumentRequestFactoryCostInclude>;
}>;

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
const MAX_EXCEL_TEMPLATE_BYTES = 4 * 1024 * 1024;
const EXCEL_TEMPLATE_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const LEGACY_EXCEL_TEMPLATE_MIME = "application/vnd.ms-excel";
const SUPPLIER_DOCUMENT_COST_CANDIDATE_LIMIT = 50;
const SUPPLIER_DOCUMENT_COST_CANDIDATE_SCAN_LIMIT = 200;
const SUPPLIER_DOCUMENT_ACTIVE_REQUEST_SCAN_LIMIT = SUPPLIER_DOCUMENT_COST_CANDIDATE_SCAN_LIMIT * 20;
const SUPPLIER_INVOICE_SYNC_COST_LIMIT = 100;

function supplierDocumentRequestInclude() {
  return Prisma.validator<Prisma.SupplierDocumentRequestInclude>()({
    order: {
      select: {
        id: true,
        orderNo: true,
        blNo: true,
        taxRefundStatus: true,
        taxArchived: true,
        isArchived: true,
        taxSubmittedAt: true,
        taxRefundArchivedAt: true,
        costs: {
          where: { deletedAt: null },
          include: { supplier: true },
          orderBy: [{ createdAt: "asc" }],
        },
      },
    },
    customsDeclaration: {
      select: {
        id: true,
        batchNo: true,
        declarationNo: true,
        declarationDate: true,
        billOfLadingNo: true,
        taxArchived: true,
        taxRefundStatus: true,
        taxSubmittedAt: true,
        taxRefundArchivedAt: true,
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
    completedBy: { select: { id: true, name: true, email: true } },
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

function supplierDocumentRequestFactoryCostInclude() {
  return Prisma.validator<Prisma.OrderCostInclude>()({
    order: {
      select: {
        id: true,
        orderNo: true,
        blNo: true,
        deletedAt: true,
        taxRefundStatus: true,
        taxArchived: true,
        isArchived: true,
        taxSubmittedAt: true,
        taxRefundArchivedAt: true,
        customsDeclarations: {
          where: { deletedAt: null },
          select: {
            id: true,
            batchNo: true,
            declarationNo: true,
            declarationDate: true,
            billOfLadingNo: true,
            purchaseOrderId: true,
            supplierId: true,
            suppliers: {
              where: { deletedAt: null },
              select: {
                supplierId: true,
                purchaseOrderId: true,
                requiredInvoiceAmount: true,
                splitAmount: true,
              },
              take: 200,
            },
          },
          orderBy: [{ declarationDate: "desc" }, { createdAt: "desc" }],
          take: 20,
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
  });
}

function supplierDocumentRequestFactoryCostWhere({
  costId = "",
  orderId = "",
  supplierId = "",
  keyword = "",
}: {
  costId?: string;
  orderId?: string;
  supplierId?: string;
  keyword?: string;
} = {}): Prisma.OrderCostWhereInput {
  const q = nonEmpty(keyword);
  return {
    AND: [
      ...(costId ? [{ id: costId }] : []),
      ...(orderId ? [{ orderId }] : []),
      ...(supplierId ? [{ supplierId }] : []),
      { supplierId: { not: null } },
    ],
    deletedAt: null,
    sourceType: { not: "LOGISTICS_EXPENSE" },
    costType: { in: FACTORY_SUPPLIER_COST_TYPES },
    supplier: {
      is: {
        status: "启用",
        allowFactoryDocumentUpload: true,
        supplierType: { in: TAX_REFUND_SUPPLIER_TYPES },
      },
    },
    order: { is: { deletedAt: null } },
    ...(q ? {
      OR: [
        { costType: { contains: q, mode: "insensitive" } },
        { supplierNameSnapshot: { contains: q, mode: "insensitive" } },
        { vendorName: { contains: q, mode: "insensitive" } },
        { order: { is: { orderNo: { contains: q, mode: "insensitive" } } } },
        { order: { is: { blNo: { contains: q, mode: "insensitive" } } } },
        { supplier: { is: { supplierName: { contains: q, mode: "insensitive" } } } },
      ],
    } : {}),
  };
}

function customsDeclarationMatchesFactoryCost(
  declaration: {
    purchaseOrderId?: string | null;
    supplierId?: string | null;
    suppliers?: Array<{ purchaseOrderId?: string | null; supplierId?: string | null }> | null;
  },
  cost: { id?: string | null; supplierId?: string | null },
) {
  const linkedSuppliers = declaration.suppliers || [];
  if (linkedSuppliers.length) {
    return linkedSuppliers.some((supplier) => {
      const purchaseOrderMatches = !supplier.purchaseOrderId || supplier.purchaseOrderId === cost.id;
      const supplierMatches = !supplier.supplierId || supplier.supplierId === cost.supplierId;
      return purchaseOrderMatches && supplierMatches;
    });
  }
  const purchaseOrderMatches = !declaration.purchaseOrderId || declaration.purchaseOrderId === cost.id;
  const supplierMatches = !declaration.supplierId || declaration.supplierId === cost.supplierId;
  return purchaseOrderMatches && supplierMatches;
}

function numberFromDecimalLike(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function declarationSupplierRequiredInvoiceAmount(
  declaration: {
    suppliers?: Array<{
      purchaseOrderId?: string | null;
      supplierId?: string | null;
      requiredInvoiceAmount?: unknown;
      splitAmount?: unknown;
    }> | null;
  },
  cost: { id?: string | null; supplierId?: string | null },
) {
  const linkedSupplier = (declaration.suppliers || []).find((supplier) => {
    const purchaseOrderMatches = !supplier.purchaseOrderId || supplier.purchaseOrderId === cost.id;
    const supplierMatches = !supplier.supplierId || supplier.supplierId === cost.supplierId;
    return purchaseOrderMatches && supplierMatches;
  });
  return numberFromDecimalLike(linkedSupplier?.requiredInvoiceAmount)
    || numberFromDecimalLike(linkedSupplier?.splitAmount);
}

function serializeSupplierDocumentCostCandidate(cost: FactorySupplierReturnCost, existingPairs = new Set<string>()) {
  const declarations = (cost.order?.customsDeclarations || [])
    .filter((declaration) => (
      customsDeclarationMatchesFactoryCost(declaration, cost)
      && !existingPairs.has(supplierDocumentRequestPairKey(
        cost.orderId,
        cost.supplierId || "",
        cost.id,
        declaration.id,
      ))
    ))
    .map((declaration) => ({
      id: declaration.id,
      batchNo: declaration.batchNo || "",
      declarationNo: declaration.declarationNo || "",
      declarationDate: dateToInput(declaration.declarationDate),
      billOfLadingNo: declaration.billOfLadingNo || cost.order?.blNo || "",
      requiredInvoiceAmount: declarationSupplierRequiredInvoiceAmount(declaration, cost) || null,
    }));
  return {
    id: cost.id,
    orderId: cost.orderId,
    orderNo: cost.order?.orderNo || "",
    billOfLadingNo: cost.order?.blNo || "",
    supplierId: cost.supplierId || "",
    supplierName: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "",
    supplierType: cost.supplier?.supplierType || "",
    costType: cost.costType,
    currency: cost.currency || "CNY",
    amount: Number(cost.amount || 0),
    amountCny: Number(cost.amountCny || 0),
    customsDeclarations: declarations,
    createdAt: cost.createdAt,
  };
}

function activeSupplierDocumentRequestWhere(orderId: string, supplierId: string, costId = "", customsDeclarationId = ""): Prisma.SupplierDocumentRequestWhereInput {
  return {
    orderId,
    supplierId,
    ...(costId ? { costId } : {}),
    ...(customsDeclarationId ? { customsDeclarationId } : {}),
    deletedAt: null,
    NOT: { status: "DELETED" },
  };
}

function supplierDocumentRequestPairKey(orderId: string, supplierId: string, costId = "", customsDeclarationId = "") {
  return `${orderId}:${supplierId}:${costId}:${customsDeclarationId}`;
}

function isSupplierDocumentRequestDuplicateError(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const text = error instanceof Error ? error.message : String(error || "");
  return record.code === "P2002" || /supplier_document_requests_active_batch_unique|unique constraint/i.test(text);
}

async function activeSupplierDocumentRequestPairSet(costs: Array<{ id?: string | null; orderId?: string | null; supplierId?: string | null; order?: { customsDeclarations?: Array<{ id?: string | null; purchaseOrderId?: string | null; supplierId?: string | null }> | null } | null }>) {
  const orderIds = [...new Set(costs.map((cost) => cost.orderId || "").filter(Boolean))];
  const supplierIds = [...new Set(costs.map((cost) => cost.supplierId || "").filter(Boolean))];
  if (!orderIds.length || !supplierIds.length) return new Set<string>();
  const requests = await prisma.supplierDocumentRequest.findMany({
    where: {
      orderId: { in: orderIds },
      supplierId: { in: supplierIds },
      deletedAt: null,
      NOT: { status: "DELETED" },
    },
    select: { orderId: true, supplierId: true, costId: true, customsDeclarationId: true },
    take: SUPPLIER_DOCUMENT_ACTIVE_REQUEST_SCAN_LIMIT,
  });
  return new Set(requests.map((row) => supplierDocumentRequestPairKey(row.orderId, row.supplierId, row.costId || "", row.customsDeclarationId || "")));
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

async function loadFactorySupplierReturnCostForRequest(input: SupplierDocumentRequestInput) {
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

function selectedCustomsDeclarationId(input: SupplierDocumentRequestInput) {
  return nonEmpty(input.customsDeclarationId || input.declarationId || input.customsDeclaration_id);
}

async function loadCustomsDeclarationForSupplierRequest(input: SupplierDocumentRequestInput, cost: FactorySupplierReturnCost) {
  const customsDeclarationId = selectedCustomsDeclarationId(input);
  if (!customsDeclarationId) {
    throw codedError("请选择对应报关批次。", 400, "CUSTOMS_DECLARATION_REQUIRED");
  }
  const declaration = await prisma.customsDeclaration.findFirst({
    where: {
      id: customsDeclarationId,
      orderId: cost.orderId,
      deletedAt: null,
    },
    select: {
      id: true,
      orderId: true,
      batchNo: true,
      declarationNo: true,
      declarationDate: true,
      billOfLadingNo: true,
      purchaseOrderId: true,
      supplierId: true,
      suppliers: {
        where: { deletedAt: null },
        select: {
          supplierId: true,
          purchaseOrderId: true,
          requiredInvoiceAmount: true,
          splitAmount: true,
        },
        take: 200,
      },
      taxArchived: true,
      taxRefundStatus: true,
      taxSubmittedAt: true,
      taxRefundArchivedAt: true,
    },
  });
  if (!declaration) throw codedError("请选择有效报关批次。", 400, "CUSTOMS_DECLARATION_NOT_FOUND");
  if (supplierDocumentRequestOrderLocked(cost.order, declaration)) {
    throw codedError("该报关批次已提交退税或已归档，不能创建资料回传任务。", 400, "SUPPLIER_DOCUMENT_REQUEST_TAX_ARCHIVED");
  }
  if (!customsDeclarationMatchesFactoryCost(declaration, cost)) {
    throw codedError("所选报关批次与供应商采购资料不匹配。", 400, "CUSTOMS_DECLARATION_SUPPLIER_COST_MISMATCH");
  }
  if (declaration.purchaseOrderId && declaration.purchaseOrderId !== cost.id) {
    throw codedError("所选报关批次与采购订单不匹配。", 400, "CUSTOMS_DECLARATION_COST_MISMATCH");
  }
  if (declaration.supplierId && declaration.supplierId !== cost.supplierId) {
    throw codedError("所选报关批次与供应商不匹配。", 400, "CUSTOMS_DECLARATION_SUPPLIER_MISMATCH");
  }
  return declaration;
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

function isPaidFactorySupplierCost(cost: { paid?: boolean | null; paymentStatus?: string | null }) {
  return Boolean(cost.paid) || cost.paymentStatus === "已支付" || cost.paymentStatus === "部分支付";
}

async function selectedProductSupplierPaymentVoucherAttachment(cost: FactorySupplierReturnCost) {
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

async function safeSelectedProductSupplierPaymentVoucherAttachment(cost: FactorySupplierReturnCost) {
  return selectedProductSupplierPaymentVoucherAttachment(cost).catch((error) => {
    logServerError("产品供应商资料回传通知付款凭证附件准备失败，已跳过水单附件", error, {
      orderId: cost.orderId,
      supplierId: cost.supplierId || "",
      costId: cost.id,
    });
    return null;
  });
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

function serializeSupplierDocumentRequest(row: SupplierDocumentRequestWithOptionalOcr, actor: ActorLike) {
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  const documents = (row.documents || [])
    .filter((document) => requiredTypes.includes(normalizeSupplierReturnDocumentType(document.documentType) as OrderDocumentType))
    .map((document) => serializeSupplierDocument(document));
  const factoryCostSlots = factoryCostSlotsForSupplierRequest(row);
  const canDelete = actor?.role === "管理员" && !supplierDocumentRequestOrderLocked(row.order, row.customsDeclaration);
  const taxRefundDocumentCount = documents.filter((document) => document.uploadStatus === "SUCCESS").length;
  return {
    id: row.id,
    orderId: row.orderId,
    orderNo: row.order?.orderNo || "",
    billOfLadingNo: row.customsDeclaration?.billOfLadingNo || row.order?.blNo || "",
    customsDeclarationId: row.customsDeclarationId || "",
    customsDeclarationBatchNo: row.customsDeclaration?.batchNo || "",
    customsDeclarationNo: row.customsDeclaration?.declarationNo || "",
    customsDeclarationDate: dateToInput(row.customsDeclaration?.declarationDate),
    requiredInvoiceAmount: row.requiredInvoiceAmount == null ? null : Number(row.requiredInvoiceAmount || 0),
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
    await reconcileStaleSupplierDocumentOcrTasks(documentIds);
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
  const uploadedTypes = new Set(row.documents.map((document) => normalizeSupplierReturnDocumentType(document.documentType)));
  const nextStatus = uploadedTypes.size ? "部分上传" : "待上传";
  return tx.supplierDocumentRequest.update({
    where: { id: requestId },
    data: { status: nextStatus, completedAt: null, completedById: null },
  });
}

type SupplierDocumentRequestLockRecord = {
  taxArchived?: boolean | null;
  isArchived?: boolean | null;
  taxSubmittedAt?: Date | string | null;
  taxRefundArchivedAt?: Date | string | null;
  taxRefundStatus?: string | null;
} | null | undefined;

function supplierDocumentRequestOrderLocked(
  order: SupplierDocumentRequestLockRecord,
  declaration: SupplierDocumentRequestLockRecord = null,
) {
  if (declaration) {
    return Boolean(
      order?.isArchived
      || declaration.taxArchived
      || declaration.taxSubmittedAt
      || declaration.taxRefundArchivedAt
      || declaration.taxRefundStatus === "SUBMITTED",
    );
  }
  return Boolean(
    order?.taxArchived
    || order?.isArchived
    || order?.taxSubmittedAt
    || order?.taxRefundArchivedAt
    || order?.taxRefundStatus === "SUBMITTED",
  );
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
  await safeRefreshSupplierDocumentRequestCompletion(row.id);
  const refreshed = await prisma.supplierDocumentRequest.findFirst({
    where,
    include: supplierDocumentRequestInclude(),
  });
  if (!refreshed) throw codedError("资料回传任务不存在或无权限访问。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  const [rowWithOcr] = await attachSupplierDocumentOcrTasks([row]);
  const [refreshedWithOcr] = await attachSupplierDocumentOcrTasks([refreshed]);
  return refreshedWithOcr || rowWithOcr;
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
  const reconciledRows = await Promise.all(rows.map(async (row) => {
    const refreshed = await safeRefreshSupplierDocumentRequestCompletion(row.id);
    return refreshed ? { ...row, status: refreshed.status, completedAt: refreshed.completedAt, completedById: refreshed.completedById } : row;
  }));
  const rowsWithOcr = await attachSupplierDocumentOcrTasks(reconciledRows);
  return {
    ...pageResult(rowsWithOcr.map((row) => serializeSupplierDocumentRequest(row, actor)), total, page, pageSize),
    summary: { pendingCount },
  };
}

export async function deleteSupplierDocumentRequest(request: AuditRequestLike, actor: ActorLike, requestId: string) {
  if (actor?.role !== "管理员") {
    throw codedError("只有管理员可以删除资料回传任务。", 403, "SUPPLIER_DOCUMENT_DELETE_ADMIN_ONLY");
  }
  const deletedById = actorId(actor);
  const row = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    include: supplierDocumentRequestInclude(),
  });
  if (!row) {
    throw codedError("资料回传任务不存在或已删除。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  }
  if (supplierDocumentRequestOrderLocked(row.order, row.customsDeclaration)) {
    throw codedError("该任务对应订单已提交退税或已归档，不能删除资料回传任务。", 400, "SUPPLIER_DOCUMENT_REQUEST_TAX_ARCHIVED");
  }

  const now = new Date();
  const activeDocuments = (row.documents || []).filter((document) => !document.deletedAt);
  const activeDocumentIds = activeDocuments.map((document) => document.id);
  const deletedTaxRefundDocumentIds = activeDocuments
    .filter((document) => document.uploadStatus === "SUCCESS")
    .map((document) => document.id);
  const affectedCostIds = activeDocuments
    .map((document) => document.costId || "")
    .filter((id, index, ids) => id && ids.indexOf(id) === index);
  const deletedSupplierInvoice = activeDocuments.some((document) => document.documentType === "SUPPLIER_INVOICE");

  await prisma.$transaction(async (tx) => {
    if (activeDocumentIds.length) {
      await tx.orderDocument.updateMany({
        where: { id: { in: activeDocumentIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.customsDeclarationDocument.updateMany({
        where: { fileId: { in: activeDocumentIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.customsDeclarationSupplier.updateMany({
        where: { contractFileId: { in: activeDocumentIds }, deletedAt: null },
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
      await tx.customsDeclarationSupplier.updateMany({
        where: { vatInvoiceFileId: { in: activeDocumentIds }, deletedAt: null },
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
    await tx.supplierDocumentRequest.update({
      where: { id: row.id },
      data: {
        deletedAt: now,
        deletedById,
        status: "DELETED",
        completedAt: null,
        completedById: null,
      },
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
    for (const document of activeDocuments) {
      await softDeleteFileAssetBySource(
        tx,
        FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
        document.id,
        String(document.documentType || "ORDER_DOCUMENT"),
        now,
      );
    }
  });

  scheduleTaxRefundCompletenessRefresh(row.orderId, "资料回传任务删除后退税完整度刷新");
  await refreshCustomsDeclarationAfterOwnershipChange(row.customsDeclarationId, "资料回传任务删除后报关批次完整度刷新");
  if (deletedSupplierInvoice) {
    await runNonCriticalTask("资料回传任务删除后成本发票状态同步", async () => {
      const costs = await prisma.orderCost.findMany({
        where: {
          orderId: row.orderId,
          supplierId: row.supplierId,
          deletedAt: null,
        },
        select: { id: true },
        take: SUPPLIER_INVOICE_SYNC_COST_LIMIT,
      });
      const ids = [...new Set([...affectedCostIds, ...costs.map((cost) => cost.id)].filter(Boolean))];
      await Promise.all(ids.map((costId) => syncCostInvoiceStatus(costId)));
    });
  }
  await runNonCriticalTask("资料回传任务删除日志写入", () => writeAudit(request, actor, "删除资料回传任务", "supplier_document_requests", row.id, row, {
    orderNo: row.order?.orderNo,
    supplierId: row.supplierId,
    deletedDocumentIds: activeDocumentIds,
    deletedTaxRefundDocumentIds,
    deletedById,
  }));
  return {
    id: row.id,
    deletedDocumentIds: activeDocumentIds,
    deletedTaxRefundDocumentIds,
    taxRefundCompletenessRecalculated: deletedTaxRefundDocumentIds.length > 0,
  };
}

export async function listSupplierDocumentRequestCostCandidates(query: QueryLike, actor: ActorLike) {
  if (actor?.role !== "管理员") throw codedError("只有管理员可以发起资料回传通知。", 403, "SUPPLIER_DOCUMENT_NOTICE_ADMIN_ONLY");
  assertWrite(actor, "supplierDocuments");
  const keyword = nonEmpty(query.get("q") || query.get("keyword"));
  const costs = await prisma.orderCost.findMany({
    where: supplierDocumentRequestFactoryCostWhere({ keyword }),
    include: supplierDocumentRequestFactoryCostInclude(),
    orderBy: [{ createdAt: "desc" }],
    take: SUPPLIER_DOCUMENT_COST_CANDIDATE_SCAN_LIMIT,
  });
  const existingPairs = await activeSupplierDocumentRequestPairSet(costs);
  return costs
    .filter((cost) => {
      const declarations = (cost.order?.customsDeclarations || []).filter((declaration) => customsDeclarationMatchesFactoryCost(declaration, cost));
      return declarations.some((declaration) => !existingPairs.has(supplierDocumentRequestPairKey(
        cost.orderId,
        cost.supplierId || "",
        cost.id,
        declaration.id,
      )));
    })
    .slice(0, SUPPLIER_DOCUMENT_COST_CANDIDATE_LIMIT)
    .map((cost) => serializeSupplierDocumentCostCandidate(cost, existingPairs));
}

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
  const customsDeclaration = await loadCustomsDeclarationForSupplierRequest(input, factoryCost);
  const inputRequiredInvoiceAmount = Number(input.requiredInvoiceAmount || 0);
  const requiredInvoiceAmount = (Number.isFinite(inputRequiredInvoiceAmount) && inputRequiredInvoiceAmount > 0 ? inputRequiredInvoiceAmount : 0)
    || declarationSupplierRequiredInvoiceAmount(customsDeclaration, factoryCost)
    || Number(factoryCost.amount || 0);
  if (!Number.isFinite(requiredInvoiceAmount) || requiredInvoiceAmount <= 0) {
    throw codedError("请填写该报关批次要求开票金额。", 400, "SUPPLIER_DOCUMENT_REQUIRED_INVOICE_AMOUNT_REQUIRED");
  }
  if (!order) throw codedError("请选择有效订单。", 404, "ORDER_NOT_FOUND");
  if (!supplier) throw codedError("请选择有效供应商。", 404, "SUPPLIER_NOT_FOUND");
  const existingRequest = await prisma.supplierDocumentRequest.findFirst({
    where: activeSupplierDocumentRequestWhere(order.id, supplier.id, factoryCost.id, customsDeclaration.id),
    select: { id: true },
  });
  if (existingRequest) {
    throw codedError("该订单、供应商、采购订单与报关批次已有资料回传任务，请直接重新发送邮件或上传资料。", 409, "SUPPLIER_DOCUMENT_REQUEST_DUPLICATE");
  }
  if (supplier.status !== "启用") throw codedError("供应商已停用，不能通知回传资料。", 400, "SUPPLIER_DISABLED");
  if (!isProductSupplierType(supplier.supplierType)) throw codedError("资料回传只允许通知产品供应商。", 400, "SUPPLIER_TYPE_NOT_ALLOWED");
  if (!supplier.allowFactoryDocumentUpload) throw codedError("该供应商未开启资料回传权限，请先到系统设置开启。", 400, "SUPPLIER_DOCUMENT_UPLOAD_DISABLED");

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
      const saved = await tx.supplierDocumentRequest.create({
        data: {
          orderId: order.id,
          supplierId: supplier.id,
          costId: factoryCost.id,
          customsDeclarationId: customsDeclaration.id,
          requiredInvoiceAmount,
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
      await upsertCustomsDeclarationSupplierLink(tx, {
        customsDeclarationId: customsDeclaration.id,
        supplierId: supplier.id,
        purchaseOrderId: factoryCost.id,
        requiredInvoiceAmount,
      });
      return saved;
    });
  } catch (error: unknown) {
    if (templateStorageKey) await deleteR2Object(templateStorageKey).catch(() => null);
    if (isSupplierDocumentRequestDuplicateError(error)) {
      throw codedError("该订单、供应商、采购订单与报关批次已有资料回传任务，请直接重新发送邮件或上传资料。", 409, "SUPPLIER_DOCUMENT_REQUEST_DUPLICATE");
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
    customsDeclarationId: customsDeclaration.id,
    declarationNo: customsDeclaration.declarationNo || "",
    costId: factoryCost.id,
    supplierId: supplier.id,
    requiredDocumentTypes: requiredTypes,
    sendStatus: created.sendStatus,
  }));
  return serializeSupplierDocumentRequest(created, actor);
}

function jsonStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

export async function resendSupplierDocumentRequestNotice(request: AuditRequestLike, actor: ActorLike, requestId: string) {
  if (actor?.role !== "管理员") throw codedError("只有管理员可以重新发送资料回传催办。", 403, "SUPPLIER_DOCUMENT_RESEND_ADMIN_ONLY");
  assertWrite(actor, "supplierDocuments");
  const row = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    include: supplierDocumentRequestInclude(),
  });
  if (!row) throw codedError("资料回传任务不存在或已删除。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (supplierDocumentRequestOrderLocked(row.order, row.customsDeclaration)) {
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

export async function uploadSupplierDocumentRequestDocument(request: AuditRequestLike, actor: ActorLike, requestId: string, input: SupplierDocumentUploadInput) {
  assertWrite(actor, "supplierDocuments");
  const uploadedById = actorId(actor);
  const row = await loadSupplierDocumentRequest(requestId, actor);
  if (supplierDocumentRequestOrderLocked(row.order, row.customsDeclaration)) {
    throw codedError("该任务对应报关批次已提交退税或已归档，不能继续上传资料。", 400, "SUPPLIER_DOCUMENT_REQUEST_TAX_ARCHIVED");
  }
  const documentType = normalizeSupplierReturnDocumentType(nonEmpty(input.documentType)) as OrderDocumentType;
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  if (!requiredTypes.includes(documentType)) {
    throw codedError("该任务不需要上传此类资料。", 400, "DOCUMENT_TYPE_NOT_ALLOWED");
  }
  const uploadedFile = await readManagedUploadFile(input.file, "pdf", "supplier-document.pdf");
  const { originalFileName, mimeType, fileSize } = uploadedFile;
  const standardFilename = `${row.order.orderNo || row.orderId}_${SUPPLIER_DOCUMENT_LABELS[documentType] || documentType}.pdf`;
  const uniqueFactoryCost = await resolveUniqueFactoryCostForSupplierReturn(row.orderId, row.supplierId, nonEmpty(input.costId) || row.costId || "");
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
      const replacedAt = new Date();
      const previousDocuments = await tx.orderDocument.findMany({
        where: {
          factoryDocumentRequestId: row.id,
          documentType,
          deletedAt: null,
        },
        select: { id: true },
        take: 20,
      });
      const previousDocumentIds = previousDocuments.map((item) => item.id);
      if (previousDocumentIds.length) {
        await tx.orderDocument.updateMany({
          where: { id: { in: previousDocumentIds }, deletedAt: null },
          data: { deletedAt: replacedAt },
        });
        await tx.customsDeclarationDocument.updateMany({
          where: { fileId: { in: previousDocumentIds }, deletedAt: null },
          data: { deletedAt: replacedAt },
        });
        for (const previousDocumentId of previousDocumentIds) {
          await softDeleteFileAssetBySource(
            tx,
            FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
            previousDocumentId,
            documentType,
            replacedAt,
          );
        }
      }
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
      if (row.customsDeclarationId) {
        await upsertCustomsDeclarationDocumentLink(tx, {
          customsDeclarationId: row.customsDeclarationId,
          documentId: created.id,
          documentType,
          uploadedByUserId: uploadedById,
          uploadedAt: created.uploadedAt,
        });
        await upsertCustomsDeclarationSupplierLink(tx, {
          customsDeclarationId: row.customsDeclarationId,
          supplierId: row.supplierId,
          purchaseOrderId: uniqueFactoryCost?.id || row.costId || null,
          requiredInvoiceAmount: row.requiredInvoiceAmount || null,
          documentType,
          documentId: created.id,
        });
      }
      await refreshSupplierDocumentRequestStatus(tx, row.id);
      return created;
    });
  } catch (error: unknown) {
    await deleteManagedStoredFile(storedFile.storageKey).catch(() => null);
    throw error;
  }
  scheduleTaxRefundCompletenessRefresh(row.orderId);
  await refreshCustomsDeclarationAfterOwnershipChange(row.customsDeclarationId);
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
