import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  quotationManualConfirmationChannel,
  requiredQuotationConfirmationDate,
} = await jiti.import<typeof import("../lib/platform/quotation-values.ts")>(
  "../lib/platform/quotation-values.ts",
);
const { recordQuotationDecision } = await jiti.import<
  typeof import("../lib/platform/quotation-status-service.ts")
>("../lib/platform/quotation-status-service.ts");

const schema = readFileSync("prisma/models/quotations.prisma", "utf8");
const identitySchema = readFileSync("prisma/models/identity.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260810020000_quotation_manual_confirmations/migration.sql",
  "utf8",
);
const manualOnlyMigration = readFileSync(
  "prisma/migrations/20260810021000_quotation_manual_confirmation_only/migration.sql",
  "utf8",
);
const manualService = readFileSync(
  "lib/platform/quotation-manual-confirmation-service.ts",
  "utf8",
);
const statusService = readFileSync("lib/platform/quotation-status-service.ts", "utf8");
const queryService = readFileSync("lib/platform/quotation-query-service.ts", "utf8");
const valuesService = readFileSync("lib/platform/quotation-values.ts", "utf8");
const deliveryValues = readFileSync("lib/platform/quotation-delivery-values.ts", "utf8");
const salesExecutionCreate = readFileSync(
  "lib/platform/sales-execution-create-quotation.ts",
  "utf8",
);
const route = readFileSync(
  "app/api/quotations/[id]/manual-confirmation/route.ts",
  "utf8",
);

