import { createHash } from "node:crypto";
import { isLocalDatabaseUrl } from "../database-url-security.ts";
import { deleteR2Object, readR2Object, uploadToR2 } from "../r2.ts";
import {
  deleteLocalQuotationDocument,
  readLocalQuotationDocument,
  writeLocalQuotationDocument,
} from "./local-quotation-document-storage.ts";

type StorageError = Error & { status?: number; code?: string; expose?: boolean };

type StoreInput = {
  key: string;
  body: Buffer | Uint8Array;
  contentType: "application/pdf";
  maxBytes: number;
  expectedSha256: string;
};

type ReadOptions = { maxBytes: number };

export const LOCAL_QUOTATION_DOCUMENT_BUCKET = "local://quotation-documents";
const LEGACY_LOCAL_QUOTATION_DOCUMENT_BUCKET = "local-development";

function storageError(message: string, status: number, code: string): StorageError {
  const error: StorageError = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}

export function quotationDocumentStorageDriver() {
  const driver = String(process.env.QUOTATION_FILE_STORAGE_DRIVER || "r2").trim().toLowerCase();
  if (driver !== "r2" && driver !== "local") {
    throw storageError("报价文件存储驱动配置无效", 500, "STORAGE_DRIVER_INVALID");
  }
  return driver;
}

function assertLocalDriverAllowed() {
  if (!["development", "test"].includes(String(process.env.NODE_ENV || "").toLowerCase())
    || process.env.VERCEL || process.env.VERCEL_ENV) {
    throw storageError("本地文件存储仅允许开发和测试环境使用", 503, "LOCAL_STORAGE_DISABLED");
  }
  if (!isLocalDatabaseUrl(String(process.env.DATABASE_URL || ""))) {
    throw storageError(
      "本地文件存储必须连接本机开发数据库，已拒绝写入共享数据库",
      503,
      "LOCAL_STORAGE_DATABASE_UNSAFE",
    );
  }
}

function localBucket(bucket: string | null) {
  return bucket === LOCAL_QUOTATION_DOCUMENT_BUCKET
    || bucket === LEGACY_LOCAL_QUOTATION_DOCUMENT_BUCKET;
}

function assertBody(input: StoreInput) {
  const body = Buffer.from(input.body);
  if (body.byteLength > input.maxBytes) {
    throw storageError("文件超过安全写入上限", 413, "R2_OBJECT_TOO_LARGE");
  }
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (sha256 !== input.expectedSha256) {
    throw storageError("形式发票文件完整性校验失败", 409, "QUOTATION_DOCUMENT_HASH_MISMATCH");
  }
  return body;
}

export async function storeQuotationDocumentObject(input: StoreInput) {
  const body = assertBody(input);
  if (quotationDocumentStorageDriver() === "r2") {
    return uploadToR2({ key: input.key, body, contentType: input.contentType });
  }
  assertLocalDriverAllowed();
  await writeLocalQuotationDocument(input.key, {
    body,
    maxBytes: input.maxBytes,
  });
  return { bucket: LOCAL_QUOTATION_DOCUMENT_BUCKET, key: input.key };
}

export async function readQuotationDocumentObject(bucket: string | null, key: string, options: ReadOptions) {
  const driver = quotationDocumentStorageDriver();
  if (!localBucket(bucket)) {
    return readR2Object(key, options);
  }
  if (driver !== "local") {
    throw storageError("当前存储驱动无法读取本地开发文件", 409, "STORAGE_PROVIDER_MISMATCH");
  }
  assertLocalDriverAllowed();
  return readLocalQuotationDocument(key, options);
}

export async function deleteQuotationDocumentObject(bucket: string | null, key: string) {
  const recordedBucket = String(bucket || "").trim();
  if (!recordedBucket) {
    throw storageError(
      "报价文件缺少原始存储桶记录，已拒绝删除，请先修复文件元数据",
      409,
      "QUOTATION_DOCUMENT_BUCKET_REQUIRED",
    );
  }
  const driver = quotationDocumentStorageDriver();
  if (localBucket(recordedBucket)) {
    if (driver !== "local") {
      throw storageError("当前存储驱动无法删除本地开发文件", 409, "STORAGE_PROVIDER_MISMATCH");
    }
    assertLocalDriverAllowed();
    try {
      await deleteLocalQuotationDocument(key);
    } catch (error) {
      if ((error as StorageError | null)?.code !== "R2_OBJECT_NOT_FOUND") throw error;
    }
    return;
  }
  if (driver !== "r2") {
    throw storageError("当前本地存储驱动无法删除 R2 报价文件", 409, "STORAGE_PROVIDER_MISMATCH");
  }
  // Reads and writes always use the currently configured canonical provider.
  // A record can still contain its pre-migration R2 bucket after the same key
  // has been copied to COS, so sending that legacy bucket to the COS endpoint
  // would make the cleanup task fail forever.
  await deleteR2Object(key);
}
