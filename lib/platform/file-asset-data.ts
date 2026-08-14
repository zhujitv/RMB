import type { FileAsset, Prisma } from "../generated/prisma/client.js";
import { managedFileMetadata, type ManagedFileBinding } from "./file-center";

export const FILE_ASSET_SOURCE_TABLES = {
  ORDER_DOCUMENTS: "order_documents",
  ORDER_COSTS: "order_costs",
  SUPPLIER_DOCUMENT_REQUESTS: "supplier_document_requests",
  FACTORY_PURCHASE_ORDER_SUPPLIER_RESPONSES: "factory_purchase_order_supplier_responses",
  FACTORY_PURCHASE_ORDERS: "factory_purchase_orders",
} as const;

export const FILE_ASSET_ROLES = {
  PAYMENT_VOUCHER: "PAYMENT_VOUCHER",
  SUPPLIER_REQUEST_TEMPLATE: "SUPPLIER_REQUEST_TEMPLATE",
  SUPPLIER_CONFIRMATION_EVIDENCE: "SUPPLIER_CONFIRMATION_EVIDENCE",
  PRODUCTION_COMPLETION_EVIDENCE: "PRODUCTION_COMPLETION_EVIDENCE",
} as const;

export type FileAssetClient = {
  fileAsset: {
    findFirst(args: Prisma.FileAssetFindFirstArgs): Promise<FileAsset | null>;
    upsert(args: Prisma.FileAssetUpsertArgs): Promise<FileAsset>;
    updateMany(args: Prisma.FileAssetUpdateManyArgs): Promise<Prisma.BatchPayload>;
  };
  notificationOutbox: {
    upsert(args: Prisma.NotificationOutboxUpsertArgs): Promise<unknown>;
  };
};

export type OrderDocumentAssetLike = {
  id?: string | null;
  orderId?: string | null;
  costId?: string | null;
  supplierId?: string | null;
  factoryDocumentRequestId?: string | null;
  relatedModule?: string | null;
  documentType?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  originalName?: string | null;
  originalFilename?: string | null;
  standardFilename?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  r2Bucket?: string | null;
  storageKey?: string | null;
  uploadedById?: string | null;
  uploadedAt?: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  deletedAt?: Date | null;
};

export type PaymentVoucherAssetLike = {
  id?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  paymentVoucherUrl?: string | null;
  paymentVoucherFileName?: string | null;
  paymentVoucherMimeType?: string | null;
  paymentVoucherUploadedAt?: Date | null;
  paymentVoucherStorageKey?: string | null;
  paymentVoucherBucket?: string | null;
  updatedById?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  deletedAt?: Date | null;
};

export type SupplierRequestTemplateAssetLike = {
  id?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  requestedById?: string | null;
  templateFileName?: string | null;
  templateOriginalName?: string | null;
  templateMimeType?: string | null;
  templateFileSize?: number | null;
  templateStorageKey?: string | null;
  templateBucket?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  deletedAt?: Date | null;
};

export type ManagedMetadataLike = ReturnType<typeof managedFileMetadata> & {
  id?: string;
  previewKind?: string;
};

export function nonEmpty(value: unknown) {
  return String(value || "").trim();
}

export function nullableString(value: unknown) {
  const text = nonEmpty(value);
  return text || null;
}

export function nullableDate(value: unknown) {
  return value instanceof Date ? value : null;
}

export function nullableInt(value: unknown) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.trunc(numberValue) : null;
}

export function sourceUnique(sourceTable: string, sourceId: string, fileRole: string) {
  return {
    sourceTable_sourceId_fileRole: {
      sourceTable,
      sourceId,
      fileRole,
    },
  };
}

export function activeFileAssetWhere(sourceTable: string, sourceId: string, fileRole: string): Prisma.FileAssetWhereInput {
  return {
    sourceTable,
    sourceId,
    fileRole,
    isDeleted: false,
    deletedAt: null,
  };
}

export function orderDocumentFileRole(document: OrderDocumentAssetLike) {
  return nonEmpty(document.documentType) || "ORDER_DOCUMENT";
}

