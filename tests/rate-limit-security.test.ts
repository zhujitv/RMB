import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import type { NextRequest } from "next/server";

const jiti = createJiti(import.meta.url);
const { apiRateLimitKey, checkApiRateLimit } = await jiti.import<typeof import("../proxy-rate-limit.ts")>(
  "../proxy-rate-limit.ts",
);

const REDIS_ENV_KEYS = [
  "RATE_LIMIT_REDIS_REST_URL",
  "RATE_LIMIT_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_KV_REST_API_URL",
  "UPSTASH_REDIS_KV_REST_API_TOKEN",
] as const;

async function withRedisEnvironment(values: Record<string, string>, run: () => Promise<void>) {
  const previous = new Map(REDIS_ENV_KEYS.map((key) => [key, process.env[key]]));
  REDIS_ENV_KEYS.forEach((key) => delete process.env[key]);
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    REDIS_ENV_KEYS.forEach((key) => {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

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
  process.env.API_RATE_LIMIT_READ_LIMIT = "1";
  try {
    await withRedisEnvironment({}, async () => {
      const first = await checkApiRateLimit(request("/api/orders/cmb11111111111111111111111"));
      const second = await checkApiRateLimit(request("/api/anything-else"));
      assert.equal(first.allowed, true);
      assert.equal(second.allowed, false);
    });
  } finally {
    if (previousLimit === undefined) delete process.env.API_RATE_LIMIT_READ_LIMIT;
    else process.env.API_RATE_LIMIT_READ_LIMIT = previousLimit;
  }
});

test("Vercel Upstash integration variables drive distributed rate limiting", async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  let authorization = "";
  await withRedisEnvironment({
    UPSTASH_REDIS_KV_REST_API_URL: "https://vercel-upstash.example.net/",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "integration-token",
  }, async () => {
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") || "";
      return new Response(JSON.stringify([{ result: 1 }, { result: 1 }, { result: 60 }]));
    };
    const result = await checkApiRateLimit(request("/api/vercel-upstash"));
    assert.equal(result.allowed, true);
    assert.equal(requestedUrl, "https://vercel-upstash.example.net/pipeline");
    assert.equal(authorization, "Bearer integration-token");
  }).finally(() => {
    globalThis.fetch = previousFetch;
  });
});

test("explicit rate-limit Redis variables take priority over Upstash aliases", async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  let authorization = "";
  await withRedisEnvironment({
    RATE_LIMIT_REDIS_REST_URL: "https://explicit.example.net",
    RATE_LIMIT_REDIS_REST_TOKEN: "explicit-token",
    UPSTASH_REDIS_REST_URL: "https://legacy-upstash.example.net",
    UPSTASH_REDIS_REST_TOKEN: "legacy-token",
    UPSTASH_REDIS_KV_REST_API_URL: "https://vercel-upstash.example.net",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "integration-token",
  }, async () => {
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") || "";
      return new Response(JSON.stringify([{ result: 1 }, { result: 1 }, { result: 60 }]));
    };
    await checkApiRateLimit(request("/api/explicit-redis"));
    assert.equal(requestedUrl, "https://explicit.example.net/pipeline");
    assert.equal(authorization, "Bearer explicit-token");
  }).finally(() => {
    globalThis.fetch = previousFetch;
  });
});

test("registration and upload retain their dedicated compatibility buckets", () => {
  const registration = apiRateLimitKey(request("/api/auth/register", "POST"));
  const upload = apiRateLimitKey(request("/api/order-documents", "POST"));
  const purchaseOrderAttachment = apiRateLimitKey(request(
    "/api/sales-executions/execution-1/purchase-orders/po-1/dispatch-attachment",
    "POST",
  ));
  const write = apiRateLimitKey(request("/api/orders", "POST"));
  assert.match(registration, /^api:registration:/);
  assert.match(upload, /^api:upload:/);
  assert.match(purchaseOrderAttachment, /^api:upload:/);
  assert.match(write, /^api:write:/);
});
