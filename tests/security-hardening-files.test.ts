import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("multipart uploads require a bounded uncompressed request before parsing", () => {
  const guard = readFileSync("lib/platform/upload-request-guard.ts", "utf8");
  assert.match(guard, /MAX_STANDARD_MULTIPART_REQUEST_BYTES = 12 \* 1024 \* 1024/);
  assert.match(guard, /UPLOAD_CONTENT_LENGTH_REQUIRED/);
  assert.match(guard, /UPLOAD_BODY_TOO_LARGE/);
  assert.match(guard, /UPLOAD_CONTENT_ENCODING_UNSUPPORTED/);
  assert.match(guard, /UPLOAD_TRANSFER_ENCODING_UNSUPPORTED/);
  assert.ok(guard.indexOf("parseRequiredContentLength") < guard.indexOf("contentLength > maxBytes"));
});

test("all multipart routes guard the body before request.formData", () => {
  const routes = [
    "app/api/order-documents/route.ts",
    "app/api/logistics-costs/[id]/invoice/route.ts",
    "app/api/costs/[id]/payment-voucher/route.ts",
    "app/api/supplier-document-requests/[id]/documents/route.ts",
    "app/api/supplier-document-requests/route.ts",
  ];
  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    assert.ok(source.indexOf("assertMultipartRequestWithinLimit(request") < source.indexOf("request.formData()"), route);
  }
  const rateLimit = readFileSync("proxy-rate-limit.ts", "utf8");
  assert.match(rateLimit, /payment-voucher\|supplier-document-requests/);
  assert.match(rateLimit, /isUploadRequest\(request\)[\s\S]*?"upload"/);
});

test("avatar data URLs are decoded and signature checked", () => {
  const picker = readFileSync("app/account-settings/avatar-file.ts", "utf8");
  const panel = readFileSync("app/account-settings/panels.tsx", "utf8");
  const profile = readFileSync("lib/platform/shared-users-profile.ts", "utf8");
  assert.match(picker, /MAX_AVATAR_BYTES = 200 \* 1024/);
  assert.match(picker, /头像文件不能超过 200KB/);
  assert.match(panel, /文件不能超过 200KB/);
  assert.doesNotMatch(`${picker}\n${panel}`, /220KB/);
  assert.match(profile, /MAX_AVATAR_BYTES = 200 \* 1024/);
  assert.match(profile, /Buffer\.from\(match\[2\], "base64"\)/);
  assert.match(profile, /body\.toString\("base64"\) !== match\[2\]/);
  assert.match(profile, /avatarSignature\(body\)/);
  assert.match(profile, /AVATAR_SIGNATURE_INVALID/);
});

test("public file metadata never exposes object-store locators", () => {
  const fileCenter = readFileSync("lib/platform/file-center.ts", "utf8");
  const publicType = fileCenter.slice(fileCenter.indexOf("export type ManagedFileMetadata"), fileCenter.indexOf("export const MANAGED_FILE_KINDS"));
  const returnBlock = fileCenter.slice(fileCenter.indexOf("export function managedFileMetadata"));
  assert.doesNotMatch(publicType, /storageKey|bucket/);
  assert.doesNotMatch(returnBlock, /storageKey: String|bucket: String/);
  const operations = readFileSync("lib/platform/file-asset-operations.ts", "utf8");
  assert.doesNotMatch(operations, /storageKey: asset\.storageKey \|\| metadata\.storageKey/);
  assert.doesNotMatch(operations, /bucket: asset\.bucket \|\| metadata\.bucket/);
});

test("soft-deleted file assets enqueue retryable physical deletion", () => {
  const operations = readFileSync("lib/platform/file-asset-operations.ts", "utf8");
  const outbox = readFileSync("lib/platform/file-storage-deletion-outbox.ts", "utf8");
  const cron = readFileSync("app/api/cron/notification-outbox/route.ts", "utf8");
  assert.match(operations, /await enqueueFileStorageDeletion\(client/);
  assert.match(outbox, /DEFAULT_FILE_STORAGE_SOFT_DELETE_RETENTION_DAYS = 30/);
  assert.match(outbox, /!currentAsset\.isDeleted && !currentAsset\.deletedAt/);
  assert.match(outbox, /FILE_STORAGE_DELETE_MAX_ATTEMPTS = 8/);
  assert.match(outbox, /deleteR2Object\(storageKey\)/);
  assert.match(outbox, /status: "failed"/);
  assert.match(cron, /processFileStorageDeletionOutbox\(20\)/);
});

test("PDF parsing and tax ZIP generation have hard resource budgets", () => {
  const parser = readFileSync("lib/customs-pdf-text-extractor.ts", "utf8");
  const runner = readFileSync("lib/platform/logistics-invoice-validation-runner.ts", "utf8");
  const provider = readFileSync("lib/platform/ocr-integration-provider-clients.ts", "utf8");
  const taxPackage = readFileSync("lib/platform/tax-refunds-package.ts", "utf8");
  const r2 = readFileSync("lib/r2.ts", "utf8");
  assert.match(parser, /MAX_CUSTOMS_PDF_PAGES = 80/);
  assert.match(parser, /CUSTOMS_PDF_PARSE_TIMEOUT/);
  assert.match(parser, /new Worker\(PDF_TEXT_WORKER_SOURCE/);
  assert.match(parser, /await worker\.terminate\(\)/);
  assert.match(parser, /resourceLimits:/);
  assert.match(runner, /const controller = new AbortController\(\)/);
  assert.doesNotMatch(runner, /Promise\.race/);
  assert.match(provider, /signal\?\.addEventListener\("abort", abortBody/);
  assert.match(taxPackage, /TAX_REFUND_PACKAGE_MAX_FILES = 50/);
  assert.match(taxPackage, /TAX_REFUND_PACKAGE_MAX_TOTAL_BYTES = 48 \* 1024 \* 1024/);
  assert.match(r2, /STORAGE_OBJECT_TOO_LARGE/);
});