export function orderDocumentAssetData(document: OrderDocumentAssetLike, binding: Partial<ManagedFileBinding> = {}) {
  const sourceId = nonEmpty(document.id);
  const fileRole = orderDocumentFileRole(document);
  const fileName = nonEmpty(document.standardFilename) || nonEmpty(document.fileName) || nonEmpty(document.originalFilename) || nonEmpty(document.originalName) || "文件";
  const originalFileName = nullableString(document.originalFilename) || nullableString(document.originalName) || nullableString(document.fileName);
  const deletedAt = nullableDate(document.deletedAt);
  return {
    unique: sourceUnique(FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS, sourceId, fileRole),
    create: {
      fileUrl: nullableString(document.fileUrl),
      fileName,
      originalFileName,
      mimeType: nonEmpty(document.mimeType) || "application/octet-stream",
      fileSize: nullableInt(document.fileSize),
      storageKey: nonEmpty(document.storageKey),
      bucket: nullableString(document.r2Bucket),
      uploadedAt: nullableDate(document.uploadedAt),
      uploadedById: nullableString(document.uploadedById),
      bindingType: "ORDER_DOCUMENT",
      sourceTable: FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
      sourceId,
      fileRole,
      orderId: nullableString(document.orderId),
      costId: nullableString(document.costId),
      supplierId: nullableString(document.supplierId),
      logisticsExpenseId: nullableString(binding.logisticsExpenseId),
      supplierDocumentRequestId: nullableString(document.factoryDocumentRequestId) || nullableString(binding.supplierDocumentRequestId),
      orderDocumentId: sourceId,
      taxRefundDocumentType: nullableString(document.documentType),
      relatedModule: nullableString(document.relatedModule),
      isDeleted: Boolean(deletedAt),
      deletedAt,
      createdAt: nullableDate(document.createdAt) || new Date(),
      updatedAt: nullableDate(document.updatedAt) || new Date(),
    },
    update: {
      fileUrl: nullableString(document.fileUrl),
      fileName,
      originalFileName,
      mimeType: nonEmpty(document.mimeType) || "application/octet-stream",
      fileSize: nullableInt(document.fileSize),
      storageKey: nonEmpty(document.storageKey),
      bucket: nullableString(document.r2Bucket),
      uploadedAt: nullableDate(document.uploadedAt),
      uploadedById: nullableString(document.uploadedById),
      bindingType: "ORDER_DOCUMENT",
      orderId: nullableString(document.orderId),
      costId: nullableString(document.costId),
      supplierId: nullableString(document.supplierId),
      logisticsExpenseId: nullableString(binding.logisticsExpenseId),
      supplierDocumentRequestId: nullableString(document.factoryDocumentRequestId) || nullableString(binding.supplierDocumentRequestId),
      orderDocumentId: sourceId,
      taxRefundDocumentType: nullableString(document.documentType),
      relatedModule: nullableString(document.relatedModule),
      isDeleted: Boolean(deletedAt),
      deletedAt,
    },
  };
}

