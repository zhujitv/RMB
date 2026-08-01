import type { NextRequest } from "next/server";
import { resolveTrustedClientIp } from "./lib/client-ip";

const STORE = new Map<string, { count: number; resetAt: number }>();
const DEFAULTS = {
  windowMs: 60_000,
  readLimit: 1000,
  writeLimit: 300,
  uploadLimit: 60,
  weChatWebhookLimit: 3000,
  registrationWindowMs: 15 * 60_000,
  registrationLimit: 5,
  memoryMaxBuckets: 20_000,
};
let lastCleanupAt = 0;
let lastFallbackWarningAt = 0;
const REDIS_RESPONSE_MAX_BYTES = 128 * 1024;

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function rateLimitConfig() {
  return {
    windowMs: positiveIntegerFromEnv("API_RATE_LIMIT_WINDOW_MS", DEFAULTS.windowMs),
    readLimit: positiveIntegerFromEnv("API_RATE_LIMIT_READ_LIMIT", DEFAULTS.readLimit),
    writeLimit: positiveIntegerFromEnv("API_RATE_LIMIT_WRITE_LIMIT", DEFAULTS.writeLimit),
    uploadLimit: positiveIntegerFromEnv("API_RATE_LIMIT_UPLOAD_LIMIT", DEFAULTS.uploadLimit),
    weChatWebhookLimit: positiveIntegerFromEnv("API_RATE_LIMIT_WECHAT_WEBHOOK_LIMIT", DEFAULTS.weChatWebhookLimit),
    registrationWindowMs: positiveIntegerFromEnv("API_RATE_LIMIT_REGISTRATION_WINDOW_MS", DEFAULTS.registrationWindowMs),
    registrationLimit: positiveIntegerFromEnv("API_RATE_LIMIT_REGISTRATION_LIMIT", DEFAULTS.registrationLimit),
    memoryMaxBuckets: positiveIntegerFromEnv("API_RATE_LIMIT_MEMORY_MAX_BUCKETS", DEFAULTS.memoryMaxBuckets),
  };
}

function distributedRateLimitConfig() {
  const explicit = [process.env.RATE_LIMIT_REDIS_REST_URL, process.env.RATE_LIMIT_REDIS_REST_TOKEN];
  const upstash = [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN];
  const vercelUpstash = [
    process.env.UPSTASH_REDIS_KV_REST_API_URL,
    process.env.UPSTASH_REDIS_KV_REST_API_TOKEN,
  ];
  const candidates = [explicit, upstash, vercelUpstash];
  const [rawUrl, rawToken] = candidates.find(
    (pair) => pair.every((value) => String(value || "").trim()),
  ) || candidates.find((pair) => pair.some((value) => String(value || "").trim())) || explicit;
  const restUrl = String(rawUrl || "").replace(/\/+$/, "");
  const restToken = String(rawToken || "");
  const namespace = String(process.env.RATE_LIMIT_NAMESPACE || "nextwood").replace(/[^a-z0-9:_-]/gi, "_");
  if (!restUrl && !restToken) return null;
  if (!restUrl || !restToken) throw new Error("Distributed rate limit configuration is incomplete");
  const parsed = new URL(restUrl);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Distributed rate limit endpoint must use HTTPS without URL credentials");
  }
  return { restUrl, restToken, namespace };
}

