import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const MAX_OBJECT_BYTES = 512 * 1024 * 1024;
const concurrency = Math.min(8, Math.max(1, Number(process.env.COS_MIGRATION_CONCURRENCY || 4)));
const manifestPath = process.env.COS_MIGRATION_MANIFEST || "/srv/rmb/shared/cos-migration/manifest.jsonl";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`缺少迁移配置：${name}`);
  return value;
}

function sourceConfig() {
  const accountId = String(process.env.SOURCE_R2_ACCOUNT_ID || "").trim();
  return {
    endpoint: String(process.env.SOURCE_R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")).trim()
      || required("SOURCE_R2_ENDPOINT"),
    accessKeyId: required("SOURCE_R2_ACCESS_KEY_ID"),
    secretAccessKey: required("SOURCE_R2_SECRET_ACCESS_KEY"),
    bucket: required("SOURCE_R2_BUCKET"),
  };
}

function targetConfig() {
  const region = required("COS_REGION");
  return {
    region,
    endpoint: String(process.env.COS_ENDPOINT || `https://cos.${region}.myqcloud.com`).trim(),
    accessKeyId: required("COS_SECRET_ID"),
    secretAccessKey: required("COS_SECRET_KEY"),
    bucket: required("COS_BUCKET"),
  };
}

function client(config, region) {
  return new S3Client({
    region,
    endpoint: config.endpoint,
    forcePathStyle: false,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

async function listAllObjects(s3, bucket) {
  const objects = [];
  let continuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));
    for (const item of page.Contents || []) {
      if (item.Key) objects.push({ key: item.Key, size: Number(item.Size || 0) });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

async function bodyToBuffer(body, expectedSize) {
  if (expectedSize > MAX_OBJECT_BYTES) throw new Error(`对象超过迁移上限：${expectedSize} bytes`);
  if (typeof body?.transformToByteArray === "function") {
    const bytes = Buffer.from(await body.transformToByteArray());
    if (bytes.byteLength > MAX_OBJECT_BYTES) throw new Error(`对象超过迁移上限：${bytes.byteLength} bytes`);
    return bytes;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of body || []) {
    const buffer = Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_OBJECT_BYTES) throw new Error(`对象超过迁移上限：${total} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

async function record(entry) {
  await mkdir(dirname(manifestPath), { recursive: true, mode: 0o700 });
  await appendFile(manifestPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
}

async function copyOne({ source, target, sourceBucket, targetBucket, object }) {
  try {
    const existing = await target.send(new HeadObjectCommand({ Bucket: targetBucket, Key: object.key }));
    if (Number(existing.ContentLength || 0) === object.size && existing.Metadata?.["migration-sha256"]) {
      await record({ status: "skipped", key: object.key, size: object.size, sha256: existing.Metadata["migration-sha256"] });
      return { status: "skipped", size: object.size };
    }
  } catch (error) {
    const status = Number(error?.$metadata?.httpStatusCode || 0);
    const code = String(error?.name || error?.Code || "");
    if (status !== 404 && !["NotFound", "NoSuchKey"].includes(code)) throw error;
  }

  const sourceObject = await source.send(new GetObjectCommand({ Bucket: sourceBucket, Key: object.key }));
  const body = await bodyToBuffer(sourceObject.Body, object.size);
  const sha256 = createHash("sha256").update(body).digest("hex");

  await target.send(new PutObjectCommand({
    Bucket: targetBucket,
    Key: object.key,
    Body: body,
    ContentLength: body.byteLength,
    ContentType: sourceObject.ContentType || "application/octet-stream",
    CacheControl: sourceObject.CacheControl,
    ContentDisposition: sourceObject.ContentDisposition,
    Metadata: { "migration-sha256": sha256 },
  }));

  const saved = await target.send(new HeadObjectCommand({ Bucket: targetBucket, Key: object.key }));
  if (Number(saved.ContentLength || -1) !== body.byteLength || saved.Metadata?.["migration-sha256"] !== sha256) {
    throw new Error("目标对象校验失败");
  }
  await record({ status: "copied", key: object.key, size: body.byteLength, sha256 });
  return { status: "copied", size: body.byteLength };
}

async function runPool(items, worker) {
  const results = [];
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        await record({ status: "failed", key: items[index].key, size: items[index].size, error: String(error?.message || error) });
        results[index] = { status: "failed", size: items[index].size, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, run));
  return results;
}

const sourceSettings = sourceConfig();
const targetSettings = targetConfig();
const source = client(sourceSettings, "auto");
const target = client(targetSettings, targetSettings.region);
const sourceObjects = await listAllObjects(source, sourceSettings.bucket);

console.log(JSON.stringify({ phase: "inventory", objects: sourceObjects.length, bytes: sourceObjects.reduce((sum, item) => sum + item.size, 0) }));
const results = await runPool(sourceObjects, (object) => copyOne({
  source,
  target,
  sourceBucket: sourceSettings.bucket,
  targetBucket: targetSettings.bucket,
  object,
}));

const targetObjects = await listAllObjects(target, targetSettings.bucket);
const summary = {
  sourceObjects: sourceObjects.length,
  sourceBytes: sourceObjects.reduce((sum, item) => sum + item.size, 0),
  targetObjects: targetObjects.length,
  targetBytes: targetObjects.reduce((sum, item) => sum + item.size, 0),
  copied: results.filter((result) => result?.status === "copied").length,
  skipped: results.filter((result) => result?.status === "skipped").length,
  failed: results.filter((result) => result?.status === "failed").length,
  manifestPath,
};
console.log(JSON.stringify({ phase: "complete", ...summary }));

if (summary.failed || summary.targetObjects < summary.sourceObjects || summary.targetBytes < summary.sourceBytes) {
  process.exitCode = 1;
}
