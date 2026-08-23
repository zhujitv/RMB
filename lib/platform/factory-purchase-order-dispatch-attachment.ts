import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { readR2Object, safeFileName } from "../r2";
import { deleteManagedStoredFile, managedPreviewableMimeType, uploadManagedFileToStorage } from "./file-center";
import { FILE_ASSET_ROLES, FILE_ASSET_SOURCE_TABLES } from "./file-asset-data";
import { softDeleteFileAssetBySource } from "./file-asset-operations";
import { enqueueFileStorageDeletion } from "./file-storage-deletion-outbox";
import {
  PURCHASE_ORDER_DISPATCH_ATTACHMENT_MAX_BYTES,
  purchaseOrderDispatchAttachmentEmailFileName,
  readValidatedPurchaseOrderDispatchAttachment,
} from "./factory-purchase-order-dispatch-attachment-validation";
import { requireActiveInternalConfirmationActor } from "./factory-purchase-order-confirmation-access";
import { salesExecutionAccessWhere, type SalesExecutionActor } from "./sales-execution-access";
import { assertRead, assertWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";

type AuditRequest = Parameters<typeof writeAudit>[0];
const REPLACED_ATTACHMENT_DELETE_GRACE_MS = 10 * 60 * 1000;

function activeAttachmentWhere(purchaseOrderId: string) {
  return {
    sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS,
    sourceId: purchaseOrderId,
    fileRole: FILE_ASSET_ROLES.PURCHASE_ORDER_ORIGINAL_DETAIL,
    isDeleted: false,
    deletedAt: null,
  } as const;
}

function publicAttachment(asset: {
  id: string;
  fileName: string;
  originalFileName: string | null;
  mimeType: string;
  fileSize: number | null;
  uploadedAt: Date | null;
}, uploadedBy: { id: string; name: string } | null = null) {
  return {
    id: asset.id,
    fileName: asset.fileName,
    originalFileName: asset.originalFileName || "",
    mimeType: asset.mimeType,
    fileSize: Number(asset.fileSize || 0),
    uploadedAt: asset.uploadedAt,
    uploadedBy,
    previewKind: managedPreviewableMimeType(asset.mimeType),
  };
}

async function resolvePurchaseOrder(
  client: Prisma.TransactionClient | typeof prisma,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  requireDraft: boolean,
) {
  const order = await client.factoryPurchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      executionId,
      execution: { is: salesExecutionAccessWhere(actor) },
    },
    select: {
      id: true,
      poNo: true,
      supplierId: true,
      status: true,
      dispatchVersionNumber: true,
      execution: { select: { status: true } },
    },
  });
  if (!order) throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
  if (requireDraft && (order.status !== "DRAFT" || order.execution.status !== "DRAFT")) {
    throw codedError("采购单正式下发后附件已锁定，不能替换或删除", 409, "PURCHASE_ORDER_ATTACHMENT_LOCKED");
  }
  return order;
}

