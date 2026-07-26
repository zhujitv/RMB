import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://security-test:security-test@127.0.0.1:5432/security-test";

const jiti = createJiti(import.meta.url);
const supplierSelection = await jiti.import<typeof import("../lib/platform/supplier-selection.ts")>("../lib/platform/supplier-selection.ts");
const serialization = await jiti.import<typeof import("../lib/platform/shared-serialization-parties.ts")>("../lib/platform/shared-serialization-parties.ts");
const authInput = await jiti.import<typeof import("../lib/platform/shared-auth-input.ts")>("../lib/platform/shared-auth-input.ts");
const authPassword = await jiti.import<typeof import("../lib/platform/shared-auth-password.ts")>("../lib/platform/shared-auth-password.ts");
const passwordPolicy = await jiti.import<typeof import("../lib/password-policy.ts")>("../lib/password-policy.ts");
const clientIp = await jiti.import<typeof import("../lib/client-ip.ts")>("../lib/client-ip.ts");
const baseErrors = await jiti.import<typeof import("../lib/platform/shared-base-errors.ts")>("../lib/platform/shared-base-errors.ts");
const access = await jiti.import<typeof import("../lib/platform/shared-access.ts")>("../lib/platform/shared-access.ts");

function requestWithHeaders(headers: Record<string, string>, ip?: string) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ip,
    headers: { get: (name: string) => normalized[name.toLowerCase()] || null },
  };
}

test("supplier selectors preserve role access while minimizing non-admin records", () => {
  const salesperson = { id: "sales-1", role: "业务员" };
  const finance = { id: "finance-1", role: "财务" };
  const logistics = { id: "logistics-user", role: "物流供应商", supplierId: "supplier-own" };

  assert.equal(supplierSelection.canListAvailableSupplierOptions(salesperson), true);
  assert.equal(supplierSelection.canListAvailableSupplierOptions(finance), true);
  assert.equal(supplierSelection.canListAvailableSupplierOptions(logistics), true);
  assert.equal(supplierSelection.canReadFullSupplierRecords(salesperson), false);
  assert.equal(supplierSelection.canReadFullSupplierRecords(finance), false);
  assert.equal(supplierSelection.canReadFullSupplierRecords(logistics), false);
  assert.equal(supplierSelection.canReadFullSupplierRecords({ role: "管理员" }), true);
  assert.equal(supplierSelection.availableSupplierScopeId(logistics), "supplier-own");
  assert.equal(supplierSelection.availableSupplierScopeId({ role: "物流供应商" }), "__no_supplier_bound__");
  assert.equal(supplierSelection.availableSupplierScopeId({ role: "物流资料录入员" }), "");
  assert.equal(supplierSelection.canListAvailableSupplierOptions({ role: "未知角色" }), false);
  const adminSearch = supplierSelection.supplierListWhere(new URLSearchParams({ keyword: "needle" }), { role: "管理员" }, true);
  const salespersonSearch = supplierSelection.supplierListWhere(new URLSearchParams({ keyword: "needle" }), salesperson, true);
  assert.equal(adminSearch.OR?.length, 5);
  assert.equal(salespersonSearch.OR?.length, 2);

  const option = serialization.serializeSupplierOption({
    id: "supplier-1",
    supplierName: "安全供应商",
    supplierType: "物流供应商",
    status: "启用",
    bankAccount: "6222000000000000",
    taxNumber: "secret-tax-number",
    remark: "secret-remark",
    createdBy: { id: "admin-1", email: "admin@example.com" },
    allowLogisticsExpenseEntry: true,
  });
  assert.deepEqual(Object.keys(option).sort(), [
    "allowDomesticLogisticsEntry",
    "allowFactoryDocumentUpload",
    "allowLogisticsExpenseEntry",
    "allowLogisticsInvoiceUpload",
    "allowedLogisticsCostTypes",
    "id",
    "isDefaultLogisticsSupplier",
    "status",
    "supplierName",
    "supplierType",
  ].sort());
  assert.equal("bankAccount" in option, false);
  assert.equal("taxNumber" in option, false);
  assert.equal("remark" in option, false);
  assert.equal("createdBy" in option, false);
});

