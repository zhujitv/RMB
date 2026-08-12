import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  QUOTATION_EMAIL_LEASE_MS,
  QUOTATION_EMAIL_QUOTE_DAY_LIMIT,
  QUOTATION_EMAIL_USER_MINUTE_LIMIT,
  assertQuotationEmailRecipientLimits,
  assertQuotationVersionNotExpired,
  isQuotationVersionExpired,
  quotationEmailClaimDisposition,
  quotationEmailPayloadMatches,
  startOfChinaDay,
} = await jiti.import<typeof import("../lib/platform/quotation-email-delivery-rules.ts")>(
  "../lib/platform/quotation-email-delivery-rules.ts",
);

const claimSource = readFileSync("lib/platform/quotation-email-delivery-claim.ts", "utf8");
const emailSource = readFileSync("lib/platform/quotation-email-service.ts", "utf8");
const statusSource = readFileSync("lib/platform/quotation-status-service.ts", "utf8");
const mutationSource = readFileSync("lib/platform/quotation-service.ts", "utf8");

const payload = {
  quotationId: "quote-1",
  quotationVersionId: "version-1",
  versionNumber: 3,
  idempotencyKey: "quotation-email:quote-1:v3:req-1",
  recipientEmails: ["buyer@example.com", "owner@example.com"],
  ccEmails: ["finance@example.com"],
  subject: "Quotation QT-1",
  body: "Please see the attached quotation.",
  attachmentFileAssetId: "asset-1",
  attachmentFileName: "quotation.pdf",
  sentById: "user-1",
};

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: "delivery-1",
    quotationId: payload.quotationId,
    quotationVersionId: payload.quotationVersionId,
    idempotencyKey: payload.idempotencyKey,
    status: "PENDING" as const,
    recipientEmails: ["OWNER@example.com", "buyer@example.com"],
    ccEmails: ["FINANCE@example.com"],
    subject: payload.subject,
    body: payload.body,
    attachmentFileAssetId: payload.attachmentFileAssetId,
    attachmentFileName: payload.attachmentFileName,
    sentById: payload.sentById,
    outboxId: null,
    attempts: 1,
    sentAt: null,
    updatedAt: new Date("2026-08-09T03:00:00.000Z"),
    ...overrides,
  };
}

function errorCode(code: string, status?: number) {
  return (error: unknown) => {
    const typed = error as { code?: string; status?: number };
    return typed.code === code && (status === undefined || typed.status === status);
  };
}

test("idempotency keys are bound to the complete delivery payload", () => {
  assert.equal(quotationEmailPayloadMatches(delivery(), payload), true);
  assert.equal(quotationEmailPayloadMatches(delivery({ body: "changed" }), payload), false);
  assert.equal(quotationEmailPayloadMatches(delivery({ sentById: "user-2" }), payload), false);
  assert.equal(quotationEmailPayloadMatches(delivery({ idempotencyKey: "other-key" }), payload), false);
  assert.throws(
    () => quotationEmailClaimDisposition(delivery({ subject: "changed" }), null, payload),
    errorCode("QUOTATION_EMAIL_IDEMPOTENCY_PAYLOAD_MISMATCH", 409),
  );
});

test("a known sent outcome only finalizes, while fresh leases block duplicate sends", () => {
  const now = new Date("2026-08-09T03:10:00.000Z");
  const sentOutbox = {
    id: "outbox-1",
    status: "sent",
    sentAt: now,
    updatedAt: now,
  };
  assert.equal(quotationEmailClaimDisposition(delivery({ status: "FAILED" }), sentOutbox, payload, now), "FINALIZE");
  assert.equal(quotationEmailClaimDisposition(delivery({ status: "SENT" }), null, payload, now), "FINALIZE");
  assert.equal(quotationEmailClaimDisposition(delivery(), null, payload, now), "IN_PROGRESS");
  assert.equal(quotationEmailClaimDisposition(
    delivery({ updatedAt: new Date(now.getTime() - QUOTATION_EMAIL_LEASE_MS) }),
    null,
    payload,
    now,
  ), "RETRY");
  assert.equal(quotationEmailClaimDisposition(
    delivery({ status: "FAILED" }),
    { ...sentOutbox, status: "sending", sentAt: null },
    payload,
    now,
  ), "IN_PROGRESS");
});

