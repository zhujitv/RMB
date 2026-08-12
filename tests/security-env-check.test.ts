import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SECURITY_ENV_KEYS = [
  "APP_URL",
  "APP_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "CRON_SECRET",
  "SETTINGS_ENCRYPTION_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_KV_REST_API_URL",
  "UPSTASH_REDIS_KV_REST_API_TOKEN",
  "RATE_LIMIT_REDIS_REST_URL",
  "RATE_LIMIT_REDIS_REST_TOKEN",
  "STRICT_PRODUCTION_SECURITY",
  "SECURITY_BUILD_MODE",
  "EXPOSE_ERROR_DETAILS",
  "QUOTATION_FILE_STORAGE_DRIVER",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "CI",
  "NODE_ENV",
  "npm_lifecycle_event",
] as const;

function runSecurityEnvironmentCheck(overrides: Record<string, string> = {}) {
  const env = { ...process.env };
  SECURITY_ENV_KEYS.forEach((key) => delete env[key]);
  Object.assign(env, overrides);
  return spawnSync(process.execPath, ["scripts/security-env-check.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

const validProductionEnvironment = {
  NODE_ENV: "production",
  APP_URL: "https://www.nextwood.net",
  CRON_SECRET: "0123456789abcdef".repeat(4),
  SETTINGS_ENCRYPTION_KEY: "0123456789abcdef".repeat(4),
  UPSTASH_REDIS_REST_URL: "https://secure-rate-limit.example.net",
  UPSTASH_REDIS_REST_TOKEN: "test-token",
};

test("production security gate cannot be disabled by CI=false", () => {
  const result = runSecurityEnvironmentCheck({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    CI: "false",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CRON_SECRET/);
  assert.match(result.stderr, /SETTINGS_ENCRYPTION_KEY/);
  assert.match(result.stderr, /分布式限流/);
  assert.doesNotMatch(result.stdout, /skipped/);
});

test("standalone production builds enforce the same security gate", () => {
  const result = runSecurityEnvironmentCheck({ NODE_ENV: "production" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /生产环境必须配置 HTTPS/);
});

test("ordinary npm build lifecycles enforce the gate before NODE_ENV is set", () => {
  const result = runSecurityEnvironmentCheck({ npm_lifecycle_event: "build:app" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CRON_SECRET/);
  assert.doesNotMatch(result.stdout, /skipped/);
});

test("valid production configuration passes while error details remain forbidden", () => {
  const passed = runSecurityEnvironmentCheck(validProductionEnvironment);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /passed/);

  const exposed = runSecurityEnvironmentCheck({
    ...validProductionEnvironment,
    EXPOSE_ERROR_DETAILS: "true",
  });
  assert.equal(exposed.status, 1);
  assert.match(exposed.stderr, /EXPOSE_ERROR_DETAILS/);
});

test("production security gate rejects local quotation file storage", () => {
  const result = runSecurityEnvironmentCheck({
    ...validProductionEnvironment,
    QUOTATION_FILE_STORAGE_DRIVER: "local",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /禁止启用报价本地文件存储/);
});

test("Vercel Upstash integration variables satisfy the production gate", () => {
  const result = runSecurityEnvironmentCheck({
    ...validProductionEnvironment,
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    UPSTASH_REDIS_KV_REST_API_URL: "https://vercel-upstash.example.net",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "integration-token",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed/);
});

test("Vercel preview builds keep non-production compatibility", () => {
  const result = runSecurityEnvironmentCheck({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "preview",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skipped/);
});

test("non-deployment CI builds require an explicit preview mode", () => {
  const result = runSecurityEnvironmentCheck({
    npm_lifecycle_event: "build:app",
    SECURITY_BUILD_MODE: "preview",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skipped/);
});
