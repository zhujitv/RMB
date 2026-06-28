import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy, isDevelopmentEnv, staticSecurityHeaders } from "./lib/security-headers.mjs";

const BLOCKED_BOT_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /baiduspider/i,
  /yandex(bot|images|mobilebot)/i,
  /duckduckbot/i,
  /slurp/i,
  /sogou/i,
  /exabot/i,
  /applebot(?!-extended)/i,
  /petalbot/i,
  /ahrefsbot/i,
  /semrushbot/i,
  /mj12bot/i,
  /dotbot/i,
  /bytespider/i,
  /gptbot/i,
  /chatgpt-user/i,
  /oai-searchbot/i,
  /google-extended/i,
  /claudebot/i,
  /claude-web/i,
  /anthropic-ai/i,
  /perplexitybot/i,
  /ccbot/i,
  /facebookbot/i,
  /meta-externalagent/i,
  /amazonbot/i,
  /youbot/i,
  /cohere-ai/i,
  /applebot-extended/i,
  /diffbot/i,
];

const IS_DEVELOPMENT = isDevelopmentEnv();
const SECURITY_HEADERS = Object.fromEntries(staticSecurityHeaders().map(({ key, value }) => [key, value]));
const API_RATE_LIMIT_STORE = new Map<string, { count: number; resetAt: number }>();
const API_RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
let lastRateLimitCleanupAt = 0;
let lastDistributedRateLimitWarningAt = 0;

const API_RATE_LIMIT_DEFAULTS = {
  windowMs: 60_000,
  readLimit: 1000,
  writeLimit: 300,
  uploadLimit: 60,
};

function headerOrigin(value = "") {
  const text = String(value || "").trim();
  if (!text || text === "null") return "";
  try {
    return new URL(text).origin;
  } catch {
    return "";
  }
}

function originListFromEnv() {
  return [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.APP_BASE_URL,
    process.env.ALLOWED_ORIGINS,
  ].flatMap((value) => String(value || "").split(/[\s,;]+/)).map(headerOrigin).filter(Boolean);
}

function localDevelopmentAliases(origin = "") {
  if (!IS_DEVELOPMENT) return [];
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) return [];
    const port = url.port ? `:${url.port}` : "";
    return [`http://localhost${port}`, `http://127.0.0.1${port}`];
  } catch {
    return [];
  }
}

function allowedRequestOrigins(expectedOrigin = "") {
  const configuredOrigins = originListFromEnv();
  return new Set([
    expectedOrigin,
    ...configuredOrigins,
    ...localDevelopmentAliases(expectedOrigin),
    ...configuredOrigins.flatMap(localDevelopmentAliases),
  ].filter(Boolean));
}

function isBlockedCorsPreflight(request: NextRequest) {
  if (request.method.toUpperCase() !== "OPTIONS") return false;
  if (!request.headers.get("access-control-request-method")) return false;
  const origin = headerOrigin(request.headers.get("origin") || "");
  if (!origin) return false;
  return !allowedRequestOrigins(request.nextUrl.origin).has(origin);
}

