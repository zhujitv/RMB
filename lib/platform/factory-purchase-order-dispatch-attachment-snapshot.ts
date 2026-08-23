import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { readR2Object, safeFileName } from "../r2";
import { FILE_ASSET_ROLES, FILE_ASSET_SOURCE_TABLES } from "./file-asset-data";
import { PURCHASE_ORDER_DISPATCH_ATTACHMENT_MAX_BYTES } from "./factory-purchase-order-dispatch-attachment-validation";
import { codedError } from "./shared-base-errors";

type DispatchAttachmentSnapshot = {
  assetId: string;
  sha256: string;
  size: number;
  mimeType: string;
  fileName: string;
};

function activeAttachmentWhere(purchaseOrderId: string) {
  return {
    sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS,
    sourceId: purchaseOrderId,
    fileRole: FILE_ASSET_ROLES.PURCHASE_ORDER_ORIGINAL_DETAIL,
    isDeleted: false,
    deletedAt: null,
  } as const;
}

export function parseDispatchAttachmentSnapshot(value: unknown): DispatchAttachmentSnapshot | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw codedError("采购单邮件附件快照无效", 409, "PURCHASE_ORDER_ATTACHMENT_SNAPSHOT_INVALID");
  }
  const data = value as Record<string, unknown>;
  const snapshot = {
    assetId: String(data.assetId || "").trim(),
    sha256: String(data.sha256 || "").trim().toLowerCase(),
    size: Number(data.size || 0),
    mimeType: String(data.mimeType || "").trim().toLowerCase(),
    fileName: safeFileName(String(data.fileName || "采购明细.pdf")),
  };
  if (
    !snapshot.assetId
    || !/^[a-f0-9]{64}$/.test(snapshot.sha256)
    || !Number.isSafeInteger(snapshot.size)
    || snapshot.size <= 0
    || snapshot.size > PURCHASE_ORDER_DISPATCH_ATTACHMENT_MAX_BYTES
    || !["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(snapshot.mimeType)
  ) {
    throw codedError("采购单邮件附件快照无效", 409, "PURCHASE_ORDER_ATTACHMENT_SNAPSHOT_INVALID");
  }
  return snapshot;
}

export function dispatchAttachmentSnapshotFromAsset(asset: {
  id: string;
  contentSha256: string | null;
  fileSize: number | null;
  mimeType: string;
  fileName: string;
}) {
  return parseDispatchAttachmentSnapshot({
    assetId: asset.id,
    sha256: asset.contentSha256,
    size: asset.fileSize,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
  });
}

export async function readFrozenFactoryPurchaseOrderDispatchAttachment(
  purchaseOrderId: string,
  snapshotValue: unknown,
) {
  const snapshot = parseDispatchAttachmentSnapshot(snapshotValue);
  if (!snapshot) return [];
  const order = await prisma.factoryPurchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, supplierId: true },
  });
  if (!order) throw codedError("采购单邮件附件绑定已失效", 409, "PURCHASE_ORDER_ATTACHMENT_BINDING_INVALID");
  const asset = await prisma.fileAsset.findFirst({
    where: {
      id: snapshot.assetId,
      ...activeAttachmentWhere(order.id),
      supplierId: order.supplierId,
    },
  });
  if (!asset) throw codedError("采购单邮件附件已丢失，邮件未发送", 409, "PURCHASE_ORDER_ATTACHMENT_NOT_FOUND");
  const storedSnapshot = dispatchAttachmentSnapshotFromAsset(asset);
  if (
    !storedSnapshot
    || storedSnapshot.assetId !== snapshot.assetId
    || storedSnapshot.sha256 !== snapshot.sha256
    || storedSnapshot.size !== snapshot.size
    || storedSnapshot.mimeType !== snapshot.mimeType
    || storedSnapshot.fileName !== snapshot.fileName
  ) {
    throw codedError("采购单邮件附件与下发快照不一致，邮件未发送", 409, "PURCHASE_ORDER_ATTACHMENT_CHANGED");
  }
  const body = await readR2Object(asset.storageKey, { maxBytes: PURCHASE_ORDER_DISPATCH_ATTACHMENT_MAX_BYTES });
  if (body.byteLength !== snapshot.size || createHash("sha256").update(body).digest("hex") !== snapshot.sha256) {
    throw codedError("采购单邮件附件校验失败，邮件未发送", 409, "PURCHASE_ORDER_ATTACHMENT_INTEGRITY_FAILED");
  }
  return [{
    filename: snapshot.fileName,
    content: body,
    contentType: snapshot.mimeType,
    sha256: snapshot.sha256,
  }];
}
