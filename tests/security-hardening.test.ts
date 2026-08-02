import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  nextConfig,
  proxy,
  securityHeaders,
  apiRouteGuard,
  sharedBaseUtils,
  sharedUtils,
  sharedAudit,
  sharedUsers,
  inputSchemas,
  uploadValidation,
  fileCenter,
  appUtils,
  taxRefundModule,
  domesticLogisticsModule,
  costsUiModule,
  logisticsFeesModule,
  orderDocumentsRoute,
  orderDocumentsService,
  logisticsInvoiceService,
  ordersModule,
  paymentsModule,
  costsModule,
  loginRoute,
  registerRoute,
  reportsRoute,
  reportExportRoute,
  settingsUsersRoute,
  schema,
  packageJson,
  runWithEnvScript,
  securityAuditScript,
  ciWorkflow,
  filesUnder,
  apiRouteSources,
  cspFor,
  configuredCsp
} from "./security-hardening-context.ts";

test("global security headers are configured for pages api and proxy responses", () => {
  assert.match(nextConfig, /staticSecurityHeaders/);
  assert.match(nextConfig, /poweredByHeader:\s*false/);
  assert.match(proxy, /staticSecurityHeaders/);
  assert.match(securityHeaders, /X-Content-Type-Options/);
  assert.match(securityHeaders, /X-Frame-Options/);
  assert.match(securityHeaders, /Strict-Transport-Security/);
  assert.match(securityHeaders, /max-age=31536000; includeSubDomains; preload/);
  assert.match(securityHeaders, /if \(!isDevelopmentEnv\(env\)\)/);
  assert.match(securityHeaders, /Referrer-Policy/);
  assert.match(securityHeaders, /Permissions-Policy/);
  assert.match(securityHeaders, /Cross-Origin-Opener-Policy/);
  assert.match(
    securityHeaders,
    /Content-Security-Policy|buildContentSecurityPolicy/,
  );
  assert.match(securityHeaders, /frame-ancestors 'self'/);
  assert.match(proxy, /buildContentSecurityPolicy/);
  assert.match(proxy, /applySecurityHeaders/);
  assert.match(securityHeaders, /Access-Control-Allow-Origin/);
  assert.doesNotMatch(
    securityHeaders,
    /Access-Control-Allow-Origin", value: "\*"/,
  );
  assert.doesNotMatch(proxy, /"Access-Control-Allow-Origin": "\*"/);
});

test("cors preflight blocks untrusted origins before route handlers", () => {
  assert.match(proxy, /function isBlockedCorsPreflight/);
  assert.match(proxy, /request\.method\.toUpperCase\(\) !== "OPTIONS"/);
  assert.match(proxy, /access-control-request-method/);
  assert.match(
    proxy,
    /allowedRequestOrigins\(request\.nextUrl\.origin\)\.has\(origin\)/,
  );
  assert.match(proxy, /isBlockedCorsPreflight\(request\)/);
  assert.match(proxy, /new NextResponse\("Forbidden", \{ status: 403 \}\)/);
});

