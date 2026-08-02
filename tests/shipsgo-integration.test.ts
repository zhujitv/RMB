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
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";
import {
  readDomesticLogisticsModuleSource,
  readDomesticLogisticsOpsSource,
  readFreightowerTrackingSource,
  readNotificationEngineSource,
  readSettingsModuleSource,
  readShipsgoTrackingSource,
  readTrackingMapSource,
  readWorkspaceStylesSource,
} from "./source-helpers.ts";

const integration = readFileSync("lib/platform/freightower-integration.ts", "utf8");
const trackingService = readShipsgoTrackingSource();
const freightowerService = readFreightowerTrackingSource();
const freightowerRequest = readFileSync("lib/platform/freightower-api.ts", "utf8");
const trackingTimeline = readFileSync("lib/platform/shipsgo-tracking-timeline.ts", "utf8");
const trackingSerializer = readFileSync("lib/platform/shipsgo-tracking-serializer.ts", "utf8");
const createService = readFileSync("lib/platform/shipsgo-tracking-create.ts", "utf8");
const syncService = readFileSync("lib/platform/shipsgo-tracking-sync-operation.ts", "utf8");
const recoveryService = readFileSync("lib/platform/shipsgo-tracking-recovery.ts", "utf8");
const scheduledService = readFileSync("lib/platform/shipsgo-tracking-scheduled-sync.ts", "utf8");
const webhookService = readFileSync("lib/platform/shipsgo-tracking-webhook.ts", "utf8");
const webhookPayload = readFileSync("lib/platform/freightower-webhook-payload.ts", "utf8");
const settingsRoute = readFileSync("app/api/settings/freightower/route.ts", "utf8");
const settingsTestRoute = readFileSync("app/api/settings/freightower/test/route.ts", "utf8");
const trackingRoute = readFileSync("app/api/freightower/ocean-trackings/route.ts", "utf8");
const detailRoute = readFileSync("app/api/freightower/ocean-trackings/[id]/route.ts", "utf8");
const syncRoute = readFileSync("app/api/freightower/ocean-trackings/[id]/sync/route.ts", "utf8");
const recoverRoute = readFileSync("app/api/freightower/ocean-trackings/recover/route.ts", "utf8");
const controlTowerRoute = readFileSync("app/api/freightower/ocean-trackings/control-tower/route.ts", "utf8");
const webhookRoute = readFileSync("app/api/freightower/webhook/route.ts", "utf8");
const cronRoute = readFileSync("app/api/cron/freightower-sync/route.ts", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");
const settingsModule = readSettingsModuleSource();
const logisticsModule = readDomesticLogisticsModuleSource();
const logisticsOps = readDomesticLogisticsOpsSource();
const trackingMap = readTrackingMapSource();
const schema = readPrismaSchemaSource();
const freightowerOnlyMigration = readFileSync("prisma/migrations/20260729160000_freightower_only_tracking/migration.sql", "utf8");
const notifications = readNotificationEngineSource();
const trackingNotifications = readFileSync("lib/platform/shipsgo-tracking-notifications.ts", "utf8");
const workspaceStyles = readWorkspaceStylesSource();

test("tracking settings force Freightower as the only provider and keep secrets private", () => {
  assert.match(integration, /activeProvider: "FREIGHTOWER" as const/);
  assert.match(integration, /freightowerEnabled: true/);
  assert.match(integration, /providerLabel: "飞驼可视"/);
  assert.match(integration, /FREIGHTOWER_SECRET_FIELDS/);
  assert.match(integration, /freightowerApiKeyConfigured: Boolean\(normalized\.freightowerApiKey\)/);
  assert.match(integration, /freightowerClientIdConfigured: Boolean\(normalized\.freightowerClientId\)/);
  assert.match(integration, /freightowerIframeKeyConfigured: Boolean\(normalized\.freightowerIframeKey\)/);
  assert.match(integration, /freightowerWebhookAccessSecretConfigured: Boolean\(normalized\.freightowerWebhookAccessSecret\)/);
  assert.match(integration, /freightowerApiKey: ""/);
  assert.match(integration, /freightowerClientId: ""/);
  assert.doesNotMatch(integration, /api\.shipsgo\.com|SHIPSGO_API_HOSTS/);
  assert.match(integration, /assertRead\(actor, "settings"\)/);
  assert.match(integration, /assertWrite\(actor, "settings"\)/);
  assert.match(integration, /prisma\.systemSetting\.upsert/);
  assert.match(integration, /const directApiKey = cleanSecret\(input\.freightowerApiKey/);
  assert.match(integration, /return legacyValue\.length >= 20 \? legacyValue : ""/);
  assert.match(integration, /input\.freightowerIframeKey \|\| input\.freightowerMapKey/);
});

test("Freightower settings API supports authenticated read and admin write", () => {
  assert.match(settingsRoute, /export async function GET/);
  assert.match(settingsRoute, /readShipsgoIntegrationSettings\(actor\)/);
  assert.match(settingsRoute, /export async function PATCH/);
  assert.match(settingsRoute, /saveShipsgoIntegrationSettings\(request, actor, body\)/);
  assert.match(settingsRoute, /飞驼可视设置已保存/);
});

test("all active tracking operations call Freightower and never call ShipsGo", () => {
  for (const source of [createService, syncService, recoveryService, scheduledService, webhookService]) {
    assert.doesNotMatch(source, /shipsgoApiRequest|X-Shipsgo-User-Token|api\.shipsgo\.com/);
  }
  assert.match(createService, /freightowerApiRequest<unknown>\(settings, "\/application\/v1\/query", payload\)/);
  assert.match(syncService, /createFreightowerPayloadFromTracking/);
  assert.match(recoveryService, /provider: FREIGHTOWER_PROVIDER/);
  assert.match(scheduledService, /provider: FREIGHTOWER_PROVIDER/);
  assert.match(webhookService, /verifyFreightowerWebhookSignature/);
  assert.doesNotMatch(webhookService, /X-Shipsgo|createHmac\("sha256"|SHIPSGO_PROVIDER/);
});

test("Freightower requests enforce bounded, non-cached outbound access", () => {
  assert.match(freightowerRequest, /createOutboundTimeoutSignal\(TRACKING_PROVIDER_TIMEOUT_MS/);
  assert.match(freightowerRequest, /readResponseTextLimited\(response, TRACKING_PROVIDER_RESPONSE_MAX_BYTES\)/);
  assert.match(freightowerRequest, /TRACKING_PROVIDER_RESPONSE_MAX_BYTES = 2 \* 1024 \* 1024/);
  assert.match(freightowerRequest, /cache: "no-store"/);
  assert.match(freightowerRequest, /redirect: "error"/);
  assert.doesNotMatch(freightowerRequest, /response\.text\(\)/);
  assert.match(freightowerRequest, /FREIGHTOWER_API_ERROR/);
  assert.doesNotMatch(freightowerRequest, /FREIGHTOWER_TOKEN_FAILED/);
});

test("Freightower requests use the API key directly as Bearer authorization", () => {
  assert.match(freightowerRequest, /const requestPath = path/);
  assert.match(freightowerRequest, /Authorization: `Bearer \$\{settings\.freightowerApiKey\}`/);
  assert.match(freightowerRequest, /if \(!settings\.freightowerApiKey\)/);
  assert.match(freightowerRequest, /\["20000", "20001", "40000", "40020"\]\.includes\(statusCode\)/);
  assert.doesNotMatch(freightowerRequest, /\/auth\/api\/token|access_token|refresh_token|freightowerSecret|tokenCache/);
  assert.match(freightowerRequest, /numericTimestamp >= 1_000_000_000_000/);
  assert.doesNotMatch(freightowerRequest, /FREIGHTOWER_EXCHANGE_PREFIX|X-Auth-|aes-256-cbc|createDecipheriv/);
  assert.doesNotMatch(settingsModule, /App ID|App Secret|Data Secret|接口签名凭据|接口认证模式/);
});

test("Freightower errors explain authorization failures and subscription state", () => {
  assert.match(freightowerService, /statusCode === "40300"/);
  assert.match(freightowerService, /服务器出口 IP 白名单/);
  assert.match(freightowerService, /API Key 的接口授权/);
  assert.match(freightowerService, /集装箱综合跟踪查询权限/);
  assert.match(freightowerService, /statusCode === "20000" \|\| statusCode === "20001"/);
  assert.match(freightowerService, /飞驼暂未返回运输数据，系统将继续自动查询/);
  assert.match(freightowerService, /syncStatus: isSubscribedOnly \? "SUBSCRIBED" : "SYNCED"/);
  assert.match(freightowerService, /status: isSubscribedOnly \? "SUBSCRIBED"/);
  assert.match(freightowerService, /lastEvent: isSubscribedOnly \? ""/);
  assert.match(freightowerService, /trackingUpdateFromFreightowerMappedShipment/);
  assert.match(freightowerService, /subscriptionParamFromFreightowerPayload/);
  assert.match(freightowerService, /safeFreightowerIframeUrl\(result\.iframeUrl\) \|\| freightowerMapUrl\(settings, subscriptionParam\)/);
  assert.match(freightowerService, /url\.hostname === "i\.saas\.freightower\.com"/);
});

test("Freightower timeline reads provider vessel fields and inherits shipment context", () => {
  assert.match(trackingTimeline, /textAt\(event, "vslName"\)/);
  assert.match(trackingTimeline, /textAt\(event, "voy"\)/);
  assert.doesNotMatch(trackingTimeline, /"movements",\s*"places"/);
  assert.match(trackingSerializer, /vesselName: event\.vesselName \|\| row\.vesselName \|\| ""/);
  assert.match(trackingSerializer, /voyage: event\.voyage \|\| row\.voyage \|\| ""/);
});

test("Freightower dumping warnings are normalized, prioritized, and shown in tracking views", () => {
  assert.match(freightowerService, /code === "WDUMP"/);
  assert.match(freightowerService, /code === "DUMP"/);
  assert.match(freightowerService, /category === "DUMPING"/);
  assert.match(freightowerService, /arrayAt\(container, "warnings"\)/);
  assert.match(freightowerService, /arrayAt\(item, "warnings"\)\.length > 0/);
  assert.match(trackingSerializer, /hasDumpingWarning: dumpingAlerts\.length > 0/);
  assert.match(freightowerService, /alert\.isDumping && alert\.active/);
  assert.match(freightowerService, /DUMPING_RESOLUTION_CODES/);
  assert.match(trackingTimeline, /isDumpingWarning/);
  assert.match(logisticsModule, /FreightowerDumpingAlertBanner/);
  assert.match(logisticsModule, /甩柜预警/);
  assert.match(workspaceStyles, /shipsgoAlertBanner/);
  assert.match(workspaceStyles, /controlTowerNodeAlert/);
});

test("Freightower tracking changes notify enabled admins and the order salesperson", () => {
  assert.match(webhookService, /verifyFreightowerWebhookSignature/);
  assert.match(webhookService, /claimWebhookReplay\("freightower"/);
  assert.match(webhookService, /completeWebhookReplayClaim\(replay\.key, "freightower"\)/);
  assert.match(webhookService, /notifyFreightowerTrackingUpdate/);
  assert.match(webhookService, /createFreightowerPayloadFromTracking\(target, settings\)/);
  assert.match(webhookService, /mergeFreightowerWebhookPayload\(fullResponse, payload\)/);
  assert.match(webhookService, /signatureVerified && envelope\.hasIncrementalResult/);
  assert.match(webhookPayload, /"UPDATE_NOTICE" \| "INCREMENTAL_WARNING"/);
  assert.match(webhookService, /shipsgoTracking\.findMany/);
  assert.match(webhookService, /prisma\.\$transaction\(async \(tx\)/);
  assert.doesNotMatch(webhookService, /shipsgoTracking\.findFirst/);
  assert.match(trackingNotifications, /latestFreightowerDumpingAlert/);
  assert.match(trackingNotifications, /dumpingWarning: dumpingAlertText/);
  assert.match(trackingNotifications, /dumpingAlertEventKey\(dumpingAlert\)/);
  assert.match(trackingNotifications, /activeApprovedEmails\(\[tracking\.order\.salesperson\]\)/);
  assert.match(trackingNotifications, /const adminEmails = await enabledAdminEmails\(\)/);
  assert.match(trackingNotifications, /uniqueEmails\(\[adminEmails, salespersonEmails\]\)/);
  assert.match(trackingNotifications, /recipientSource: "admins_and_order_salesperson"/);
  assert.doesNotMatch(trackingNotifications, /contactEmail: true|shippingDocsEmails: true|customerEmails/);
  assert.doesNotMatch(trackingNotifications, /tracking\.order\.createdBy|tracking\.order\.updatedBy|tracking\.createdBy|tracking\.updatedBy/);
  assert.match(syncService, /hasFreightowerTrackingNotificationChange\(before, savedBase\)/);
  assert.match(syncService, /notifyFreightowerTrackingUpdate\(saved\.id\)/);
  assert.match(scheduledService, /hasFreightowerTrackingNotificationChange\(row, savedBase\)/);
  assert.match(scheduledService, /notifyFreightowerTrackingUpdate\(savedBase\.id\)/);
  assert.match(notifications, /FREIGHTOWER_TRACKING_UPDATE: "FREIGHTOWER_TRACKING_UPDATE"/);
  assert.match(notifications, /name: "飞驼可视运输节点通知"/);
  assert.match(notifications, /subjectTemplate: "\[NEXTWOOD ERP\] Shipment Tracking Update/);
  assert.match(notifications, /Shipment tracking for Order \{orderNo\} has changed/);
  assert.match(notifications, /订单 \{orderNo\} 的物流跟踪信息发生变化/);
  assert.match(notifications, /如当前状态包含“甩柜预警”/);
  assert.match(settingsModule, /物流变化触发与收件人/);
  assert.match(settingsModule, /所有已启用且已审批的管理员，以及该订单的业务员/);
});

test("settings UI focuses on the basic Freightower web workflow", () => {
  assert.match(settingsModule, /\/api\/settings\/freightower/);
  assert.match(settingsModule, /\/api\/settings\/freightower\/test/);
  assert.match(settingsModule, /API Key 直连认证/);
  assert.match(settingsModule, /label="API Key"/);
  assert.match(settingsModule, /Client ID/);
  assert.match(settingsModule, /Iframe Key/);
  assert.match(settingsModule, /跟踪更新与甩柜预警/);
  assert.match(settingsModule, /Webhook Access Secret/);
  assert.match(settingsModule, /https:\/\/www\.nextwood\.net\/api\/freightower\/webhook/);
  assert.match(settingsModule, /未填写时，推送只会触发 API Key 安全回查/);
  assert.doesNotMatch(integration, /FREIGHTOWER_WEBHOOK_SECRET_REQUIRED/);
  assert.match(settingsModule, /测试 API 连接/);
  assert.match(settingsModule, /SHIPSGO_FEATURE_OPTIONS/);
  assert.doesNotMatch(settingsModule, /label="Secret"|\/auth\/api\/token/);
  assert.doesNotMatch(settingsModule, /客户自动推送|每日自动同步|空运货物跟踪/);
  assert.doesNotMatch(settingsModule, /title="ShipsGo 接口"|启用 ShipsGo|当前使用接口|TRACKING_PROVIDER_OPTIONS/);
});

test("Freightower connection test validates a stored or unsaved API key without exposing it", () => {
  assert.match(settingsTestRoute, /export async function POST/);
  assert.match(settingsTestRoute, /requireApiActor\(request\)/);
  assert.match(settingsTestRoute, /testShipsgoIntegrationConnection\(actor, body\)/);
  assert.match(integration, /testFreightowerConnection\(candidate\)/);
  assert.match(freightowerRequest, /message: "连接成功，飞驼 API Key 直连认证正常。"/);
  assert.doesNotMatch(settingsTestRoute, /apiKey|Authorization|Bearer/);
});

test("Freightower routes cover create, read, delete, sync, recovery, webhook, and cron", () => {
  assert.match(trackingRoute, /createShipsgoOceanTracking\(request, actor, body\)/);
  assert.match(detailRoute, /getShipsgoOceanTracking\(actor, id\)/);
  assert.match(detailRoute, /deleteShipsgoOceanTracking\(request, actor, id\)/);
  assert.match(syncRoute, /syncShipsgoOceanTracking\(request, actor, id\)/);
  assert.match(recoverRoute, /recoverShipsgoOceanTracking\(request, actor, body\)/);
  assert.match(controlTowerRoute, /listShipsgoControlTowerTrackings/);
  assert.match(webhookRoute, /WEBHOOK_BODY_MAX_BYTES = 1024 \* 1024/);
  assert.match(webhookRoute, /readWebhookBody\(request\)/);
  assert.match(webhookRoute, /handleShipsgoWebhook\(rawBody, null, request\.headers\)/);
  assert.match(cronRoute, /syncDueShipsgoOceanTrackings\(request, actor\)/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/freightower-sync"/);
  assert.match(vercelConfig, /"schedule": "\*\/30 \* \* \* \*"/);
  assert.match(scheduledService, /if \(!settings\.autoSyncEnabled\)/);
  assert.match(scheduledService, /syncStatus: "SUBSCRIBED", lastSyncTime: \{ lt: subscribedCutoff \}/);
  assert.match(scheduledService, /trackingUpdateFromFreightowerMappedShipment/);
  assert.match(integration, /autoSyncEnabled: true/);
});

test("domestic logistics and map clients use Freightower endpoints and labels", () => {
  assert.match(logisticsModule, /\/api\/freightower\/ocean-trackings/);
  assert.match(logisticsModule, /const activeProviderLabel = "飞驼可视"/);
  assert.match(logisticsModule, /提单号 \/ 柜号/);
  assert.match(logisticsModule, /请先在物流信息中录入提单号或柜号后再开始追踪/);
  assert.doesNotMatch(logisticsModule, /\/api\/shipsgo\/ocean-trackings/);
  assert.match(trackingMap, /\/api\/freightower\/ocean-trackings\/\$\{encodeURIComponent\(trackingId\)\}/);
  assert.doesNotMatch(trackingMap, /\/api\/shipsgo\/ocean-trackings/);
  assert.match(trackingMap, /打开\{providerName\}原始地图/);
});

test("retired ShipsGo data is deleted and the existing tracking table defaults to Freightower", () => {
  assert.match(schema, /model ShipsgoTracking/);
  assert.match(schema, /model ShipsgoTrackingContainer/);
  assert.match(schema, /@@map\("shipsgo_trackings"\)/);
  assert.match(schema, /provider\s+String\s+@default\("FREIGHTOWER"\)/);
  assert.match(freightowerOnlyMigration, /DELETE FROM "shipsgo_trackings"/);
  assert.match(freightowerOnlyMigration, /"provider" IS DISTINCT FROM 'FREIGHTOWER'/);
  assert.match(freightowerOnlyMigration, /ALTER COLUMN "provider" SET DEFAULT 'FREIGHTOWER'/);
  assert.match(freightowerOnlyMigration, /- 'apiKey'/);
  assert.match(freightowerOnlyMigration, /- 'webhookSecret'/);
  assert.match(createService, /provider: FREIGHTOWER_PROVIDER/);
  assert.doesNotMatch(createService, /provider: SHIPSGO_PROVIDER/);
  assert.match(logisticsOps, /serializeShipsgoTrackingSummary/);
  assert.doesNotMatch(logisticsModule, /rawPayload|rawResponse/);
});

test("Freightower tracking mutations remain role-scoped", () => {
  assert.match(trackingService, /function assertShipsgoTrackingWriteAccess/);
  assert.match(trackingService, /role === "管理员"/);
  assert.match(trackingService, /role === "业务员" && orderBelongsToSalesperson/);
  assert.match(trackingService, /FREIGHTOWER_TRACKING_WRITE_FORBIDDEN/);
  assert.match(trackingService, /FREIGHTOWER_TRACKING_DELETE_ADMIN_ONLY/);
  assert.match(createService, /assertShipsgoTrackingWriteAccess\(actor, order\)/);
  assert.match(syncService, /assertFreightowerOceanEnabled\(settings\)/);
  assert.match(recoveryService, /assertShipsgoTrackingWriteAccess\(actor, order\)/);
});

test("Freightower creation is idempotent per order and provider", () => {
  assert.match(createService, /provider: FREIGHTOWER_PROVIDER,\s*mode: OCEAN_MODE,\s*deletedAt: null/);
  assert.match(createService, /if \(existing\)/);
  assert.match(createService, /alreadyExists: true/);
  assert.match(createService, /createFreightowerPayloadFromInput/);
  assert.match(createService, /replaceShipsgoTrackingContainers\(savedBase\.id, mapped\.containerNumbers\)/);
  assert.match(logisticsModule, /开始追踪/);
  assert.match(logisticsModule, /从\$\{activeProviderLabel\}同步已有跟踪/);
});

test("Freightower control tower remains read-only and permission scoped", () => {
  assert.match(trackingService, /export async function listShipsgoControlTowerTrackings/);
  assert.match(trackingService, /while \(page\.length === 300\)/);
  assert.match(trackingService, /cursor: \{ id: afterId \}, skip: 1/);
  assert.doesNotMatch(controlTowerRoute, /createShipsgoOceanTracking|recoverShipsgoOceanTracking/);
  assert.match(logisticsModule, /\/api\/freightower\/ocean-trackings\/control-tower/);
  assert.match(logisticsModule, /全屏查看/);
  assert.match(logisticsModule, /退出全屏/);
  assert.match(logisticsModule, /同步最新状态/);
  assert.match(logisticsModule, /查看运输节点/);
  assert.match(workspaceStyles, /\.controlTowerFullscreen/);
});

test("tracking display keeps localized carrier, port, status, and method labels", () => {
  assert.equal(formatShipsgoCarrierForLocale("HAPAG LLOYD", "HLCU", "zh-CN"), "赫伯罗特（Hapag-Lloyd）");
  assert.equal(formatShipsgoCarrierForLocale("MAERSK", "MAEU", "zh-CN"), "马士基（Maersk）");
  assert.equal(formatShipsgoPortForLocale("SHANGHAI", "CNSHA", "zh-CN"), "上海（CNSHA）");
  assert.equal(formatShipsgoStatusForLocale("In Transit", "zh-CN"), "运输途中");
  assert.equal(formatShipsgoStatusForLocale("SUBSCRIBED", "zh-CN"), "已订阅，等待节点");
  assert.equal(formatShipsgoTrackingMethodForLocale("Master B/L", "zh-CN"), "主提单跟踪");
});

test("tracking notification display supports configured customer languages", () => {
  assert.equal(normalizeShipsgoDisplayLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeShipsgoDisplayLocale("EN"), "en");
  assert.equal(normalizeShipsgoDisplayLocale("ru"), "ru");
  assert.equal(normalizeShipsgoDisplayLocale(""), "en");
  assert.equal(formatShipsgoPortForLocale("SHANGHAI", "CNSHA", "ru"), "Шанхай");
  assert.equal(formatShipsgoStatusForLocale("Arrived", "de"), "Angekommen");
});
