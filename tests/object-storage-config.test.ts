import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { objectStorageConfig } = await jiti.import<typeof import("../lib/r2.ts")>("../lib/r2.ts");

test("Tencent COS configuration takes precedence over legacy R2", () => {
  const config = objectStorageConfig({
    COS_REGION: "ap-shanghai",
    COS_SECRET_ID: "cos-secret-id",
    COS_SECRET_KEY: "cos-secret-key",
    COS_BUCKET: "rmb-private-1250000000",
    R2_ACCOUNT_ID: "legacy-account",
    R2_ACCESS_KEY_ID: "legacy-access",
    R2_SECRET_ACCESS_KEY: "legacy-secret",
    R2_BUCKET: "legacy-bucket",
  });

  assert.deepEqual(config, {
    provider: "Tencent COS",
    endpoint: "https://cos.ap-shanghai.myqcloud.com",
    region: "ap-shanghai",
    accessKeyId: "cos-secret-id",
    secretAccessKey: "cos-secret-key",
    bucket: "rmb-private-1250000000",
    forcePathStyle: false,
  });
});

test("partial COS configuration fails instead of silently falling back to R2", () => {
  assert.throws(
    () => objectStorageConfig({
      COS_REGION: "ap-shanghai",
      R2_ACCOUNT_ID: "legacy-account",
      R2_ACCESS_KEY_ID: "legacy-access",
      R2_SECRET_ACCESS_KEY: "legacy-secret",
      R2_BUCKET: "legacy-bucket",
    }),
    (error: unknown) => (error as { code?: string }).code === "STORAGE_NOT_CONFIGURED",
  );
});

test("legacy R2 configuration remains supported", () => {
  const config = objectStorageConfig({
    R2_ACCOUNT_ID: "legacy-account",
    R2_ACCESS_KEY_ID: "legacy-access",
    R2_SECRET_ACCESS_KEY: "legacy-secret",
    R2_BUCKET: "legacy-bucket",
  });

  assert.equal(config.provider, "S3-compatible object storage");
  assert.equal(config.endpoint, "https://legacy-account.r2.cloudflarestorage.com");
  assert.equal(config.region, "auto");
});

test("public object-storage URL is rejected for COS", () => {
  assert.throws(
    () => objectStorageConfig({
      COS_REGION: "ap-shanghai",
      COS_SECRET_ID: "cos-secret-id",
      COS_SECRET_KEY: "cos-secret-key",
      COS_BUCKET: "rmb-private-1250000000",
      COS_PUBLIC_URL: "https://public.example.com",
    }),
    (error: unknown) => (error as { code?: string }).code === "STORAGE_BUCKET_MUST_BE_PRIVATE",
  );
});

test("COS migration is resumable, checks hashes, and never deletes the source", () => {
  const source = readFileSync("scripts/migrate-object-storage-to-cos.mjs", "utf8");
  assert.match(source, /ListObjectsV2Command/);
  assert.match(source, /migration-sha256/);
  assert.match(source, /HeadObjectCommand/);
  assert.match(source, /status: "skipped"/);
  assert.match(source, /status: "failed"/);
  assert.doesNotMatch(source, /DeleteObjectCommand/);
});
