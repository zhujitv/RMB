import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { quotationStatusLabel } from "../app/modules/quotations/types.ts";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const { resolveQuotationBusinessEntity } = await jiti.import<
  typeof import("../lib/platform/quotation-seller-snapshot.ts")
>("../lib/platform/quotation-seller-snapshot.ts");

const schema = readFileSync("prisma/models/quotations.prisma", "utf8");
const foundationMigration = readFileSync(
  "prisma/migrations/20260809110000_sales_quotation_foundation/migration.sql",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20260809183000_sales_quotation_delivery/migration.sql",
  "utf8",
);
const service = readFileSync("lib/platform/quotation-service.ts", "utf8");
const statusService = readFileSync("lib/platform/quotation-status-service.ts", "utf8");
const emailService = readFileSync("lib/platform/quotation-email-service.ts", "utf8");
const emailClaimService = readFileSync("lib/platform/quotation-email-delivery-claim.ts", "utf8");
const documentService = readFileSync("lib/platform/quotation-documents.ts", "utf8");
const documentStorage = readFileSync("lib/platform/quotation-document-storage.ts", "utf8");
const documentIntegrity = readFileSync("lib/platform/quotation-document-integrity.ts", "utf8");
const documentRoute = readFileSync("app/api/quotations/[id]/document/route.ts", "utf8");
const emailRoute = readFileSync("app/api/quotations/[id]/email/route.ts", "utf8");
const decisionRoute = readFileSync("app/api/quotations/[id]/decision/route.ts", "utf8");
const sellerSnapshot = readFileSync("lib/platform/quotation-seller-snapshot.ts", "utf8");
const detailActions = readFileSync("app/modules/quotations/quotation-detail-actions.tsx", "utf8");
const detailDrawer = readFileSync("app/modules/quotations/quotation-detail-drawer.tsx", "utf8");

