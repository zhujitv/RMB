const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const SECURE_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);
const INSECURE_SSL_MODES = new Set(["disable", "allow", "prefer"]);

function isLocalDatabaseHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized.startsWith("/")
    || normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1";
}

/**
 * Ensures PostgreSQL traffic to a non-loopback host cannot silently fall back
 * to clear text. The function never logs or exposes the connection string.
 */
export function secureDatabaseUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL 格式无效。");
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("DATABASE_URL 必须使用 PostgreSQL 协议。");
  }

  const sslModes = parsed.searchParams.getAll("sslmode");
  const hosts = parsed.searchParams.getAll("host");
  const libpqCompatValues = parsed.searchParams.getAll("uselibpqcompat");
  if (sslModes.length > 1 || hosts.length > 1 || libpqCompatValues.length > 1) {
    throw new Error("DATABASE_URL 不能包含重复的 host、sslmode 或 uselibpqcompat 参数。");
  }
  const effectiveHost = (hosts[0] || parsed.hostname).trim();
  if (!effectiveHost) throw new Error("DATABASE_URL 缺少数据库地址。");
  const mode = (sslModes[0] || "").trim().toLowerCase();
  if (mode && !SECURE_SSL_MODES.has(mode) && !INSECURE_SSL_MODES.has(mode)) {
    throw new Error("DATABASE_URL 的 sslmode 配置无效。");
  }

  if (isLocalDatabaseHost(effectiveHost)) {
    return parsed.toString();
  }

  if (mode && INSECURE_SSL_MODES.has(mode)) {
    throw new Error("远程 PostgreSQL 禁止使用未加密连接，请将 sslmode 设置为 require 或更严格模式。");
  }

  if (!mode) {
    parsed.searchParams.set("sslmode", "require");
  }
  // node-postgres currently treats require like verify-full unless libpq
  // compatibility is explicit. Libpq semantics keep proxy connections
  // encrypted without requiring a proxy-matching server certificate.
  if (!mode || mode === "require") {
    parsed.searchParams.set("uselibpqcompat", "true");
  }
  return parsed.toString();
}