test("quotation decisions form one immutable source of truth for every version", () => {
  const channelEnum = schema.match(/enum SalesQuotationDecisionChannel \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(channelEnum, /SYSTEM_EMAIL[\s\S]*EXTERNAL_EMAIL[\s\S]*WECHAT/);
  assert.match(channelEnum, /WHATSAPP[\s\S]*PHONE[\s\S]*OTHER/);
  assert.match(schema, /model SalesQuotationDecision \{/);
  assert.match(schema, /quotationVersionId\s+String\s+@unique/);
  assert.match(schema, /deliveryId\s+String\?\s+@unique/);
  assert.match(schema, /decision\s+SalesQuotationResponseStatus/);
  assert.match(schema, /recordedBy\s+User\s+@relation\("QuotationDecisionsRecorded"/);
  assert.match(identitySchema, /recordedQuotationDecisions\s+SalesQuotationDecision\[\]/);
});

test("legacy email responses are preserved only until the forward manual-only repair", () => {
  assert.match(migration, /INSERT INTO "sales_quotation_decisions"/);
  assert.match(migration, /'SYSTEM_EMAIL'::"SalesQuotationDecisionChannel"/);
  assert.match(migration, /multiple responses exist for one quotation version/);
  assert.match(migration, /current quotation status and decision evidence disagree/);
  assert.match(migration, /quotation\."status" <> 'VOIDED'/);
  assert.match(migration, /sales_quotation_decisions_channel_delivery_check/);
  assert.match(migration, /system email quotation decision must match its delivery response/);
  assert.match(migration, /sales_quotation_decisions_immutable/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "sales_quotation_decisions"/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/);
  assert.match(manualOnlyMigration, /CREATE OR REPLACE FUNCTION "validate_sales_quotation_decision_insert"/);
  assert.match(manualOnlyMigration, /PI email delivery cannot confirm a quotation; use manual confirmation/);
  assert.match(manualOnlyMigration, /linked sales executions require manual review/);
  assert.match(manualOnlyMigration, /quotation\."status" IN \('ACCEPTED', 'REJECTED'\)/);
  assert.match(manualOnlyMigration, /DELETE FROM "sales_quotation_decisions"[\s\S]*"channel" = 'SYSTEM_EMAIL'/);
  assert.match(manualOnlyMigration, /sales_quotation_deliveries_response_write_guard/);
  assert.match(manualOnlyMigration, /PI email delivery cannot store a customer confirmation/);
  assert.doesNotMatch(manualOnlyMigration, /DROP TABLE|DROP COLUMN|TRUNCATE/);
});

test("manual confirmation validates the current sealed version and records an audit-safe acceptance", () => {
  assert.match(manualService, /assertWrite\(actor, "quotations"\)/);
  assert.match(manualService, /assertExpectedQuotationVersion\(body, before\.currentVersionNumber\)/);
  assert.match(manualService, /!currentVersion\.sealedAt/);
  assert.match(manualService, /before\.status === "DRAFT" \|\| before\.status === "SENT"/);
  assert.match(manualService, /assertQuotationVersionNotExpired\(currentVersion\.validUntil\)/);
  assert.match(manualService, /assertNoActiveQuotationEmailLease\(tx, before\.id, currentVersion\.id\)/);
  assert.match(manualService, /salesQuotationDecision\.create/);
  assert.match(manualService, /decision: "ACCEPTED"/);
  assert.match(manualService, /data: \{ status: "ACCEPTED", updatedById: userId \}/);
  assert.match(manualService, /writeAudit\(/);
  assert.match(manualService, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(manualService, /\["P2002", "P2034"\]\.includes\(code\)/);
  assert.match(manualService, /sameManualConfirmation/);
  assert.match(route, /export async function POST/);
  assert.match(route, /recordManualQuotationConfirmation/);
});

test("manual confirmation channel and date validation reject forged or impossible evidence", () => {
  assert.equal(quotationManualConfirmationChannel("external_email"), "EXTERNAL_EMAIL");
  assert.throws(
    () => quotationManualConfirmationChannel("SYSTEM_EMAIL"),
    (error: unknown) => (error as { code?: string }).code === "QUOTATION_CONFIRMATION_CHANNEL_INVALID",
  );
  assert.throws(
    () => requiredQuotationConfirmationDate("", new Date("2026-08-01T00:00:00.000Z")),
    (error: unknown) => (error as { code?: string }).code === "QUOTATION_CONFIRMATION_DATE_REQUIRED",
  );
  assert.throws(
    () => requiredQuotationConfirmationDate(
      "2026-08-10",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-09T00:00:00.000Z"),
    ),
    (error: unknown) => (error as { code?: string }).code === "QUOTATION_CONFIRMATION_DATE_FUTURE",
  );
  assert.throws(
    () => requiredQuotationConfirmationDate(
      "2026-07-31",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-09T00:00:00.000Z"),
    ),
    (error: unknown) => (error as { code?: string }).code === "QUOTATION_CONFIRMATION_DATE_BEFORE_QUOTE",
  );
  assert.equal(
    requiredQuotationConfirmationDate(
      "2026-08-09",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-09T00:00:00.000Z"),
    ).toISOString().slice(0, 10),
    "2026-08-09",
  );
});

test("PI email delivery cannot write a customer decision", async () => {
  assert.match(statusService, /QUOTATION_EMAIL_DECISION_DISABLED/);
  assert.match(statusService, /assertWrite\(actor, "quotations"\)/);
  assert.doesNotMatch(statusService, /salesQuotationDecision\.(?:create|update|delete)/);
  assert.doesNotMatch(statusService, /salesQuotationDelivery\.(?:update|delete)/);
  assert.match(queryService, /decisions: \{[\s\S]*recordedBy: \{ select: quotationUserSelect \}/);
  assert.match(valuesService, /export function serializeQuotationDecision/);
  assert.match(valuesService, /decisions: includeVersions \? decisions : undefined/);
  assert.doesNotMatch(deliveryValues, /responseStatus|responseReason|respondedBy|respondedAt/);
  await assert.rejects(
    () => recordQuotationDecision(
      null,
      { id: "admin-1", role: "管理员" },
      "quote-1",
      { decision: "ACCEPTED", deliveryId: "delivery-1" },
    ),
    (error: unknown) => {
      const coded = error as { status?: number; code?: string };
      return coded.status === 409 && coded.code === "QUOTATION_EMAIL_DECISION_DISABLED";
    },
  );
});

test("sales execution requires the accepted immutable decision for the current PI version", () => {
  assert.match(salesExecutionCreate, /salesQuotationDecision\.findUnique/);
  assert.match(salesExecutionCreate, /quotationVersionId: current\.id/);
  assert.match(salesExecutionCreate, /acceptedDecision\.decision !== "ACCEPTED"/);
  assert.match(salesExecutionCreate, /acceptedDecision\.channel === "SYSTEM_EMAIL"/);
  assert.match(salesExecutionCreate, /QUOTATION_MANUAL_ACCEPTANCE_REQUIRED/);
  assert.doesNotMatch(salesExecutionCreate, /responseStatus: "ACCEPTED"/);
});
