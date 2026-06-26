import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const nextConfig = readFileSync("next.config.mjs", "utf8");
const proxy = readFileSync("proxy.ts", "utf8");
const securityHeaders = readFileSync("lib/security-headers.mjs", "utf8");
const sharedBaseUtils = readFileSync("lib/platform/shared-base-utils.ts", "utf8");
const sharedUtils = readFileSync("lib/platform/shared-utils.ts", "utf8");
const sharedAudit = readFileSync("lib/platform/shared-audit.ts", "utf8");
const sharedUsers = readFileSync("lib/platform/shared-users.ts", "utf8");
const inputSchemas = readFileSync("lib/platform/input-schemas.ts", "utf8");
const uploadValidation = readFileSync("lib/platform/upload-validation.ts", "utf8");
const appUtils = readFileSync("app/utils.ts", "utf8");
const taxRefundModule = readFileSync("app/modules/TaxRefundModule.tsx", "utf8");
const domesticLogisticsModule = readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8");
const costsUiModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
const logisticsFeesModule = readFileSync("app/modules/LogisticsFeesModule.tsx", "utf8");
const orderDocumentsRoute = readFileSync("app/api/order-documents/route.ts", "utf8");
const orderDocumentsService = readFileSync("lib/platform/order-documents.ts", "utf8");
const logisticsInvoiceService = readFileSync("lib/platform/logistics-expense-invoice.ts", "utf8");
const ordersModule = readFileSync("lib/platform/orders-module.ts", "utf8");
const paymentsModule = readFileSync("lib/platform/payments-module.ts", "utf8");
const costsModule = readFileSync("lib/platform/cost-records-mutations.ts", "utf8");
const loginRoute = readFileSync("app/api/auth/login/route.ts", "utf8");
const registerRoute = readFileSync("app/api/auth/register/route.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const runWithEnvScript = readFileSync("scripts/run-with-env.mjs", "utf8");

function filesUnder(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = `${dir}/${entry}`;
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
}

const apiRouteSources = filesUnder("app/api")
  .filter((file) => file.endsWith("/route.ts"))
  .map((file) => [file, readFileSync(file, "utf8")] as const);

function cspFor(isDevelopment: boolean) {
  return execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    `import('./lib/security-headers.mjs').then(({ buildContentSecurityPolicy }) => process.stdout.write(buildContentSecurityPolicy({ isDevelopment: ${isDevelopment}, nonce: 'testnonce' })))`,
  ], { encoding: "utf8" });
}