test("authentication inputs have bounded lengths and production verification URLs use fixed origins", () => {
  assert.equal(authInput.loginCredentials({ email: " USER@EXAMPLE.COM ", password: "Abcdef12" }).email, "user@example.com");
  assert.throws(() => authInput.loginCredentials({ email: `${"a".repeat(255)}@example.com`, password: "Abcdef12" }), /254/);
  assert.throws(() => authInput.authPassword("A".repeat(129)), /128/);
  assert.throws(
    () => authInput.authPassword({ password: "Abcdef12" }),
    (error: unknown) => (error as { code?: string }).code === "AUTH_INPUT_INVALID",
  );
  assert.throws(() => authInput.requireAuthName("人".repeat(101)), /100/);
  assert.equal(passwordPolicy.passwordMeetsPolicy(`Ab${"界".repeat(24)}`), false);
  assert.equal(passwordPolicy.passwordMeetsPolicy(`Ab${"x".repeat(70)}`), true);
  assert.equal(authInput.boundedUserAgent("x".repeat(800))?.length, 512);
  assert.equal(
    authInput.trustedApplicationOrigin("https://attacker.invalid/register", {
      NODE_ENV: "production",
      APP_URL: "https://www.nextwood.net/some/path",
    }),
    "https://www.nextwood.net",
  );
  assert.throws(
    () => authInput.trustedApplicationOrigin("https://attacker.invalid/register", { NODE_ENV: "production" }),
    (error: unknown) => (error as { code?: string }).code === "APP_ORIGIN_NOT_CONFIGURED",
  );
});

test("unknown login accounts still execute the dummy bcrypt verification path", async () => {
  assert.equal(await authPassword.verifyLoginPassword("NotARealPassword12", ""), false);
  const loginRoute = readFileSync("app/api/auth/login/route.ts", "utf8");
  assert.match(
    loginRoute,
    /const passwordMatches = await verifyLoginPassword\(credentials\.password, user\?\.passwordHash\);[\s\S]*if \(!user\)/,
  );
});

test("client IP resolution trusts only the configured proxy boundary", () => {
  const spoofed = requestWithHeaders({
    "x-vercel-forwarded-for": "203.0.113.8",
    "x-forwarded-for": "198.51.100.99",
  });
  assert.equal(clientIp.resolveTrustedClientIp(spoofed, { platform: "vercel" }), "203.0.113.8");
  assert.equal(clientIp.resolveTrustedClientIp(spoofed, { platform: "direct", allowDevelopmentHeaders: false }), null);
  assert.equal(clientIp.resolveTrustedClientIp(requestWithHeaders({}, "192.0.2.4"), { platform: "direct" }), "192.0.2.4");
  assert.equal(
    clientIp.resolveTrustedClientIp(requestWithHeaders({ "x-forwarded-for": "198.51.100.10, 203.0.113.9" }), { platform: "trusted-proxy" }),
    "203.0.113.9",
  );
});

test("security logs pseudonymize business identifiers while keeping correlation hashes", () => {
  const sanitized = baseErrors.sanitizeForLog({
    orderId: "order-sensitive-1",
    supplierId: "supplier-sensitive-1",
    loginIdHash: "already-safe-hash",
    email: "person@example.com",
  }) as Record<string, unknown>;
  assert.match(String(sanitized.orderId), /^\[id:[0-9a-f]{12}\]$/);
  assert.match(String(sanitized.supplierId), /^\[id:[0-9a-f]{12}\]$/);
  assert.equal(sanitized.loginIdHash, "already-safe-hash");
  assert.equal(sanitized.email, "[redacted]");
});

test("server errors are private by default while client errors remain compatible", () => {
  assert.equal(baseErrors.codedError("internal detail", 500, "INTERNAL").expose, false);
  assert.equal(baseErrors.codedError("invalid input", 400, "INVALID").expose, true);
});

