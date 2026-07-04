import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { buildCostPaymentVoucherKey, readR2Object, safeFileName } from "../r2";
import { attachBusinessDocumentsToCost } from "./business-documents";
import { includeCostRelations } from "./cost-records-shared";
import {
  FILE_ASSET_ROLES,
  FILE_ASSET_SOURCE_TABLES,
  assertRead,
  codedError,
  deleteManagedStoredFile,
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
  paidAtFromInput,
  paymentBooleanInput,
  paymentVoucherFileName,
  requireCostActor,
  type AuditRequestLike,
  type CostActorInput,
  type CostInput,
} from "./cost-records-mutation-shared";

export async function updateProductSupplierCostPayment(request: AuditRequestLike, actor: CostActorInput, id: string, input: CostInput) {
  assertRead(actor, "costs");
  const currentActor = requireCostActor(actor);
  assertCanManageProductSupplierPayment(currentActor);
  const before = await loadCostForPayment(currentActor, id);
  const paid = paymentBooleanInput(input.paid ?? input.isPaid ?? input.paymentPaid);
  const paidAt = paid ? paidAtFromInput(input.paidAt ?? input.paymentTime ?? input.paymentDate) : null;
  const data = {
    paid,
    paidAt,
    paymentStatus: paid ? "已支付" : "待支付",
    paymentDate: paidAt,
    updatedById: currentActor.id,
  } as Prisma.OrderCostUncheckedUpdateInput;
  const updated = await prisma.orderCost.update({
    where: { id },
    data,
    include: includeCostRelations(),
  });
  await runNonCriticalTask("成本付款信息操作日志写入", () => writeAudit(request, currentActor, paid ? "标记产品供应商货款已付款" : "取消产品供应商货款付款", "order_costs", id, before, updated));
  return safeSerializeCost(await attachBusinessDocumentsToCost(updated));
}

export async function uploadProductSupplierCostPaymentVoucher(request: AuditRequestLike, actor: CostActorInput, id: string, file: unknown) {
  assertRead(actor, "costs");
  const currentActor = requireCostActor(actor);
  assertCanManageProductSupplierPayment(currentActor);
  const before = await loadCostForPayment(currentActor, id);
  const uploadedFile = await readManagedUploadFile(file, "paymentVoucherImage", "payment-voucher.jpg");
  const { mimeType, fileSize } = uploadedFile;
  const extension = uploadedFile.extension || "jpg";
  const fileName = paymentVoucherFileName(extension);
  const storageFileName = safeFileName(`payment-voucher-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${fileName.split(".").pop() || extension}`);
  const storageKey = buildCostPaymentVoucherKey({ costId: id, fileName: storageFileName });
  const storedFile = await uploadManagedFileToStorage({ file: uploadedFile, storageKey, fileName });
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.orderCost.update({
        where: { id },
        data: {
          paymentVoucherUrl: null,
          paymentVoucherFileName: fileName,
          paymentVoucherMimeType: storedFile.mimeType || mimeType,
          paymentVoucherUploadedAt: storedFile.uploadedAt,
          paymentVoucherStorageKey: storedFile.storageKey,
          paymentVoucherBucket: storedFile.bucket,
          updatedById: currentActor.id,
        } as Prisma.OrderCostUncheckedUpdateInput,
        include: includeCostRelations(),
      });
      await upsertFileAssetForPaymentVoucher(tx, saved);
      return saved;
    });
  } catch (error: unknown) {
    await deleteManagedStoredFile(storedFile.storageKey).catch(() => null);
    throw error;
  }
  const oldStorageKey = before.paymentVoucherStorageKey || "";
  if (oldStorageKey && oldStorageKey !== storedFile.storageKey) {
    await runNonCriticalTask("付款凭证旧文件删除", () => deleteManagedStoredFile(oldStorageKey));
  }
  await runNonCriticalTask("成本付款凭证操作日志写入", () => writeAudit(request, currentActor, "上传产品供应商货款付款凭证", "order_costs", id, before, {
    costId: id,
    fileName,
    mimeType,
    fileSize,
  }));
  return safeSerializeCost(await attachBusinessDocumentsToCost(updated));
}

export async function getProductSupplierCostPaymentVoucherMetadata(_request: AuditRequestLike, actor: CostActorInput, id: string) {
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
      storageKey,
      bucket: asset?.bucket || cost.paymentVoucherBucket,
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
    mimeType: metadata.mimeType,
    fileName: metadata.fileName,
    cost: safeSerializeCost(cost),
    metadata: mergeFileAssetMetadata(metadata, asset),
  };
}

export async function getProductSupplierCostPaymentVoucher(request: AuditRequestLike, actor: CostActorInput, id: string) {
  const metadata = await getProductSupplierCostPaymentVoucherMetadata(request, actor, id);
  const storageKey = metadata.metadata.storageKey || "";
  const body = await readR2Object(storageKey);
  return {
    body,
    mimeType: metadata.mimeType,
    fileName: metadata.fileName,
    cost: metadata.cost,
    metadata: metadata.metadata,
  };
}
