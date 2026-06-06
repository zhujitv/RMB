import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_REGION = "auto";

function storageError(message, status = 500, code = "STORAGE_ERROR", details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  error.expose = true;
  return error;
}

function r2Config() {
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
  return { endpoint, accessKeyId, secretAccessKey, bucket };
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

export function buildOrderDocumentKey({ orderId, documentType, fileName, relatedModule = "EXPORT", supplierId = "" }) {
  const safeName = safeFileName(fileName);
  if (relatedModule === "SUPPLIER") {
    return `receivable-orders/${orderId}/supplier-documents/${supplierId || "unknown-supplier"}/${documentType}/${safeName}`;
  }
  if (relatedModule === "SALES") {
    return `receivable-orders/${orderId}/sales-contracts/${safeName}`;
  }
  return `receivable-orders/${orderId}/export-documents/${documentType}/${safeName}`;
}

function isTimeoutError(error) {
  const text = `${error?.name || ""} ${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return text.includes("timeout") || text.includes("timed out") || text.includes("etimedout") || text.includes("socket");
}

function normalizeStorageError(error) {
  if (error?.code === "STORAGE_NOT_CONFIGURED") return error;
  const code = error?.name || error?.Code || error?.code || "";
  const message = String(error?.message || "");
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

export async function uploadToR2({ key, body, contentType }) {
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

export async function deleteR2Object(key) {
  const bucket = r2BucketName();
  try {
    await r2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw normalizeStorageError(error);
  }
}

export async function signedDownloadUrl(key, fileName, expiresIn = 300) {
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

async function streamToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  if (typeof stream.transformToByteArray === "function") {
    return Buffer.from(await stream.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function readR2Object(key) {
  const bucket = r2BucketName();
  let result;
  try {
    result = await r2Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw normalizeStorageError(error);
  }
  return streamToBuffer(result.Body);
}
