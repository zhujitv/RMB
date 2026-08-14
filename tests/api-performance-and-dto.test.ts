import { readPrismaSchemaSource } from "./prisma-schema-source.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { readCostRecordsQueriesSource, readLogisticsExpenseAccessSource, readLogisticsExpenseQueriesSource, readSettingsModuleSource, readSharedConstantsSource } from "./source-helpers.ts";

const schema = readPrismaSchemaSource();
const removalMigration = readFileSync(
  "prisma/migrations/20260814150000_remove_api_performance_and_audit_retention/migration.sql",
  "utf8",
);
const sharedConstants = readSharedConstantsSource();
const apiRouteGuard = readFileSync("lib/api-route-guard.ts", "utf8");
const appApi = readFileSync("app/api.ts", "utf8");
const settingsConstants = readSettingsModuleSource();
const maintenanceRoute = readFileSync("app/api/cron/system-maintenance/route.ts", "utf8");
const retention = readFileSync("lib/platform/audit-log-retention.ts", "utf8");
const cronConfig = readFileSync("config/tencent-cloud-cron.json", "utf8");
const costQueries = readCostRecordsQueriesSource();
const logisticsSerialization = readLogisticsExpenseAccessSource();
const logisticsQueries = readLogisticsExpenseQueriesSource();

test("background task telemetry is removed and audit logs retain only 30 days", () => {
  assert.doesNotMatch(schema, /model ApiPerformanceLog/);
  assert.match(removalMigration, /DROP TABLE IF EXISTS "api_performance_logs"/);
  assert.match(removalMigration, /DELETE FROM "audit_logs"/);
  assert.match(removalMigration, /INTERVAL '30 days'/);
  assert.equal(existsSync("lib/platform/api-performance.ts"), false);
  assert.equal(existsSync("lib/platform/background-task-metrics.ts"), false);
  assert.equal(existsSync("app/api/settings/api-performance/route.ts"), false);
  assert.doesNotMatch(sharedConstants, /recordBackgroundTaskMetric/);
  assert.match(sharedConstants, /background-task-slow-log/);
  assert.doesNotMatch(apiRouteGuard, /recordApiPerformanceLog/);
  assert.doesNotMatch(appApi, /reportApiRequestTiming|API_PERFORMANCE_REPORT_PATH/);
  assert.doesNotMatch(settingsConstants, /apiPerformance|后台任务/);
  assert.match(retention, /AUDIT_LOG_RETENTION_DAYS = 30/);
  assert.match(retention, /prisma\.auditLog\.deleteMany/);
  assert.match(maintenanceRoute, /assertCronSecret\(request\)/);
  assert.match(maintenanceRoute, /cleanupExpiredAuditLogs\(\)/);
  assert.match(cronConfig, /"path": "\/api\/cron\/system-maintenance"[\s\S]*"schedule": "10 3 \* \* \*"/);
});

test("api client surfaces non-json route failures with request context", () => {
  assert.match(appApi, /const responseForText = response\.clone\(\)/);
  assert.match(appApi, /请求失败（\$\{response\.status\}）：\$\{normalizedApiPath\(path\) \|\| path\}/);
  assert.match(appApi, /服务器返回非JSON响应，请查看服务端日志。/);
  assert.match(appApi, /errorCode = code \|\| `HTTP_\$\{response\.status\}`/);
  assert.match(appApi, /new ApiRequestError\(fallbackMessage, response\.status, errorCode\)/);
});

test("api client lets multipart uploads set their own content type", () => {
  assert.match(appApi, /function bodyManagesContentType/);
  assert.match(appApi, /body instanceof FormData/);
  assert.match(appApi, /apiRequestHeaders\(fetchInit\.headers, fetchInit\.body\)/);
  assert.match(appApi, /headers\.set\("Content-Type", "application\/json"\)/);
});

test("core cost and logistics list queries use lightweight DTO relations", () => {
  assert.match(costQueries, /function includeCostListRelations/);
  assert.match(costQueries, /include: includeCostListRelations\(\)/);
  assert.match(costQueries, /function includeCostInvoiceGroupRelations\(\)[\s\S]*\.\.\.includeCostListRelations\(\)/);
  assert.match(logisticsSerialization, /export function includeLogisticsExpenseListRelations/);
  assert.match(logisticsQueries, /includeLogisticsExpenseListRelations/);
  assert.match(logisticsQueries, /include: includeLogisticsExpenseListRelations\(\)/);
  assert.doesNotMatch(
    logisticsSerialization.match(/export function includeLogisticsExpenseListRelations\(\)[\s\S]*?\n}\n\nexport function logisticsExpenseBillOfLadingNo/)?.[0] || "",
    /cost:\s*\{\s*include:\s*includeCostRelations/,
  );
});
