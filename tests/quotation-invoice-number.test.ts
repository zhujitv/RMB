import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatQuotationInvoiceNumber,
  quotationInvoiceSuffix,
} from "../lib/platform/quotation-invoice-number.ts";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const schema = readPrismaSchemaSource();
const migration = readFileSync(
  "prisma/migrations/20260809235000_pi_invoice_numbers/migration.sql",
  "utf8",
);
const allocator = readFileSync("lib/platform/quotation-invoice-number.ts", "utf8");
const service = readFileSync("lib/platform/quotation-service.ts", "utf8");
const values = readFileSync("lib/platform/quotation-values.ts", "utf8");
const queryService = readFileSync("lib/platform/quotation-query-service.ts", "utf8");

test("PI invoice suffixes follow the daily A-to-Z sequence", () => {
  assert.equal(quotationInvoiceSuffix(0), "");
  assert.equal(quotationInvoiceSuffix(1), "A");
  assert.equal(quotationInvoiceSuffix(26), "Z");
  assert.equal(quotationInvoiceSuffix(27), "AA");
  assert.equal(quotationInvoiceSuffix(52), "AZ");
  assert.equal(quotationInvoiceSuffix(53), "BA");
  assert.throws(() => quotationInvoiceSuffix(-1), RangeError);
  assert.throws(() => quotationInvoiceSuffix(1.5), RangeError);
});

test("PI invoice numbers use the quotation date and can serve as quotation numbers", () => {
  const date = new Date("2026-08-09T00:00:00.000Z");
  assert.equal(formatQuotationInvoiceNumber(date, 0), "20260809");
  assert.equal(formatQuotationInvoiceNumber(date, 1), "20260809A");
  assert.equal(formatQuotationInvoiceNumber(date, 27), "20260809AA");
  assert.match(schema, /quoteNo\s+String\s+@unique\s+@map\("quote_no"\)/);
});

test("quotation schema stores a unique parent invoice number and immutable version snapshot", () => {
  assert.match(schema, /model SalesQuotation\b[\s\S]*invoiceNo\s+String\?\s+@unique\s+@map\("invoice_no"\)/);
  assert.match(schema, /model SalesQuotationVersion\b[\s\S]*invoiceNoSnapshot\s+String\?\s+@map\("invoice_no_snapshot"\)/);
  assert.match(schema, /model SalesQuotationInvoiceSequence\b[\s\S]*invoiceDate\s+DateTime\s+@id[\s\S]*lastSequence\s+Int/);
});

test("migration backfills parents by first quote date and preserves historical PI snapshots", () => {
  assert.match(migration, /ADD COLUMN "invoice_no" TEXT/);
  assert.match(migration, /ADD COLUMN "invoice_no_snapshot" TEXT/);
  assert.match(migration, /CREATE TABLE "sales_quotation_invoice_sequences"/);
  assert.match(migration, /PARTITION BY version\."quotation_id"[\s\S]*version\."version_number" ASC/);
  assert.match(migration, /PARTITION BY first_version\."quote_date"[\s\S]*quotation\."created_at" ASC, quotation\."id" ASC/);
  assert.match(migration, /TO_CHAR\(ranked\."quote_date", 'YYYYMMDD'\)/);
  assert.match(migration, /\(COUNT\(\*\) - 1\)::INTEGER/);
  assert.doesNotMatch(migration, /UPDATE\s+"sales_quotation_versions"/);
  assert.match(migration, /CREATE UNIQUE INDEX "sales_quotations_invoice_no_key"/);
});

test("invoice allocation is an atomic daily upsert inside quotation transactions", () => {
  assert.match(allocator, /salesQuotationInvoiceSequence\.upsert/);
  assert.match(allocator, /where: \{ invoiceDate: normalizedDate \}/);
  assert.match(allocator, /create: \{ invoiceDate: normalizedDate, lastSequence: 0 \}/);
  assert.match(allocator, /update: \{ lastSequence: \{ increment: 1 \} \}/);
  assert.match(service, /allocateQuotationInvoiceNumber\(tx, versionData\.quoteDate\)/);
  assert.match(service, /quoteNo: invoiceNo,[\s\S]*invoiceNo,/);
  assert.doesNotMatch(service, /nextQuotationNumber|randomBytes/);
  assert.match(service, /versionNumber: 1,[\s\S]*invoiceNoSnapshot: invoiceNo/);
  assert.match(service, /before\.invoiceNo \|\| await allocateQuotationInvoiceNumber/);
  assert.match(service, /nextVersionNumber,[\s\S]*invoiceNoSnapshot: invoiceNo/);
});

test("quotation APIs expose and search the PI invoice number", () => {
  assert.match(values, /invoiceNoSnapshot: version\.invoiceNoSnapshot/);
  assert.match(values, /invoiceNo: quotation\.invoiceNo/);
  assert.match(queryService, /\{ invoiceNo: \{ contains: keyword, mode: "insensitive" \} \}/);
});
