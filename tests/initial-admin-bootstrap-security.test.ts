import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bootstrapSource = readFileSync(new URL("../lib/platform/shared-users-bootstrap.ts", import.meta.url), "utf8");
const passwordSource = readFileSync(new URL("../lib/platform/shared-auth-password.ts", import.meta.url), "utf8");

test("initial administrator bootstrap is restricted to an empty database", () => {
  assert.match(bootstrapSource, /const userCount[\s\S]*prisma\.user\.count\(\)/);
  assert.match(bootstrapSource, /if \(userCount > 0\)[\s\S]*database-not-empty/);
  assert.doesNotMatch(bootstrapSource, /initialAdminUpsert|initial-admin-updated/);
  assert.doesNotMatch(bootstrapSource, /prisma\.user\.update\(\{ where: \{ id: existing\.id \}/);
});

test("initial administrator password must pass the full password policy", () => {
  assert.match(passwordSource, /!passwordMeetsPolicy\(INITIAL_ADMIN_PASSWORD\)/);
});
