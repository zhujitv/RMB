import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { objectStorageConfig } from "./object-storage-config.ts";

export { objectStorageConfig } from "./object-storage-config.ts";

type StorageError = Error & {
  status?: number;
  code?: string;
  details?: unknown;
  expose?: boolean;
};

type OrderDocumentKeyInput = {
  orderId: string;
  documentType: string;
  fileName: string;
  relatedModule?: string;
  supplierId?: string;
};
type CostPaymentVoucherKeyInput = {
  costId: string;
  fileName: string;
};

type ObjectStorageUploadInput = {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string | null;
};

type ReadObjectStorageOptions = {
  maxBytes?: number;
  signal?: AbortSignal;
};

export const DEFAULT_OBJECT_STORAGE_BUFFER_LIMIT_BYTES = 64 * 1024 * 1024;

type TransformableStream = {
  transformToByteArray?: () => Promise<Uint8Array>;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer | string>;
} | null | undefined;

function storageError(message: string, status = 500, code = "STORAGE_ERROR", details: unknown = {}): StorageError {
  const error: StorageError = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  error.expose = true;
  return error;
}

function storageConfig() {
  return objectStorageConfig();
}

function storageClient(config = storageConfig()) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function r2BucketName() {
  return objectStorageBucketName();
}

export function objectStorageBucketName() {
  return storageConfig().bucket;
}

export function ensureR2Configured() {
  return ensureObjectStorageConfigured();
}

export function ensureObjectStorageConfigured() {
  return storageConfig();
}

export async function checkR2Storage() {
  return checkObjectStorage();
}

export async function checkObjectStorage() {
  const config = storageConfig();
  try {
    await storageClient().send(new HeadBucketCommand({ Bucket: config.bucket }));
  } catch (error) {
    throw normalizeStorageError(error);
  }
  return {
    ok: true,
    provider: config.provider,
    bucket: config.bucket,
    endpoint: config.endpoint,
  };
}

export function safeFileName(name = "document.pdf") {
  const base = String(name || "document.pdf").split(/[\\/]/).pop() || "document.pdf";
  return base
    .normalize("NFKC")
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "document.pdf";
}

export function buildOrderDocumentKey({ orderId, documentType, fileName, relatedModule = "EXPORT", supplierId = "" }: OrderDocumentKeyInput) {
  const safeName = safeFileName(fileName);
  if (relatedModule === "SUPPLIER") {
    return `receivable-orders/${orderId}/supplier-documents/${supplierId || "unknown-supplier"}/${documentType}/${safeName}`;
  }
  if (relatedModule === "SALES") {
    return `receivable-orders/${orderId}/sales-contracts/${safeName}`;
  }
  return `receivable-orders/${orderId}/export-documents/${documentType}/${safeName}`;
}

export function buildCostPaymentVoucherKey({ costId, fileName }: CostPaymentVoucherKeyInput) {
  return `order-costs/${costId}/payment-voucher/${safeFileName(fileName || "payment-voucher")}`;
}

export function objectStorageDeleteObjectTarget(key: string, bucket: string) {
  const targetKey = String(key || "");
  const targetBucket = String(bucket || "").trim();
  if (!targetKey || /[\0\r\n]/.test(targetKey)) {
    throw storageError("对象存储文件 key 缺失或无效，已拒绝删除。", 409, "STORAGE_DELETE_KEY_INVALID");
  }
  if (!targetBucket) {
    throw storageError("对象存储桶记录缺失，已拒绝删除。", 409, "STORAGE_DELETE_BUCKET_REQUIRED");
  }
  if (targetBucket.length > 255 || /[\\/\0-\x1f\x7f]/.test(targetBucket)) {
    throw storageError("对象存储桶记录无效，已拒绝删除。", 409, "STORAGE_DELETE_BUCKET_INVALID");
  }
  return { Bucket: targetBucket, Key: targetKey };
}

export function r2DeleteObjectTarget(key: string, bucket: string) {
  return objectStorageDeleteObjectTarget(key, bucket);
}

function isTimeoutError(error: unknown) {
  const typedError = (error || {}) as { name?: string; code?: string; message?: string };
  const text = `${typedError.name || ""} ${typedError.code || ""} ${typedError.message || ""}`.toLowerCase();
  return text.includes("timeout") || text.includes("timed out") || text.includes("etimedout") || text.includes("socket");
}

function normalizeStorageError(error: unknown): StorageError {
  const typedError = (error || {}) as StorageError & { Code?: string };
  if (typedError.code === "STORAGE_NOT_CONFIGURED") return typedError;
  const code = typedError.name || typedError.Code || typedError.code || "";
  const message = String(typedError.message || "");
  if (["NoSuchKey", "NoSuchKeyError"].includes(code) || message.toLowerCase().includes("nosuchkey")) {
    return storageError("文件对象不存在，请检查数据库保存的 storageKey 是否与上传时一致。", 404, "STORAGE_OBJECT_NOT_FOUND", { providerCode: code });
  }
  if (["InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied", "InvalidToken"].includes(code)) {
    return storageError("Access Key 错误，请检查对象存储凭证。", 500, "STORAGE_ACCESS_KEY_ERROR", { providerCode: code });
  }
  if (["NoSuchBucket", "NotFound"].includes(code) || message.toLowerCase().includes("bucket")) {
    return storageError("Bucket 不存在，请检查对象存储桶名称。", 500, "STORAGE_BUCKET_NOT_FOUND", { providerCode: code });
  }
  if (isTimeoutError(error)) {
    return storageError("网络超时，请稍后重试或检查对象存储网络连接。", 504, "STORAGE_NETWORK_TIMEOUT", { providerCode: code });
  }
  return storageError("存储服务异常，请联系管理员检查对象存储配置。", 500, "STORAGE_UPLOAD_FAILED", { providerCode: code, providerMessage: message });
}

