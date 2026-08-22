import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const ROOTS = ["app", "lib", "prisma", "scripts"];
const PUBLIC_API_ROUTES = new Set([
  "app/api/auth/login/route.ts",
  "app/api/auth/logout/route.ts",
  "app/api/auth/register/route.ts",
  "app/api/auth/verify-email/route.ts",
  // Native RMB mini-program login returns a short-lived bearer session.
  // The route applies the shared login rate limit and account-state checks.
  "app/api/mini/auth/login/route.ts",
  "app/api/company-profile/route.ts",
  "app/api/freightower/webhook/route.ts",
  // CRM email inbound callbacks are called by the mail gateway without ERP
  // cookies; the route is protected by CRM_EMAIL_INBOUND_SECRET and upload caps.
  "app/api/customer-email-messages/inbound/route.ts",
  // WeChat redirects users here without the ERP session cookie. The handler is
  // authenticated by a single-use, hashed `reserved` nonce plus scene/template checks.
  "app/api/wechat-official/subscription/callback/route.ts",
  "app/wx/route.ts",
  "app/api/cron/exchange-rates/route.ts",
  "app/api/cron/freightower-sync/route.ts",
]);
const AUTH_PATTERNS = [
  /\brequireApiActor\b/,
  /\brequireApiRead\b/,
  /\brequireApiWrite\b/,
  /\bwithApiAuth\b/,
  /\bwithApiRead\b/,
  /\bwithApiWrite\b/,
  /\breportGetHandler\b/,
  /\bassertCronSecret\b/,
];
const DANGEROUS_PATTERNS = [
  { pattern: /dangerouslySetInnerHTML/, label: "dangerouslySetInnerHTML" },
  { pattern: new RegExp(`\\$queryRaw${"Unsafe"}|\\$executeRaw${"Unsafe"}`), label: "unsafe raw SQL" },
  { pattern: /\beval\s*\(|new Function\s*\(/, label: "dynamic code execution" },
  { pattern: /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE|DATABASE_URL)/, label: "public secret env" },
];

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    if (path.includes("/generated/") || path.includes("/node_modules/")) return [];
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function fail(message, details = []) {
  console.error(`Security audit failed: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

function assertSourceContains(file, pattern, message) {
  const source = readFileSync(file, "utf8");
  if (!pattern.test(source)) fail(message, [file]);
}

function assertSourceDoesNotContain(file, pattern, message) {
  const source = readFileSync(file, "utf8");
  if (pattern.test(source)) fail(message, [file]);
}

const sourceFiles = ROOTS.flatMap(filesUnder).filter((file) => /\.(ts|tsx|mjs|js|prisma)$/.test(file));

const securityHeaders = readFileSync("lib/security-headers.mjs", "utf8");
if (!/Strict-Transport-Security/.test(securityHeaders) || !/includeSubDomains; preload/.test(securityHeaders)) {
  fail("HSTS header is not configured for production.");
}

const proxy = ["proxy.ts", "proxy-rate-limit.ts"]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
for (const pattern of [
  /distributedRateLimitConfig/,
  /UPSTASH_REDIS_REST_URL/,
  /UPSTASH_REDIS_KV_REST_API_URL/,
  /RATE_LIMIT_REDIS_REST_URL/,
  /\/pipeline/,
  /checkDistributedApiRateLimit/,
  /checkMemoryApiRateLimit/,
]) {
  if (!pattern.test(proxy)) fail("API rate limiting is missing distributed Redis support.");
}

const apiRoutes = filesUnder("app/api").filter((file) => file.endsWith("/route.ts"));
const unauthenticatedRoutes = apiRoutes.filter((file) => {
  if (PUBLIC_API_ROUTES.has(file)) return false;
  const source = readFileSync(file, "utf8");
  return !AUTH_PATTERNS.some((pattern) => pattern.test(source));
});
if (unauthenticatedRoutes.length) {
  fail("API routes missing explicit auth or approved public classification.", unauthenticatedRoutes);
}
const directGetActorRoutes = apiRoutes.filter((file) => /\bgetActor\b/.test(readFileSync(file, "utf8")));
if (directGetActorRoutes.length) {
  fail("API routes must use lib/api-route-guard instead of calling getActor directly.", directGetActorRoutes);
}

const dangerousHits = [];
for (const file of sourceFiles) {
  if (file === "scripts/security-audit.mjs") continue;
  const source = readFileSync(file, "utf8");
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(source)) dangerousHits.push(`${file}: ${label}`);
  }
}
if (dangerousHits.length) {
  fail("dangerous source patterns detected.", dangerousHits);
}

assertSourceContains("lib/platform/upload-validation.ts", /MAX_PDF_UPLOAD_BYTES/, "PDF upload size validation is missing.");
assertSourceDoesNotContain(
  "lib/platform/upload-validation.ts",
  /PDF_ACTIVE_CONTENT_NOT_ALLOWED|DISALLOWED_PDF_ACTIVE_CONTENT_PATTERNS|OpenAction|RichMedia|EmbeddedFile|XFA/,
  "PDF upload must not reject active content before saving the original file.",
);
assertSourceContains("lib/platform/shared-audit.ts", /sanitizeAuditData/, "Audit log sanitization is missing.");
assertSourceContains("lib/platform/shared-audit.ts", /writeAuthAudit/, "Auth audit logging helper is missing.");
assertSourceContains("lib/platform/shared-base-utils.ts", /SENSITIVE_LOG_KEY_PATTERN/, "Server log redaction is missing.");
assertSourceContains("tests/permission-hardening.test.ts", /SECURITY_ROLE_MATRIX/, "Permission matrix regression test is missing.");

console.log(`Security audit passed: ${apiRoutes.length} API routes checked, ${sourceFiles.length} source files scanned.`);
