import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_REGION = "auto";

function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET || process.env.CLOUDFLARE_R2_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    const error = new Error("Cloudflare R2 未配置，请设置 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、R2_BUCKET");
    error.status = 500;
    throw error;
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

export async function uploadToR2({ key, body, contentType }) {
  const bucket = r2BucketName();
  await r2Client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType || "application/pdf",
  }));
  return { bucket, key };
}

export async function signedDownloadUrl(key, fileName, expiresIn = 300) {
  const bucket = r2BucketName();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName || "document.pdf")}`,
  });
  return getSignedUrl(r2Client(), command, { expiresIn });
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
  const result = await r2Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return streamToBuffer(result.Body);
}
