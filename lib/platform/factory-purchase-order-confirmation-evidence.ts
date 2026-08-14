import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { readR2Object, safeFileName } from "../r2";
import { assertRead, assertWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import { deleteManagedStoredFile, uploadManagedFileToStorage } from "./file-center";
import { enqueueFileStorageDeletion } from "./file-storage-deletion-outbox";
import { FILE_ASSET_ROLES, FILE_ASSET_SOURCE_TABLES } from "./file-asset-data";
import { readValidatedConfirmationEvidenceUploadFile } from "./upload-validation";
import { salesExecutionAccessWhere, type SalesExecutionActor } from "./sales-execution-access";
import { requireActiveInternalConfirmationActor } from "./factory-purchase-order-confirmation-access";

type AuditRequest = Parameters<typeof writeAudit>[0];
export type ConfirmationEvidenceKind = "SUPPLIER_RESPONSE" | "PRODUCTION_COMPLETION";
const REPLACED_EVIDENCE_DELETE_GRACE_MS = 10 * 60 * 1000;

function evidenceKind(value: unknown): ConfirmationEvidenceKind {
  const kind = String(value || "").trim().toUpperCase();
  if (kind !== "SUPPLIER_RESPONSE" && kind !== "PRODUCTION_COMPLETION") {
    throw codedError("确认凭证类型无效", 400, "FACTORY_CONFIRMATION_EVIDENCE_KIND_INVALID");
  }
  return kind;
}

async function resolveEvidenceTarget(
  client: Prisma.TransactionClient | typeof prisma,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  kindValue: unknown,
  eventIdValue: unknown,
) {
  const kind = evidenceKind(kindValue);
  const eventId = String(eventIdValue || "").trim();
  if (!eventId) throw codedError("确认事件不存在", 404, "FACTORY_CONFIRMATION_EVENT_NOT_FOUND");
  const order = await client.factoryPurchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      executionId,
      execution: { is: salesExecutionAccessWhere(actor) },
    },
    select: {
      id: true,
      supplierId: true,
      productionCompletedAt: true,
      productionCompletionSource: true,
      supplierResponses: {
        where: { id: eventId },
        select: { id: true, source: true },
        take: 1,
      },
    },
  });
  if (!order) throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
  if (kind === "SUPPLIER_RESPONSE") {
    const response = order.supplierResponses[0];
    if (!response || response.source !== "INTERNAL_OFFLINE") {
      throw codedError("线下回复确认事件不存在", 404, "FACTORY_CONFIRMATION_EVENT_NOT_FOUND");
    }
    return {
      kind,
      eventId: response.id,
      supplierId: order.supplierId,
      sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDER_SUPPLIER_RESPONSES,
      fileRole: FILE_ASSET_ROLES.SUPPLIER_CONFIRMATION_EVIDENCE,
    };
  }
  if (eventId !== order.id || !order.productionCompletedAt || order.productionCompletionSource !== "INTERNAL_OFFLINE") {
    throw codedError("线下完工确认事件不存在", 404, "FACTORY_CONFIRMATION_EVENT_NOT_FOUND");
  }
  return {
    kind,
    eventId: order.id,
    supplierId: order.supplierId,
    sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS,
    fileRole: FILE_ASSET_ROLES.PRODUCTION_COMPLETION_EVIDENCE,
  };
}

function publicEvidence(asset: {
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
  };
}