test("phase two quotation schema adds delivery history and five lifecycle states", () => {
  assert.match(schema, /enum SalesQuotationStatus \{[\s\S]*DRAFT[\s\S]*SENT[\s\S]*ACCEPTED[\s\S]*REJECTED[\s\S]*VOIDED/);
  assert.match(schema, /businessEntityId\s+String\s+@map\("business_entity_id"\)/);
  assert.match(schema, /model SalesQuotationDelivery \{/);
  assert.match(schema, /idempotencyKey\s+String\s+@unique/);
  assert.match(schema, /quotationVersionId\s+String/);
  assert.match(schema, /responseStatus\s+SalesQuotationResponseStatus\?/);
  assert.match(schema, /recipientEmails\s+Json/);
});

test("phase two is a forward-only migration with immutable version snapshots", () => {
  assert.match(
    foundationMigration,
    /CREATE TYPE "SalesQuotationStatus" AS ENUM \('DRAFT', 'VOIDED'\)/,
  );
  for (const status of ["SENT", "ACCEPTED", "REJECTED"]) {
    assert.match(
      migration,
      new RegExp(`ALTER TYPE "SalesQuotationStatus" ADD VALUE IF NOT EXISTS '${status}'`),
    );
  }
  assert.match(migration, /ALTER TYPE "SalesQuotationStatus"[\s\S]*BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.match(migration, /CREATE TABLE "sales_quotation_deliveries"/);
  assert.match(migration, /FOREIGN KEY \("quotation_version_id"\)/);
  assert.match(migration, /business_entity_name_snapshot/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/);
});

test("seller details are snapshotted and non-default entities do not inherit another legal name", () => {
  assert.match(sellerSnapshot, /businessEntityNameSnapshot: entity\.name/);
  assert.match(sellerSnapshot, /profileValue[\s\S]*profileMatchesEntity \? nonEmpty\(fallbackValue\) : ""/);
  assert.match(sellerSnapshot, /profileValue\(entity\.nameEn, profile\.companyNameEn\) \|\| entity\.name/);
  assert.match(sellerSnapshot, /documentTemplateVersion: "PI_V5"/);
  assert.match(sellerSnapshot, /\["PI_V1", "PI_V2", "PI_V3", "PI_V4", "PI_V5"\]\.includes/);
  assert.match(sellerSnapshot, /sellerEmailSnapshot: entity\.showContactEmailOnPi/);
  assert.match(sellerSnapshot, /报价创建后不能更换业务主体/);
});

test("quotation creation requires an explicitly selected business entity", () => {
  assert.match(sellerSnapshot, /if \(!normalizedRequestedId\)[\s\S]*BUSINESS_ENTITY_REQUIRED/);
  assert.doesNotMatch(sellerSnapshot, /getDefaultBusinessEntity/);
});

test("business entity resolver enforces create and edit selection rules", async () => {
  const existingEntity = { id: "entity-existing", name: "Existing Entity" };
  const client = {
    businessEntity: {
      findUnique: async ({ where }: { where: { id: string } }) => (
        where.id === existingEntity.id ? existingEntity : null
      ),
      findFirst: async () => null,
    },
    businessEntityBankAccount: {
      findMany: async () => [],
    },
  };

  await assert.rejects(
    () => resolveQuotationBusinessEntity(client as never, undefined),
    (error: unknown) => {
      const typed = error as { status?: number; code?: string };
      return typed.status === 400 && typed.code === "BUSINESS_ENTITY_REQUIRED";
    },
  );
  await assert.rejects(
    () => resolveQuotationBusinessEntity(client as never, "entity-invalid"),
    (error: unknown) => {
      const typed = error as { status?: number; code?: string };
      return typed.status === 400 && typed.code === "BUSINESS_ENTITY_INVALID";
    },
  );

  const reused = await resolveQuotationBusinessEntity(client as never, "", existingEntity.id);
  assert.equal(reused.id, existingEntity.id);
  assert.deepEqual(reused.bankAccounts, []);

  await assert.rejects(
    () => resolveQuotationBusinessEntity(client as never, "entity-other", existingEntity.id),
    (error: unknown) => {
      const typed = error as { status?: number; code?: string };
      return typed.status === 409 && typed.code === "QUOTATION_BUSINESS_ENTITY_IMMUTABLE";
    },
  );
});

test("email delivery stays send-only while accepted quotes stay locked", () => {
  assert.match(service, /\["DRAFT", "SENT", "REJECTED"\]\.includes\(before\.status\)/);
  assert.match(service, /status: "DRAFT"/);
  assert.match(service, /客户已接受的报价不能作废/);
  assert.match(statusService, /QUOTATION_EMAIL_DECISION_DISABLED/);
  assert.doesNotMatch(statusService, /salesQuotationDecision\.(?:create|update|delete)/);
  assert.doesNotMatch(statusService, /salesQuotationDelivery\.(?:update|delete)/);
});

test("PI generation stores one private file per immutable quotation version", () => {
  assert.match(documentService, /SOURCE_TABLE = "sales_quotation_versions"/);
  assert.match(documentService, /FILE_ROLE = "PROFORMA_INVOICE"/);
  assert.match(documentService, /sourceTable_sourceId_fileRole/);
  assert.match(documentIntegrity, /const quotation = storageSegment\(quotationId[\s\S]*const version = storageSegment\(versionId/);
  assert.match(documentIntegrity, /sales-quotations\/\$\{quotation\}\/versions\/\$\{version\}/);
  assert.match(documentService, /readQuotationDocumentObject/);
  assert.match(documentStorage, /readR2Object/);
  assert.match(documentStorage, /LOCAL_QUOTATION_DOCUMENT_BUCKET = "local:\/\/quotation-documents"/);
  assert.match(documentRoute, /export async function POST/);
  assert.match(documentRoute, /export async function GET/);
  assert.match(documentRoute, /managedFileStreamHeaders/);
});

test("quotation email sends the stored PDF with version-scoped idempotency", () => {
  assert.match(emailService, /quotation-email:\$\{quotation\.id\}:v\$\{version\.versionNumber\}:\$\{requestKey\}/);
  assert.match(emailService, /readQuotationDocument/);
  assert.match(emailService, /attachments: \[\{ filename: document\.fileName, content: file\.body/);
  assert.match(emailClaimService, /status: "SENT"/);
  assert.match(emailService, /status: "FAILED"/);
  assert.match(emailRoute, /export async function GET/);
  assert.match(emailRoute, /export async function POST/);
  assert.match(decisionRoute, /recordQuotationDecision/);
  assert.match(statusService, /PI 邮件发送仅代表已发送/);
});

test("quotation UI exposes PI and the two supported customer workflow actions", () => {
  assert.match(detailActions, /预览 PI/);
  assert.match(detailActions, /下载 PDF/);
  assert.match(detailActions, /发送客户/);
  assert.match(detailActions, /手动确认/);
  assert.doesNotMatch(detailActions, />客户接受<\/button>|>客户拒绝<\/button>/);
  assert.doesNotMatch(detailActions, /QuotationResponseDialog|当前版本没有系统邮件发送记录/);
  assert.match(detailDrawer, /QuotationDeliveryHistory/);
  assert.equal(quotationStatusLabel("DRAFT"), "草稿");
  assert.equal(quotationStatusLabel("SENT"), "已发送");
  assert.equal(quotationStatusLabel("ACCEPTED"), "客户已接受");
  assert.equal(quotationStatusLabel("REJECTED"), "客户已拒绝");
  assert.equal(quotationStatusLabel("VOIDED"), "已作废");
});
