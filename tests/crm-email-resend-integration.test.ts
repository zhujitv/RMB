import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("app/api/customer-email-messages/inbound/route.ts", "utf8");
const adapter = readFileSync("lib/platform/crm-email-resend-inbound.ts", "utf8");
const values = readFileSync("lib/platform/crm-email-resend-inbound-values.ts", "utf8");
const inbound = readFileSync("lib/platform/crm-email-inbound.ts", "utf8");
const settings = readFileSync("lib/platform/crm-email-settings.ts", "utf8");

test("Resend webhook is verified from the raw request before legacy body parsing", () => {
  assert.match(route, /if \(isResendInboundWebhookRequest\(request\)\)/);
  assert.ok(route.indexOf("receiveResendCustomerCrmEmail(request)") < route.indexOf("parseInboundCrmEmailRequest(request)"));
  assert.match(adapter, /const payload = await request\.text\(\)/);
  assert.match(adapter, /verifyResendInboundWebhookPayload\(payload, request\.headers\)/);
  assert.match(values, /new Webhook\(webhookSecret\)\.verify\(payload, verificationHeaders\)/);
  assert.match(route, /\{ status: 200 \}/);
});

test("Resend inbound fetches provider content, stores attachments, and deduplicates replays", () => {
  assert.match(adapter, /RESEND_INBOUND_API_KEY/);
  assert.match(adapter, /emails\/receiving/);
  assert.match(adapter, /\$\{RESEND_RECEIVING_ENDPOINT\}\/\$\{encodedId\}\/attachments/);
  assert.match(values, /resend-inbound:\$\{emailId\}/);
  assert.match(adapter, /claimWebhookReplay\("resend", fingerprint\)/);
  assert.ok(adapter.indexOf("matchingCustomers") < adapter.indexOf("processClaimedResendEmail(request, envelope)"));
  assert.match(adapter, /recordInboundCustomerCrmEmailMessage/);
  assert.match(adapter, /inbound-cdn\.resend\.com/);
  assert.match(inbound, /String\(body\.receivedAt \|\| ""\)/);
  assert.match(inbound, /code\?: string[\s\S]*P2002/);
});

test("changing the CRM mail domain migrates existing personal addresses atomically", () => {
  assert.match(settings, /const domainChanged = value\.mailDomain !== current\.mailDomain/);
  assert.match(settings, /prisma\.\$transaction/);
  assert.match(settings, /crmEmailAccount\.findMany/);
  assert.match(settings, /emailAddress: `\$\{account\.localPart\}@\$\{value\.mailDomain\}`/);
  assert.match(settings, /migratedAccountCount/);
});
