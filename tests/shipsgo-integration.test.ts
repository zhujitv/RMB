import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const constants = readFileSync("lib/platform/shared-constants.ts", "utf8");
const service = readFileSync("lib/platform/shipsgo-integration.ts", "utf8");
const trackingService = readFileSync("lib/platform/shipsgo-tracking.ts", "utf8");
const shared = readFileSync("lib/platform/shared.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260628100000_shipsgo_trackings/migration.sql", "utf8");
const masterBlMigration = readFileSync("prisma/migrations/20260628123000_shipsgo_master_bl_containers/migration.sql", "utf8");
const settingsRoute = readFileSync("app/api/settings/shipsgo/route.ts", "utf8");
const oceanTrackingRoute = readFileSync("app/api/shipsgo/ocean-trackings/route.ts", "utf8");
const oceanTrackingSyncRoute = readFileSync("app/api/shipsgo/ocean-trackings/[id]/sync/route.ts", "utf8");
const oceanTrackingContainerRoute = readFileSync("app/api/shipsgo/ocean-trackings/container/[containerNo]/route.ts", "utf8");
const webhookRoute = readFileSync("app/api/shipsgo/webhook/route.ts", "utf8");
const shipsgoCronRoute = readFileSync("app/api/cron/shipsgo-sync/route.ts", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");
const domesticLogisticsOps = readFileSync("lib/platform/domestic-logistics-ops.ts", "utf8");
const settingsModule = readFileSync("app/modules/SettingsModule.tsx", "utf8");
const logisticsRoute = readFileSync("app/api/domestic-logistics/route.ts", "utf8");
const logisticsModule = readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8");

test("ShipsGo integration settings are stored safely in system settings", () => {
  assert.match(constants, /SHIPSGO_INTEGRATION_SETTING_KEY = "shipsgo_integration"/);
  assert.match(constants, /DEFAULT_SHIPSGO_INTEGRATION_SETTINGS/);
  assert.match(service, /prisma\.systemSetting\.findUnique\(\{ where: \{ key: SHIPSGO_INTEGRATION_SETTING_KEY \} \}\)/);
  assert.match(service, /prisma\.systemSetting\.upsert/);
  assert.match(service, /assertRead\(actor, "settings"\)/);
  assert.match(service, /assertWrite\(actor, "settings"\)/);
  assert.match(service, /apiKeyConfigured: Boolean\(normalized\.apiKey\)/);
  assert.match(service, /webhookSecretConfigured: Boolean\(normalized\.webhookSecret\)/);
  assert.match(service, /apiKey: ""/);
  assert.match(service, /webhookSecret: ""/);
  assert.match(shared, /export \* from "\.\/shipsgo-integration"/);
  assert.match(shared, /export \* from "\.\/shipsgo-tracking"/);
});

test("ShipsGo settings API supports authenticated read and admin write", () => {
  assert.match(settingsRoute, /export async function GET/);
  assert.match(settingsRoute, /readShipsgoIntegrationSettings\(actor\)/);
  assert.match(settingsRoute, /export async function PATCH/);
  assert.match(settingsRoute, /saveShipsgoIntegrationSettings\(request, actor, body\)/);
  assert.match(settingsRoute, /ShipsGo 设置已保存/);
});

test("settings module exposes third-party API configuration without leaking secrets", () => {
  assert.match(settingsModule, /"shipsgoIntegration"/);
  assert.match(settingsModule, /label: "第三方接口"/);
  assert.match(settingsModule, /\/api\/settings\/shipsgo/);
  assert.match(settingsModule, /ShipsgoIntegrationSettingsCard/);
  assert.match(settingsModule, /保存 ShipsGo 设置/);
  assert.match(settingsModule, /placeholder=\{currentForm\.apiKeyConfigured \? "已配置，留空则保持不变"/);
  assert.match(settingsModule, /SHIPSGO_FEATURE_OPTIONS/);
  assert.match(settingsModule, /activeTab !== "shipsgoIntegration"/);
});

test("domestic logistics only receives safe ShipsGo feature flags", () => {
  assert.match(logisticsRoute, /readShipsgoFeatureFlags/);
  assert.match(logisticsRoute, /const \[rows, shipsgo\] = await Promise\.all/);
  assert.match(logisticsRoute, /return ok\(\{ rows, shipsgo \}\)/);
  assert.match(logisticsModule, /type ShipsgoFeatureFlags/);
  assert.match(logisticsModule, /shipsgoFeatures\.enabled \? \(/);
  assert.match(logisticsModule, /ShipsgoTrackingFeaturePanel/);
  assert.doesNotMatch(logisticsModule, /apiKey|webhookSecret/);
});

test("ShipsGo tracking has an isolated model and migration", () => {
  assert.match(schema, /model ShipsgoTracking/);
  assert.match(schema, /model ShipsgoTrackingContainer/);
  assert.match(schema, /masterBlNo\s+String\?\s+@map\("master_bl_no"\)/);
  assert.match(schema, /containers ShipsgoTrackingContainer\[\]/);
  assert.match(schema, /shipsgoTrackings ShipsgoTracking\[\]/);
  assert.match(schema, /createdShipsgoTrackings ShipsgoTracking\[\]/);
  assert.match(schema, /@@map\("shipsgo_trackings"\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "shipsgo_trackings"/);
  assert.match(migration, /"raw_payload" JSONB/);
  assert.match(migration, /shipsgo_trackings_provider_shipment_unique/);
  assert.match(masterBlMigration, /CREATE TABLE IF NOT EXISTS "shipsgo_tracking_containers"/);
  assert.match(masterBlMigration, /"master_bl_no"/);
  assert.match(masterBlMigration, /shipsgo_tracking_containers_tracking_container_unique/);
});

test("ShipsGo service uses official v2 headers and signature validation", () => {
  assert.match(trackingService, /"X-Shipsgo-User-Token": settings\.apiKey/);
  assert.match(trackingService, /\/ocean\/shipments/);
  assert.match(trackingService, /createShipsgoOceanTracking/);
  assert.match(trackingService, /syncShipsgoOceanTracking/);
  assert.match(trackingService, /handleShipsgoWebhook/);
  assert.match(trackingService, /createHmac\("sha256"/);
  assert.match(trackingService, /timingSafeEqualText/);
});

test("ShipsGo routes expose create, sync and webhook endpoints", () => {
  assert.match(oceanTrackingRoute, /createShipsgoOceanTracking\(request, actor, body\)/);
  assert.match(oceanTrackingSyncRoute, /syncShipsgoOceanTracking\(request, actor, id\)/);
  assert.match(oceanTrackingContainerRoute, /findShipsgoOceanTrackingByContainerNo\(actor, containerNo\)/);
  assert.match(webhookRoute, /request\.text\(\)/);
  assert.match(webhookRoute, /X-Shipsgo-Webhook-Signature/);
  assert.match(webhookRoute, /handleShipsgoWebhook\(rawBody, signature\)/);
  assert.match(shipsgoCronRoute, /syncDueShipsgoOceanTrackings\(request, actor\)/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/shipsgo-sync"/);
  assert.match(vercelConfig, /"schedule": "0 \*\/6 \* \* \*"/);
});

test("domestic logistics rows include safe ShipsGo tracking summaries", () => {
  assert.match(domesticLogisticsOps, /include\.shipsgoTrackings = \{/);
  assert.match(domesticLogisticsOps, /includeShipsgoTrackings/);
  assert.match(domesticLogisticsOps, /serializeShipsgoTrackingSummary/);
  assert.doesNotMatch(domesticLogisticsOps, /rawPayload: true/);
  assert.match(logisticsModule, /shipsgoTrackings\?: ShipsgoTrackingRow\[\]/);
  assert.match(logisticsModule, /ShipsgoOrderTrackingPanel/);
  assert.match(logisticsModule, /\/api\/shipsgo\/ocean-trackings/);
});

test("ShipsGo create errors are shown inside the create panel", () => {
  const createFunction = logisticsModule.match(/async function createShipsgoTracking[\s\S]*?async function syncShipsgoTracking/)?.[0] || "";
  assert.match(createFunction, /throw createError instanceof Error \? createError : new Error\("创建 ShipsGo 跟踪失败"\)/);
  assert.doesNotMatch(createFunction, /setError\(createError/);
  assert.match(logisticsModule, /const \[createError, setCreateError\] = useState\(""\)/);
  assert.match(logisticsModule, /styles\.shipsgoCreateError/);
  assert.match(logisticsModule, /const message = error instanceof Error \? error\.message : "创建 ShipsGo 跟踪失败"/);
  assert.match(logisticsModule, /setCreateError\(message\)/);
  assert.match(logisticsModule, /setShowCarrierInput\(true\)/);
});

test("ShipsGo creation consumes one tracking per master bill only", () => {
  const payloadFunction = trackingService.match(/function createPayloadFromInput[\s\S]*?async function replaceShipsgoTrackingContainers/)?.[0] || "";
  const createService = trackingService.match(/export async function createShipsgoOceanTracking[\s\S]*?export async function syncShipsgoOceanTracking/)?.[0] || "";
  assert.match(payloadFunction, /masterBlNo/);
  assert.match(payloadFunction, /booking_number: masterBlNo/);
  assert.doesNotMatch(payloadFunction, /container_number:/);
  assert.match(createService, /findFirst\(\{\s*where: \{\s*orderId,\s*provider: SHIPSGO_PROVIDER,\s*mode: OCEAN_MODE,\s*deletedAt: null,/);
  assert.match(createService, /if \(existing\) \{/);
  assert.match(createService, /alreadyExists: true/);
  assert.match(createService, /replaceShipsgoTrackingContainers\(savedBase\.id, mapped\.containerNumbers\)/);
  assert.match(trackingService, /export async function findShipsgoOceanTrackingByContainerNo/);
  assert.match(logisticsModule, /Master B\/L（提单号）/);
  assert.doesNotMatch(logisticsModule, /柜号 Container No\./);
  assert.match(logisticsModule, /开始追踪/);
  assert.match(logisticsModule, /查看运输状态/);
});
