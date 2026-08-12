import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const voidRoute = readFileSync("app/api/quotations/[id]/route.ts", "utf8");
const deleteRoute = readFileSync("app/api/quotations/[id]/draft/route.ts", "utf8");
const deletionService = readFileSync("lib/platform/quotation-deletion-service.ts", "utf8");
const documentService = readFileSync("lib/platform/quotation-documents.ts", "utf8");
const storageOutbox = readFileSync("lib/platform/file-storage-deletion-outbox.ts", "utf8");
const deletionMigration = readFileSync(
  "prisma/migrations/20260810000000_sales_quotation_draft_hard_delete/migration.sql",
  "utf8",
);
const deletionHardeningMigration = readFileSync(
  "prisma/migrations/20260810001000_harden_sales_quotation_draft_hard_delete_triggers/migration.sql",
  "utf8",
);
const quotesModule = readFileSync("app/modules/QuotesModule.tsx", "utf8");
const quotationDeletion = readFileSync("app/modules/quotations/use-quotation-deletion.ts", "utf8");
const quotationDeleteUi = `${quotesModule}\n${quotationDeletion}`;
const detailDrawer = readFileSync("app/modules/quotations/quotation-detail-drawer.tsx", "utf8");
const confirmationDialog = readFileSync("app/components/dialogs.tsx", "utf8");

test("quotation void and permanent draft deletion keep distinct API contracts", () => {
  assert.match(voidRoute, /export async function DELETE[\s\S]*voidQuotation/);
  assert.match(deleteRoute, /export async function DELETE[\s\S]*deleteQuotationDraft/);
  assert.match(deleteRoute, /parseJsonBody\(request\)/);
  assert.match(deleteRoute, /形式发票已永久删除|形式发票文件正在后台继续清理/);
});

test("hard deletion is admin-only and rejects every sign of external delivery", () => {
  assert.match(deletionService, /actor\?\.role !== "管理员"/);
  assert.match(deletionService, /assertExpectedQuotationVersion\(body, before\.currentVersionNumber\)/);
  assert.match(deletionService, /confirmQuoteNo !== before\.quoteNo/);
  assert.match(deletionService, /before\.status !== "DRAFT"/);
  assert.match(deletionService, /before\.deliveries\.length/);
  assert.match(deletionService, /notificationOutbox\.count/);
  assert.match(deletionService, /notificationDeliveryLog\.count/);
  assert.match(deletionService, /QUOTATION_CUSTOMER_EMAIL/);
});

test("hard deletion safely removes the full quotation tree without reusing invoice numbers", () => {
  assert.match(deletionService, /expectedPrefix = `sales-quotations\/\$\{before\.id\}\/versions\/\$\{asset\.sourceId\}\//);
  assert.match(deletionService, /enqueueFileStorageDeletion\(tx[\s\S]*deleteAfter: new Date\(\)/);
  assert.match(deletionService, /set_config\('app\.quotation_hard_delete_id', \$\{before\.id\}, true\)/);
  assert.ok(
    deletionService.indexOf("salesQuotationItem.deleteMany")
      < deletionService.indexOf("salesQuotationVersion.deleteMany"),
  );
  assert.ok(
    deletionService.indexOf("salesQuotationVersion.deleteMany")
      < deletionService.indexOf("salesQuotation.deleteMany"),
  );
  assert.doesNotMatch(deletionService, /salesQuotationInvoiceSequence\.(delete|update)/);
  assert.match(deletionService, /cleanupPending: deleted\.deletionTaskIds\.length > 0/);
  assert.doesNotMatch(deletionService, /processFileStorageDeletionOutbox|deleteQuotationDocumentObject|deleteR2Object/);
});

test("immutable snapshot triggers start with a transaction-scoped quotation tree", () => {
  assert.equal((deletionMigration.match(/current_setting\('app\.quotation_hard_delete_id', TRUE\)/g) || []).length, 2);
  assert.match(deletionMigration, /OLD\."quotation_id" = current_setting/);
  assert.match(deletionMigration, /WHERE "id" = OLD\."quotation_version_id"/);
  assert.doesNotMatch(deletionMigration, /DROP TRIGGER|DISABLE TRIGGER|ON DELETE CASCADE/);
});

test("forward migration also requires the parent quotation to remain a draft", () => {
  assert.equal((deletionHardeningMigration.match(/current_setting\('app\.quotation_hard_delete_id', TRUE\)/g) || []).length, 2);
  assert.match(
    deletionHardeningMigration,
    /OLD\."quotation_id" = current_setting[\s\S]*FROM "sales_quotations"[\s\S]*WHERE "id" = OLD\."quotation_id"[\s\S]*quotation_status = 'DRAFT'/,
  );
  assert.match(
    deletionHardeningMigration,
    /FROM "sales_quotation_versions" AS version[\s\S]*INNER JOIN "sales_quotations" AS quotation[\s\S]*version_quotation_id = current_setting[\s\S]*quotation_status = 'DRAFT'/,
  );
  assert.doesNotMatch(deletionHardeningMigration, /DROP TRIGGER|DISABLE TRIGGER|ON DELETE CASCADE/);
  assert.equal((deletionHardeningMigration.match(/TG_OP = 'UPDATE'/g) || []).length, 1);
  assert.equal((deletionHardeningMigration.match(/TG_OP = 'INSERT'/g) || []).length, 1);
});

test("quotation file deletion is durable, provider-aware and generation shares the row lock", () => {
  assert.match(storageOutbox, /bucket: bucket \|\| null/);
  assert.match(storageOutbox, /sales_quotation_versions[\s\S]*deleteQuotationDocumentObject/);
  assert.doesNotMatch(storageOutbox, /processFileStorageDeletionOutboxIds/);
  assert.match(storageOutbox, /export async function processFileStorageDeletionOutbox\(limit = 20\)/);
  assert.match(storageOutbox, /safeLimit = Math\.min\(50, Math\.max\(1,/);
  assert.match(documentService, /lockQuotationForEmailMutation\(tx, quotationId\)/);
  assert.match(documentService, /findDocumentAsset\(version\.id, tx\)/);
  assert.match(documentService, /tx\.fileAsset\.upsert/);
});

test("quotation delete UI uses admin gating, exact confirmation and page correction", () => {
  assert.match(quotationDeleteUi, /currentUser\.role === "管理员" && canWriteQuotations/);
  assert.match(quotationDeleteUi, /inputExpectedValue: quoteNo/);
  assert.match(quotationDeleteUi, /expectedVersionNumber: Number\(quotation\.currentVersionNumber \|\| 1\)/);
  assert.match(quotationDeleteUi, /\/api\/quotations\/\$\{encodeURIComponent\(quotation\.id\)\}\/draft/);
  assert.match(quotationDeleteUi, /Math\.min\(page, Math\.max\(1, Math\.ceil\(nextTotal \/ QUOTATION_PAGE_SIZE\)\)\)/);
  assert.match(detailDrawer, /删除报价/);
  assert.match(confirmationDialog, /inputValue !== String\(confirmation\.inputExpectedValue\)\.trim\(\)/);
});
