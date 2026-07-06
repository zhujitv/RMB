import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_REGION = "auto";

type StorageError = Error & {
  status?: number;
  code?: string;
  details?: unknown;
  expose?: boolean;
};

type R2Config = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
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

type R2UploadInput = {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string | null;
};

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

function r2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET || process.env.CLOUDFLARE_R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL || process.env.R2_PUBLIC_BASE_URL || process.env.CLOUDFLARE_R2_PUBLIC_URL;
  if (publicUrl) {
    throw storageError(
      "对象存储桶必须保持私有，请移除公开访问 URL 配置，下载统一使用后端签名链接。",
      500,
      "STORAGE_BUCKET_MUST_BE_PRIVATE",
    );
  }
  const missing = [
    !endpoint ? "R2_ENDPOINT 或 R2_ACCOUNT_ID" : "",
    !accessKeyId ? "R2_ACCESS_KEY_ID" : "",
    !secretAccessKey ? "R2_SECRET_ACCESS_KEY" : "",
    !bucket ? "R2_BUCKET" : "",
  ].filter(Boolean);
  if (missing.length) {
    const bucketMissing = !bucket;
    throw storageError(
      `文件存储服务未配置，请联系管理员配置 Cloudflare R2 / S3。${bucketMissing ? "存储桶未配置。" : ""}`,
      503,
      "STORAGE_NOT_CONFIGURED",
      { missing },
    );
  }
  return {
    endpoint: endpoint as string,
    accessKeyId: accessKeyId as string,
    secretAccessKey: secretAccessKey as string,
    bucket: bucket as string,
  };
}

function r2Client() {
  const config = r2Config();
  return new S3Client({
    region: R2_REGION,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function r2BucketName() {
  return r2Config().bucket;
}

export function ensureR2Configured() {
  return r2Config();
}

export async function checkR2Storage() {
  const config = r2Config();
  try {
    await r2Client().send(new HeadBucketCommand({ Bucket: config.bucket }));
  } catch (error) {
    throw normalizeStorageError(error);
  }
  return {
    ok: true,
    provider: "Cloudflare R2 / S3",
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
    return storageError("R2 文件对象不存在，请检查数据库保存的 storageKey 是否与上传时一致。", 404, "R2_OBJECT_NOT_FOUND", { providerCode: code });
  }
  if (["InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied", "InvalidToken"].includes(code)) {
    return storageError("Access Key 错误，请检查 Cloudflare R2 / S3 凭证。", 500, "STORAGE_ACCESS_KEY_ERROR", { providerCode: code });
  }
  if (["NoSuchBucket", "NotFound"].includes(code) || message.toLowerCase().includes("bucket")) {
    return storageError("Bucket 不存在，请检查对象存储桶名称。", 500, "STORAGE_BUCKET_NOT_FOUND", { providerCode: code });
  }
  if (isTimeoutError(error)) {
    return storageError("网络超时，请稍后重试或检查对象存储网络连接。", 504, "STORAGE_NETWORK_TIMEOUT", { providerCode: code });
  }
  return storageError("存储服务异常，请联系管理员检查 Cloudflare R2 / S3。", 500, "STORAGE_UPLOAD_FAILED", { providerCode: code, providerMessage: message });
}

export async function uploadToR2({ key, body, contentType }: R2UploadInput) {
  const bucket = r2BucketName();
  try {
    await r2Client().send(new PutObjectCommand({
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

export async function deleteR2Object(key: string) {
  const bucket = r2BucketName();
  try {
    await r2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw normalizeStorageError(error);
  }
}

export async function headR2Object(key: string) {
  if (!key) throw storageError("R2 文件 key 缺失，无法读取文件。", 404, "R2_OBJECT_NOT_FOUND");
  const bucket = r2BucketName();
  try {
    await r2Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw normalizeStorageError(error);
  }
  return true;
}

export async function signedDownloadUrl(key: string, fileName: string, expiresIn = 300) {
  const bucket = r2BucketName();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName || "document.pdf")}`,
  });
  try {
    return await getSignedUrl(r2Client(), command, { expiresIn });
  } catch (error) {
    throw normalizeStorageError(error);
  }
}

async function streamToBuffer(stream: TransformableStream) {
  if (!stream) return Buffer.alloc(0);
  if (typeof stream.transformToByteArray === "function") {
    return Buffer.from(await stream.transformToByteArray());
  }
  if (typeof stream[Symbol.asyncIterator] !== "function") {
    return Buffer.alloc(0);
  }
  const asyncStream = stream as AsyncIterable<Uint8Array | Buffer | string>;
  const chunks: Buffer[] = [];
  for await (const chunk of asyncStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function readR2Object(key: string) {
  if (!key) throw storageError("R2 文件 key 缺失，无法读取文件。", 404, "R2_OBJECT_NOT_FOUND");
  const bucket = r2BucketName();
  let result: GetObjectCommandOutput;
  try {
    result = await r2Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw normalizeStorageError(error);
  }
  try {
    return await streamToBuffer(result.Body as TransformableStream);
  } catch (error) {
    const typedError = (error || {}) as { message?: string };
    throw storageError("R2 文件流读取失败，请稍后重试。", 502, "R2_STREAM_FAILED", { providerMessage: typedError.message || "" });
  }
}
