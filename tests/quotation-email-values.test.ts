import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  NOTIFICATION_TYPES,
  TEXT_LIMITS,
} = await jiti.import<typeof import("../lib/platform/notification-definition-types.ts")>(
  "../lib/platform/notification-definition-types.ts",
);
const { NOTIFICATION_TYPE_DEFINITIONS } = await jiti.import<
  typeof import("../lib/platform/notification-definitions.ts")
>("../lib/platform/notification-definitions.ts");
const {
  buildQuotationEmailDefaultDraft,
  normalizeQuotationEmailBody,
  normalizeQuotationEmailRequestKey,
  normalizeQuotationEmailSendInput,
  normalizeQuotationEmailSubject,
} = await jiti.import<typeof import("../lib/platform/quotation-email-values.ts")>(
  "../lib/platform/quotation-email-values.ts",
);

function errorCode(code: string) {
  return (error: unknown) => (
    (error as { status?: number; code?: string }).status === 400
    && (error as { code?: string }).code === code
  );
}

test("quotation customer email is an editable PDF notification template", () => {
  const definition = NOTIFICATION_TYPE_DEFINITIONS.find((item) => (
    item.type === NOTIFICATION_TYPES.QUOTATION_CUSTOMER_EMAIL
  ));
  assert.ok(definition);
  assert.equal(definition.editable, true);
  assert.equal(definition.supportsAttachments, true);
  assert.match(definition.subjectTemplate, /\{quoteNo\}/);
  assert.match(definition.bodyTemplate, /attached PDF/i);
  assert.deepEqual(
    definition.variables.map((variable) => variable.key),
    ["quoteNo", "customerName", "versionNumber", "totalAmount", "currency", "salespersonName", "sellerName"],
  );
});

test("default quotation email draft renders the immutable quote values and normalizes addresses", () => {
  const draft = buildQuotationEmailDefaultDraft({
    quoteNo: "QT-20260809-ABC123",
    customerNameSnapshot: "Example Trading Ltd.",
    contactEmailSnapshot: " Buyer@Example.com ; buyer@example.com ",
    ccEmails: ["BUYER@example.com", "Finance@Example.com"],
    versionNumber: 3,
    totalAmount: "12500.00",
    currency: "USD",
    salespersonName: "Amy Chen",
    sellerNameEnSnapshot: "Example Seller Co., Ltd.",
  });

  assert.deepEqual(draft.recipientEmails, ["buyer@example.com"]);
  assert.deepEqual(draft.ccEmails, ["finance@example.com"]);
  assert.equal(draft.subject, "Quotation QT-20260809-ABC123 - Version 3");
  assert.match(draft.body, /Dear Example Trading Ltd\./);
  assert.match(draft.body, /Total Amount: USD 12500\.00/);
  assert.match(draft.body, /Amy Chen/);
  assert.match(draft.body, /Example Seller Co\., Ltd\./);
  assert.doesNotMatch(draft.subject + draft.body, /\{(?:quoteNo|customerName|versionNumber|totalAmount|currency|salespersonName|sellerName)\}/);
});

test("default draft tolerates an invalid historical customer email", () => {
  const draft = buildQuotationEmailDefaultDraft({
    quoteNo: "QT-LEGACY",
    contactEmailSnapshot: "old-invalid-address",
    ccEmails: ["also-invalid", "valid@example.com"],
  });
  assert.deepEqual(draft.recipientEmails, []);
  assert.deepEqual(draft.ccEmails, ["valid@example.com"]);
});

test("quotation email send input uses defaults, validates request key, and removes recipient duplicates from CC", () => {
  const defaults = buildQuotationEmailDefaultDraft({
    quoteNo: "QT-1",
    customerName: "Customer A",
    contactEmail: "default@example.com",
    versionNumber: 1,
    totalAmount: "88.00",
    currency: "EUR",
  });
  const normalized = normalizeQuotationEmailSendInput({
    recipientEmails: " Buyer@Example.com，second@example.com ",
    ccEmails: "buyer@example.com; finance@example.com",
    requestKey: " 550e8400-e29b-41d4-a716-446655440000 ",
  }, defaults);

  assert.deepEqual(normalized.recipientEmails, ["buyer@example.com", "second@example.com"]);
  assert.deepEqual(normalized.ccEmails, ["finance@example.com"]);
  assert.equal(normalized.subject, defaults.subject);
  assert.equal(normalized.body, defaults.body);
  assert.equal(normalized.requestKey, "550e8400-e29b-41d4-a716-446655440000");
});

test("quotation email send input rejects missing or malformed fields", () => {
  assert.throws(
    () => normalizeQuotationEmailSendInput({ recipientEmails: [], subject: "Quote", body: "Attached", requestKey: "req-1" }),
    errorCode("QUOTATION_EMAIL_RECIPIENT_REQUIRED"),
  );
  assert.throws(
    () => normalizeQuotationEmailSendInput({ recipientEmails: ["not-an-email"], subject: "Quote", body: "Attached", requestKey: "req-1" }),
    errorCode("INVALID_EMAIL_FORMAT"),
  );
  assert.throws(() => normalizeQuotationEmailSubject(""), errorCode("QUOTATION_EMAIL_SUBJECT_REQUIRED"));
  assert.throws(() => normalizeQuotationEmailSubject("Quote\nBcc: hidden@example.com"), errorCode("QUOTATION_EMAIL_SUBJECT_INVALID"));
  assert.throws(() => normalizeQuotationEmailSubject("x".repeat(TEXT_LIMITS.subject + 1)), errorCode("QUOTATION_EMAIL_SUBJECT_TOO_LONG"));
  assert.throws(() => normalizeQuotationEmailBody(""), errorCode("QUOTATION_EMAIL_BODY_REQUIRED"));
  assert.throws(() => normalizeQuotationEmailBody("Hello\u0000Customer"), errorCode("QUOTATION_EMAIL_BODY_INVALID"));
  assert.throws(() => normalizeQuotationEmailBody("x".repeat(TEXT_LIMITS.body + 1)), errorCode("QUOTATION_EMAIL_BODY_TOO_LONG"));
  assert.throws(() => normalizeQuotationEmailRequestKey(""), errorCode("QUOTATION_EMAIL_REQUEST_KEY_REQUIRED"));
  assert.throws(() => normalizeQuotationEmailRequestKey("unsafe request/key"), errorCode("QUOTATION_EMAIL_REQUEST_KEY_INVALID"));
  assert.throws(
    () => normalizeQuotationEmailSendInput({
      recipientEmails: Array.from({ length: 6 }, (_, index) => `to${index}@example.com`),
      subject: "Quote", body: "Attached", requestKey: "req-to-limit",
    }),
    errorCode("QUOTATION_EMAIL_TO_LIMIT_EXCEEDED"),
  );
  assert.throws(
    () => normalizeQuotationEmailSendInput({
      recipientEmails: ["buyer@example.com"],
      ccEmails: Array.from({ length: 11 }, (_, index) => `cc${index}@example.com`),
      subject: "Quote", body: "Attached", requestKey: "req-cc-limit",
    }),
    errorCode("QUOTATION_EMAIL_CC_LIMIT_EXCEEDED"),
  );
  assert.throws(
    () => normalizeQuotationEmailSendInput({
      recipientEmails: [`${"a".repeat(250)}@x.co`],
      subject: "Quote", body: "Attached", requestKey: "req-long-address",
    }),
    errorCode("QUOTATION_EMAIL_ADDRESS_TOO_LONG"),
  );
});
