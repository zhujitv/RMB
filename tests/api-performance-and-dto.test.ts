import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260701211500_api_performance_logs/migration.sql",
  "utf8",
);
const apiPerformance = readFileSync("lib/platform/api-performance.ts", "utf8");
const apiRouteGuard = readFileSync("lib/api-route-guard.ts", "utf8");
const appApi = readFileSync("app/api.ts", "utf8");
const apiPerformanceRoute = readFileSync(
  "app/api/settings/api-performance/route.ts",
  "utf8",
);
const settingsConstants = readFileSync(
  "app/modules/settings/constants.ts",
  "utf8",
);
const settingsHelpers = readFileSync("app/modules/settings/helpers.ts", "utf8");
const settingsController = readFileSync(
  "app/modules/settings/use-settings-controller.ts",
  "utf8",
);
const costQueries = readFileSync("lib/platform/cost-records-queries.ts", "utf8");
const logisticsSerialization = readFileSync(
  "lib/platform/logistics-expense-access-serialization.ts",
  "utf8",
);
const logisticsQueries = readFileSync(
  "lib/platform/logistics-expense-queries.ts",
  "utf8",
);

test("api performance logs are persisted and exposed through settings", () => {
  assert.match(schema, /model ApiPerformanceLog/);
  assert.match(schema, /@@map\("api_performance_logs"\)/);
  assert.match(migration, /CREATE TABLE "api_performance_logs"/);
  assert.match(apiPerformance, /export function recordApiPerformanceLog/);
  assert.match(apiPerformance, /export async function listApiPerformanceMetrics/);
  assert.match(apiPerformance, /API_PERFORMANCE_MAX_SCAN_ROWS/);
  assert.match(apiPerformance, /pageResult\(pagedRows, rows\.length, page, pageSize\)/);
  assert.match(apiRouteGuard, /recordApiPerformanceLog\(\{/);
  assert.match(appApi, /reportApiRequestTiming\(\{/);
  assert.match(appApi, /API_PERFORMANCE_REPORT_PATH = "\/api\/settings\/api-performance"/);
  assert.match(apiPerformanceRoute, /export async function GET/);
  assert.match(apiPerformanceRoute, /export async function POST/);
  assert.match(apiPerformanceRoute, /assertRead\(actor, "auditLogs"\)/);
  assert.match(settingsConstants, /apiPerformance", label: "慢接口榜单"/);
  assert.match(settingsHelpers, /API_PERFORMANCE_COLUMNS/);
  assert.match(settingsController, /setApiPerformance\(result\.metrics \|\| \[\]\)/);
  assert.equal(
    existsSync("app/api/settings/api-performance/route.ts"),
    true,
  );
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