export async function uploadFactoryConfirmationEvidence(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  input: { eventKind: unknown; eventId: unknown; file: unknown },
) {
  assertWrite(actor, "salesExecution");
  const initialTarget = await resolveEvidenceTarget(prisma, actor, executionId, purchaseOrderId, input.eventKind, input.eventId);
  const file = await readValidatedConfirmationEvidenceUploadFile(input.file);
  const displayFileName = safeFileName(file.originalFileName || "confirmation-evidence");
  const storedFileName = safeFileName(`${Date.now()}-${randomUUID().slice(0, 8)}-${displayFileName}`);
  const storageKey = `factory-purchase-orders/${purchaseOrderId}/confirmations/${initialTarget.eventId}/${storedFileName}`;
  const stored = await uploadManagedFileToStorage({ file, storageKey, fileName: displayFileName });
  let previousStorageKey = "";
  let saved;
  try {
    saved = await prisma.$transaction(async (tx) => {
      const validActor = await requireActiveInternalConfirmationActor(tx, actor);
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${purchaseOrderId} FOR UPDATE`;
      const target = await resolveEvidenceTarget(tx, validActor, executionId, purchaseOrderId, input.eventKind, input.eventId);
      const previous = await tx.fileAsset.findUnique({
        where: { sourceTable_sourceId_fileRole: {
          sourceTable: target.sourceTable,
          sourceId: target.eventId,
          fileRole: target.fileRole,
        } },
      });
      previousStorageKey = previous?.storageKey || "";
      const asset = await tx.fileAsset.upsert({
        where: { sourceTable_sourceId_fileRole: {
          sourceTable: target.sourceTable,
          sourceId: target.eventId,
          fileRole: target.fileRole,
        } },
        create: {
          fileName: displayFileName,
          originalFileName: file.originalFileName,
          mimeType: stored.mimeType,
          fileSize: stored.fileSize,
          contentSha256: createHash("sha256").update(file.body).digest("hex"),
          storageKey: stored.storageKey,
          bucket: stored.bucket,
          uploadedAt: stored.uploadedAt,
          uploadedById: validActor.id,
          bindingType: "FACTORY_CONFIRMATION_EVIDENCE",
          sourceTable: target.sourceTable,
          sourceId: target.eventId,
          fileRole: target.fileRole,
          supplierId: target.supplierId,
          relatedModule: "SALES_EXECUTION",
        },
        update: {
          fileName: displayFileName,
          originalFileName: file.originalFileName,
          mimeType: stored.mimeType,
          fileSize: stored.fileSize,
          contentSha256: createHash("sha256").update(file.body).digest("hex"),
          storageKey: stored.storageKey,
          bucket: stored.bucket,
          uploadedAt: stored.uploadedAt,
          uploadedById: validActor.id,
          isDeleted: false,
          deletedAt: null,
        },
      });
      if (previousStorageKey && previousStorageKey !== stored.storageKey) {
        await enqueueFileStorageDeletion(tx, {
          storageKey: previousStorageKey,
          bucket: previous?.bucket,
          sourceTable: target.sourceTable,
          sourceId: target.eventId,
          fileRole: target.fileRole,
          deleteAfter: new Date(Date.now() + REPLACED_EVIDENCE_DELETE_GRACE_MS),
        });
      }
      const savedEvidence = publicEvidence(asset, { id: validActor.id, name: validActor.name });
      await writeAudit(request, { id: validActor.id }, "上传或替换供应商确认凭证", target.sourceTable, target.eventId, previous ? {
        fileName: previous.fileName,
        uploadedAt: previous.uploadedAt,
      } : null, savedEvidence, tx);
      return savedEvidence;
    });
  } catch (error: unknown) {
    await deleteManagedStoredFile(stored.storageKey).catch(() => null);
    throw error;
  }
  return saved;
}

export async function readFactoryConfirmationEvidence(
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  kindValue: unknown,
  eventIdValue: unknown,
  includeBody = true,
) {
  assertRead(actor, "salesExecution");
  const target = await resolveEvidenceTarget(prisma, actor, executionId, purchaseOrderId, kindValue, eventIdValue);
  const asset = await prisma.fileAsset.findFirst({
    where: {
      sourceTable: target.sourceTable,
      sourceId: target.eventId,
      fileRole: target.fileRole,
      isDeleted: false,
      deletedAt: null,
    },
  });
  if (!asset) throw codedError("该确认事件尚未上传凭证", 404, "FACTORY_CONFIRMATION_EVIDENCE_NOT_FOUND");
  const uploader = asset.uploadedById
    ? await prisma.user.findUnique({ where: { id: asset.uploadedById }, select: { id: true, name: true } })
    : null;
  return {
    ...publicEvidence(asset, uploader),
    body: includeBody ? await readR2Object(asset.storageKey, { maxBytes: 10 * 1024 * 1024 }) : null,
  };
}
