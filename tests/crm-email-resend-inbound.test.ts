import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { Webhook } from "svix";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  parseMailbox,
  plainTextFromResendEmail,
  selectResendInboundAttachments,
  verifyResendInboundWebhookPayload,
} = await jiti.import<typeof import("../lib/platform/crm-email-resend-inbound.ts")>(
  "../lib/platform/crm-email-resend-inbound.ts",
);
const { assertCrmEmailAttachmentBodyMatchesMime } = await jiti.import<
  typeof import("../lib/platform/crm-email-attachments.ts")
>("../lib/platform/crm-email-attachments.ts");

const WEBHOOK_SECRET = `whsec_${Buffer.from("nextwood-resend-webhook-test-secret", "utf8").toString("base64")}`;

function signedHeaders(payload: string) {
  const messageId = "msg_crm_inbound_test_001";
  const timestamp = new Date();
  const signature = new Webhook(WEBHOOK_SECRET).sign(messageId, timestamp, payload);
  return new Headers({
    "svix-id": messageId,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": signature,
  });
}

test("Resend inbound verifies a valid Svix signature against the original payload", () => {
  const event = {
    type: "email.received",
    created_at: new Date().toISOString(),
    data: {
      email_id: "email_received_001",
      from: "customer@example.com",
      to: ["tony@send.nextwood.com"],
      subject: "RFQ reply",
    },
  };
  const payload = JSON.stringify(event);

  assert.deepEqual(
    verifyResendInboundWebhookPayload(payload, signedHeaders(payload), WEBHOOK_SECRET),
    event,
  );
});

test("Resend inbound rejects a missing or invalid Svix signature", () => {
  const payload = JSON.stringify({ type: "email.received", data: { email_id: "email_received_002" } });
  const headers = signedHeaders(payload);

  assert.throws(
    () => verifyResendInboundWebhookPayload(`${payload} `, headers, WEBHOOK_SECRET),
    (error: unknown) => (error as { code?: string }).code === "RESEND_WEBHOOK_SIGNATURE_INVALID",
  );
  assert.throws(
    () => verifyResendInboundWebhookPayload(payload, new Headers(), WEBHOOK_SECRET),
    (error: unknown) => (error as { code?: string }).code === "RESEND_WEBHOOK_SIGNATURE_HEADERS_MISSING",
  );
});

test("Resend inbound mailbox parsing supports display names and bare addresses", () => {
  assert.deepEqual(parseMailbox('"Alice Zhang" <Alice.Zhang@Example.COM>'), {
    email: "alice.zhang@example.com",
    name: "Alice Zhang",
  });
  assert.deepEqual(parseMailbox("Bob Smith <bob@example.com>"), {
    email: "bob@example.com",
    name: "Bob Smith",
  });
  assert.deepEqual(parseMailbox("bare@example.com"), {
    email: "bare@example.com",
    name: "",
  });
});

test("Resend inbound prefers text and safely falls back to readable HTML", () => {
  assert.equal(
    plainTextFromResendEmail("  Original plain text\r\nsecond line  ", "<p>ignored</p>"),
    "Original plain text\nsecond line",
  );
  assert.equal(
    plainTextFromResendEmail(
      "",
      "<style>.hidden{display:none}</style><p>Hello&nbsp;&amp; welcome</p><script>alert('x')</script><div>第二行<br>结束</div>",
    ),
    "Hello & welcome\n第二行\n结束",
  );
  assert.equal(plainTextFromResendEmail("", ""), "（邮件正文为空）");
});

function attachment(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `attachment_${index}`,
    filename: `document-${index}.pdf`,
    content_type: "application/pdf",
    size: 1024,
    download_url: `https://inbound-cdn.resend.com/document-${index}.pdf`,
    ...overrides,
  };
}

test("Resend inbound attachment selection allows at most five supported files", () => {
  const result = selectResendInboundAttachments(Array.from({ length: 6 }, (_, index) => attachment(index + 1)));

  assert.equal(result.accepted.length, 5);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /附件数量上限/);
});

test("Resend inbound attachment selection filters unsupported MIME and oversized files", () => {
  const tenMegabytes = 10 * 1024 * 1024;
  const result = selectResendInboundAttachments([
    attachment(1),
    attachment(2, { filename: "malware.exe", content_type: "application/x-msdownload" }),
    attachment(3, { size: tenMegabytes + 1 }),
  ]);

  assert.deepEqual(result.accepted.map((item) => item.fileName), ["document-1.pdf"]);
  assert.equal(result.skipped.length, 2);
  assert.ok(result.skipped.some((reason) => reason.includes("不支持的文件类型")));
  assert.ok(result.skipped.some((reason) => reason.includes("超过 10MB")));
});

test("Resend inbound attachment selection enforces the 20MB aggregate limit", () => {
  const tenMegabytes = 10 * 1024 * 1024;
  const result = selectResendInboundAttachments([
    attachment(1, { size: tenMegabytes }),
    attachment(2, { size: tenMegabytes }),
    attachment(3, { size: 1 }),
  ]);

  assert.equal(result.accepted.length, 2);
  assert.equal(result.accepted.reduce((sum, item) => sum + item.fileSize, 0), 20 * 1024 * 1024);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /附件总大小上限/);
});

test("CRM email attachments reject files whose content does not match the declared type", () => {
  assert.doesNotThrow(() => assertCrmEmailAttachmentBodyMatchesMime(
    "document.pdf",
    "application/pdf",
    Buffer.from("%PDF-1.7\nvalid-test-document"),
  ));
  assert.throws(
    () => assertCrmEmailAttachmentBodyMatchesMime(
      "document.pdf",
      "application/pdf",
      Buffer.from("MZ executable content"),
    ),
    (error: unknown) => (error as { code?: string }).code === "CRM_EMAIL_ATTACHMENT_SIGNATURE_INVALID",
  );
});
