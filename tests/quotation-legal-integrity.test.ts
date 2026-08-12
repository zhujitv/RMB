import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertQuotationDocumentBody,
  quotationDocumentSha256,
  quotationDocumentStorageKey,
} from "../lib/platform/quotation-document-integrity.ts";
import {
  assertQuotationPdfOutputBudget,
  quotationPdfBankDetails,
  QUOTATION_PDF_LIMITS,
  validateQuotationPdfSnapshot,
} from "../lib/platform/quotation-pdf-input.ts";
import type { QuotationProformaInvoiceSnapshot } from "../lib/platform/quotation-pdf-types.ts";

const partiesSchema = readFileSync("prisma/models/parties.prisma", "utf8");
const quotationSchema = readFileSync("prisma/models/quotations.prisma", "utf8");
const fileSchema = readFileSync("prisma/models/commissions-documents.prisma", "utf8");
const businessEntityCore = readFileSync("lib/platform/business-entity-core.ts", "utf8");
const businessEntitySettings = readFileSync("lib/platform/business-entity-settings.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260809201500_quotation_legal_identity_integrity/migration.sql",
  "utf8",
);
const bankAccountMigration = readFileSync(
  "prisma/migrations/20260809230000_business_entity_currency_bank_accounts/migration.sql",
  "utf8",
);
const legacyBankAccountCleanupMigration = readFileSync(
  "prisma/migrations/20260809233000_clear_legacy_business_entity_bank_account/migration.sql",
  "utf8",
);
const piHeaderVisibilityMigration = readFileSync(
  "prisma/migrations/20260809234000_business_entity_pi_header_visibility/migration.sql",
  "utf8",
);
const manualConfirmationMigration = readFileSync(
  "prisma/migrations/20260810021000_quotation_manual_confirmation_only/migration.sql",
  "utf8",
);
const invariantCorrectionMigration = readFileSync(
  "prisma/migrations/20260812140000_procurement_database_invariant_corrections/migration.sql",
  "utf8",
);
const documents = readFileSync("lib/platform/quotation-documents.ts", "utf8");
const sellerSnapshot = readFileSync("lib/platform/quotation-seller-snapshot.ts", "utf8");
const quotationService = readFileSync("lib/platform/quotation-service.ts", "utf8");
const quotationValues = readFileSync("lib/platform/quotation-values.ts", "utf8");
const documentRoute = readFileSync("app/api/quotations/[id]/document/route.ts", "utf8");

function errorCode(code: string) {
  return (error: unknown) => (error as { code?: string } | null)?.code === code;
}

function pdfFixture(): QuotationProformaInvoiceSnapshot {
  return {
    quoteNo: "QT-SECURITY",
    quoteDate: "2026-08-09",
    currency: "USD",
    seller: { legalName: "Seller Co." },
    buyer: { legalName: "Buyer Co." },
    items: [{ description: "Panel", unit: "PCS", quantity: "1", unitPrice: "1", amount: "1" }],
    subtotal: "1",
    totalAmount: "1",
  };
}