test("business API requests are protected by unified rate limiting", () => {
  assert.match(proxy, /const (?:API_RATE_LIMIT_STORE|STORE) = new Map/);
  assert.match(proxy, /async function checkApiRateLimit/);
  assert.match(proxy, /request\.nextUrl\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(proxy, /API_RATE_LIMIT_READ_LIMIT/);
  assert.match(proxy, /API_RATE_LIMIT_WRITE_LIMIT/);
  assert.match(proxy, /API_RATE_LIMIT_UPLOAD_LIMIT/);
  assert.doesNotMatch(proxy, /(?:sessionTokenForRateLimit|sessionToken)\(request\)/);
  assert.match(proxy, /resolveTrustedClientIp\(request\)/);
  assert.match(
    proxy,
    /const apiRateLimit = await checkApiRateLimit\(request\)/,
  );
  assert.match(proxy, /if \(!apiRateLimit\.allowed\)/);
  assert.match(proxy, /status: 429/);
  assert.match(proxy, /Retry-After/);
  assert.match(proxy, /X-RateLimit-Limit/);
  assert.match(proxy, /X-RateLimit-Remaining/);
  assert.match(proxy, /X-RateLimit-Reset/);
});

test("api rate limiting supports distributed redis with memory fallback", () => {
  assert.match(proxy, /function distributedRateLimitConfig/);
  assert.match(proxy, /UPSTASH_REDIS_REST_URL/);
  assert.match(proxy, /UPSTASH_REDIS_KV_REST_API_URL/);
  assert.match(proxy, /RATE_LIMIT_REDIS_REST_URL/);
  assert.match(proxy, /REDIS_RESPONSE_MAX_BYTES/);
  assert.match(proxy, /readRedisJson\(response\)/);
  assert.match(proxy, /RATE_LIMIT_NAMESPACE/);
  assert.match(proxy, /async function checkDistributedApiRateLimit/);
  assert.match(proxy, /\/pipeline/);
  assert.match(proxy, /\["INCR", (?:redisKey|`\$\{config\.namespace\}:rate:\$\{key\}`)\]/);
  assert.match(proxy, /\["EXPIRE", (?:redisKey|`\$\{config\.namespace\}:rate:\$\{key\}`), (?:ttlCommand|ttl), "NX"\]/);
  assert.match(proxy, /\["TTL", (?:redisKey|`\$\{config\.namespace\}:rate:\$\{key\}`)\]/);
  assert.match(proxy, /(?:warnDistributedRateLimitFallback|warnFallback)/);
  assert.match(
    proxy,
    /return checkMemoryApiRateLimit\(request, limit, windowMs\)/,
  );
});

test("sensitive api routes use the shared auth and permission wrapper", () => {
  const directGetActorRoutes = apiRouteSources
    .filter(([, source]) => /\bgetActor\b/.test(source))
    .map(([file]) => file);
  assert.match(apiRouteGuard, /export function withApiAuth/);
  assert.match(apiRouteGuard, /export function withApiPermission/);
  assert.match(apiRouteGuard, /export function withApiRead/);
  assert.match(apiRouteGuard, /export function withApiWrite/);
  assert.match(apiRouteGuard, /export async function requireApiActor/);
  assert.match(apiRouteGuard, /export async function requireApiRead/);
  assert.match(apiRouteGuard, /export async function requireApiWrite/);
  assert.match(apiRouteGuard, /const actor = await getActor/);
  assert.match(apiRouteGuard, /assertRead\(actor, area\)/);
  assert.match(apiRouteGuard, /assertWrite\(actor, area\)/);
  assert.match(reportsRoute, /withApiRead\("reports"/);
  assert.match(reportExportRoute, /withApiRead\("reports"/);
  assert.match(settingsUsersRoute, /withApiRead\("users"/);
  assert.match(orderDocumentsRoute, /requireApiActor\(request\)/);
  assert.doesNotMatch(reportsRoute, /const actor = await getActor/);
  assert.doesNotMatch(settingsUsersRoute, /const actor = await getActor/);
  assert.deepEqual(
    directGetActorRoutes,
    [],
    "API routes must use lib/api-route-guard instead of getActor directly",
  );
  assert.match(securityAuditScript, /directGetActorRoutes/);
});

test("production CSP removes unsafe inline and local development connect sources", () => {
  const productionCsp = cspFor(false);
  assert.match(productionCsp, /script-src 'self' 'nonce-testnonce'/);
  assert.match(productionCsp, /style-src 'self' 'nonce-testnonce'/);
  assert.doesNotMatch(productionCsp, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(productionCsp, /localhost|127\.0\.0\.1/);
  assert.doesNotMatch(productionCsp, /connect-src[^;]*https:/);
  assert.doesNotMatch(productionCsp, /img-src[^;]*https:/);
  assert.match(productionCsp, /img-src 'self' data: blob:/);

  const developmentCsp = cspFor(true);
  assert.match(developmentCsp, /unsafe-inline/);
  assert.match(developmentCsp, /localhost:\*/);
  assert.match(developmentCsp, /127\.0\.0\.1:\*/);
});

test("production CSP external sources require explicit allowlists", () => {
  const csp = configuredCsp();
  assert.match(csp, /connect-src 'self' https:\/\/api\.nextwood\.net/);
  assert.match(
    csp,
    /img-src 'self' data: blob: https:\/\/assets\.nextwood\.net/,
  );
  assert.doesNotMatch(csp, /frame-src[^;]*https:\/\/embed\.shipsgo\.com/);
  assert.match(csp, /frame-src[\s\S]*https:\/\/viewer\.nextwood\.net/);
});

test("critical write paths use shared input schemas", () => {
  assert.match(inputSchemas, /RECEIVABLE_ORDER_INPUT_SCHEMA/);
  assert.match(inputSchemas, /PAYMENT_INPUT_SCHEMA/);
  assert.match(inputSchemas, /COST_INPUT_SCHEMA/);
  assert.match(inputSchemas, /ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA/);
  assert.match(
    ordersModule,
    /assertInputSchema\(assertJsonObject\(input\), RECEIVABLE_ORDER_INPUT_SCHEMA\)/,
  );
  assert.match(
    paymentsModule,
    /const jsonInput = assertJsonObject\(input\);[\s\S]*assertPaymentInputRequiredFields\(jsonInput\);[\s\S]*assertInputSchema\(jsonInput, PAYMENT_INPUT_SCHEMA\)/,
  );
  assert.match(
    costsModule,
    /assertInputSchema\(assertJsonObject\(input\), COST_INPUT_SCHEMA\)/,
  );
  assert.match(
    orderDocumentsService,
    /assertInputSchema\(assertJsonObject\(\{ orderId, documentType, costId, supplierId, uploadSource \}\), ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA\)/,
  );
});

test("user email writes use shared email format validation", () => {
  assert.match(sharedBaseUtils, /export function requireValidEmail/);
  assert.match(sharedBaseUtils, /VALIDATION_INVALID_EMAIL/);
  assert.match(sharedUtils, /requireValidEmail/);
  assert.match(sharedUsers, /const email = requireAuthEmail\(input\.email\)/);
  assert.match(sharedUsers, /const data: Record<string, unknown> = \{[\s\S]*email,/);
  assert.doesNotMatch(
    sharedUsers,
    /requireText\(normalizeEmail\(input\.email\), "邮箱"\)/,
  );
});

test("admin user email changes are treated as verified emails", () => {
  assert.match(sharedUsers, /const emailChanged = Boolean\(id && before && normalizeEmail\(before\.email\) !== email\)/);
  assert.match(sharedUsers, /const emailIsAdminVerified = !id \|\| emailChanged/);
  assert.match(
    sharedUsers,
    /if \(emailIsAdminVerified\) \{[\s\S]*data\.emailVerified = true;[\s\S]*data\.emailVerifiedAt = new Date\(\);[\s\S]*\}/,
  );
  assert.match(
    sharedUsers,
    /if \(id && approvalStatus === "APPROVED" && before\?\.emailVerified === false && !emailIsAdminVerified\)/,
  );
  assert.match(sharedUsers, /if \(id && emailChanged\) \{[\s\S]*邮箱验证令牌失效[\s\S]*emailVerificationToken\.updateMany/);
});

test("login service errors do not expose deployment diagnostics to unauthenticated users", () => {
  assert.match(loginRoute, /LOGIN_SERVICE_UNAVAILABLE_MESSAGE/);
  assert.match(loginRoute, /assertSameOriginRequest\(request\)/);
  assert.match(loginRoute, /function loginAuditContext/);
  assert.match(loginRoute, /loginIdHash: sha256Hex\(email\)\.slice\(0, 16\)/);
  assert.match(
    loginRoute,
    /diagnostic: "Database connection failed; verify runtime database configuration and credentials\."/,
  );
  assert.match(
    loginRoute,
    /diagnostic: "Prisma schema mismatch; run migrations and regenerate the Prisma client\."/,
  );
  assert.match(loginRoute, /\["P1000", "P1001", "P1002", "P1010", "P1017"\]/);
  assert.match(loginRoute, /error: classified\.message/);
  assert.doesNotMatch(
    loginRoute,
    /message: "数据库连接失败，请检查 DATABASE_URL 和数据库账号密码。"/,
  );
  assert.doesNotMatch(
    loginRoute,
    /message: "数据库结构未同步，请执行 npx prisma migrate deploy && npx prisma generate。"/,
  );
  assert.doesNotMatch(
    loginRoute,
    /logSecurityEvent\("login failed", \{[^}]*email/,
  );
});

test("database connections are bounded for serverless production instances", () => {
  const prismaSource = filesUnder("lib")
    .filter((file) => file.endsWith("/prisma.ts") || file === "lib/prisma.ts")
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.match(prismaSource, /DATABASE_POOL_MAX/);
  assert.match(prismaSource, /process\.env\.NODE_ENV === "production" \? 2 : 10/);
  assert.match(prismaSource, /max: databasePoolMax/);
  assert.match(prismaSource, /idleTimeoutMillis: 5_000/);
  assert.match(prismaSource, /maxLifetimeSeconds: 300/);
  assert.match(prismaSource, /allowExitOnIdle: true/);
  assert.match(prismaSource, /globalForPrisma\.prisma = prisma/);
});

test("api errors explain logistics expense billing schema mismatches", () => {
  assert.match(sharedBaseUtils, /function prismaSchemaMismatchMessage/);
  assert.match(
    sharedBaseUtils,
    /Unknown argument `\?\(billingMethod\|billingQuantity\)`\?/,
  );
  assert.match(
    sharedBaseUtils,
    /保存失败：本地数据库缺少 \$\{fieldName\} 字段，请执行迁移。/,
  );
  assert.match(sharedBaseUtils, /PRISMA_SCHEMA_MISMATCH/);
});

test("anonymous auth posts require same-origin checks before processing input", () => {
  assert.match(
    loginRoute,
    /assertSameOriginRequest\(request\);[\s\S]*await ensureDefaultUsers\(\)/,
  );
  assert.match(
    registerRoute,
    /assertSameOriginRequest\(request\);[\s\S]*parseJsonBody\(request\)/,
  );
});

test("api routes parse JSON bodies through the shared helper", () => {
  assert.match(sharedBaseUtils, /export async function parseJsonBody/);
  assert.match(
    sharedBaseUtils,
    /assertJsonObject\(await request\.json\(\), label\)/,
  );
  for (const [file, source] of apiRouteSources) {
    assert.doesNotMatch(
      source,
      /request\.json\(/,
      `${file} should call parseJsonBody instead of request.json directly`,
    );
  }
  assert.match(loginRoute, /parseJsonBody\(request\)/);
  assert.match(registerRoute, /parseJsonBody\(request\)/);
});

test("all active PDF upload services reuse shared basic PDF validation", () => {
  assert.match(uploadValidation, /type ValidatedUploadFile = \{/);
  assert.match(
    uploadValidation,
    /export function assertPdfUploadFileCandidate/,
  );
  assert.match(
    uploadValidation,
    /assertPdfUploadFileCandidate\(candidate: unknown\)/,
  );
  assert.match(
    uploadValidation,
    /export async function readValidatedPdfUploadFile/,
  );
  assert.match(
    uploadValidation,
    /readValidatedPdfUploadFile\(candidate: unknown, fallbackName = "document\.pdf"\): Promise<ValidatedUploadFile>/,
  );
  assert.match(
    uploadValidation,
    /export async function readValidatedInvoiceUploadFile/,
  );
  assert.match(
    uploadValidation,
    /readValidatedInvoiceUploadFile\(candidate: unknown, fallbackName = "invoice\.pdf"\): Promise<ValidatedUploadFile>/,
  );
  assert.match(uploadValidation, /文件大小不能超过 10MB/);
  assert.match(uploadValidation, /文件不能为空/);
  assert.match(uploadValidation, /FILE_SIGNATURE_INVALID/);
  assert.doesNotMatch(uploadValidation, /DISALLOWED_PDF_ACTIVE_CONTENT_PATTERNS/);
  assert.doesNotMatch(uploadValidation, /PDF_ACTIVE_CONTENT_NOT_ALLOWED/);
  assert.doesNotMatch(uploadValidation, /OpenAction|RichMedia|EmbeddedFile|XFA|JavaScript/);
  assert.match(
    orderDocumentsRoute,
    /assertPdfUploadFileCandidate\(candidate\)/,
  );
  assert.match(
    orderDocumentsService,
    /readManagedUploadFile\(file, "pdf", "document\.pdf"\)/,
  );
  assert.match(
    logisticsInvoiceService,
    /readManagedUploadFile\(file, "invoicePdf", "invoice\.pdf"\)/,
  );
  assert.match(fileCenter, /readValidatedPdfUploadFile\(candidate, fallbackName\)/);
  assert.match(fileCenter, /readValidatedInvoiceUploadFile\(candidate, fallbackName\)/);
  assert.match(
    uploadValidation,
    /return readValidatedPdfUploadFile\(candidate, fallbackName\)/,
  );
  const pdfUploadReader = uploadValidation.slice(
    uploadValidation.indexOf("export async function readValidatedPdfUploadFile"),
    uploadValidation.indexOf("export async function readValidatedInvoiceUploadFile"),
  );
  assert.doesNotMatch(
    pdfUploadReader,
    /image\/jpeg|image\/png|image\/webp|INVOICE_IMAGE_SIGNATURES|invoiceMimeTypeFromName/,
  );
  assert.match(uploadValidation, /export async function readValidatedPaymentVoucherUploadFile/);
});