test("cron authentication rejects placeholders and uses a strong shared secret", () => {
  assert.equal(access.cronSecretIsStrong("use-a-long-random-secret"), false);
  assert.equal(access.cronSecretIsStrong("a".repeat(64)), false);
  assert.equal(access.cronSecretIsStrong("0123456789abcdef".repeat(4)), true);
});

test("registration, preview, order errors, and login alerts retain safe compatibility contracts", () => {
  const registration = readFileSync("lib/platform/shared-users-registration.ts", "utf8");
  const rateLimit = readFileSync("proxy-rate-limit.ts", "utf8");
  const previews = [
    "app/api/files/[kind]/[id]/preview/route.ts",
    "app/api/order-documents/[id]/preview/route.ts",
  ].map((file) => readFileSync(file, "utf8")).join("\n");
  const orderRoutes = [
    "app/api/orders/route.ts",
    "app/api/orders/[id]/route.ts",
    "app/api/orders/[id]/business-entity/route.ts",
  ].map((file) => readFileSync(file, "utf8")).join("\n");
  const loginRoute = readFileSync("app/api/auth/login/route.ts", "utf8");
  const authLogin = readFileSync("lib/platform/shared-auth-login.ts", "utf8");
  const notifications = [
    "lib/platform/notification-definitions.ts",
    "lib/platform/notification-security-definitions.ts",
  ].map((file) => readFileSync(file, "utf8")).join("\n");
  const audit = readFileSync("lib/platform/shared-audit.ts", "utf8");
  const orderDocumentUpload = readFileSync("lib/platform/order-documents-upload.ts", "utf8");
  const orderDocumentRoute = readFileSync("app/api/order-documents/route.ts", "utf8");

  assert.doesNotMatch(registration, /EMAIL_ALREADY_EXISTS/);
  assert.match(registration, /registrationResponse\(email, name\)/);
  assert.match(registration, /PrismaClientKnownRequestError[\s\S]*P2002/);
  assert.match(registration, /requestOriginFromAuditRequest\(request\)/);
  assert.match(rateLimit, /API_RATE_LIMIT_REGISTRATION_LIMIT/);
  assert.match(rateLimit, /API_RATE_LIMIT_REGISTRATION_WINDOW_MS/);
  assert.match(rateLimit, /pathname === "\/api\/auth\/register"/);
  assert.doesNotMatch(rateLimit, /sessionToken\(request/);
  assert.match(rateLimit, /ip:\$\{hashIdentity\(resolveTrustedClientIp\(request\) \|\| "unknown"\)\}/);
  assert.match(rateLimit, /RATE_LIMIT_REDIS_TIMEOUT_MS/);
  assert.match(rateLimit, /signal: AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(previews, /apiErrorSafe500\(error, "文件暂时无法预览，请下载查看。", code\)/);
  assert.doesNotMatch(previews, /error\?\.message/);
  assert.match(orderRoutes, /apiErrorWithLegacyShape/);
  assert.doesNotMatch(orderRoutes, /typedError\.message/);
  assert.match(loginRoute, /loginAlertEnabled: true/);
  assert.match(loginRoute, /after\(async \(\) =>/);
  assert.match(loginRoute, /sendUserLoginAlert\(user, successfulLoginAttempt\)/);
  assert.match(authLogin, /idempotencyKey: `user-login-alert-\$\{attempt\.id\}`/);
  assert.match(notifications, /USER_LOGIN_ALERT/);
  assert.match(audit, /critical auth audit write failed/);
  assert.match(orderDocumentUpload, /logServerError\("订单单证数据库写入失败", error/);
  assert.match(orderDocumentUpload, /codedError\("数据库写入失败，请稍后重试。", 500, "DATABASE_WRITE_FAILED"\)/);
  assert.doesNotMatch(orderDocumentUpload, /数据库写入失败：\$\{message\}/);
  assert.match(orderDocumentRoute, /isProduction && status >= 500 \? fallback/);
});
