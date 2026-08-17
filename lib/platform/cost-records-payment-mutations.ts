import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { buildCostPaymentVoucherKey, readR2Object, safeFileName } from "../r2";
import { attachBusinessDocumentsToCost } from "./business-documents";
import { includeCostRelations } from "./cost-records-shared";
import {
  FILE_ASSET_ROLES,
  FILE_ASSET_SOURCE_TABLES,
  ORDER_COST_STATUS_VOID,
  assertRead,
  assertWrite,
  codedError,
  deleteManagedStoredFile,
  enqueueFileStorageDeletion,
  findActiveFileAssetBySource,
  managedFileMetadata,
  managedPreviewableMimeType,
  mergeFileAssetMetadata,
  readManagedUploadFile,
  runNonCriticalTask,
  safeSerializeCost,
  uploadManagedFileToStorage,
  upsertFileAssetForPaymentVoucher,
  writeAudit,
} from "./shared";
import {
  assertCanManageProductSupplierPayment,
  loadCostForPayment,
  loadCostForPaymentVoucher,
  paidAtFromInput,
  paymentBooleanInput,
  paymentVoucherFileName,
  requireCostActor,
  type AuditRequestLike,
  type CostActorInput,
  type CostInput,
} from "./cost-records-mutation-shared";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";

export async function updateProductSupplierCostPayment(request: AuditRequestLike, actor: CostActorInput, id: string, input: CostInput) {
  assertWrite(actor, "payments");
  const currentActor = requireCostActor(actor);
  assertCanManageProductSupplierPayment(currentActor);
  const before = await loadCostForPayment(currentActor, id, "修改付款状态");
  const paid = paymentBooleanInput(input.paid ?? input.isPaid ?? input.paymentPaid);
  const paidAt = paid ? paidAtFromInput(input.paidAt ?? input.paymentTime ?? input.paymentDate) : null;
  const data = {
    paid,
    paidAt,
    paymentStatus: paid ? "已支付" : "待支付",
    paymentDate: paidAt,
    updatedById: currentActor.id,
  } as Prisma.OrderCostUncheckedUpdateInput;
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.orderCost.updateMany({
      where: {
        id,
        updatedAt: before.updatedAt,
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
      },
      data,
    });
    if (changed.count !== 1) {
      throw codedError("成本付款状态已被其他操作修改，请刷新后重试。", 409, "COST_PAYMENT_CONFLICT");
    }
    const current = await tx.orderCost.findUnique({ where: { id }, include: includeCostRelations() });
    if (!current) throw codedError("成本付款状态已发生变化，请刷新后重试。", 409, "COST_PAYMENT_CONFLICT");
    await writeAudit(
      request,
      currentActor,
      paid ? "标记产品供应商货款已付款" : "取消产品供应商货款付款",
      "order_costs",
      id,
      before,
      current,
      tx,
    );
    return current;
  });
  invalidateWorkbenchTodosCache();
  return safeSerializeCost(await attachBusinessDocumentsToCost(updated));
}