export async function uploadFactoryPurchaseOrderDispatchAttachment(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  input: { file: unknown; confirmedSupplierSafe: unknown },
) {
  assertWrite(actor, "salesExecution");
  if (String(input.confirmedSupplierSafe || "").trim().toLowerCase() !== "true") {
    throw codedError(
      "请确认附件仅含供应商可见的采购信息，不含客户资料、销售价格或利润",
      400,
      "PURCHASE_ORDER_ATTACHMENT_CONFIRMATION_REQUIRED",
    );
  }
  const initialOrder = await resolvePurchaseOrder(prisma, actor, executionId, purchaseOrderId, true);
  const file = await readValidatedPurchaseOrderDispatchAttachment(input.file);
  const outgoingFileName = purchaseOrderDispatchAttachmentEmailFileName(initialOrder.poNo, file.mimeType);
  const storedFileName = safeFileName(`${Date.now()}-${randomUUID().slice(0, 8)}-${file.originalFileName}`);
  const storageKey = `factory-purchase-orders/${purchaseOrderId}/dispatch-attachment/${storedFileName}`;
  const stored = await uploadManagedFileToStorage({ file, storageKey, fileName: outgoingFileName });
  const sha256 = createHash("sha256").update(file.body).digest("hex");
  let previousStorageKey = "";
  try {
    return await prisma.$transaction(async (tx) => {
      const validActor = await requireActiveInternalConfirmationActor(tx, actor);
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${purchaseOrderId} FOR UPDATE`;
      const order = await resolvePurchaseOrder(tx, validActor, executionId, purchaseOrderId, true);
      const previous = await tx.fileAsset.findUnique({
        where: { sourceTable_sourceId_fileRole: {
          sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS,
          sourceId: purchaseOrderId,
          fileRole: FILE_ASSET_ROLES.PURCHASE_ORDER_ORIGINAL_DETAIL,
        } },
      });
      previousStorageKey = previous?.storageKey || "";
      const asset = await tx.fileAsset.upsert({
        where: { sourceTable_sourceId_fileRole: {
          sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS,
          sourceId: purchaseOrderId,
          fileRole: FILE_ASSET_ROLES.PURCHASE_ORDER_ORIGINAL_DETAIL,
        } },
        create: {
          fileName: outgoingFileName,
          originalFileName: file.originalFileName,
          mimeType: stored.mimeType,
          fileSize: stored.fileSize,
          contentSha256: sha256,
          storageKey: stored.storageKey,
          bucket: stored.bucket,
          uploadedAt: stored.uploadedAt,
          uploadedById: validActor.id,
          bindingType: "FACTORY_PURCHASE_ORDER_DISPATCH_ATTACHMENT",
          sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS,
          sourceId: purchaseOrderId,
          fileRole: FILE_ASSET_ROLES.PURCHASE_ORDER_ORIGINAL_DETAIL,
          supplierId: order.supplierId,
          relatedModule: "SALES_EXECUTION",
        },
        update: {
          fileName: outgoingFileName,
          originalFileName: file.originalFileName,
          mimeType: stored.mimeType,
          fileSize: stored.fileSize,
          contentSha256: sha256,
          storageKey: stored.storageKey,
          bucket: stored.bucket,
          uploadedAt: stored.uploadedAt,
          uploadedById: validActor.id,
          supplierId: order.supplierId,
          isDeleted: false,
          deletedAt: null,
        },
      });
      if (previousStorageKey && previousStorageKey !== stored.storageKey) {
        await enqueueFileStorageDeletion(tx, {
          storageKey: previousStorageKey,
          bucket: previous?.bucket,
          sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS,
          sourceId: purchaseOrderId,
          fileRole: FILE_ASSET_ROLES.PURCHASE_ORDER_ORIGINAL_DETAIL,
          deleteAfter: new Date(Date.now() + REPLACED_ATTACHMENT_DELETE_GRACE_MS),
        });
      }
      const saved = publicAttachment(asset, { id: validActor.id, name: validActor.name });
      await writeAudit(request, { id: validActor.id }, "上传或替换采购单下发附件", "factory_purchase_orders", purchaseOrderId, previous ? {
        assetId: previous.id,
        sha256: previous.contentSha256,
        size: previous.fileSize,
        mimeType: previous.mimeType,
      } : null, {
        assetId: asset.id,
        sha256,
        size: stored.fileSize,
        mimeType: stored.mimeType,
        fileName: outgoingFileName,
        supplierSafeContentConfirmed: true,
        dispatchVersionNumber: order.dispatchVersionNumber,
      }, tx);
      return saved;
    });
  } catch (error: unknown) {
    try {
      await deleteManagedStoredFile(stored.storageKey);
    } catch {
      await enqueueFileStorageDeletion(prisma, {
        storageKey: stored.storageKey,
        bucket: stored.bucket,
        sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS,
        sourceId: purchaseOrderId,
        fileRole: FILE_ASSET_ROLES.PURCHASE_ORDER_ORIGINAL_DETAIL,
        deleteAfter: new Date(),
      }).catch((cleanupError: unknown) => {
        console.error("purchase-order-attachment-cleanup-queue-failed", {
          purchaseOrderId,
          message: cleanupError instanceof Error ? cleanupError.message : "cleanup queue failed",
        });
      });
    }
    throw error;
  }
}

export async function deleteFactoryPurchaseOrderDispatchAttachment(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
) {
  assertWrite(actor, "salesExecution");
  return prisma.$transaction(async (tx) => {
    const validActor = await requireActiveInternalConfirmationActor(tx, actor);
    await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${purchaseOrderId} FOR UPDATE`;
    await resolvePurchaseOrder(tx, validActor, executionId, purchaseOrderId, true);
    const previous = await tx.fileAsset.findFirst({ where: activeAttachmentWhere(purchaseOrderId) });
    if (!previous) throw codedError("采购单尚未上传原始采购明细附件", 404, "PURCHASE_ORDER_ATTACHMENT_NOT_FOUND");
    await softDeleteFileAssetBySource(
      tx,
      FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS,
      purchaseOrderId,
      FILE_ASSET_ROLES.PURCHASE_ORDER_ORIGINAL_DETAIL,
    );
    await writeAudit(request, { id: validActor.id }, "删除采购单下发附件", "factory_purchase_orders", purchaseOrderId, {
      assetId: previous.id,
      sha256: previous.contentSha256,
      size: previous.fileSize,
      mimeType: previous.mimeType,
      fileName: previous.fileName,
    }, null, tx);
    return { deleted: true };
  });
}

export async function readFactoryPurchaseOrderDispatchAttachment(
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  includeBody = true,
) {
  assertRead(actor, "salesExecution");
  await resolvePurchaseOrder(prisma, actor, executionId, purchaseOrderId, false);
  const asset = await prisma.fileAsset.findFirst({ where: activeAttachmentWhere(purchaseOrderId) });
  if (!asset) throw codedError("采购单尚未上传原始采购明细附件", 404, "PURCHASE_ORDER_ATTACHMENT_NOT_FOUND");
  const uploader = asset.uploadedById
    ? await prisma.user.findUnique({ where: { id: asset.uploadedById }, select: { id: true, name: true } })
    : null;
  const body = includeBody
    ? await readR2Object(asset.storageKey, { maxBytes: PURCHASE_ORDER_DISPATCH_ATTACHMENT_MAX_BYTES })
    : null;
  if (body) {
    const expectedSize = Number(asset.fileSize || 0);
    const expectedSha256 = String(asset.contentSha256 || "").toLowerCase();
    const actualSha256 = createHash("sha256").update(body).digest("hex");
    if (body.byteLength !== expectedSize || !/^[a-f0-9]{64}$/.test(expectedSha256) || actualSha256 !== expectedSha256) {
      throw codedError("采购明细附件完整性校验失败，请重新上传", 409, "PURCHASE_ORDER_ATTACHMENT_INTEGRITY_FAILED");
    }
  }
  return {
    ...publicAttachment(asset, uploader),
    body,
  };
}