test("global security headers are configured for pages api and proxy responses", () => {
  assert.match(nextConfig, /staticSecurityHeaders/);
  assert.match(nextConfig, /poweredByHeader:\s*false/);
  assert.match(proxy, /staticSecurityHeaders/);
  assert.match(securityHeaders, /X-Content-Type-Options/);
  assert.match(securityHeaders, /X-Frame-Options/);
  assert.match(securityHeaders, /Referrer-Policy/);
  assert.match(securityHeaders, /Permissions-Policy/);
  assert.match(securityHeaders, /Cross-Origin-Opener-Policy/);
  assert.match(securityHeaders, /Content-Security-Policy|buildContentSecurityPolicy/);
  assert.match(securityHeaders, /frame-ancestors 'self'/);
  assert.match(proxy, /buildContentSecurityPolicy/);
  assert.match(proxy, /applySecurityHeaders/);
  assert.match(securityHeaders, /Access-Control-Allow-Origin/);
  assert.doesNotMatch(securityHeaders, /Access-Control-Allow-Origin", value: "\*"/);
  assert.doesNotMatch(proxy, /"Access-Control-Allow-Origin": "\*"/);
});

test("cors preflight blocks untrusted origins before route handlers", () => {
  assert.match(proxy, /function isBlockedCorsPreflight/);
  assert.match(proxy, /request\.method\.toUpperCase\(\) !== "OPTIONS"/);
  assert.match(proxy, /access-control-request-method/);
  assert.match(proxy, /allowedRequestOrigins\(request\.nextUrl\.origin\)\.has\(origin\)/);
  assert.match(proxy, /isBlockedCorsPreflight\(request\)/);
  assert.match(proxy, /new NextResponse\("Forbidden", \{ status: 403 \}\)/);
});

test("production CSP removes unsafe inline and local development connect sources", () => {
  const productionCsp = cspFor(false);
  assert.match(productionCsp, /script-src 'self' 'nonce-testnonce'/);
  assert.match(productionCsp, /style-src 'self' 'nonce-testnonce'/);
  assert.doesNotMatch(productionCsp, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(productionCsp, /localhost|127\.0\.0\.1/);

  const developmentCsp = cspFor(true);
  assert.match(developmentCsp, /unsafe-inline/);
  assert.match(developmentCsp, /localhost:\*/);
  assert.match(developmentCsp, /127\.0\.0\.1:\*/);
});

test("critical write paths use shared input schemas", () => {
  assert.match(inputSchemas, /RECEIVABLE_ORDER_INPUT_SCHEMA/);
  assert.match(inputSchemas, /PAYMENT_INPUT_SCHEMA/);
  assert.match(inputSchemas, /COST_INPUT_SCHEMA/);
  assert.match(inputSchemas, /ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA/);
  assert.match(ordersModule, /assertInputSchema\(assertJsonObject\(input\), RECEIVABLE_ORDER_INPUT_SCHEMA\)/);
  assert.match(paymentsModule, /assertInputSchema\(assertJsonObject\(input\), PAYMENT_INPUT_SCHEMA\)/);
  assert.match(costsModule, /assertInputSchema\(assertJsonObject\(input\), COST_INPUT_SCHEMA\)/);
  assert.match(orderDocumentsService, /assertInputSchema\(assertJsonObject\(\{ orderId, documentType, costId, supplierId, uploadSource \}\), ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA\)/);
});

test("user email writes use shared email format validation", () => {
  assert.match(sharedBaseUtils, /export function requireValidEmail/);
  assert.match(sharedBaseUtils, /VALIDATION_INVALID_EMAIL/);
  assert.match(sharedUtils, /requireValidEmail/);
  assert.match(sharedUsers, /const email = requireValidEmail\(input\.email, "邮箱"\)/);
  assert.match(sharedUsers, /email: requireValidEmail\(input\.email, "邮箱"\)/);
  assert.doesNotMatch(sharedUsers, /requireText\(normalizeEmail\(input\.email\), "邮箱"\)/);
});

test("login service errors do not expose deployment diagnostics to unauthenticated users", () => {
  assert.match(loginRoute, /LOGIN_SERVICE_UNAVAILABLE_MESSAGE/);
  assert.match(loginRoute, /assertSameOriginRequest\(request\)/);
  assert.match(loginRoute, /function loginAuditContext/);
  assert.match(loginRoute, /loginIdHash: sha256Hex\(email\)\.slice\(0, 16\)/);
  assert.match(loginRoute, /diagnostic: "Database connection failed; verify runtime database configuration and credentials\."/);
  assert.match(loginRoute, /diagnostic: "Prisma schema mismatch; run migrations and regenerate the Prisma client\."/);
  assert.match(loginRoute, /\["P1000", "P1001", "P1002", "P1010", "P1017"\]/);
  assert.match(loginRoute, /error: classified\.message/);
  assert.doesNotMatch(loginRoute, /message: "数据库连接失败，请检查 DATABASE_URL 和数据库账号密码。"/);
  assert.doesNotMatch(loginRoute, /message: "数据库结构未同步，请执行 npx prisma migrate deploy && npx prisma generate。"/);
  assert.doesNotMatch(loginRoute, /logSecurityEvent\("login failed", \{[^}]*email/);
});

test("api errors explain logistics expense billing schema mismatches", () => {
  assert.match(sharedBaseUtils, /function prismaSchemaMismatchMessage/);
  assert.match(sharedBaseUtils, /Unknown argument `\?\(billingMethod\|billingQuantity\)`\?/);
  assert.match(sharedBaseUtils, /保存失败：本地数据库缺少 \$\{fieldName\} 字段，请执行迁移。/);
  assert.match(sharedBaseUtils, /PRISMA_SCHEMA_MISMATCH/);
});

test("anonymous auth posts require same-origin checks before processing input", () => {
  assert.match(loginRoute, /assertSameOriginRequest\(request\);[\s\S]*await ensureDefaultUsers\(\)/);
  assert.match(registerRoute, /assertSameOriginRequest\(request\);[\s\S]*parseJsonBody\(request\)/);
});

test("api routes parse JSON bodies through the shared helper", () => {
  assert.match(sharedBaseUtils, /export async function parseJsonBody/);
  assert.match(sharedBaseUtils, /assertJsonObject\(await request\.json\(\), label\)/);
  for (const [file, source] of apiRouteSources) {
    assert.doesNotMatch(source, /request\.json\(/, `${file} should call parseJsonBody instead of request.json directly`);
  }
  assert.match(loginRoute, /parseJsonBody\(request\)/);
  assert.match(registerRoute, /parseJsonBody\(request\)/);
});

test("all active PDF upload services reuse shared PDF validation", () => {
  assert.match(uploadValidation, /type ValidatedUploadFile = \{/);
  assert.match(uploadValidation, /export function assertPdfUploadFileCandidate/);
  assert.match(uploadValidation, /assertPdfUploadFileCandidate\(candidate: unknown\)/);
  assert.match(uploadValidation, /export async function readValidatedPdfUploadFile/);
  assert.match(uploadValidation, /readValidatedPdfUploadFile\(candidate: unknown, fallbackName = "document\.pdf"\): Promise<ValidatedUploadFile>/);
  assert.match(uploadValidation, /export async function readValidatedInvoiceUploadFile/);
  assert.match(uploadValidation, /readValidatedInvoiceUploadFile\(candidate: unknown, fallbackName = "invoice\.pdf"\): Promise<ValidatedUploadFile>/);
  assert.match(uploadValidation, /文件大小不能超过 5MB/);
  assert.match(uploadValidation, /FILE_SIGNATURE_INVALID/);
  assert.match(uploadValidation, /DISALLOWED_PDF_ACTIVE_CONTENT_PATTERNS/);
  assert.match(uploadValidation, /PDF_ACTIVE_CONTENT_NOT_ALLOWED/);
  assert.match(orderDocumentsRoute, /assertPdfUploadFileCandidate\(candidate\)/);
  assert.match(orderDocumentsService, /readValidatedPdfUploadFile\(file, "document\.pdf"\)/);
  assert.match(logisticsInvoiceService, /readValidatedInvoiceUploadFile\(file, "invoice\.pdf"\)/);
  assert.match(uploadValidation, /return readValidatedPdfUploadFile\(candidate, fallbackName\)/);
  assert.doesNotMatch(uploadValidation, /image\/jpeg|image\/png|INVOICE_IMAGE_SIGNATURES|invoiceMimeTypeFromName/);
});

test("logistics generated cost invoices are managed only by logistics invoice groups", () => {
  assert.match(orderDocumentsService, /function isLogisticsGeneratedCostInvoice\(documentType: string \| null \| undefined, cost: DocumentCostLike \| null \| undefined\)/);
  assert.match(orderDocumentsService, /documentType === "SUPPLIER_INVOICE" && cost\?\.sourceType === "LOGISTICS_EXPENSE"/);
  assert.match(orderDocumentsService, /物流费用发票请在物流费用模块按发票分组上传，成本管理仅同步查看。/);
  assert.match(orderDocumentsService, /物流费用发票请在物流费用模块按发票分组删除或替换，成本管理仅同步查看。/);
  assert.match(orderDocumentsService, /if \(isLogisticsGeneratedCostInvoice\(documentType, cost\)\) \{/);
  assert.match(orderDocumentsService, /if \(isLogisticsGeneratedCostInvoice\(before\.documentType, before\.cost\)\) \{/);
  assert.match(costsUiModule, /function isLogisticsGeneratedCost\(cost: Pick<CostRow, "sourceType">\)/);
  assert.match(costsUiModule, /const canManageDocuments = canWriteDocuments && !logisticsGenerated/);
  assert.match(costsUiModule, /发票按物流费用模块的分组开票规则上传；成本管理仅同步查看/);
});

test("shared PDF validation rejects active content actions", () => {
  assert.match(uploadValidation, /\/JavaScript\\b/);
  assert.match(uploadValidation, /\/OpenAction\\b/);
  assert.match(uploadValidation, /\/EmbeddedFile\\b/);
  assert.match(uploadValidation, /\/Launch\\b/);
  assert.match(uploadValidation, /function assertPdfDoesNotContainActiveContent\(body: Buffer\)/);
  assert.match(uploadValidation, /assertPdfDoesNotContainActiveContent\(body\);[\s\S]*return \{/);
});

test("all active upload UIs enforce pdf only auto upload with progress", () => {
  assert.match(appUtils, /export const PDF_UPLOAD_ACCEPT = "\.pdf"/);
  assert.match(appUtils, /export const PDF_UPLOAD_MAX_BYTES = 5 \* 1024 \* 1024/);
  assert.match(appUtils, /export function validatePdfUploadFile/);
  assert.match(appUtils, /file\.type !== "application\/pdf"|file\.type === "application\/pdf"/);
  assert.match(appUtils, /export function uploadFormDataWithProgress/);
  assert.match(appUtils, /new XMLHttpRequest\(\)/);
  assert.match(appUtils, /xhr\.upload\.onprogress/);

  for (const [name, source] of [
    ["TaxRefundModule", taxRefundModule],
    ["DomesticLogisticsModule", domesticLogisticsModule],
    ["CostsModule", costsUiModule],
    ["LogisticsFeesModule", logisticsFeesModule],
  ] as const) {
    assert.match(source, /accept=\{PDF_UPLOAD_ACCEPT\}/, `${name} must use the shared PDF accept rule`);
    assert.match(source, /validatePdfUploadFile/, `${name} must use the shared 5MB PDF validator`);
    assert.match(source, /uploadFormDataWithProgress/, `${name} must use upload progress`);
    assert.match(source, /invoiceUploadProgressBar/, `${name} must render upload progress`);
    assert.doesNotMatch(source, /PDF \/ JPG \/ PNG|20MB|accept="application\/pdf,\.pdf"|fetch\("\/api\/order-documents"/, `${name} must not keep legacy upload flow`);
  }
});

test("server and audit logs redact sensitive file and credential fields", () => {
  assert.match(sharedBaseUtils, /SENSITIVE_LOG_KEY_PATTERN/);
  assert.match(sharedBaseUtils, /original\(name\|filename\)/);
  assert.match(sharedBaseUtils, /logServerError/);
  assert.match(sharedAudit, /originalName\|originalFilename/);
  assert.doesNotMatch(orderDocumentsRoute, /originalName: file/);
  assert.doesNotMatch(orderDocumentsRoute, /originalFilename/);
  assert.doesNotMatch(orderDocumentsService, /originalFilename: document\.originalFilename/);
});

test("expected auth failures do not flood server error logs", () => {
  assert.match(sharedBaseUtils, /function shouldLogApiErrorStatus\(status: number\)/);
  assert.match(sharedBaseUtils, /status === 401 \|\| status === 403/);
  assert.match(sharedBaseUtils, /LOG_EXPECTED_AUTH_ERRORS === "true"/);
  assert.match(sharedBaseUtils, /if \(shouldLogApiErrorStatus\(status\)\) logServerError\(fallback, error\)/);
});

test("local build scripts load env files before prisma commands", () => {
  assert.match(packageJson, /"build:app": "node scripts\/run-with-env\.mjs prisma generate && next build"/);
  assert.match(packageJson, /"build:release": "node scripts\/run-with-env\.mjs prisma migrate deploy && npm run build:app"/);
  assert.match(packageJson, /"db:deploy": "node scripts\/run-with-env\.mjs prisma migrate deploy"/);
  assert.match(runWithEnvScript, /const ENV_FILES = \["\.env", "\.env\.local"\]/);
  assert.match(runWithEnvScript, /originalEnvKeys\.has\(key\)/);
  assert.match(runWithEnvScript, /spawnSync\(command, args/);
});

test("legacy attachment model and service are removed", () => {
  assert.equal(existsSync("lib/platform/legacy-attachments.ts"), false);
  assert.doesNotMatch(schema, /model Attachment/);
  assert.doesNotMatch(schema, /attachments Attachment\[\]/);
  assert.match(readFileSync("prisma/migrations/20260619143000_drop_legacy_attachments/migration.sql", "utf8"), /DROP TABLE IF EXISTS "attachments"/);
});