test("business entities persist legal PI fields and quotation versions freeze them", () => {
  for (const column of ["nameEn", "address", "contactEmail", "contactPhone", "website"]) {
    assert.match(partiesSchema, new RegExp(`\\b${column}\\s+String\\?`));
  }
  for (const column of ["showContactPhoneOnPi", "showContactEmailOnPi", "showWebsiteOnPi"]) {
    assert.match(partiesSchema, new RegExp(`\\b${column}\\s+Boolean\\s+@default\\(false\\)`));
  }
  assert.match(piHeaderVisibilityMigration, /show_contact_phone_on_pi[\s\S]*DEFAULT false/);
  assert.doesNotMatch(piHeaderVisibilityMigration, /sales_quotation_versions|file_assets/);
  assert.match(quotationSchema, /sellerBankAccountSnapshot\s+String\?/);
  assert.match(partiesSchema, /model BusinessEntityBankAccount/);
  for (const column of ["beneficiaryName", "beneficiaryAddress", "bankName", "accountNumber", "swiftCode"]) {
    assert.match(partiesSchema, new RegExp(`\\b${column}\\s+String`));
  }
  assert.match(partiesSchema, /@@unique\(\[businessEntityId, currency\]\)/);
  assert.match(bankAccountMigration, /CREATE TABLE "business_entity_bank_accounts"/);
  assert.match(bankAccountMigration, /business_entity_bank_accounts_business_entity_id_currency_key/);
  assert.doesNotMatch(bankAccountMigration, /seller_bank_account_snapshot|DROP COLUMN "bank_account"/);
  assert.match(legacyBankAccountCleanupMigration, /UPDATE "business_entities"[\s\S]*SET "bank_account" = NULL/);
  assert.doesNotMatch(
    legacyBankAccountCleanupMigration,
    /(?:UPDATE|DELETE FROM|ALTER TABLE)\s+"?(?:sales_quotation_versions|business_entity_bank_accounts)|DROP COLUMN/i,
  );
  assert.match(fileSchema, /contentSha256\s+String\?/);
  assert.match(migration, /UPDATE "sales_quotations"[\s\S]*"business_entity_id" IS NULL/);
  assert.doesNotMatch(migration, /ALTER COLUMN "business_entity_id" SET NOT NULL/);
  assert.match(invariantCorrectionMigration, /ALTER COLUMN "business_entity_id" SET NOT NULL/);
  assert.match(quotationSchema, /businessEntityId\s+String\s+@map\("business_entity_id"\)/);
  assert.match(quotationSchema, /businessEntity\s+BusinessEntity\s+@relation/);
  assert.match(migration, /FOREIGN KEY \("quotation_version_id", "quotation_id"\)/);
  assert.match(migration, /file_assets_content_sha256_check/);
});

test("manual quotation confirmation is actor-attributed and commit-consistent", () => {
  const decisionModel = quotationSchema.match(
    /model SalesQuotationDecision\b[\s\S]*?\n\}/,
  )?.[0] || "";

  assert.match(decisionModel, /recordedById\s+String\s+@map\("recorded_by"\)/);
  assert.match(decisionModel, /recordedBy\s+User\s+@relation[\s\S]*onDelete: Restrict/);
  assert.doesNotMatch(manualConfirmationMigration, /ALTER COLUMN "recorded_by" SET NOT NULL/);
  assert.match(invariantCorrectionMigration, /ALTER COLUMN "recorded_by" SET NOT NULL/);
  assert.match(invariantCorrectionMigration, /recorded_by_fkey[\s\S]*ON DELETE RESTRICT/);
  assert.match(invariantCorrectionMigration, /current_version_id IS DISTINCT FROM NEW\."quotation_version_id"/);
  assert.match(invariantCorrectionMigration, /quotation_record\."status"::TEXT IS DISTINCT FROM NEW\."decision"::TEXT/);
  assert.match(invariantCorrectionMigration, /actor\."supplier_id" IS NULL/);
  assert.match(invariantCorrectionMigration, /actor\."approval_status" = 'APPROVED'/);
  assert.match(invariantCorrectionMigration, /NEW\."responded_at" > CURRENT_TIMESTAMP/);
  assert.match(invariantCorrectionMigration, /CREATE CONSTRAINT TRIGGER "sales_quotations_decision_commit_consistency"/);
  assert.match(invariantCorrectionMigration, /CREATE CONSTRAINT TRIGGER "sales_quotation_decisions_commit_consistency"/);
  assert.match(invariantCorrectionMigration, /DEFERRABLE INITIALLY DEFERRED/);
});

