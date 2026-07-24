import type { FileAsset } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { managedPreviewableMimeType, type ManagedFileBinding } from "./file-center";
import {
  activeFileAssetWhere,
  orderDocumentAssetData,
  paymentVoucherAssetData,
  supplierTemplateAssetData,
  type FileAssetClient,
  type ManagedMetadataLike,
  type OrderDocumentAssetLike,
  type PaymentVoucherAssetLike,
  type SupplierRequestTemplateAssetLike,
} from "./file-asset-data";

export async function findActiveFileAssetBySource(sourceTable: string, sourceId: string, fileRole: string) {
  if (!sourceTable || !sourceId || !fileRole) return null;
  return prisma.fileAsset.findFirst({
    where: activeFileAssetWhere(sourceTable, sourceId, fileRole),
    orderBy: [{ updatedAt: "desc" }],
  });
}

export async function upsertFileAssetForOrderDocument(
  client: FileAssetClient,
  document: OrderDocumentAssetLike,
  binding: Partial<ManagedFileBinding> = {},
) {
  if (!document.id || !document.storageKey) return null;
  const data = orderDocumentAssetData(document, binding);
  return client.fileAsset.upsert({
    where: data.unique,
    create: data.create,
    update: data.update,
  });
}

export async function upsertFileAssetForPaymentVoucher(client: FileAssetClient, cost: PaymentVoucherAssetLike) {
  if (!cost.id || !cost.paymentVoucherStorageKey) return null;
  const data = paymentVoucherAssetData(cost);
  return client.fileAsset.upsert({
    where: data.unique,
    create: data.create,
    update: data.update,
  });
}

export async function upsertFileAssetForSupplierRequestTemplate(client: FileAssetClient, row: SupplierRequestTemplateAssetLike) {
  if (!row.id || !row.templateStorageKey) return null;
  const data = supplierTemplateAssetData(row);
  return client.fileAsset.upsert({
    where: data.unique,
    create: data.create,
    update: data.update,
  });
}

export async function softDeleteFileAssetBySource(
  client: FileAssetClient,
  sourceTable: string,
  sourceId: string,
  fileRole: string,
  deletedAt = new Date(),
) {
  if (!sourceTable || !sourceId || !fileRole) return { count: 0 };
  return client.fileAsset.updateMany({
    where: {
      sourceTable,
      sourceId,
      fileRole,
      isDeleted: false,
    },
    data: {
      isDeleted: true,
      deletedAt,
    },
  });
}

export function applyFileAssetToOrderDocument<T extends OrderDocumentAssetLike>(document: T, asset: FileAsset | null): T {
  if (!asset) return document;
  return {
    ...document,
    fileUrl: asset.fileUrl || document.fileUrl || null,
    fileName: asset.fileName || document.fileName || "文件",
    originalName: asset.originalFileName || document.originalName || null,
    originalFilename: asset.originalFileName || document.originalFilename || null,
    standardFilename: asset.fileName || document.standardFilename || document.fileName || "文件",
    fileSize: asset.fileSize ?? document.fileSize ?? 0,
    mimeType: asset.mimeType || document.mimeType || "application/octet-stream",
    r2Bucket: asset.bucket || document.r2Bucket || "",
    storageKey: asset.storageKey || document.storageKey || "",
    uploadedAt: asset.uploadedAt || document.uploadedAt || null,
    uploadedById: asset.uploadedById || document.uploadedById || null,
  };
}

export function mergeFileAssetMetadata<T extends ManagedMetadataLike>(metadata: T, asset: FileAsset | null): T {
  if (!asset) return metadata;
  const binding = {
    ...(metadata.binding || {}),
    orderId: asset.orderId || metadata.binding?.orderId || null,
    costId: asset.costId || metadata.binding?.costId || null,
    supplierId: asset.supplierId || metadata.binding?.supplierId || null,
    logisticsExpenseId: asset.logisticsExpenseId || metadata.binding?.logisticsExpenseId || null,
    supplierDocumentRequestId: asset.supplierDocumentRequestId || metadata.binding?.supplierDocumentRequestId || null,
    orderDocumentId: asset.orderDocumentId || metadata.binding?.orderDocumentId || null,
    taxRefundDocumentType: asset.taxRefundDocumentType || metadata.binding?.taxRefundDocumentType || null,
    relatedModule: asset.relatedModule || metadata.binding?.relatedModule || null,
  };
  const mimeType = asset.mimeType || metadata.mimeType || "application/octet-stream";
  return {
    ...metadata,
    fileUrl: asset.fileUrl || metadata.fileUrl || "",
    fileName: asset.fileName || metadata.fileName || "文件",
    originalFileName: asset.originalFileName || metadata.originalFileName || "",
    mimeType,
    fileSize: asset.fileSize ?? metadata.fileSize ?? 0,
    storageKey: asset.storageKey || metadata.storageKey || "",
    bucket: asset.bucket || metadata.bucket || "",
    uploadedAt: asset.uploadedAt || metadata.uploadedAt || null,
    binding,
    previewKind: managedPreviewableMimeType(mimeType),
  };
}
