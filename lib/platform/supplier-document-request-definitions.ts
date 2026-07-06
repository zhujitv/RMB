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

export type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
} | null | undefined;
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type QueryLike = Pick<URLSearchParams, "get">;
export type SupplierDocumentRequestInput = Record<string, unknown>;
export type SupplierDocumentUploadInput = {
  documentType: string;
  file: unknown;
  costId?: string;
};
export type ExcelUploadFile = {
  originalFileName: string;
  mimeType: string;
  body: Buffer;
  fileSize: number;
};
export type SupplierDocumentRequestRow = Prisma.SupplierDocumentRequestGetPayload<{
  include: ReturnType<typeof supplierDocumentRequestInclude>;
}>;
export type SupplierDocumentWithOptionalOcr = SupplierDocumentRequestRow["documents"][number] & {
  ocrTasks?: unknown[];
};
export type SupplierDocumentRequestWithOptionalOcr = Omit<SupplierDocumentRequestRow, "documents"> & {
  documents: SupplierDocumentWithOptionalOcr[];
};
export type FactorySupplierReturnCost = Prisma.OrderCostGetPayload<{
  include: ReturnType<typeof supplierDocumentRequestFactoryCostInclude>;
}>;

export const SUPPLIER_DOCUMENT_REQUEST_STATUSES = ["待上传", "部分上传", "已完成", "已关闭"];
export const SUPPLIER_DOCUMENT_LABELS: Record<string, string> = {
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同",
  SUPPLIER_INVOICE: "工厂增值税发票",
  PURCHASE_CONTRACT: "工厂采购合同",
  VAT_INVOICE: "工厂增值税发票",
};
export const SUPPLIER_DOCUMENT_EMAIL_LABELS: Record<string, string> = {
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同（盖章扫描件，PDF）",
  SUPPLIER_INVOICE: "工厂增值税发票（PDF）",
  PURCHASE_CONTRACT: "工厂采购合同（盖章扫描件，PDF）",
  VAT_INVOICE: "工厂增值税发票（PDF）",
};
export const MAX_EXCEL_TEMPLATE_BYTES = 4 * 1024 * 1024;
export const EXCEL_TEMPLATE_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const LEGACY_EXCEL_TEMPLATE_MIME = "application/vnd.ms-excel";
export const SUPPLIER_DOCUMENT_COST_CANDIDATE_LIMIT = 50;
export const SUPPLIER_DOCUMENT_COST_CANDIDATE_SCAN_LIMIT = 200;
export const SUPPLIER_INVOICE_SYNC_COST_LIMIT = 100;
export const DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_CODE = "DUPLICATE_SUPPLIER_DOCUMENT_REQUEST";
export const DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_MESSAGE = "该工厂成本已存在资料回传任务，请在原任务中查看或替换资料。";

export type SupplierDocumentRequestOccupancyClient = Pick<Prisma.TransactionClient, "supplierDocumentRequest" | "orderDocument" | "fileAsset">;

type SupplierDocumentRequestCostOccupancySource = "REQUEST" | "DOCUMENT" | "FILE_ASSET" | "LEGACY_REQUEST";

export type SupplierDocumentRequestCostOccupancy = {
  occupied: boolean;
  source?: SupplierDocumentRequestCostOccupancySource;
  sourceId?: string;
};

export function supplierDocumentRequestInclude() {
  return Prisma.validator<Prisma.SupplierDocumentRequestInclude>()({
    order: {
      select: {
        id: true,
        orderNo: true,
        taxRefundStatus: true,
        taxArchived: true,
        isArchived: true,
        taxSubmittedAt: true,
        taxRefundArchivedAt: true,
        businessEntity: { select: { id: true, name: true, shortName: true, isDefault: true } },
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

export function supplierDocumentRequestFactoryCostInclude() {
  return Prisma.validator<Prisma.OrderCostInclude>()({
    order: {
      select: {
        id: true,
        orderNo: true,
        blNo: true,
        deletedAt: true,
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

export function supplierDocumentRequestFactoryCostWhere({
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
    status: { not: ORDER_COST_STATUS_VOID },
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

export function serializeSupplierDocumentCostCandidate(cost: FactorySupplierReturnCost) {
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
    createdAt: cost.createdAt,
  };
}

export function activeSupplierDocumentRequestWhere(orderId: string, supplierId: string): Prisma.SupplierDocumentRequestWhereInput {
  return {
    orderId,
    supplierId,
    deletedAt: null,
    NOT: { status: "DELETED" },
  };
}

export function supplierDocumentRequestPairKey(orderId: string, supplierId: string) {
  return `${orderId}:${supplierId}`;
}

export function duplicateSupplierDocumentRequestError() {
  return codedError(DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_MESSAGE, 409, DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_CODE);
}