test("ordinary business entity options omit private PI and bank details", () => {
  const ordinarySerializer = businessEntityCore.match(
    /export function serializeBusinessEntity\([\s\S]*?\n\}/,
  )?.[0] || "";
  const settingsSerializer = businessEntityCore.match(
    /export function serializeBusinessEntitySettings\([\s\S]*?\n\}/,
  )?.[0] || "";
  assert.doesNotMatch(ordinarySerializer, /bankAccount|contactEmail|address/);
  assert.doesNotMatch(settingsSerializer, /\bbankAccount:/);
  assert.match(settingsSerializer, /serializeBusinessEntityBankAccounts/);
  assert.match(settingsSerializer, /contactEmail/);
  assert.doesNotMatch(businessEntitySettings, /bankAccount: optionalBusinessText\(input\.bankAccount/);
  assert.match(businessEntitySettings, /delete safeEntity\.bankAccount/);
  assert.match(businessEntitySettings, /bankAccounts: accounts/);
  assert.match(businessEntitySettings, /configured: true/);
  assert.doesNotMatch(quotationValues, /sellerBankAccountSnapshot:\s*String/);
});

test("PI snapshot uses only the frozen seller version and rejects unknown template versions", () => {
  assert.doesNotMatch(documents, /getCompanyProfileSettings|fallbackProfile|quotation\.businessEntity/);
  assert.match(documents, /bankAccount: version\.sellerBankAccountSnapshot/);
  assert.match(sellerSnapshot, /profileValue\(entity\.address, profile\.address\)/);
  assert.match(sellerSnapshot, /sellerBankAccountSnapshot: quotationBankAccountSnapshot\(entity\.bankAccounts, currency\)/);
  assert.match(sellerSnapshot, /QUOTATION_BANK_ACCOUNT_REQUIRED/);
  assert.match(documents, /assertQuotationCurrencyBankAccountSnapshot\(version\)/);
  assert.match(sellerSnapshot, /QUOTATION_SELLER_SNAPSHOT_REQUIRED/);
  assert.match(sellerSnapshot, /QUOTATION_DOCUMENT_TEMPLATE_UNSUPPORTED/);
  const buildVersionAt = quotationService.indexOf("const versionData = await buildQuotationVersionData");
  const buildSellerAt = quotationService.indexOf("const sellerSnapshot = buildQuotationSellerSnapshot");
  assert.ok(buildVersionAt >= 0 && buildSellerAt > buildVersionAt);
});

test("PI files have a content-addressed key and verified PDF bytes", () => {
  const body = Buffer.from("%PDF-1.7\n1 0 obj\n%%EOF\n", "ascii");
  const hash = quotationDocumentSha256(body);
  assert.equal(assertQuotationDocumentBody(body, hash, body.byteLength), hash);
  assert.equal(
    quotationDocumentStorageKey("quote_1", "version_1", hash, "invoice.pdf"),
    `sales-quotations/quote_1/versions/version_1/${hash}/invoice.pdf`,
  );
  assert.throws(
    () => assertQuotationDocumentBody(Buffer.from("not-a-pdf")),
    errorCode("QUOTATION_DOCUMENT_PDF_INVALID"),
  );
  assert.throws(
    () => assertQuotationDocumentBody(Buffer.concat([body, Buffer.from("tampered")]), hash),
    errorCode("QUOTATION_DOCUMENT_HASH_MISMATCH"),
  );
});

test("stored PI reads verify hash and downloads are never cached", () => {
  assert.match(documents, /readVerifiedAsset/);
  assert.match(documents, /contentSha256/);
  assert.match(documents, /isDeleted: false, deletedAt: null/);
  assert.match(documents, /QUOTATION_DOCUMENT_DELETED_OBJECT_MISSING/);
  assert.match(documentRoute, /private, no-store, max-age=0, must-revalidate/);
  assert.match(documentRoute, /mimeType: "application\/pdf"/);
});

test("PDF rendering enforces text and page budgets and accepts frozen bank text", () => {
  const oversized = { ...pdfFixture(), remark: "x".repeat(QUOTATION_PDF_LIMITS.totalTextCharacters + 1) };
  assert.throws(() => validateQuotationPdfSnapshot(oversized), errorCode("QUOTATION_PDF_TEXT_BUDGET_EXCEEDED"));
  assert.throws(
    () => assertQuotationPdfOutputBudget(Buffer.from("pdf"), QUOTATION_PDF_LIMITS.pages + 1),
    errorCode("QUOTATION_PDF_PAGE_LIMIT_EXCEEDED"),
  );
  assert.throws(
    () => assertQuotationPdfOutputBudget(
      { byteLength: QUOTATION_PDF_LIMITS.outputBytes + 1 } as Buffer,
      1,
    ),
    errorCode("QUOTATION_PDF_OUTPUT_TOO_LARGE"),
  );
  assert.equal(quotationPdfBankDetails(null, "Bank: Example\nSWIFT: EXAMPLE"), "Bank: Example\nSWIFT: EXAMPLE");
});