test("quotation email limits and China-day boundary are deterministic", () => {
  assert.equal(QUOTATION_EMAIL_LEASE_MS, 15 * 60 * 1000);
  assert.equal(QUOTATION_EMAIL_USER_MINUTE_LIMIT, 5);
  assert.equal(QUOTATION_EMAIL_QUOTE_DAY_LIMIT, 25);
  assert.doesNotThrow(() => assertQuotationEmailRecipientLimits(Array(5).fill("to@example.com"), Array(10).fill("cc@example.com")));
  assert.throws(
    () => assertQuotationEmailRecipientLimits(Array(6).fill("to@example.com"), []),
    errorCode("QUOTATION_EMAIL_RECIPIENT_LIMIT", 400),
  );
  assert.throws(
    () => assertQuotationEmailRecipientLimits([], Array(11).fill("cc@example.com")),
    errorCode("QUOTATION_EMAIL_CC_LIMIT", 400),
  );
  assert.equal(startOfChinaDay(new Date("2026-08-09T15:59:59.000Z")).toISOString(), "2026-08-08T16:00:00.000Z");
  assert.equal(startOfChinaDay(new Date("2026-08-09T16:00:00.000Z")).toISOString(), "2026-08-09T16:00:00.000Z");
});

test("expired quotations cannot be sent or accepted", () => {
  const today = new Date("2026-08-09T00:00:00.000Z");
  assert.equal(isQuotationVersionExpired(new Date("2026-08-08T00:00:00.000Z"), today), true);
  assert.equal(isQuotationVersionExpired(new Date("2026-08-09T00:00:00.000Z"), today), false);
  assert.throws(
    () => assertQuotationVersionNotExpired(new Date("2020-01-01T00:00:00.000Z")),
    errorCode("QUOTATION_EXPIRED", 409),
  );
});

test("delivery claims serialize creation, recover P2002, and rate-limit only new keys", () => {
  assert.match(claimSource, /FOR UPDATE/);
  assert.match(claimSource, /const existing[\s\S]*if \(existing\)[\s\S]*assertNewSendRateLimits/);
  assert.match(claimSource, /code !== "P2002"/);
  assert.match(claimSource, /return retryExistingClaim\(payload\)/);
  assert.match(claimSource, /status: delivery\.status, updatedAt: delivery\.updatedAt/);
  assert.match(claimSource, /actorMinuteCount >= QUOTATION_EMAIL_USER_MINUTE_LIMIT/);
  assert.match(claimSource, /quotationDayCount >= QUOTATION_EMAIL_QUOTE_DAY_LIMIT/);
});

test("known provider success cannot enter the failed-delivery path", () => {
  assert.match(emailSource, /assertWrite\(actor, "quotations"\)[\s\S]*assertWrite\(actor, "customerCommunication"\)/);
  assert.match(emailSource, /ignoreTemplateCc: true/);
  assert.match(emailSource, /OUTCOME_RECONCILIATION_REQUIRED/);
  assert.match(emailSource, /if \(sentOutbox\)[\s\S]*reconcileKnownProviderSuccess/);
  assert.match(emailSource, /catch \(error: unknown\)[\s\S]*markDeliveryFailed[\s\S]*throw error;[\s\S]*return reconcileKnownProviderSuccess/);
  assert.match(emailSource, /const existing = await prisma\.salesQuotationDelivery\.findUnique[\s\S]*if \(!existing\)[\s\S]*QUOTATION_CURRENT_VERSION_REQUIRED/);
  assert.match(emailSource, /const defaults = existing \? persistedDeliveryDraft\(existing\)/);
  assert.match(emailSource, /if \(claim\.action === "FINALIZE"\)[\s\S]*return reconcileKnownProviderSuccess[\s\S]*let file:/);
});

test("email feedback is disabled while edits and voids bind to the sending lease", () => {
  assert.match(statusSource, /QUOTATION_EMAIL_DECISION_DISABLED/);
  assert.doesNotMatch(statusSource, /salesQuotationDecision\.(?:create|update|delete)/);
  assert.doesNotMatch(statusSource, /salesQuotationDelivery\.(?:update|delete)/);
  assert.equal((mutationSource.match(/lockQuotationForEmailMutation\(tx, id\)/g) || []).length, 2);
  assert.equal((mutationSource.match(/assertNoActiveQuotationEmailLease\(tx, before\.id, current\.id\)/g) || []).length, 2);
});