export async function uploadObjectStorage({ key, body, contentType }: ObjectStorageUploadInput) {
  const bucket = objectStorageBucketName();
  try {
    await storageClient().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/pdf",
    }));
  } catch (error) {
    throw normalizeStorageError(error);
  }
  return { bucket, key };
}

export async function uploadToR2(input: ObjectStorageUploadInput) {
  return uploadObjectStorage(input);
}

export async function deleteObjectStorageObject(key: string) {
  const config = storageConfig();
  const target = objectStorageDeleteObjectTarget(key, config.bucket);
  try {
    await storageClient(config).send(new DeleteObjectCommand(target));
  } catch (error) {
    throw normalizeStorageError(error);
  }
}

export async function deleteR2Object(key: string) {
  return deleteObjectStorageObject(key);
}

export async function headObjectStorageObject(key: string) {
  if (!key) throw storageError("对象存储文件 key 缺失，无法读取文件。", 404, "STORAGE_OBJECT_NOT_FOUND");
  const bucket = objectStorageBucketName();
  try {
    await storageClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw normalizeStorageError(error);
  }
  return true;
}

export async function headR2Object(key: string) {
  return headObjectStorageObject(key);
}

export async function signedDownloadUrl(key: string, fileName: string, expiresIn = 300) {
  return signedObjectUrl(key, fileName, "attachment", expiresIn);
}

async function signedObjectUrl(key: string, fileName: string, disposition: "inline" | "attachment", expiresIn = 300) {
  if (!key) throw storageError("对象存储文件 key 缺失，无法读取文件。", 404, "STORAGE_OBJECT_NOT_FOUND");
  const bucket = objectStorageBucketName();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName || "document.pdf")}`,
  });
  try {
    return await getSignedUrl(storageClient(), command, { expiresIn });
  } catch (error) {
    throw normalizeStorageError(error);
  }
}

export const signedPreviewUrl = (key: string, fileName: string, expiresIn = 120) => signedObjectUrl(key, fileName, "inline", expiresIn);

async function streamToBuffer(stream: TransformableStream, maxBytes: number) {
  if (!stream) return Buffer.alloc(0);
  if (typeof stream[Symbol.asyncIterator] === "function") {
    const asyncStream = stream as AsyncIterable<Uint8Array | Buffer | string>;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of asyncStream) {
      const buffer = Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        throw storageError("文件超过安全读取上限，无法继续处理。", 413, "STORAGE_OBJECT_TOO_LARGE");
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, totalBytes);
  }
  if (typeof stream.transformToByteArray === "function") {
    const body = Buffer.from(await stream.transformToByteArray());
    if (body.byteLength > maxBytes) {
      throw storageError("文件超过安全读取上限，无法继续处理。", 413, "STORAGE_OBJECT_TOO_LARGE");
    }
    return body;
  }
  return Buffer.alloc(0);
}

export async function readObjectStorageObject(key: string, options: ReadObjectStorageOptions = {}) {
  if (!key) throw storageError("对象存储文件 key 缺失，无法读取文件。", 404, "STORAGE_OBJECT_NOT_FOUND");
  const bucket = objectStorageBucketName();
  const maxBytes = Math.min(
    DEFAULT_OBJECT_STORAGE_BUFFER_LIMIT_BYTES,
    Math.max(1, Math.trunc(Number(options.maxBytes) || DEFAULT_OBJECT_STORAGE_BUFFER_LIMIT_BYTES)),
  );
  let result: GetObjectCommandOutput;
  try {
    result = await storageClient().send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      options.signal ? { abortSignal: options.signal } : undefined,
    );
  } catch (error) {
    throw normalizeStorageError(error);
  }
  if (Number(result.ContentLength || 0) > maxBytes) {
    throw storageError("文件超过安全读取上限，无法继续处理。", 413, "STORAGE_OBJECT_TOO_LARGE");
  }
  try {
    return await streamToBuffer(result.Body as TransformableStream, maxBytes);
  } catch (error) {
    if ((error as StorageError | null)?.code === "STORAGE_OBJECT_TOO_LARGE") throw error;
    const typedError = (error || {}) as { message?: string };
    throw storageError("对象存储文件流读取失败，请稍后重试。", 502, "STORAGE_STREAM_FAILED", { providerMessage: typedError.message || "" });
  }
}

export async function readR2Object(key: string, options: ReadObjectStorageOptions = {}) {
  return readObjectStorageObject(key, options);
}
