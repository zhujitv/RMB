import type { NextRequest } from "next/server";

const STORE = new Map<string, { count: number; resetAt: number }>();
const DEFAULTS = { windowMs: 60_000, readLimit: 1000, writeLimit: 300, uploadLimit: 60 };
let lastCleanupAt = 0;
let lastFallbackWarningAt = 0;

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
  };
}

function distributedRateLimitConfig() {
  const restUrl = String(process.env.RATE_LIMIT_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
  const restToken = String(process.env.RATE_LIMIT_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "");
  const namespace = String(process.env.RATE_LIMIT_NAMESPACE || "nextwood").replace(/[^a-z0-9:_-]/gi, "_");
  return restUrl && restToken ? { restUrl, restToken, namespace } : null;
}

function requestIp(request: NextRequest) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function sessionToken(request: NextRequest) {
  return request.cookies.get("__Host-fta_session")?.value || request.cookies.get("fta_session")?.value
    || request.cookies.get("fta_user_id")?.value || "";
}

function hashIdentity(value = "") {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizedPath(pathname = "") {
  return pathname.split("/").map((segment) => {
    if (/^[0-9a-f]{8,}-[0-9a-f-]{8,}$/i.test(segment) || /^[0-9a-f]{16,}$/i.test(segment) || /^\d+$/.test(segment)) return ":id";
    return segment;
  }).join("/");
}

function isUnsafeMethod(method = "") {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isUploadRequest(request: NextRequest) {
  return isUnsafeMethod(request.method) && /\/(documents|invoice|attachments|import|package)(\/|$)/i.test(request.nextUrl.pathname);
}

function identity(request: NextRequest) {
  const token = sessionToken(request);
  return token ? `session:${hashIdentity(token)}` : `ip:${hashIdentity(requestIp(request))}`;
}

function rateLimitKey(request: NextRequest) {
  return ["api", isUnsafeMethod(request.method) ? "write" : "read", normalizedPath(request.nextUrl.pathname), identity(request)].join(":");
}

function requestLimit(request: NextRequest) {
  const config = rateLimitConfig();
  return {
    limit: isUploadRequest(request) ? config.uploadLimit : isUnsafeMethod(request.method) ? config.writeLimit : config.readLimit,
    windowMs: config.windowMs,
  };
}

function checkMemoryApiRateLimit(request: NextRequest, limit: number, windowMs: number, now = Date.now()) {
  if (now - lastCleanupAt >= 60_000) {
    lastCleanupAt = now;
    for (const [key, bucket] of STORE.entries()) if (bucket.resetAt <= now) STORE.delete(key);
  }
  const key = rateLimitKey(request);
  const current = STORE.get(key);
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

async function checkDistributedApiRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const config = distributedRateLimitConfig();
  if (!config) return null;
  const ttl = Math.max(1, Math.ceil(windowMs / 1000));
  const response = await fetch(`${config.restUrl}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.restToken}`, "Content-Type": "application/json" },
    body: JSON.stringify([["INCR", `${config.namespace}:rate:${key}`], ["EXPIRE", `${config.namespace}:rate:${key}`, ttl, "NX"], ["TTL", `${config.namespace}:rate:${key}`]]),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Redis rate limit request failed: ${response.status}`);
  const result = await response.json();
  const count = Number(result?.[0]?.result ?? result?.[0] ?? 0);
  const ttlSeconds = Number(result?.[2]?.result ?? result?.[2] ?? ttl);
  return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt: now + Math.max(1, ttlSeconds > 0 ? ttlSeconds : ttl) * 1000 };
}

export async function checkApiRateLimit(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/") || request.method.toUpperCase() === "OPTIONS") {
    return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
  }
  const { limit, windowMs } = requestLimit(request);
  try {
    const distributed = await checkDistributedApiRateLimit(rateLimitKey(request), limit, windowMs);
    if (distributed) return distributed;
  } catch (error) {
    warnFallback(error);
  }
  return checkMemoryApiRateLimit(request, limit, windowMs);
}
