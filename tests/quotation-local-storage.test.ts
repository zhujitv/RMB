import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  deleteLocalQuotationDocument,
  readLocalQuotationDocument,
  writeLocalQuotationDocument,
} from "../lib/platform/local-quotation-document-storage.ts";
import {
  LOCAL_QUOTATION_DOCUMENT_BUCKET,
  deleteQuotationDocumentObject,
  readQuotationDocumentObject,
  storeQuotationDocumentObject,
} from "../lib/platform/quotation-document-storage.ts";

const mutableEnvironment = process.env as Record<string, string | undefined>;

function matchesCode(code: string) {
  return (error: unknown) => (error as { code?: string } | null)?.code === code;
}

function pdfBody(label = "fixture") {
  return Buffer.from(`%PDF-1.7\n${label}\n%%EOF\n`, "ascii");
}

test("local quotation storage writes, reads and deletes a private PDF", async () => {
  const root = await mkdtemp(join(tmpdir(), "rmb-quotation-storage-"));
  const key = "sales-quotations/quote_1/versions/version_1/hash/invoice.pdf";
  const body = pdfBody();
  try {
    await writeLocalQuotationDocument(key, { root, body, maxBytes: 1024 });
    await Promise.all([
      writeLocalQuotationDocument(key, { root, body, maxBytes: 1024 }),
      writeLocalQuotationDocument(key, { root, body, maxBytes: 1024 }),
    ]);
    const stored = await readLocalQuotationDocument(key, { root, maxBytes: 1024 });
    assert.deepEqual(stored, body);
    await assert.rejects(
      readLocalQuotationDocument(key, { root, maxBytes: 4 }),
      matchesCode("STORAGE_OBJECT_TOO_LARGE"),
    );
    await writeLocalQuotationDocument(key, { root, body, maxBytes: 1024 });
    await deleteLocalQuotationDocument(key, root);
    await assert.rejects(
      readLocalQuotationDocument(key, { root, maxBytes: 1024 }),
      matchesCode("STORAGE_OBJECT_NOT_FOUND"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local quotation storage rejects traversal, oversize data and key conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "rmb-quotation-storage-"));
  const key = "sales-quotations/quote_1/versions/version_1/hash/invoice.pdf";
  try {
    await assert.rejects(
      writeLocalQuotationDocument("../outside.pdf", { root, body: pdfBody(), maxBytes: 1024 }),
      matchesCode("LOCAL_STORAGE_PATH_INVALID"),
    );
    await assert.rejects(
      writeLocalQuotationDocument("/absolute.pdf", { root, body: pdfBody(), maxBytes: 1024 }),
      matchesCode("LOCAL_STORAGE_PATH_INVALID"),
    );
    await assert.rejects(
      writeLocalQuotationDocument("folder\\outside.pdf", { root, body: pdfBody(), maxBytes: 1024 }),
      matchesCode("LOCAL_STORAGE_PATH_INVALID"),
    );
    await assert.rejects(
      writeLocalQuotationDocument(key, { root, body: pdfBody(), maxBytes: 4 }),
      matchesCode("STORAGE_OBJECT_TOO_LARGE"),
    );
    await writeLocalQuotationDocument(key, { root, body: pdfBody("first"), maxBytes: 1024 });
    await assert.rejects(
      writeLocalQuotationDocument(key, { root, body: pdfBody("second"), maxBytes: 1024 }),
      matchesCode("STORAGE_KEY_CONFLICT"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local quotation storage rejects symbolic-link escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "rmb-quotation-storage-"));
  const outside = await mkdtemp(join(tmpdir(), "rmb-quotation-outside-"));
  try {
    await mkdir(join(root, "sales-quotations"), { recursive: true });
    await symlink(outside, join(root, "sales-quotations", "quote_1"));
    await assert.rejects(
      writeLocalQuotationDocument(
        "sales-quotations/quote_1/versions/version_1/hash/invoice.pdf",
        { root, body: pdfBody(), maxBytes: 1024 },
      ),
      matchesCode("LOCAL_STORAGE_SYMLINK_REJECTED"),
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("local quotation storage rejects workspace-sensitive and ancestor-link roots", async () => {
  const wrapper = await mkdtemp(join(tmpdir(), "rmb-quotation-root-"));
  const key = "sales-quotations/quote_1/versions/version_1/hash/invoice.pdf";
  try {
    await assert.rejects(
      writeLocalQuotationDocument(key, {
        root: join(process.cwd(), "public", "quotation-documents"),
        body: pdfBody(),
        maxBytes: 1024,
      }),
      matchesCode("LOCAL_STORAGE_ROOT_INVALID"),
    );
    await symlink(process.cwd(), join(wrapper, "workspace-link"));
    await assert.rejects(
      writeLocalQuotationDocument(key, {
        root: join(wrapper, "workspace-link", "public"),
        body: pdfBody(),
        maxBytes: 1024,
      }),
      matchesCode("LOCAL_STORAGE_ROOT_INVALID"),
    );
  } finally {
    await rm(wrapper, { recursive: true, force: true });
  }
});

test("local quotation driver stores and reads through the provider adapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "rmb-quotation-storage-"));
  const previous = {
    nodeEnv: mutableEnvironment.NODE_ENV,
    driver: mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER,
    root: mutableEnvironment.QUOTATION_LOCAL_STORAGE_ROOT,
    databaseUrl: mutableEnvironment.DATABASE_URL,
  };
  mutableEnvironment.NODE_ENV = "test";
  mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = "local";
  mutableEnvironment.QUOTATION_LOCAL_STORAGE_ROOT = root;
  mutableEnvironment.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/rmb_test";
  const body = pdfBody("adapter");
  const expectedSha256 = createHash("sha256").update(body).digest("hex");
  const key = `sales-quotations/quote_1/versions/version_1/${expectedSha256}/invoice.pdf`;
  try {
    const stored = await storeQuotationDocumentObject({
      key,
      body,
      contentType: "application/pdf",
      maxBytes: 1024,
      expectedSha256,
    });
    assert.equal(stored.bucket, LOCAL_QUOTATION_DOCUMENT_BUCKET);
    assert.deepEqual(
      await readQuotationDocumentObject(stored.bucket, stored.key, { maxBytes: 1024 }),
      body,
    );
    await deleteQuotationDocumentObject(stored.bucket, stored.key);
    await deleteQuotationDocumentObject(stored.bucket, stored.key);
    await assert.rejects(
      readQuotationDocumentObject(stored.bucket, stored.key, { maxBytes: 1024 }),
      matchesCode("STORAGE_OBJECT_NOT_FOUND"),
    );
    await storeQuotationDocumentObject({
      key,
      body,
      contentType: "application/pdf",
      maxBytes: 1024,
      expectedSha256,
    });
    await assert.rejects(
      storeQuotationDocumentObject({
        key,
        body,
        contentType: "application/pdf",
        maxBytes: 1024,
        expectedSha256: "0".repeat(64),
      }),
      matchesCode("QUOTATION_DOCUMENT_HASH_MISMATCH"),
    );
  } finally {
    if (previous.nodeEnv === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = previous.nodeEnv;
    if (previous.driver === undefined) delete mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER;
    else mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = previous.driver;
    if (previous.root === undefined) delete mutableEnvironment.QUOTATION_LOCAL_STORAGE_ROOT;
    else mutableEnvironment.QUOTATION_LOCAL_STORAGE_ROOT = previous.root;
    if (previous.databaseUrl === undefined) delete mutableEnvironment.DATABASE_URL;
    else mutableEnvironment.DATABASE_URL = previous.databaseUrl;
    await rm(root, { recursive: true, force: true });
  }
});

test("local quotation driver rejects a shared or remote database", async () => {
  const previous = {
    nodeEnv: mutableEnvironment.NODE_ENV,
    driver: mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER,
    databaseUrl: mutableEnvironment.DATABASE_URL,
  };
  mutableEnvironment.NODE_ENV = "development";
  mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = "local";
  mutableEnvironment.DATABASE_URL = "postgresql://test:test@database.example.com:5432/rmb";
  const body = pdfBody("remote-database");
  try {
    await assert.rejects(
      storeQuotationDocumentObject({
        key: "sales-quotations/quote_1/versions/version_1/hash/invoice.pdf",
        body,
        contentType: "application/pdf",
        maxBytes: 1024,
        expectedSha256: createHash("sha256").update(body).digest("hex"),
      }),
      matchesCode("LOCAL_STORAGE_DATABASE_UNSAFE"),
    );
  } finally {
    if (previous.nodeEnv === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = previous.nodeEnv;
    if (previous.driver === undefined) delete mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER;
    else mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = previous.driver;
    if (previous.databaseUrl === undefined) delete mutableEnvironment.DATABASE_URL;
    else mutableEnvironment.DATABASE_URL = previous.databaseUrl;
  }
});

test("production rejects the local quotation storage driver", async () => {
  const beforeNodeEnv = mutableEnvironment.NODE_ENV;
  const beforeDriver = mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER;
  mutableEnvironment.NODE_ENV = "production";
  mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = "local";
  const body = pdfBody();
  try {
    await assert.rejects(
      storeQuotationDocumentObject({
        key: "sales-quotations/quote_1/versions/version_1/hash/invoice.pdf",
        body,
        contentType: "application/pdf",
        maxBytes: 1024,
        expectedSha256: createHash("sha256").update(body).digest("hex"),
      }),
      matchesCode("LOCAL_STORAGE_DISABLED"),
    );
  } finally {
    if (beforeNodeEnv === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = beforeNodeEnv;
    if (beforeDriver === undefined) delete mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER;
    else mutableEnvironment.QUOTATION_FILE_STORAGE_DRIVER = beforeDriver;
  }
});