export async function uploadProductSupplierCostPaymentVoucher(request: AuditRequestLike, actor: CostActorInput, id: string, file: unknown) {
  assertWrite(actor, "payments");
  const currentActor = requireCostActor(actor);
  assertCanManageProductSupplierPayment(currentActor);
  const before = await loadCostForPaymentVoucher(currentActor, id);
  const uploadedFile = await readManagedUploadFile(file, "paymentVoucherImage", "payment-voucher.jpg");
  const { mimeType, fileSize } = uploadedFile;
  const extension = uploadedFile.extension || "jpg";
  const fileName = paymentVoucherFileName(extension);
  const storageFileName = safeFileName(`payment-voucher-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${fileName.split(".").pop() || extension}`);
  const storageKey = buildCostPaymentVoucherKey({ costId: id, fileName: storageFileName });
  const previousStorageKey = before.paymentVoucherStorageKey || "";
  if (previousStorageKey && previousStorageKey === storageKey) {
    throw codedError("付款凭证替换失败，请重新上传。", 409, "PAYMENT_VOUCHER_REPLACE_UNCHANGED");
  }
  const storedFile = await uploadManagedFileToStorage({ file: uploadedFile, storageKey, fileName });
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.orderCost.updateMany({
        where: {
          id,
          updatedAt: before.updatedAt,
          deletedAt: null,
          status: { not: ORDER_COST_STATUS_VOID },
        },
        data: {
          paymentVoucherUrl: null,
          paymentVoucherFileName: fileName,
          paymentVoucherMimeType: storedFile.mimeType || mimeType,
          paymentVoucherUploadedAt: storedFile.uploadedAt,
          paymentVoucherStorageKey: storedFile.storageKey,
          paymentVoucherBucket: storedFile.bucket,
          updatedById: currentActor.id,
        } as Prisma.OrderCostUncheckedUpdateInput,
      });
      if (changed.count !== 1) {
        throw codedError("付款凭证已被其他操作替换，请刷新后重试。", 409, "PAYMENT_VOUCHER_REPLACE_CONFLICT");
      }
      const saved = await tx.orderCost.findUnique({ where: { id }, include: includeCostRelations() });
      if (!saved) throw codedError("付款凭证状态已发生变化，请刷新后重试。", 409, "PAYMENT_VOUCHER_REPLACE_CONFLICT");
      if (previousStorageKey && previousStorageKey !== storedFile.storageKey) {
        await enqueueFileStorageDeletion(tx, {
          storageKey: previousStorageKey,
          sourceTable: FILE_ASSET_SOURCE_TABLES.ORDER_COSTS,
          sourceId: id,
          fileRole: FILE_ASSET_ROLES.PAYMENT_VOUCHER,
          deleteAfter: new Date(),
        });
      }
      await upsertFileAssetForPaymentVoucher(tx, saved);
      await writeAudit(request, currentActor, "上传产品供应商货款付款凭证", "order_costs", id, before, {
        costId: id,
        operatorId: currentActor.id,
        replacedAt: storedFile.uploadedAt,
        replacedExistingFile: Boolean(previousStorageKey),
        previousFileName: before.paymentVoucherFileName || "",
        fileName,
        mimeType,
        fileSize,
      }, tx);
      return saved;
    });
  } catch (error: unknown) {
    await deleteManagedStoredFile(storedFile.storageKey);
    throw error;
  }
  if (previousStorageKey && previousStorageKey !== storedFile.storageKey) {
    await runNonCriticalTask("付款凭证旧文件删除", () => deleteManagedStoredFile(previousStorageKey));
  }
  invalidateWorkbenchTodosCache();
  return safeSerializeCost(await attachBusinessDocumentsToCost(updated));
}

async function resolveProductSupplierCostPaymentVoucher(actor: CostActorInput, id: string) {
  assertRead(actor, "costs");
  const currentActor = requireCostActor(actor);
  const cost = await loadCostForPayment(currentActor, id);
  const asset = await findActiveFileAssetBySource(
    FILE_ASSET_SOURCE_TABLES.ORDER_COSTS,
    cost.id,
    FILE_ASSET_ROLES.PAYMENT_VOUCHER,
  );
  const storageKey = asset?.storageKey || cost.paymentVoucherStorageKey || "";
  if (!storageKey) throw codedError("该成本记录尚未上传付款凭证。", 404, "PAYMENT_VOUCHER_NOT_FOUND");
  const mimeType = asset?.mimeType || cost.paymentVoucherMimeType || "application/octet-stream";
  const fileName = asset?.fileName || cost.paymentVoucherFileName || "汇款水单.jpg";
  const metadata = {
    id: cost.id,
    ...managedFileMetadata({
      fileUrl: asset?.fileUrl || cost.paymentVoucherUrl,
      fileName,
      originalFileName: asset?.originalFileName || cost.paymentVoucherFileName,
      mimeType,
      uploadedAt: asset?.uploadedAt || cost.paymentVoucherUploadedAt,
      uploadedBy: asset?.uploadedById ? cost.updatedBy : null,
      binding: {
        orderId: cost.orderId,
        costId: cost.id,
        supplierId: cost.supplierId,
        relatedModule: "COST_PAYMENT",
      },
    }),
    previewKind: managedPreviewableMimeType(mimeType),
  };
  return {
    storageKey,
    mimeType: metadata.mimeType,
    fileName: metadata.fileName,
    cost: safeSerializeCost(cost),
    metadata: mergeFileAssetMetadata(metadata, asset),
  };
}

export async function getProductSupplierCostPaymentVoucherMetadata(_request: AuditRequestLike, actor: CostActorInput, id: string) {
  const { storageKey: _storageKey, ...publicResult } = await resolveProductSupplierCostPaymentVoucher(actor, id);
  return publicResult;
}

export async function getProductSupplierCostPaymentVoucher(request: AuditRequestLike, actor: CostActorInput, id: string) {
  const resolved = await resolveProductSupplierCostPaymentVoucher(actor, id);
  const body = await readR2Object(resolved.storageKey);
  return {
    body,
    mimeType: resolved.mimeType,
    fileName: resolved.fileName,
    cost: resolved.cost,
    metadata: resolved.metadata,
  };
}
