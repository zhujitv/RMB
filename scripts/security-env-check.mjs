#!/usr/bin/env node

function configured(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function validEncryptionKey(value) {
  const text = String(value || "").trim();
  if (/^[a-f0-9]{64}$/i.test(text)) return true;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) return false;
  try {
    const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").byteLength === 32;
  } catch {
    return false;
  }
}

function hasDistributedRateLimit() {
  const pairs = [
    [process.env.RATE_LIMIT_REDIS_REST_URL, process.env.RATE_LIMIT_REDIS_REST_TOKEN],
    [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN],
    [process.env.UPSTASH_REDIS_KV_REST_API_URL, process.env.UPSTASH_REDIS_KV_REST_API_TOKEN],
  ];
  return pairs.some(([url, token]) => {
    if (!String(token || "").trim()) return false;
    try {
      const parsed = new URL(String(url || ""));
      return parsed.protocol === "https:" && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  });
}

function hasCanonicalOrigin() {
  const value = process.env.APP_URL || process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  try {
    const parsed = new URL(String(value || ""));
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && hostname !== "localhost"
      && !["example.com", "example.net", "example.org"].some(
        (reserved) => hostname === reserved || hostname.endsWith(`.${reserved}`),
      )
      && !hostname.endsWith(".test")
      && !hostname.endsWith(".localhost")
      && !hostname.endsWith(".invalid");
  } catch {
    return false;
  }
}

function hasStrongCronSecret() {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const placeholders = new Set(["change-me", "use-a-long-random-secret", "replace-me", "your-cron-secret", "ci-secret"]);
  return secret.length >= 32 && new Set(secret).size >= 12 && !placeholders.has(secret.toLowerCase());
}

const deploymentEnvironments = [process.env.VERCEL_TARGET_ENV, process.env.VERCEL_ENV]
  .map((value) => String(value || "").trim().toLowerCase())
  .filter(Boolean);
const platformProductionBuild = deploymentEnvironments.includes("production");
const buildLifecycle = ["build", "build:app", "build:release"].includes(
  String(process.env.npm_lifecycle_event || "").trim().toLowerCase(),
);
const explicitPreviewBuild = !platformProductionBuild && (
  (deploymentEnvironments.length > 0 && !platformProductionBuild)
  || process.env.SECURITY_BUILD_MODE === "preview"
);
const standaloneProductionBuild = !explicitPreviewBuild
  && (process.env.NODE_ENV === "production" || buildLifecycle);
const strictProduction = platformProductionBuild
  || standaloneProductionBuild
  || process.env.STRICT_PRODUCTION_SECURITY === "true";
const failures = [];

if (strictProduction && !hasStrongCronSecret()) {
  failures.push("CRON_SECRET 必须配置为至少 32 位的独立随机密钥，且不能使用公开占位值");
}
if (strictProduction && !validEncryptionKey(process.env.SETTINGS_ENCRYPTION_KEY)) {
  failures.push("SETTINGS_ENCRYPTION_KEY 必须配置为 32 字节随机密钥");
}
if (strictProduction && !hasDistributedRateLimit()) {
  failures.push("生产多实例必须配置 Upstash/Redis 分布式限流");
}
if (strictProduction && !hasCanonicalOrigin()) {
  failures.push("生产环境必须配置 HTTPS APP_URL/APP_BASE_URL/NEXT_PUBLIC_APP_URL");
}
if (strictProduction && process.env.EXPOSE_ERROR_DETAILS === "true") {
  failures.push("生产环境禁止启用 EXPOSE_ERROR_DETAILS");
}
if (strictProduction && String(process.env.QUOTATION_FILE_STORAGE_DRIVER || "").trim().toLowerCase() === "local") {
  failures.push("生产环境禁止启用报价本地文件存储");
}

if (failures.length) {
  console.error("Production security environment check failed:");
  failures.forEach((message) => console.error(`- ${message}`));
  process.exitCode = 1;
} else {
  console.log(strictProduction ? "Production security environment check passed." : "Security environment check skipped strict production-only requirements.");
}