function hashIdentity(value = "") {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isUnsafeMethod(method = "") {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isUploadRequest(request: NextRequest) {
  const uploadPath = /\/(?:[^/]+-)?(?:documents?|invoices?)(?:\/|$)|\/(?:attachments|import|package|payment-voucher|supplier-document-requests)(?:\/|$)/i;
  return isUnsafeMethod(request.method) && uploadPath.test(request.nextUrl.pathname);
}

function isRegistrationRequest(request: NextRequest) {
  return request.method.toUpperCase() === "POST" && request.nextUrl.pathname === "/api/auth/register";
}

function isWeChatOfficialAccountWebhookRequest(request: NextRequest) {
  return request.nextUrl.pathname === "/api/wechat/official-account/callback";
}

function identity(request: NextRequest) {
  // This layer cannot authenticate cookies. A network identity prevents a
  // forged session token from creating unlimited fresh rate-limit buckets.
  return `ip:${hashIdentity(resolveTrustedClientIp(request) || "unknown")}`;
}

export function apiRateLimitKey(request: NextRequest) {
  const requestClass = isRegistrationRequest(request)
    ? "registration"
    : isWeChatOfficialAccountWebhookRequest(request)
      ? "wechat-webhook"
      : isUploadRequest(request)
        ? "upload"
        : isUnsafeMethod(request.method)
          ? "write"
          : "read";
  return [
    "api",
    requestClass,
    identity(request),
  ].join(":");
}

function requestLimit(request: NextRequest) {
  const config = rateLimitConfig();
  if (isRegistrationRequest(request)) {
    return { limit: config.registrationLimit, windowMs: config.registrationWindowMs };
  }
  if (isWeChatOfficialAccountWebhookRequest(request)) {
    return { limit: config.weChatWebhookLimit, windowMs: config.windowMs };
  }
  return {
    limit: isUploadRequest(request) ? config.uploadLimit : isUnsafeMethod(request.method) ? config.writeLimit : config.readLimit,
    windowMs: config.windowMs,
  };
}

function checkMemoryApiRateLimit(request: NextRequest, limit: number, windowMs: number, now = Date.now()) {
  const { memoryMaxBuckets } = rateLimitConfig();
  if (now - lastCleanupAt >= 60_000) {
    lastCleanupAt = now;
    for (const [key, bucket] of STORE.entries()) if (bucket.resetAt <= now) STORE.delete(key);
  }
  const key = apiRateLimitKey(request);
  const current = STORE.get(key);
  if (!current && STORE.size >= memoryMaxBuckets) {
    return { allowed: false, limit, remaining: 0, resetAt: now + windowMs };
  }
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  STORE.set(key, bucket);
  return { allowed: bucket.count <= limit, limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

function warnFallback(error: unknown) {
  const now = Date.now();
  if (now - lastFallbackWarningAt < 60_000) return;
  lastFallbackWarningAt = now;
  console.warn("distributed rate limit unavailable; falling back to memory limit", {
    message: error instanceof Error ? error.message : String(error || "unknown"),
  });
}

async function readRedisJson(response: Response) {
  const declaredBytes = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > REDIS_RESPONSE_MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Redis rate limit response is too large");
  }
  if (!response.body) throw new Error("Redis rate limit response is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > REDIS_RESPONSE_MAX_BYTES) {
      await reader.cancel();
      throw new Error("Redis rate limit response is too large");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(combined));
}

async function checkDistributedApiRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const config = distributedRateLimitConfig();
  if (!config) return null;
  const ttl = Math.max(1, Math.ceil(windowMs / 1000));
  const timeoutMs = Math.min(5000, Math.max(250, positiveIntegerFromEnv("RATE_LIMIT_REDIS_TIMEOUT_MS", 1500)));
  const response = await fetch(`${config.restUrl}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.restToken}`, "Content-Type": "application/json" },
    body: JSON.stringify([["INCR", `${config.namespace}:rate:${key}`], ["EXPIRE", `${config.namespace}:rate:${key}`, ttl, "NX"], ["TTL", `${config.namespace}:rate:${key}`]]),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Redis rate limit request failed: ${response.status}`);
  const result = await readRedisJson(response);
  const count = Number(result?.[0]?.result ?? result?.[0] ?? 0);
  const ttlSeconds = Number(result?.[2]?.result ?? result?.[2] ?? ttl);
  if (!Number.isFinite(count) || count < 1 || !Number.isFinite(ttlSeconds)) {
    throw new Error("Redis rate limit response is invalid");
  }
  return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt: now + Math.max(1, ttlSeconds > 0 ? ttlSeconds : ttl) * 1000 };
}

export async function checkApiRateLimit(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/") || request.method.toUpperCase() === "OPTIONS") {
    return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
  }
  const { limit, windowMs } = requestLimit(request);
  try {
    const distributed = await checkDistributedApiRateLimit(apiRateLimitKey(request), limit, windowMs);
    if (distributed) return distributed;
  } catch (error) {
    warnFallback(error);
  }
  return checkMemoryApiRateLimit(request, limit, windowMs);
}
