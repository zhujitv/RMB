import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatShipsgoCarrierForLocale,
  formatShipsgoPortForLocale,
  formatShipsgoStatusForLocale,
  formatShipsgoTrackingMethodForLocale,
  normalizeShipsgoDisplayLocale,
} from "../lib/shipsgo-display.ts";
import { readDomesticLogisticsModuleSource, readSettingsModuleSource, readWorkspaceStylesSource } from "./source-helpers.ts";

const constants = readFileSync("lib/platform/shared-constants.ts", "utf8");
const service = readFileSync("lib/platform/shipsgo-integration.ts", "utf8");
const trackingService = [
  "lib/platform/shipsgo-tracking.ts",
  "lib/platform/shipsgo-tracking-utils.ts",
  "lib/platform/shipsgo-tracking-mapping.ts",
  "lib/platform/shipsgo-control-tower.ts",
  "lib/platform/shipsgo-tracking-service.ts",
].map((path) => readFileSync(path, "utf8")).join("\n");
const shipsgoControlTowerService = readFileSync("lib/platform/shipsgo-control-tower.ts", "utf8");
const shared = readFileSync("lib/platform/shared.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260628100000_shipsgo_trackings/migration.sql", "utf8");
const masterBlMigration = readFileSync("prisma/migrations/20260628123000_shipsgo_master_bl_containers/migration.sql", "utf8");
const settingsRoute = readFileSync("app/api/settings/shipsgo/route.ts", "utf8");
const oceanTrackingRoute = readFileSync("app/api/shipsgo/ocean-trackings/route.ts", "utf8");
const oceanTrackingDeleteRoute = readFileSync("app/api/shipsgo/ocean-trackings/[id]/route.ts", "utf8");
const oceanTrackingSyncRoute = readFileSync("app/api/shipsgo/ocean-trackings/[id]/sync/route.ts", "utf8");
const oceanTrackingContainerRoute = readFileSync("app/api/shipsgo/ocean-trackings/container/[containerNo]/route.ts", "utf8");
const oceanTrackingRecoverRoute = readFileSync("app/api/shipsgo/ocean-trackings/recover/route.ts", "utf8");
const oceanTrackingControlTowerRoute = readFileSync("app/api/shipsgo/ocean-trackings/control-tower/route.ts", "utf8");
const webhookRoute = readFileSync("app/api/shipsgo/webhook/route.ts", "utf8");
const shipsgoCronRoute = readFileSync("app/api/cron/shipsgo-sync/route.ts", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");
const domesticLogisticsOps = readFileSync("lib/platform/domestic-logistics-ops.ts", "utf8");
const settingsModule = readSettingsModuleSource();
const logisticsRoute = readFileSync("app/api/domestic-logistics/route.ts", "utf8");
const logisticsModule = readDomesticLogisticsModuleSource();
const trackingMapPage = readFileSync("app/tracking-map/page.tsx", "utf8");
const trackingMapClient = readFileSync("app/tracking-map/tracking-map-client.tsx", "utf8");
const workspaceStyles = readWorkspaceStylesSource();

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
  assert.doesNotMatch(service, /liveMapEmbedTokenConfigured|liveMapEmbedUrl|shipsgoEmbedUrl/);
  assert.match(shared, /export \* from "\.\/shipsgo-integration"/);
  assert.match(shared, /export \* from "\.\/shipsgo-tracking"/);
});

test("ShipsGo settings API supports authenticated read and admin write", () => {
  assert.match(settingsRoute, /export async function GET/);
  assert.match(settingsRoute, /readShipsgoIntegrationSettings\(actor\)/);
  assert.match(settingsRoute, /export async function PATCH/);
  assert.match(settingsRoute, /saveShipsgoIntegrationSettings\(request, actor, body\)/);
  assert.match(settingsRoute, /大掌櫃设置已保存/);
});

