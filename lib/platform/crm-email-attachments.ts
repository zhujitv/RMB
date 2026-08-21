import crypto from "node:crypto";
import type { FileAsset, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { readObjectStorageObject, safeObjectFileName, uploadObjectStorage } from "../object-storage";
import { codedError, managedFileStreamHeaders } from "./shared";
import {
  assertCustomerCrmRead,
  assertScopedCustomerForCrmEmail,
  CRM_EMAIL_ATTACHMENT_MAX_BYTES,
  type CrmEmailActor,
  type CrmEmailAttachmentFile,
} from "./crm-email-shared";

export const CRM_EMAIL_ATTACHMENT_SOURCE_TABLE = "crm_email_messages";
const CRM_EMAIL_ATTACHMENT_ROLE_PREFIX = "CRM_EMAIL_ATTACHMENT";
const CRM_EMAIL_ATTACHMENT_MAX_COUNT = 5;
const CRM_EMAIL_ATTACHMENT_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
const CRM_EMAIL_ATTACHMENT_ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function messageAttachmentRole(index: number) {
  return `${CRM_EMAIL_ATTACHMENT_ROLE_PREFIX}_${index + 1}`;
}

export function serializeCrmEmailAttachment(asset: FileAsset) {
  return {
    id: asset.id,
    fileName: asset.fileName,
    originalFileName: asset.originalFileName || asset.fileName,
    mimeType: asset.mimeType,
    fileSize: asset.fileSize || 0,
    uploadedAt: asset.uploadedAt || asset.createdAt,
    downloadUrl: `/api/customer-email-messages/${encodeURIComponent(asset.sourceId)}/attachments/${encodeURIComponent(asset.id)}/download`,
  };
}

function normalizeAttachmentMimeType(file: File) {
  const mimeType = String(file.type || "application/octet-stream").toLowerCase();
  if (mimeType !== "application/octet-stream") return mimeType;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".txt")) return "text/plain";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".doc")) return "application/msword";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".xls")) return "application/vnd.ms-excel";
  if (name.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (name.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (name.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return mimeType;
}

async function readCrmEmailAttachmentFile(candidate: unknown, index: number): Promise<CrmEmailAttachmentFile> {
  if (!(candidate instanceof File)) throw codedError("附件格式错误", 400, "CRM_EMAIL_ATTACHMENT_INVALID");
  const originalFileName = safeObjectFileName(candidate.name || `attachment-${index + 1}`);
  const mimeType = normalizeAttachmentMimeType(candidate);
  if (!CRM_EMAIL_ATTACHMENT_ALLOWED_MIMES.has(mimeType)) {
    throw codedError(`附件类型暂不支持：${originalFileName}`, 415, "CRM_EMAIL_ATTACHMENT_TYPE_INVALID");
  }
  const fileSize = Number(candidate.size || 0);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) throw codedError(`附件不能为空：${originalFileName}`, 400, "CRM_EMAIL_ATTACHMENT_EMPTY");
  if (fileSize > CRM_EMAIL_ATTACHMENT_MAX_BYTES) throw codedError(`附件超过 10MB：${originalFileName}`, 413, "CRM_EMAIL_ATTACHMENT_TOO_LARGE");
  const body = Buffer.from(await candidate.arrayBuffer());
  if (body.byteLength !== fileSize) throw codedError(`附件读取不完整：${originalFileName}`, 400, "CRM_EMAIL_ATTACHMENT_SIZE_MISMATCH");
  return {
    originalFileName,
    fileName: originalFileName,
    mimeType,
    fileSize,
    body,
    contentSha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
}

export async function readCrmEmailAttachmentFiles(formData: FormData) {
  const rawFiles = [...formData.getAll("attachments"), ...formData.getAll("files")].filter(Boolean);
  if (rawFiles.length > CRM_EMAIL_ATTACHMENT_MAX_COUNT) {
    throw codedError(`邮件附件最多 ${CRM_EMAIL_ATTACHMENT_MAX_COUNT} 个`, 413, "CRM_EMAIL_ATTACHMENT_COUNT_LIMIT");
  }
  const files = await Promise.all(rawFiles.map((file, index) => readCrmEmailAttachmentFile(file, index)));
  const totalBytes = files.reduce((total, file) => total + file.fileSize, 0);
  if (totalBytes > CRM_EMAIL_ATTACHMENT_TOTAL_MAX_BYTES) {
    throw codedError("邮件附件总大小不能超过 20MB", 413, "CRM_EMAIL_ATTACHMENT_TOTAL_TOO_LARGE");
  }
  return files;
}

function crmAttachmentStorageKey(customerId: string, messageId: string, index: number, file: CrmEmailAttachmentFile) {
  const name = safeObjectFileName(`${index + 1}-${file.contentSha256.slice(0, 12)}-${file.originalFileName}`);
  return `crm-email/${customerId}/${messageId}/attachments/${name}`;
}

export async function storeCrmEmailAttachments(input: {
  tx: Prisma.TransactionClient;
  actorId: string;
  customerId: string;
  messageId: string;
  files: CrmEmailAttachmentFile[];
}) {
  const assets: FileAsset[] = [];
  for (let index = 0; index < input.files.length; index += 1) {
    const file = input.files[index];
    const stored = await uploadObjectStorage({
      key: crmAttachmentStorageKey(input.customerId, input.messageId, index, file),
      body: file.body,
      contentType: file.mimeType,
    });
    const asset = await input.tx.fileAsset.upsert({
      where: {
        sourceTable_sourceId_fileRole: {
          sourceTable: CRM_EMAIL_ATTACHMENT_SOURCE_TABLE,
          sourceId: input.messageId,
          fileRole: messageAttachmentRole(index),
        },
      },
      create: fileAssetData(file, stored, input, index),
      update: { ...fileAssetData(file, stored, input, index), bindingType: undefined, sourceTable: undefined, sourceId: undefined, fileRole: undefined, relatedModule: undefined },
    });
    assets.push(asset);
  }
  return assets;
}

function fileAssetData(
  file: CrmEmailAttachmentFile,
  stored: { key: string; bucket: string },
  input: { actorId: string; messageId: string },
  index: number,
) {
  return {
    fileUrl: null,
    fileName: file.fileName,
    originalFileName: file.originalFileName,
    mimeType: file.mimeType,
    fileSize: file.fileSize,
    contentSha256: file.contentSha256,
    storageKey: stored.key,
    bucket: stored.bucket,
    uploadedAt: new Date(),
    uploadedById: input.actorId || null,
    bindingType: "CRM_EMAIL_ATTACHMENT",
    sourceTable: CRM_EMAIL_ATTACHMENT_SOURCE_TABLE,
    sourceId: input.messageId,
    fileRole: messageAttachmentRole(index),
    relatedModule: "CRM_EMAIL",
    isDeleted: false,
    deletedAt: null,
  };
}

export async function listCrmEmailAttachments(messageIds: string[]) {
  if (!messageIds.length) return new Map<string, ReturnType<typeof serializeCrmEmailAttachment>[]>();
  const assets = await prisma.fileAsset.findMany({
    where: { sourceTable: CRM_EMAIL_ATTACHMENT_SOURCE_TABLE, sourceId: { in: messageIds }, isDeleted: false, deletedAt: null },
    orderBy: [{ sourceId: "asc" }, { fileRole: "asc" }],
  });
  const grouped = new Map<string, ReturnType<typeof serializeCrmEmailAttachment>[]>();
  for (const asset of assets) {
    const rows = grouped.get(asset.sourceId) || [];
    rows.push(serializeCrmEmailAttachment(asset));
    grouped.set(asset.sourceId, rows);
  }
  return grouped;
}

export async function readCustomerCrmEmailAttachment(actor: CrmEmailActor, messageId: string, assetId: string) {
  assertCustomerCrmRead(actor);
  const message = await prisma.crmEmailMessage.findUnique({ where: { id: messageId } });
  if (!message || message.deletedAt) throw codedError("邮件记录不存在", 404, "CRM_EMAIL_MESSAGE_NOT_FOUND");
  await assertScopedCustomerForCrmEmail(actor, message.customerId);
  const asset = await prisma.fileAsset.findFirst({
    where: { id: assetId, sourceTable: CRM_EMAIL_ATTACHMENT_SOURCE_TABLE, sourceId: message.id, isDeleted: false, deletedAt: null },
  });
  if (!asset) throw codedError("邮件附件不存在", 404, "CRM_EMAIL_ATTACHMENT_NOT_FOUND");
  const body = await readObjectStorageObject(asset.storageKey, { maxBytes: CRM_EMAIL_ATTACHMENT_MAX_BYTES });
  if (asset.contentSha256) {
    const actual = crypto.createHash("sha256").update(body).digest("hex");
    if (actual !== asset.contentSha256) throw codedError("邮件附件校验失败，请联系管理员检查文件存储。", 409, "CRM_EMAIL_ATTACHMENT_HASH_MISMATCH");
  }
  return {
    body,
    headers: managedFileStreamHeaders({
      bodyLength: body.byteLength,
      mimeType: asset.mimeType,
      fileName: asset.fileName,
      disposition: "attachment",
    }),
  };
}
