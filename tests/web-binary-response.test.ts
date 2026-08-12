import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const binaryResponseFiles = [
  "app/api/costs/[id]/payment-voucher/download/route.ts",
  "app/api/files/[kind]/[id]/download/route.ts",
  "app/api/files/[kind]/[id]/preview/route.ts",
  "app/api/order-documents/[id]/download/route.ts",
  "app/api/order-documents/[id]/preview/route.ts",
  "app/api/supplier-document-requests/[id]/template/route.ts",
  "lib/report-service-export.ts",
];

test("binary Web responses normalize Node buffers to compatible byte arrays", () => {
  for (const file of binaryResponseFiles) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /new Response\(Buffer\.from\(/, file);
    assert.match(source, /new Response\(new Uint8Array\(/, file);
  }
});