test("settings module exposes third-party API configuration without leaking secrets", () => {
  assert.match(settingsModule, /"shipsgoIntegration"/);
  assert.match(settingsModule, /label: "物流接口"/);
  assert.match(settingsModule, /\/api\/settings\/shipsgo/);
  assert.match(settingsModule, /ShipsgoIntegrationSettingsCard/);
  assert.match(settingsModule, /title="物流接口"/);
  assert.match(settingsModule, /SecretField/);
  assert.match(settingsModule, /placeholder=\{currentForm\.apiKeyConfigured \? "已配置，留空则保持不变"/);
  assert.doesNotMatch(settingsModule, /Live Map Embed Token|iframe 授权 Token|liveMapEmbedToken/);
  assert.match(settingsModule, /SHIPSGO_FEATURE_OPTIONS/);
  assert.match(settingsModule, /markLoaded\("shipsgoIntegration"\)/);
});

test("domestic logistics only receives safe ShipsGo feature flags", () => {
  assert.match(logisticsRoute, /readShipsgoFeatureFlags/);
  assert.match(logisticsRoute, /const \[rows, shipsgo\] = await Promise\.all/);
  assert.match(logisticsRoute, /return ok\(\{ rows, shipsgo \}\)/);
  assert.match(logisticsModule, /type ShipsgoFeatureFlags/);
  assert.match(logisticsModule, /shipsgoFeatures\.enabled && shipsgoFeatures\.oceanTrackingEnabled/);
  assert.doesNotMatch(logisticsModule, /liveMapEmbedUrl\?: string/);
  assert.doesNotMatch(logisticsModule, /<iframe[\s\S]*src=\{embedUrl\}/);
  assert.doesNotMatch(logisticsModule, /SideDetailDrawer[\s\S]*大掌櫃运输地图/);
  assert.match(logisticsModule, /\/tracking-map\?trackingId=\$\{encodeURIComponent\(cleanTrackingId\)\}/);
  assert.doesNotMatch(trackingMapClient, /<iframe|shipsgo-embed|embedUrl|https:\/\/embed\.shipsgo\.com/);
  assert.doesNotMatch(service, /https:\/\/embed\.shipsgo\.com\/\?token=/);
  assert.doesNotMatch(logisticsModule, /ShipsgoTrackingFeaturePanel/);
  assert.doesNotMatch(logisticsModule, /Credit 预警阈值/);
  assert.doesNotMatch(logisticsModule, /每日自动同步/);
  assert.doesNotMatch(logisticsModule, /apiKey|webhookSecret|liveMapEmbedToken/);
});

test("ShipsGo tracking has an isolated model and migration", () => {
  assert.match(schema, /model ShipsgoTracking/);
  assert.match(schema, /model ShipsgoTrackingContainer/);
  assert.match(schema, /masterBlNo\s+String\?\s+@map\("master_bl_no"\)/);
  assert.match(schema, /containers\s+ShipsgoTrackingContainer\[\]/);
  assert.match(schema, /shipsgoTrackings\s+ShipsgoTracking\[\]/);
  assert.match(schema, /createdShipsgoTrackings\s+ShipsgoTracking\[\]/);
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
  assert.match(oceanTrackingDeleteRoute, /export async function GET/);
  assert.match(oceanTrackingDeleteRoute, /getShipsgoOceanTracking\(actor, id\)/);
  assert.match(oceanTrackingDeleteRoute, /readShipsgoFeatureFlags\(\)/);
  assert.match(oceanTrackingRoute, /createShipsgoOceanTracking\(request, actor, body\)/);
  assert.match(oceanTrackingDeleteRoute, /deleteShipsgoOceanTracking\(request, actor, id\)/);
  assert.match(oceanTrackingSyncRoute, /syncShipsgoOceanTracking\(request, actor, id\)/);
  assert.match(oceanTrackingContainerRoute, /findShipsgoOceanTrackingByContainerNo\(actor, containerNo\)/);
  assert.match(oceanTrackingRecoverRoute, /recoverShipsgoOceanTracking\(request, actor, body\)/);
  assert.match(oceanTrackingControlTowerRoute, /listShipsgoControlTowerTrackings\(new URL\(request\.url\)\.searchParams, actor\)/);
  assert.match(webhookRoute, /request\.text\(\)/);
  assert.match(webhookRoute, /X-Shipsgo-Webhook-Signature/);
  assert.match(webhookRoute, /handleShipsgoWebhook\(rawBody, signature\)/);
  assert.match(shipsgoCronRoute, /syncDueShipsgoOceanTrackings\(request, actor\)/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/shipsgo-sync"/);
  assert.match(vercelConfig, /"schedule": "0 \*\/6 \* \* \*"/);
});

test("ShipsGo map opens as a dedicated page and loads by trackingId", () => {
  assert.match(trackingMapPage, /initialTrackingId=\{firstSearchParam\(params\?\.trackingId\)\}/);
  assert.match(trackingMapClient, /\/api\/shipsgo\/ocean-trackings\/\$\{encodeURIComponent\(trackingId\)\}/);
  assert.match(trackingMapClient, /请选择一条运输跟踪记录/);
  assert.match(trackingMapClient, /当前运输跟踪数据加载失败，请重新同步后再试。/);
  assert.match(trackingMapClient, /Master B\/L/);
  assert.match(trackingMapClient, /船公司/);
  assert.match(trackingMapClient, /船名航次/);
  assert.match(trackingMapClient, /起运港/);
  assert.match(trackingMapClient, /目的港/);
  assert.match(trackingMapClient, /关联柜号/);
  assert.match(trackingMapClient, /打开大掌柜原始地图/);
  assert.match(trackingMapClient, /href=\{tracking\.mapUrl\}/);
  assert.doesNotMatch(trackingMapClient, /trackingMapUrl|appendIfAbsent|<iframe/);
  assert.match(logisticsModule, /target="_blank"/);
  assert.doesNotMatch(logisticsModule, /setOpen\(true\)/);
});

test("ShipsGo tracking mutations are role-scoped to admin and owning sales", () => {
  assert.match(trackingService, /function assertShipsgoTrackingWriteAccess/);
  assert.match(trackingService, /role === "管理员"/);
  assert.match(trackingService, /role === "业务员" && order\?\.customer\?\.salespersonUserId === actorId\(actor\)/);
  assert.match(trackingService, /SHIPSGO_TRACKING_WRITE_FORBIDDEN/);
  assert.match(trackingService, /function assertShipsgoTrackingDeleteAccess/);
  assert.match(trackingService, /SHIPSGO_TRACKING_DELETE_ADMIN_ONLY/);
  assert.match(trackingService.match(/export async function createShipsgoOceanTracking[\s\S]*?const payload = createPayloadFromInput/)?.[0] || "", /assertShipsgoTrackingWriteAccess\(actor, order\)/);
  assert.match(trackingService.match(/export async function syncShipsgoOceanTracking[\s\S]*?if \(!before\.shipsgoShipmentId\)/)?.[0] || "", /assertShipsgoTrackingWriteAccess\(actor, before\.order\)/);
  assert.match(trackingService.match(/export async function recoverShipsgoOceanTracking[\s\S]*?const masterBlNo/)?.[0] || "", /assertShipsgoTrackingWriteAccess\(actor, order\)/);
  assert.match(trackingService, /export async function deleteShipsgoOceanTracking/);
});

test("domestic logistics rows include safe ShipsGo tracking summaries", () => {
  assert.match(domesticLogisticsOps, /include\.shipsgoTrackings = \{/);
  assert.match(domesticLogisticsOps, /includeShipsgoTrackings/);
  assert.match(domesticLogisticsOps, /serializeShipsgoTrackingSummary/);
  assert.match(domesticLogisticsOps, /rawPayload: true/);
  assert.match(domesticLogisticsOps, /rawResponse: true/);
  assert.match(trackingService, /rawFallback/);
  assert.doesNotMatch(logisticsModule, /rawPayload|rawResponse/);
  assert.match(logisticsModule, /shipsgoTrackings\?: ShipsgoTrackingRow\[\]/);
  assert.match(logisticsModule, /ShipsgoOrderTrackingPanel/);
  assert.match(logisticsModule, /\/api\/shipsgo\/ocean-trackings/);
});

test("ShipsGo create errors are shown inside the create panel", () => {
  const createFunction = logisticsModule.match(/async function createShipsgoTracking[\s\S]*?async function syncShipsgoTracking/)?.[0] || "";
  assert.match(createFunction, /throw createError instanceof Error \? createError : new Error\("创建大掌櫃跟踪失败"\)/);
  assert.doesNotMatch(createFunction, /setError\(createError/);
  assert.match(logisticsModule, /const \[createError, setCreateError\] = useState\(""\)/);
  assert.match(logisticsModule, /styles\.shipsgoCreateError/);
  assert.match(logisticsModule, /const message = error instanceof Error \? error\.message : "创建大掌櫃跟踪失败"/);
  assert.match(logisticsModule, /setCreateError\(message\)/);
  assert.match(logisticsModule, /setShowCarrierInput\(true\)/);
});

test("ShipsGo creation consumes one tracking per master bill only", () => {
  const payloadFunction = trackingService.match(/function createPayloadFromInput[\s\S]*?async function replaceShipsgoTrackingContainers/)?.[0] || "";
  const createService = trackingService.match(/export async function createShipsgoOceanTracking[\s\S]*?export async function syncShipsgoOceanTracking/)?.[0] || "";
  assert.match(payloadFunction, /masterBlNo/);
  assert.match(payloadFunction, /cleanBookingNumber\(order\.blNo\)/);
  assert.doesNotMatch(payloadFunction, /input\.masterBlNo/);
  assert.doesNotMatch(payloadFunction, /input\.bookingNumber/);
  assert.match(payloadFunction, /booking_number: masterBlNo/);
  assert.doesNotMatch(payloadFunction, /container_number:/);
  assert.match(createService, /findFirst\(\{\s*where: \{\s*orderId,\s*provider: SHIPSGO_PROVIDER,\s*mode: OCEAN_MODE,\s*deletedAt: null,/);
  assert.match(createService, /if \(existing\) \{/);
  assert.match(createService, /alreadyExists: true/);
  assert.match(createService, /replaceShipsgoTrackingContainers\(savedBase\.id, mapped\.containerNumbers\)/);
  assert.match(trackingService, /export async function findShipsgoOceanTrackingByContainerNo/);
  assert.match(trackingService, /export async function recoverShipsgoOceanTracking/);
  assert.match(trackingService, /findExistingShipsgoShipment/);
  assert.match(logisticsModule, /Master B\/L（提单号）/);
  assert.match(logisticsModule, /请先在物流信息中录入提单号后再开始追踪/);
  assert.doesNotMatch(logisticsModule, /placeholder="请输入 Master B\/L"/);
  assert.doesNotMatch(logisticsModule, /柜号 Container No\./);
  assert.match(logisticsModule, /开始追踪/);
  assert.match(logisticsModule, /查看运输状态/);
  assert.match(logisticsModule, /从大掌櫃同步已有跟踪/);
});

test("ShipsGo raw response port mapping reads nested loading and discharge locations", () => {
  assert.match(trackingService, /function extractShipsgoPort/);
  assert.match(trackingService, /recordByNormalizedKey\(route, keys\)/);
  assert.match(trackingService, /findPortInLocationArrays\(payload, direction\)/);
  assert.match(trackingService, /portName\(nestedLocation\)/);
  assert.match(trackingService, /portCode\(nestedLocation\)/);
  assert.match(trackingService, /originPortName: row\.originName \|\| rawFallback\?\.originName \|\| ""/);
  assert.match(trackingService, /destinationPortName: row\.destinationName \|\| rawFallback\?\.destinationName \|\| ""/);
  assert.match(logisticsModule, /tracking\.originPortName \|\| tracking\.originName/);
  assert.match(logisticsModule, /tracking\.destinationPortName \|\| tracking\.destinationName/);
});

test("ShipsGo ERP display localizes carrier ports status and tracking method in Chinese", () => {
  assert.equal(formatShipsgoCarrierForLocale("HAPAG LLOYD", "HLCU", "zh-CN"), "赫伯罗特（Hapag-Lloyd）");
  assert.equal(formatShipsgoCarrierForLocale("MAERSK", "MAEU", "zh-CN"), "马士基（Maersk）");
  assert.equal(formatShipsgoPortForLocale("SHANGHAI", "CNSHA", "zh-CN"), "上海（CNSHA）");
  assert.equal(formatShipsgoPortForLocale("AARHUS", "DKAAR", "zh-CN"), "奥胡斯（DKAAR）");
  assert.equal(formatShipsgoStatusForLocale("Sailing", "zh-CN"), "航行中");
  assert.equal(formatShipsgoStatusForLocale("In Transit", "zh-CN"), "运输途中");
  assert.equal(formatShipsgoTrackingMethodForLocale("Master B/L", "zh-CN"), "主提单跟踪");
  assert.match(logisticsModule, /formatShipsgoCarrierForLocale/);
  assert.match(logisticsModule, /formatShipsgoPortForLocale/);
  assert.match(logisticsModule, /formatShipsgoStatusForLocale/);
  assert.match(logisticsModule, /formatShipsgoTrackingMethodForLocale/);
});

test("ShipsGo customer notification display can target configured customer language", () => {
  assert.equal(normalizeShipsgoDisplayLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeShipsgoDisplayLocale("EN"), "en");
  assert.equal(normalizeShipsgoDisplayLocale("ru"), "ru");
  assert.equal(normalizeShipsgoDisplayLocale("de"), "de");
  assert.equal(normalizeShipsgoDisplayLocale("fr"), "fr");
  assert.equal(normalizeShipsgoDisplayLocale("es"), "es");
  assert.equal(normalizeShipsgoDisplayLocale(""), "en");
  assert.equal(formatShipsgoPortForLocale("SHANGHAI", "CNSHA", "en"), "Shanghai");
  assert.equal(formatShipsgoPortForLocale("SHANGHAI", "CNSHA", "ru"), "Шанхай");
  assert.equal(formatShipsgoStatusForLocale("Arrived", "de"), "Angekommen");
  assert.equal(formatShipsgoTrackingMethodForLocale("Container", "es"), "Seguimiento de contenedor");
});

test("ShipsGo ocean control tower is read-only and does not create tracking", () => {
  assert.match(trackingService, /export async function listShipsgoControlTowerTrackings/);
  assert.match(trackingService, /shipsgoShipmentId: \{ not: null \}/);
  const controlTowerService = shipsgoControlTowerService.match(/export async function listShipsgoControlTowerTrackings[\s\S]*$/)?.[0] || "";
  assert.match(controlTowerService, /canAccessDomesticLogisticsOrder\(actor, row\.order\)/);
  assert.doesNotMatch(controlTowerService, /供应商账号不可查看运输监控/);
  assert.match(trackingService, /trackingSignalExists\(row\)/);
  assert.match(trackingService, /includeCompleted/);
  assert.match(trackingService, /soonArrivingCount/);
  assert.match(trackingService, /etaOverdueCount/);
  assert.match(trackingService, /syncFailedCount/);
  assert.doesNotMatch(oceanTrackingControlTowerRoute, /createShipsgoOceanTracking|recoverShipsgoOceanTracking/);
});

test("domestic logistics exposes ocean control tower tab and fullscreen monitor UI", () => {
  assert.match(logisticsModule, /运输监控/);
  assert.doesNotMatch(logisticsModule, /集中监控已创建大掌櫃跟踪且尚未到港的在途海运业务/);
  assert.match(logisticsModule, /ShipsgoControlTowerView/);
  assert.match(logisticsModule, /initialFullScreen\?: boolean/);
  assert.match(logisticsModule, /useState\(initialFullScreen\)/);
  assert.match(logisticsModule, /\/api\/shipsgo\/ocean-trackings\/control-tower/);
  assert.match(logisticsModule, /全屏查看/);
  assert.match(logisticsModule, /退出全屏/);
  assert.match(logisticsModule, /setInterval\(\(\) => \{/);
  assert.match(logisticsModule, /同步最新状态/);
  assert.match(logisticsModule, /查看运输节点/);
  assert.match(logisticsModule, /跳转物流详情/);
  const controlTowerHead = logisticsModule.match(/<th className=\{styles\.orderNoColumn\}>订单号<\/th>[\s\S]*?<th>操作<\/th>/)?.[0] || "";
  assert.match(controlTowerHead, /提单号 \/ B\/L No\./);
  assert.match(controlTowerHead, /客户简称/);
  assert.ok(controlTowerHead.indexOf("订单号") < controlTowerHead.indexOf("提单号 / B/L No."));
  assert.ok(controlTowerHead.indexOf("提单号 / B/L No.") < controlTowerHead.indexOf("客户简称"));
  assert.match(logisticsModule, /row\.blNo \|\| row\.billOfLadingNo \|\| row\.masterBlNo \|\| "-"/);
  assert.match(trackingService, /blNo: row\.order\?\.blNo \|\| tracking\.masterBlNo \|\| tracking\.bookingNumber \|\| ""/);
  assert.match(trackingService, /billOfLadingNo: row\.order\?\.blNo \|\| tracking\.masterBlNo \|\| tracking\.bookingNumber \|\| ""/);
  assert.match(logisticsModule, /const canManageShipsgoTracking = \["管理员", "业务员"\]\.includes\(currentUser\.role\)/);
  assert.match(logisticsModule, /暂无已同步运输节点，请联系管理员或业务员同步最新状态。/);
  assert.doesNotMatch(logisticsModule.match(/function ShipsgoControlTowerView[\s\S]*?function ControlTowerStatCard/)?.[0] || "", /\/api\/shipsgo\/ocean-trackings",\s*\{/);
  assert.match(workspaceStyles, /\.controlTowerFullscreen/);
  assert.match(workspaceStyles, /\.controlTowerTooltip/);
});
