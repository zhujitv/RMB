import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("app/api/health/route.ts", "utf8");
const securityAudit = readFileSync("scripts/security-audit.mjs", "utf8");

test("public readiness route verifies the database without exposing failure details", () => {
  assert.match(route, /readFile\(join\(process\.cwd\(\), "\.next", "RMB_DEPLOY_SHA"\)/);
  assert.match(route, /\^\[a-f0-9\]\{40\}\$/);
  assert.match(route, /prisma\.\$queryRaw`SELECT 1`/);
  assert.match(route, /status:\s*"ok"/);
  assert.match(route, /version:\s*readiness\.version/);
  assert.match(route, /status:\s*"unavailable"/);
  assert.match(route, /httpStatus:\s*503/);
  assert.match(route, /Cache-Control/);
  assert.match(route, /successCacheMs\s*=\s*10_000/);
  assert.match(route, /pendingReadiness/);
  assert.doesNotMatch(route, /error\.message|String\(error\)|stack/);
});

test("deployment readiness is explicitly classified as a narrow public route", () => {
  assert.match(securityAudit, /PUBLIC_API_ROUTES[\s\S]*"app\/api\/health\/route\.ts"/);
  assert.match(route, /\? \{ status: readiness\.status, version: readiness\.version \}/);
  assert.match(route, /: \{ status: readiness\.status \}/);
  assert.doesNotMatch(route, /process\.env|DATABASE_URL|error\.message|String\(error\)|stack/);
});