export function paymentVoucherAssetData(cost: PaymentVoucherAssetLike) {
  const sourceId = nonEmpty(cost.id);
  const deletedAt = nullableDate(cost.deletedAt);
  return {
    unique: sourceUnique(FILE_ASSET_SOURCE_TABLES.ORDER_COSTS, sourceId, FILE_ASSET_ROLES.PAYMENT_VOUCHER),
    create: {
      fileUrl: nullableString(cost.paymentVoucherUrl),
      fileName: nonEmpty(cost.paymentVoucherFileName) || "汇款水单",
      originalFileName: nullableString(cost.paymentVoucherFileName),
      mimeType: nonEmpty(cost.paymentVoucherMimeType) || "application/octet-stream",
      storageKey: nonEmpty(cost.paymentVoucherStorageKey),
      bucket: nullableString(cost.paymentVoucherBucket),
      uploadedAt: nullableDate(cost.paymentVoucherUploadedAt),
      uploadedById: nullableString(cost.updatedById),
      bindingType: "PAYMENT_VOUCHER",
      sourceTable: FILE_ASSET_SOURCE_TABLES.ORDER_COSTS,
      sourceId,
      fileRole: FILE_ASSET_ROLES.PAYMENT_VOUCHER,
      orderId: nullableString(cost.orderId),
      costId: sourceId,
      supplierId: nullableString(cost.supplierId),
      relatedModule: "COST_PAYMENT",
      isDeleted: Boolean(deletedAt),
      deletedAt,
      createdAt: nullableDate(cost.createdAt) || new Date(),
      updatedAt: nullableDate(cost.updatedAt) || new Date(),
    },
    update: {
      fileUrl: nullableString(cost.paymentVoucherUrl),
      fileName: nonEmpty(cost.paymentVoucherFileName) || "汇款水单",
      originalFileName: nullableString(cost.paymentVoucherFileName),
      mimeType: nonEmpty(cost.paymentVoucherMimeType) || "application/octet-stream",
      storageKey: nonEmpty(cost.paymentVoucherStorageKey),
      bucket: nullableString(cost.paymentVoucherBucket),
      uploadedAt: nullableDate(cost.paymentVoucherUploadedAt),
      uploadedById: nullableString(cost.updatedById),
      bindingType: "PAYMENT_VOUCHER",
      orderId: nullableString(cost.orderId),
      costId: sourceId,
      supplierId: nullableString(cost.supplierId),
      relatedModule: "COST_PAYMENT",
      isDeleted: Boolean(deletedAt),
      deletedAt,
    },
  };
}

export function supplierTemplateAssetData(row: SupplierRequestTemplateAssetLike) {
  const sourceId = nonEmpty(row.id);
  const deletedAt = nullableDate(row.deletedAt);
  return {
    unique: sourceUnique(FILE_ASSET_SOURCE_TABLES.SUPPLIER_DOCUMENT_REQUESTS, sourceId, FILE_ASSET_ROLES.SUPPLIER_REQUEST_TEMPLATE),
    create: {
      fileName: nonEmpty(row.templateOriginalName) || nonEmpty(row.templateFileName) || "factory-document-template.xlsx",
      originalFileName: nullableString(row.templateOriginalName) || nullableString(row.templateFileName),
      mimeType: nonEmpty(row.templateMimeType) || "application/octet-stream",
      fileSize: nullableInt(row.templateFileSize),
      storageKey: nonEmpty(row.templateStorageKey),
      bucket: nullableString(row.templateBucket),
      uploadedAt: nullableDate(row.createdAt),
      uploadedById: nullableString(row.requestedById),
      bindingType: "SUPPLIER_REQUEST_TEMPLATE",
      sourceTable: FILE_ASSET_SOURCE_TABLES.SUPPLIER_DOCUMENT_REQUESTS,
      sourceId,
      fileRole: FILE_ASSET_ROLES.SUPPLIER_REQUEST_TEMPLATE,
      orderId: nullableString(row.orderId),
      supplierId: nullableString(row.supplierId),
      supplierDocumentRequestId: sourceId,
      relatedModule: "SUPPLIER_REQUEST_TEMPLATE",
      isDeleted: Boolean(deletedAt),
      deletedAt,
      createdAt: nullableDate(row.createdAt) || new Date(),
      updatedAt: nullableDate(row.updatedAt) || new Date(),
    },
    update: {
      fileName: nonEmpty(row.templateOriginalName) || nonEmpty(row.templateFileName) || "factory-document-template.xlsx",
      originalFileName: nullableString(row.templateOriginalName) || nullableString(row.templateFileName),
      mimeType: nonEmpty(row.templateMimeType) || "application/octet-stream",
      fileSize: nullableInt(row.templateFileSize),
      storageKey: nonEmpty(row.templateStorageKey),
      bucket: nullableString(row.templateBucket),
      uploadedAt: nullableDate(row.createdAt),
      uploadedById: nullableString(row.requestedById),
      bindingType: "SUPPLIER_REQUEST_TEMPLATE",
      orderId: nullableString(row.orderId),
      supplierId: nullableString(row.supplierId),
      supplierDocumentRequestId: sourceId,
      relatedModule: "SUPPLIER_REQUEST_TEMPLATE",
      isDeleted: Boolean(deletedAt),
      deletedAt,
    },
  };
}
