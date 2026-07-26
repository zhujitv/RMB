import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import type { NextRequest } from "next/server";

const jiti = createJiti(import.meta.url);
const { apiRateLimitKey, checkApiRateLimit } = await jiti.import<typeof import("../proxy-rate-limit.ts")>(
  "../proxy-rate-limit.ts",
);

function request(path: string, method = "GET") {
  return {
    method,
    nextUrl: new URL(`https://www.nextwood.net${path}`),
    headers: { get: () => null },
  } as unknown as NextRequest;
}

test("random paths and CUID resource ids share one coarse IP bucket", () => {
  const paths = [
    "/api/orders/cmbzzzzzzzzzzzzzzzzzzzzzz",
    "/api/orders/cmaaaaaaaaaaaaaaaaaaaaaaa",
    "/api/random-attacker-controlled-path",
  ];
  const keys = paths.map((path) => apiRateLimitKey(request(path)));
  assert.equal(new Set(keys).size, 1);
  assert.doesNotMatch(keys[0], /orders|random|cmbz|cmaa/);
});

test("changing a path cannot bypass the active in-memory limit", async () => {
  const previousLimit = process.env.API_RATE_LIMIT_READ_LIMIT;
  const previousUrl = process.env.RATE_LIMIT_REDIS_REST_URL;
  const previousToken = process.env.RATE_LIMIT_REDIS_REST_TOKEN;
  const previousUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.API_RATE_LIMIT_READ_LIMIT = "1";
  delete process.env.RATE_LIMIT_REDIS_REST_URL;
  delete process.env.RATE_LIMIT_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    const first = await checkApiRateLimit(request("/api/orders/cmb11111111111111111111111"));
    const second = await checkApiRateLimit(request("/api/anything-else"));
    assert.equal(first.allowed, true);
    assert.equal(second.allowed, false);
  } finally {
    if (previousLimit === undefined) delete process.env.API_RATE_LIMIT_READ_LIMIT;
    else process.env.API_RATE_LIMIT_READ_LIMIT = previousLimit;
    if (previousUrl === undefined) delete process.env.RATE_LIMIT_REDIS_REST_URL;
    else process.env.RATE_LIMIT_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.RATE_LIMIT_REDIS_REST_TOKEN;
    else process.env.RATE_LIMIT_REDIS_REST_TOKEN = previousToken;
    if (previousUpstashUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousUpstashUrl;
    if (previousUpstashToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousUpstashToken;
  }
});

test("registration and upload retain their dedicated compatibility buckets", () => {
  const registration = apiRateLimitKey(request("/api/auth/register", "POST"));
  const upload = apiRateLimitKey(request("/api/order-documents", "POST"));
  const write = apiRateLimitKey(request("/api/orders", "POST"));
  assert.match(registration, /^api:registration:/);
  assert.match(upload, /^api:upload:/);
  assert.match(write, /^api:write:/);
});
