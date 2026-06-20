import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
const orderDocumentsRoute = readFileSync("app/api/order-documents/route.ts", "utf8");
const orderDocumentsService = readFileSync("lib/platform/order-documents.ts", "utf8");
const logisticsInvoiceService = readFileSync("lib/platform/logistics-expense-invoice.ts", "utf8");
const ordersModule = readFileSync("lib/platform/orders-module.ts", "utf8");
const paymentsModule = readFileSync("lib/platform/payments-module.ts", "utf8");
const costsModule = readFileSync("lib/platform/cost-records-mutations.ts", "utf8");
const loginRoute = readFileSync("app/api/auth/login/route.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

function cspFor(isDevelopment: boolean) {
  return execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    `import('./lib/security-headers.mjs').then(({ buildContentSecurityPolicy }) => process.stdout.write(buildContentSecurityPolicy({ isDevelopment: ${isDevelopment}, nonce: 'testnonce' })))`,
  ], { encoding: "utf8" });
}

test("global security headers are configured for pages api and proxy responses", () => {
  assert.match(nextConfig, /staticSecurityHeaders/);
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
  assert.match(loginRoute, /diagnostic: "Database connection failed; verify runtime database configuration and credentials\."/);
  assert.match(loginRoute, /diagnostic: "Prisma schema mismatch; run migrations and regenerate the Prisma client\."/);
  assert.match(loginRoute, /\["P1000", "P1001", "P1002", "P1010", "P1017"\]/);
  assert.match(loginRoute, /error: classified\.message/);
  assert.doesNotMatch(loginRoute, /message: "数据库连接失败，请检查 DATABASE_URL 和数据库账号密码。"/);
  assert.doesNotMatch(loginRoute, /message: "数据库结构未同步，请执行 npx prisma migrate deploy && npx prisma generate。"/);
});

test("all active PDF upload services reuse shared PDF validation", () => {
  assert.match(uploadValidation, /export function assertPdfUploadFileCandidate/);
  assert.match(uploadValidation, /export async function readValidatedPdfUploadFile/);
  assert.match(uploadValidation, /FILE_SIGNATURE_INVALID/);
  assert.match(orderDocumentsRoute, /assertPdfUploadFileCandidate\(candidate\)/);
  assert.match(orderDocumentsService, /readValidatedPdfUploadFile\(file, "document\.pdf"\)/);
  assert.match(logisticsInvoiceService, /readValidatedPdfUploadFile\(file, "invoice\.pdf"\)/);
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

test("legacy attachment model and service are removed", () => {
  assert.equal(existsSync("lib/platform/legacy-attachments.ts"), false);
  assert.doesNotMatch(schema, /model Attachment/);
  assert.doesNotMatch(schema, /attachments Attachment\[\]/);
  assert.match(readFileSync("prisma/migrations/20260619143000_drop_legacy_attachments/migration.sql", "utf8"), /DROP TABLE IF EXISTS "attachments"/);
});
