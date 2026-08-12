import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { r2DeleteObjectTarget } from "../lib/r2.ts";
import { deleteQuotationDocumentObject } from "../lib/platform/quotation-document-storage.ts";

const mutableEnvironment = process.env as Record<string, string | undefined>;

function matchesCode(code: string) {
  return (error: unknown) => (error as { code?: string } | null)?.code === code;
}

test("object deletion target validation rejects missing or unsafe bucket metadata", () => {
  assert.deepEqual(
    r2DeleteObjectTarget("sales-quotations/quote-1/document.pdf", "historical-quotation-bucket"),
    {
      Bucket: "historical-quotation-bucket",
      Key: "sales-quotations/quote-1/document.pdf",
    },
  );
  assert.throws(
    () => r2DeleteObjectTarget("sales-quotations/quote-1/document.pdf", ""),
    matchesCode("STORAGE_DELETE_BUCKET_REQUIRED"),
  );
  assert.throws(
    () => r2DeleteObjectTarget("sales-quotations/quote-1/document.pdf", "unsafe/bucket"),
    matchesCode("STORAGE_DELETE_BUCKET_INVALID"),
  );
});

test("quotation cleanup deletes from the canonical provider after an R2 to COS migration", () => {
  const source = readFileSync("lib/platform/quotation-document-storage.ts", "utf8");
  assert.match(source, /await deleteR2Object\(key\);/);
  assert.doesNotMatch(source, /deleteR2Object\(key, recordedBucket\)/);
});

test("quotation deletion refuses missing bucket metadata before touching configured storage", async () => {
  const previousDriver = mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER;
  mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = "r2";
  try {
    await assert.rejects(
      deleteQuotationDocumentObject(null, "sales-quotations/quote-1/document.pdf"),
      matchesCode("QUOTATION_DOCUMENT_BUCKET_REQUIRED"),
    );
  } finally {
    if (previousDriver === undefined) delete mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER;
    else mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = previousDriver;
  }
});

test("legacy local buckets never fall through to current R2 storage", async () => {
  const previousDriver = mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER;
  mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = "r2";
  try {
    await assert.rejects(
      deleteQuotationDocumentObject("local-development", "sales-quotations/quote-1/document.pdf"),
      matchesCode("STORAGE_PROVIDER_MISMATCH"),
    );
  } finally {
    if (previousDriver === undefined) delete mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER;
    else mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = previousDriver;
  }
});

test("local driver refuses an R2 bucket instead of deleting through ambient credentials", async () => {
  const previousDriver = mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER;
  mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = "local";
  try {
    await assert.rejects(
      deleteQuotationDocumentObject("historical-quotation-bucket", "sales-quotations/quote-1/document.pdf"),
      matchesCode("STORAGE_PROVIDER_MISMATCH"),
    );
  } finally {
    if (previousDriver === undefined) delete mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER;
    else mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = previousDriver;
  }
});
