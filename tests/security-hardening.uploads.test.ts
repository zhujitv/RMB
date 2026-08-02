import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

const vercelReleaseBuild = readFileSync("scripts/vercel-release-build.mjs", "utf8");

test("logistics generated cost invoices are managed only by logistics invoice groups", () => {
  assert.match(
    orderDocumentsService,
    /function isLogisticsGeneratedCostInvoice\(documentType: string \| null \| undefined, cost: DocumentCostLike \| null \| undefined\)/,
  );
  assert.match(
    orderDocumentsService,
    /documentType === "SUPPLIER_INVOICE" && isLogisticsGeneratedCostSourceType\(cost\?\.sourceType\)/,
  );
  assert.match(
    orderDocumentsService,
    /物流费用发票请在物流费用模块按发票分组上传，成本管理仅同步查看。/,
  );
  assert.match(
    orderDocumentsService,
    /物流费用发票请在物流费用模块按发票分组删除或替换，成本管理仅同步查看。/,
  );
  assert.match(
    orderDocumentsService,
    /if \(isLogisticsGeneratedCostInvoice\(documentType, cost\)\) \{/,
  );
  assert.match(
    orderDocumentsService,
    /if \(isLogisticsGeneratedCostInvoice\(before\.documentType, before\.cost\)\) \{/,
  );
  assert.match(
    costsUiModule,
    /function isLogisticsGeneratedCost\(cost: Pick<CostRow, "sourceType">\)/,
  );
  assert.match(
    costsUiModule,
    /const canManageDocuments = canWriteDocuments && !logisticsGenerated/,
  );
  assert.match(
    costsUiModule,
    /发票按物流费用模块的分组开票规则上传；成本管理仅同步查看/,
  );
});

test("shared PDF validation does not reject active content actions", () => {
  assert.doesNotMatch(uploadValidation, /\/JavaScript\\b/);
  assert.doesNotMatch(uploadValidation, /\/OpenAction\\b/);
  assert.doesNotMatch(uploadValidation, /\/EmbeddedFile\\b/);
  assert.doesNotMatch(uploadValidation, /\/Launch\\b/);
  assert.doesNotMatch(
    uploadValidation,
    /function assertPdfDoesNotContainActiveContent\(body: Buffer\)/,
  );
  assert.doesNotMatch(
    uploadValidation,
    /assertPdfDoesNotContainActiveContent\(body\);[\s\S]*return \{/,
  );
});

test("all active upload UIs enforce pdf only auto upload with progress", () => {
  assert.match(appUtils, /export const PDF_UPLOAD_ACCEPT = "\.pdf"/);
  assert.match(
    appUtils,
    /export const PDF_UPLOAD_MAX_BYTES = 10 \* 1024 \* 1024/,
  );
  assert.match(appUtils, /export function validatePdfUploadFile/);
  assert.match(
    appUtils,
    /file\.type !== "application\/pdf"|file\.type === "application\/pdf"/,
  );
  assert.match(appUtils, /export function uploadFormDataWithProgress/);
  assert.match(appUtils, /new XMLHttpRequest\(\)/);
  assert.match(appUtils, /xhr\.upload\.onprogress/);

  for (const [name, source] of [
    ["TaxRefundModule", taxRefundModule],
    ["DomesticLogisticsModule", domesticLogisticsModule],
    ["CostsModule", costsUiModule],
    ["LogisticsFeesModule", logisticsFeesModule],
  ] as const) {
    assert.match(
      source,
      /accept=\{PDF_UPLOAD_ACCEPT\}/,
      `${name} must use the shared PDF accept rule`,
    );
    assert.match(
      source,
      /validatePdfUploadFile/,
      `${name} must use the shared 10MB PDF validator`,
    );
    assert.match(
      source,
      /uploadFormDataWithProgress/,
      `${name} must use upload progress`,
    );
    assert.match(
      source,
      /invoiceUploadProgressBar/,
      `${name} must render upload progress`,
    );
    assert.doesNotMatch(
      source,
      /PDF \/ JPG \/ PNG|20MB|accept="application\/pdf,\.pdf"|fetch\("\/api\/order-documents"/,
      `${name} must not keep legacy upload flow`,
    );
  }
});

test("server and audit logs redact sensitive file and credential fields", () => {
  assert.match(sharedBaseUtils, /SENSITIVE_LOG_KEY_PATTERN/);
  assert.match(sharedBaseUtils, /original\(name\|filename\)/);
  assert.match(sharedBaseUtils, /logServerError/);
  assert.match(sharedAudit, /originalName\|originalFilename/);
  assert.doesNotMatch(orderDocumentsRoute, /originalName: file/);
  assert.doesNotMatch(orderDocumentsRoute, /originalFilename/);
  assert.doesNotMatch(
    orderDocumentsService,
    /originalFilename: document\.originalFilename/,
  );
});

test("expected auth failures do not flood server error logs", () => {
  assert.match(
    sharedBaseUtils,
    /function shouldLogApiErrorStatus\(status: number\)/,
  );
  assert.match(sharedBaseUtils, /status === 401 \|\| status === 403/);
  assert.match(sharedBaseUtils, /LOG_EXPECTED_AUTH_ERRORS === "true"/);
  assert.match(
    sharedBaseUtils,
    /if \(shouldLogApiErrorStatus\(status\)\) logServerError\(fallback, error\)/,
  );
});

test("local build scripts load env files before prisma commands", () => {
  assert.match(
    packageJson,
    /"build:app": "node scripts\/run-with-env\.mjs node scripts\/security-env-check\.mjs && node scripts\/run-with-env\.mjs prisma generate && next build"/,
  );
  assert.match(
    packageJson,
    /"build:release": "node scripts\/run-with-env\.mjs prisma migrate deploy && npm run build:app"/,
  );
  assert.match(
    packageJson,
    /"build": "node scripts\/vercel-release-build\.mjs"/,
  );
  assert.doesNotMatch(packageJson, /"build": "[^"]*migrate deploy/);
  assert.match(vercelReleaseBuild, /target === "production"/);
  assert.match(vercelReleaseBuild, /runNpmScript\("db:deploy"\)/);
  assert.match(vercelReleaseBuild, /runNpmScript\("build:app"\)/);
  assert.match(
    packageJson,
    /"db:deploy": "node scripts\/run-with-env\.mjs prisma migrate deploy"/,
  );
  assert.match(
    runWithEnvScript,
    /const ENV_FILES = \["\.env", "\.env\.local"\]/,
  );
  assert.match(runWithEnvScript, /originalEnvKeys\.has\(key\)/);
  assert.match(runWithEnvScript, /spawnSync\(command, args/);
});

test("ci runs the security audit guardrail", () => {
  assert.match(
    packageJson,
    /"security:audit": "node scripts\/security-audit\.mjs && node scripts\/lockfile-integrity\.mjs"/,
  );
  assert.match(packageJson, /"verify:ci": "[^"]*npm run security:audit/);
  assert.match(packageJson, /"verify:release": "[^"]*npm run security:audit/);
  assert.match(ciWorkflow, /npm run verify:ci/);
  assert.match(securityAuditScript, /Strict-Transport-Security/);
  assert.match(securityAuditScript, /UPSTASH_REDIS_REST_URL/);
  assert.match(securityAuditScript, /UPSTASH_REDIS_KV_REST_API_URL/);
  assert.match(securityAuditScript, /AUTH_PATTERNS/);
  assert.match(securityAuditScript, /dangerouslySetInnerHTML/);
  assert.match(securityAuditScript, /SECURITY_ROLE_MATRIX/);
});

test("legacy attachment model and service are removed", () => {
  assert.equal(existsSync("lib/platform/legacy-attachments.ts"), false);
  assert.doesNotMatch(schema, /model Attachment/);
  assert.doesNotMatch(schema, /attachments Attachment\[\]/);
  assert.match(
    readFileSync(
      "prisma/migrations/20260619143000_drop_legacy_attachments/migration.sql",
      "utf8",
    ),
    /DROP TABLE IF EXISTS "attachments"/,
  );
});
