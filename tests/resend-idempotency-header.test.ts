import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resendIdempotencyHeaderValue } = await jiti.import<
  typeof import("../lib/platform/resend-email-security.ts")
>("../lib/platform/resend-email-security.ts");

test("Resend idempotency headers safely encode Chinese tracking statuses", async () => {
  const businessKey = "freightower:tracking:20250516:进场:上海港:提柜(货)";
  const header = resendIdempotencyHeaderValue(businessKey);

  await assert.rejects(
    () => fetch("data:text/plain,ok", { headers: { "Idempotency-Key": businessKey } }),
    /ByteString/,
  );
  assert.match(header, /^nextwood-[a-f0-9]{64}$/);
  assert.equal(Buffer.byteLength(header, "ascii"), header.length);
  assert.equal(
    (await fetch("data:text/plain,ok", { headers: { "Idempotency-Key": header } })).ok,
    true,
  );
  assert.equal(resendIdempotencyHeaderValue(businessKey), header);
  assert.notEqual(
    resendIdempotencyHeaderValue("freightower:tracking:20250516:离港"),
    header,
  );
});

test("Resend idempotency header is omitted when no business key exists", () => {
  assert.equal(resendIdempotencyHeaderValue(undefined), "");
  assert.equal(resendIdempotencyHeaderValue(null), "");
  assert.equal(resendIdempotencyHeaderValue(""), "");
});

test("all Resend transports sanitize business keys before writing request headers", () => {
  for (const file of [
    "lib/platform/notification-email-transport.ts",
    "lib/platform/system-email.ts",
    "lib/platform/shipping-documents-email.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /resendIdempotencyHeaderValue/);
    assert.match(source, /"Idempotency-Key": idempotencyHeader/);
    assert.doesNotMatch(source, /"Idempotency-Key": idempotencyKey/);
  }
});