function isBlockedBot(userAgent = "") {
  return BLOCKED_BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function apiRateLimitConfig() {
  return {
    windowMs: positiveIntegerFromEnv("API_RATE_LIMIT_WINDOW_MS", API_RATE_LIMIT_DEFAULTS.windowMs),
    readLimit: positiveIntegerFromEnv("API_RATE_LIMIT_READ_LIMIT", API_RATE_LIMIT_DEFAULTS.readLimit),
    writeLimit: positiveIntegerFromEnv("API_RATE_LIMIT_WRITE_LIMIT", API_RATE_LIMIT_DEFAULTS.writeLimit),
    uploadLimit: positiveIntegerFromEnv("API_RATE_LIMIT_UPLOAD_LIMIT", API_RATE_LIMIT_DEFAULTS.uploadLimit),
  };
}

function distributedRateLimitConfig() {
  const restUrl = String(process.env.RATE_LIMIT_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
  const restToken = String(process.env.RATE_LIMIT_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "");
  const namespace = String(process.env.RATE_LIMIT_NAMESPACE || "nextwood").replace(/[^a-z0-9:_-]/gi, "_");
  return restUrl && restToken ? { restUrl, restToken, namespace } : null;
}

function requestIp(request: NextRequest) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function sessionTokenForRateLimit(request: NextRequest) {
  return request.cookies.get("__Host-fta_session")?.value
    || request.cookies.get("fta_session")?.value
    || request.cookies.get("fta_user_id")?.value
    || "";
}

function hashRateLimitIdentity(value = "") {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizedRateLimitPath(pathname = "") {
  return pathname
    .split("/")
    .map((segment) => {
      if (/^[0-9a-f]{8,}-[0-9a-f-]{8,}$/i.test(segment)) return ":id";
      if (/^[0-9a-f]{16,}$/i.test(segment)) return ":id";
      if (/^\d+$/.test(segment)) return ":id";
      return segment;
    })
    .join("/");
}

function isApiRequest(request: NextRequest) {
  return request.nextUrl.pathname.startsWith("/api/");
}

function isUnsafeMethod(method = "") {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isUploadApiRequest(request: NextRequest) {
  const method = request.method.toUpperCase();
  const pathname = request.nextUrl.pathname;
  if (!isUnsafeMethod(method)) return false;
  return /\/(documents|invoice|attachments|import|package)(\/|$)/i.test(pathname);
}

function cleanupRateLimitStore(now: number) {
  if (now - lastRateLimitCleanupAt < API_RATE_LIMIT_CLEANUP_INTERVAL_MS) return;
  lastRateLimitCleanupAt = now;
  for (const [key, bucket] of API_RATE_LIMIT_STORE.entries()) {
    if (bucket.resetAt <= now) API_RATE_LIMIT_STORE.delete(key);
  }
}

function apiRateLimitIdentity(request: NextRequest) {
  const sessionToken = sessionTokenForRateLimit(request);
  if (sessionToken) return `session:${hashRateLimitIdentity(sessionToken)}`;
  return `ip:${hashRateLimitIdentity(requestIp(request))}`;
}

function apiRateLimitKey(request: NextRequest) {
  const methodGroup = isUnsafeMethod(request.method) ? "write" : "read";
  return [
    "api",
    methodGroup,
    normalizedRateLimitPath(request.nextUrl.pathname),
    apiRateLimitIdentity(request),
  ].join(":");
}

function apiRateLimitLimit(request: NextRequest, config = apiRateLimitConfig()) {
  const limit = isUploadApiRequest(request)
    ? config.uploadLimit
    : isUnsafeMethod(request.method)
      ? config.writeLimit
      : config.readLimit;
  return { limit, windowMs: config.windowMs };
}

function checkMemoryApiRateLimit(request: NextRequest, limit: number, windowMs: number, now = Date.now()) {
  cleanupRateLimitStore(now);
  const key = apiRateLimitKey(request);
  const current = API_RATE_LIMIT_STORE.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  API_RATE_LIMIT_STORE.set(key, bucket);
  return {
    allowed: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

function warnDistributedRateLimitFallback(error: unknown) {
  const now = Date.now();
  if (now - lastDistributedRateLimitWarningAt < 60_000) return;
  lastDistributedRateLimitWarningAt = now;
  console.warn("distributed rate limit unavailable; falling back to memory limit", {
    message: error instanceof Error ? error.message : String(error || "unknown"),
  });
}

async function checkDistributedApiRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const config = distributedRateLimitConfig();
  if (!config) return null;
  const redisKey = `${config.namespace}:rate:${key}`;
  const ttlCommand = Math.max(1, Math.ceil(windowMs / 1000));
  const response = await fetch(`${config.restUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.restToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["EXPIRE", redisKey, ttlCommand, "NX"],
      ["TTL", redisKey],
    ]),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Redis rate limit request failed: ${response.status}`);
  }
  const result = await response.json();
  const count = Number(result?.[0]?.result ?? result?.[0] ?? 0);
  const ttlSeconds = Number(result?.[2]?.result ?? result?.[2] ?? ttlCommand);
  const resetAt = now + Math.max(1, ttlSeconds > 0 ? ttlSeconds : ttlCommand) * 1000;
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

async function checkApiRateLimit(request: NextRequest) {
  if (!isApiRequest(request)) return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
  if (request.method.toUpperCase() === "OPTIONS") return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
  const { limit, windowMs } = apiRateLimitLimit(request);
  const key = apiRateLimitKey(request);
  try {
    const distributed = await checkDistributedApiRateLimit(key, limit, windowMs);
    if (distributed) return distributed;
  } catch (error) {
    warnDistributedRateLimitFallback(error);
  }
  return checkMemoryApiRateLimit(request, limit, windowMs);
}

function rateLimitResponse(rateLimit: { limit: number; remaining: number; resetAt: number }, contentSecurityPolicy: string) {
  const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
  const response = NextResponse.json({
    success: false,
    error: "请求过于频繁，请稍后重试。",
    message: "请求过于频繁，请稍后重试。",
    code: "API_RATE_LIMITED",
  }, { status: 429 });
  response.headers.set("Retry-After", String(retryAfterSeconds));
  response.headers.set("X-RateLimit-Limit", String(rateLimit.limit));
  response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1000)));
  return applySecurityHeaders(response, contentSecurityPolicy);
}

function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary);
}

function appendHeaderValue(current: string | null, value: string) {
  const values = String(current || "").split(",").map((item) => item.trim()).filter(Boolean);
  return values.includes(value) ? values.join(", ") : [...values, value].join(", ");
}

function applySecurityHeaders(response: NextResponse, contentSecurityPolicy: string) {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    if (key === "Vary") {
      response.headers.set(key, appendHeaderValue(response.headers.get(key), value));
    } else {
      response.headers.set(key, value);
    }
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
  });
  const userAgent = request.headers.get("user-agent") || "";
  if (isBlockedBot(userAgent)) {
    return applySecurityHeaders(new NextResponse("Forbidden", { status: 403 }), contentSecurityPolicy);
  }
  if (isBlockedCorsPreflight(request)) {
    return applySecurityHeaders(new NextResponse("Forbidden", { status: 403 }), contentSecurityPolicy);
  }
  const apiRateLimit = await checkApiRateLimit(request);
  if (!apiRateLimit.allowed) {
    return rateLimitResponse(apiRateLimit, contentSecurityPolicy);
  }

  if (request.nextUrl.pathname === "/workspace" || request.nextUrl.pathname === "/index.html") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return applySecurityHeaders(NextResponse.redirect(url), contentSecurityPolicy);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  return applySecurityHeaders(NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  }), contentSecurityPolicy);
}

export const config = {
  matcher: "/:path*",
};
