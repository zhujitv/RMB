import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
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

const jiti = createJiti(import.meta.url);
const { normalizeShipsgoIntegrationSettings } = await jiti.import<
  typeof import("../lib/platform/freightower-integration-normalize.ts")
>("../lib/platform/freightower-integration-normalize.ts");

const integration = [
  readFileSync("lib/platform/freightower-integration.ts", "utf8"),
  readFileSync("lib/platform/freightower-integration-normalize.ts", "utf8"),
].join("\n");
const trackingService = readShipsgoTrackingSource();
const freightowerService = readFreightowerTrackingSource();
const freightowerRequest = readFileSync("lib/platform/freightower-api.ts", "utf8");
const freightowerCustoms = readFileSync("lib/platform/freightower-customs-tracking.ts", "utf8");
const trackingTimeline = readFileSync("lib/platform/shipsgo-tracking-timeline.ts", "utf8");
const trackingSerializer = readFileSync("lib/platform/shipsgo-tracking-serializer.ts", "utf8");
const createService = readFileSync("lib/platform/shipsgo-tracking-create.ts", "utf8");
const syncService = readFileSync("lib/platform/shipsgo-tracking-sync-operation.ts", "utf8");
const recoveryService = readFileSync("lib/platform/shipsgo-tracking-recovery.ts", "utf8");
const trackingServiceShared = readFileSync("lib/platform/shipsgo-tracking-service-shared.ts", "utf8");
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
const cronConfig = readFileSync("config/tencent-cloud-cron.json", "utf8");
const settingsModule = readSettingsModuleSource();
const logisticsModule = readDomesticLogisticsModuleSource();
const logisticsOps = readDomesticLogisticsOpsSource();
const trackingMap = readTrackingMapSource();
const schema = readPrismaSchemaSource();
const freightowerOnlyMigration = readFileSync("prisma/migrations/20260729160000_freightower_only_tracking/migration.sql", "utf8");
const notifications = readNotificationEngineSource();
const trackingNotifications = readFileSync("lib/platform/shipsgo-tracking-notifications.ts", "utf8");
const trackingEmailNotification = readFileSync("lib/platform/freightower-tracking-email-notification.ts", "utf8");
const trackingEmailAudience = readFileSync("lib/platform/freightower-notification-audience.ts", "utf8");
const freightowerNotificationEvents = readFileSync("lib/platform/freightower-notification-events.ts", "utf8");
const freightowerPendingNotifications = readFileSync("lib/platform/freightower-notification-pending.ts", "utf8");
const freightowerSyncLease = readFileSync("lib/platform/shipsgo-tracking-sync-lease.ts", "utf8");
const freightowerSyncLeaseMigration = readFileSync("prisma/migrations/20260810130000_freightower_sync_lease/migration.sql", "utf8");
const notificationOutboxRoute = readFileSync("app/api/cron/notification-outbox/route.ts", "utf8");
const freightowerNotificationRetry = readFileSync("lib/platform/notification-freightower-retry.ts", "utf8");
const workspaceStyles = readWorkspaceStylesSource();

test("tracking settings force Freightower as the only provider and keep secrets private", () => {
  assert.match(integration, /activeProvider: "FREIGHTOWER" as const/);
  assert.match(integration, /freightowerEnabled: true/);
  assert.match(integration, /providerLabel: "飞驼可视"/);
  assert.match(integration, /FREIGHTOWER_SECRET_FIELDS/);
  assert.match(integration, /freightowerApiKeyConfigured: Boolean\(normalized\.freightowerApiKey\)/);
  assert.match(integration, /freightowerClientIdConfigured: Boolean\(normalized\.freightowerClientId\)/);
  assert.match(integration, /freightowerApiSecretConfigured: Boolean\(normalized\.freightowerApiSecret\)/);
  assert.match(integration, /freightowerIframeKeyConfigured: Boolean\(normalized\.freightowerIframeKey\)/);
  assert.match(integration, /freightowerWebhookAccessSecretConfigured: Boolean\(normalized\.freightowerWebhookAccessSecret\)/);
  assert.match(integration, /freightowerApiKey: ""/);
  assert.match(integration, /freightowerClientId: ""/);
  assert.match(integration, /freightowerApiSecret: ""/);
  assert.doesNotMatch(integration, /api\.shipsgo\.com|SHIPSGO_API_HOSTS/);
  assert.match(integration, /assertRead\(actor, "settings"\)/);
  assert.match(integration, /assertWrite\(actor, "settings"\)/);
  assert.match(integration, /prisma\.systemSetting\.upsert/);
  assert.match(integration, /const directApiKey = cleanFreightowerSecret\(input\.freightowerApiKey/);
  assert.match(integration, /return legacyValue\.length >= 20 \? legacyValue : ""/);
  assert.match(integration, /input\.freightowerIframeKey \|\| input\.freightowerMapKey/);
  assert.equal(normalizeShipsgoIntegrationSettings({}).customsTrackingEnabled, true);
  assert.equal(normalizeShipsgoIntegrationSettings({ customsTrackingEnabled: false }).customsTrackingEnabled, false);
  assert.equal(normalizeShipsgoIntegrationSettings({}).freightowerDefaultIsExport, "E");
  assert.equal(normalizeShipsgoIntegrationSettings({ freightowerDefaultIsExport: "I" }).freightowerDefaultIsExport, "E");
  assert.equal(normalizeShipsgoIntegrationSettings({}).freightowerDefaultPortCode, "CNSHA");
  assert.equal(normalizeShipsgoIntegrationSettings({ freightowerDefaultPortCode: "CNNGB" }).freightowerDefaultPortCode, "CNNGB");
  assert.doesNotMatch(integration, /customsTrackingEnabled && \(!value\.freightowerClientId \|\| !value\.freightowerApiSecret\)/);
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

test("Freightower uses one direct API-key authorization path for comprehensive and customs tracking", () => {
  assert.match(freightowerRequest, /const requestPath = path/);
  assert.match(freightowerRequest, /options\.bearer \|\| \(options\.anonymous \? "" : settings\.freightowerApiKey\)/);
  assert.match(freightowerRequest, /Authorization: `Bearer \$\{bearer\}`/);
  assert.match(freightowerRequest, /\["20000", "20001", "40000", "40020"\]\.includes\(statusCode\)/);
  assert.match(freightowerCustoms, /freightowerApiGet<unknown>/);
  assert.doesNotMatch(freightowerCustoms, /freightowerTokenApiGet|freightowerClientId|freightowerApiSecret/);
  assert.match(freightowerRequest, /FREIGHTOWER_REQUEST_INTERVAL_MS = 175/);
  assert.match(freightowerRequest, /numericTimestamp >= 1_000_000_000_000/);
  assert.doesNotMatch(freightowerRequest, /FREIGHTOWER_EXCHANGE_PREFIX|X-Auth-|aes-256-cbc|createDecipheriv/);
  assert.doesNotMatch(settingsModule, /App ID|App Secret|Data Secret|接口签名凭据|接口认证模式/);
});

test("Freightower errors explain authorization failures and subscription state", () => {
  assert.match(freightowerService, /statusCode === "40300"/);
  assert.match(freightowerService, /服务器出口 IP 白名单/);
  assert.match(freightowerService, /credentialLabel.*API Key/);
  assert.match(freightowerService, /接口授权/);
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

test("Freightower tracking changes split internal Chinese and customer English emails", () => {
  assert.match(webhookService, /verifyFreightowerWebhookSignature/);
  assert.match(webhookService, /claimWebhookReplay\("freightower"/);
  assert.match(webhookService, /completeWebhookReplayClaim\(replay\.key, "freightower"\)/);
  assert.match(webhookService, /reconcileFreightowerTrackingNotification/);
  assert.match(webhookService, /createFreightowerPayloadFromTracking\(target, settings\)/);
  assert.match(webhookService, /mergeFreightowerWebhookPayload\(fullResponse, payload\)/);
  assert.match(webhookService, /signatureVerified && envelope\.hasIncrementalResult/);
  assert.match(webhookPayload, /"UPDATE_NOTICE" \| "INCREMENTAL_WARNING"/);
  assert.match(webhookService, /shipsgoTracking\.findMany/);
  assert.match(webhookService, /prisma\.\$transaction\(async \(tx\)/);
  assert.doesNotMatch(webhookService, /shipsgoTracking\.findFirst/);
  assert.match(trackingNotifications, /latestFreightowerDumpingAlert/);
  assert.match(trackingNotifications, /dumpingWarning: currentDumpingAlertText/);
  assert.match(freightowerNotificationEvents, /dumpingAlertEventKey\(dumpingAlert\)/);
  assert.match(trackingNotifications, /activeApprovedEmails\(\[tracking\.order\.salesperson\]\)/);
  assert.match(trackingNotifications, /const adminEmails = await enabledAdminEmails\(\)/);
  assert.match(trackingNotifications, /const internalRecipientEmails = uniqueEmails\(\[adminEmails, salespersonEmails\]\)/);
  assert.match(trackingNotifications, /contactEmail: true/);
  assert.match(trackingNotifications, /customerRecipientEmails/);
  assert.match(trackingNotifications, /recipientSource: "admins_and_order_salesperson"/);
  assert.match(trackingNotifications, /recipientSource: "customer_contact_email"/);
  assert.match(trackingNotifications, /FREIGHTOWER_TRACKING_CUSTOMER_UPDATE/);
  assert.match(trackingNotifications, /portRolloverChanged/);
  assert.match(trackingNotifications, /portOperationChanged/);
  assert.match(trackingNotifications, /freightowerPortOperationNotification/);
  assert.match(trackingNotifications, /customsChanged/);
  assert.match(trackingNotifications, /emailAudience\.customerAllowed \? customerRecipientEmails : \[\]/);
  assert.match(trackingEmailAudience, /FREIGHTOWER_PORT_ROLLOVER_ALERT/);
  assert.match(trackingEmailAudience, /FREIGHTOWER_PORT_OPERATION_ALERT/);
  assert.match(trackingEmailAudience, /FREIGHTOWER_CUSTOMS_ALERT/);
  assert.match(trackingEmailNotification, /`freightower-tracking-update:\$\{input\.trackingEventKey\}:\$\{input\.audience\}`/);
  assert.match(trackingNotifications, /"internal"/);
  assert.match(trackingNotifications, /"customer"/);
  assert.match(trackingEmailNotification, /ignoreTemplateCc: input\.audience === "customer"/);
  assert.doesNotMatch(trackingNotifications, /tracking\.order\.createdBy|tracking\.order\.updatedBy|tracking\.createdBy|tracking\.updatedBy/);
  assert.match(syncService, /hasFreightowerTrackingNotificationChange\(before, saved\)/);
  assert.match(syncService, /markFreightowerNotificationPending/);
  assert.match(syncService, /reconcileFreightowerTrackingNotification/);
  assert.match(scheduledService, /hasFreightowerTrackingNotificationChange\(currentRow, saved\)/);
  assert.match(scheduledService, /markFreightowerNotificationPending/);
  assert.match(scheduledService, /reconcileFreightowerTrackingNotification/);
  assert.match(webhookService, /markFreightowerNotificationPending/);
  assert.match(freightowerPendingNotifications, /changeSource: changeEvents\[0\]\?\.source \|\| "comprehensive"/);
  assert.match(freightowerPendingNotifications, /trackingEventKey/);
  assert.match(freightowerPendingNotifications, /trackingNotificationPendingMask/);
  assert.match(freightowerPendingNotifications, /trackingNotificationQueuedKey/);
  assert.match(trackingNotifications, /options\.trackingEventKey \|\| freightowerTrackingNotificationEventKey\(tracking\)/);
  assert.match(trackingNotifications, /freightowerNotificationSourceEvent/);
  assert.match(freightowerNotificationEvents, /extractFreightowerCustomsTimeline/);
  assert.match(notifications, /FREIGHTOWER_TRACKING_UPDATE: "FREIGHTOWER_TRACKING_UPDATE"/);
  assert.match(notifications, /FREIGHTOWER_TRACKING_CUSTOMER_UPDATE: "FREIGHTOWER_TRACKING_CUSTOMER_UPDATE"/);
  assert.match(notifications, /name: "物流跟踪通知（内部中文）"/);
  assert.match(notifications, /subjectTemplate: "【物流跟踪更新】/);
  assert.match(notifications, /订单 \{orderNo\} 的物流跟踪信息发生变化/);
  assert.match(notifications, /name: "Shipment Tracking Update \(Customer English\)"/);
  assert.match(notifications, /subjectTemplate: "Shipment Tracking Update \| Order/);
  assert.match(settingsModule, /内部中文物流通知/);
  assert.match(settingsModule, /客户英文物流通知/);
  assert.match(settingsModule, /所有已启用且已审批的管理员，以及该订单的业务员/);
  assert.match(settingsModule, /客户资料中绑定的主联系邮箱/);
});

test("Freightower manual, scheduled, and webhook syncs share one database lease", () => {
  assert.match(schema, /syncLeaseToken/);
  assert.match(schema, /syncLeaseExpiresAt/);
  assert.match(freightowerSyncLeaseMigration, /sync_lease_token/);
  assert.match(freightowerSyncLeaseMigration, /sync_lease_expires_at/);
  assert.match(freightowerSyncLease, /UPDATE "shipsgo_trackings"/);
  assert.match(freightowerSyncLease, /"sync_lease_expires_at" <= \$\{now\}/);
  assert.match(syncService, /claimFreightowerTrackingSyncLease/);
  assert.match(syncService, /releaseFreightowerTrackingSyncLease/);
  assert.match(scheduledService, /claimFreightowerTrackingSyncLease/);
  assert.match(scheduledService, /releaseFreightowerTrackingSyncLease/);
  assert.match(webhookService, /claimFreightowerTrackingSyncLease/);
  assert.match(webhookService, /releaseFreightowerTrackingSyncLease/);
});

test("Freightower tracking notifications persist a durable pending watermark and recover stale sends", () => {
  for (const field of [
    "trackingNotificationPendingAt",
    "trackingNotificationPendingMask",
    "trackingNotificationQueuedKey",
  ]) assert.match(schema, new RegExp(field));
  assert.match(freightowerSyncLeaseMigration, /tracking_notification_pending_at/);
  assert.match(freightowerSyncLeaseMigration, /tracking_notification_pending_mask/);
  assert.match(freightowerSyncLeaseMigration, /tracking_notification_queued_key/);
  assert.match(freightowerPendingNotifications, /tracking_notification_pending_mask" \|/);
  assert.match(freightowerPendingNotifications, /trackingNotificationPendingMask: pendingMask/);
  assert.match(freightowerPendingNotifications, /syncLeaseToken: ownedLeaseToken/);
  assert.match(freightowerPendingNotifications, /syncLeaseExpiresAt: \{ gt: new Date\(\) \}/);
  assert.match(freightowerPendingNotifications, /skipped: "error"/);
  assert.match(notificationOutboxRoute, /await processPendingFreightowerTrackingNotifications/);
  assert.match(notificationOutboxRoute, /物流待通知队列读取失败/);
  assert.match(freightowerNotificationRetry, /status: "pending", updatedAt: \{ lte: staleAt \}/);
  assert.match(freightowerNotificationRetry, /status: "sending", updatedAt: \{ lte: staleAt \}/);
});

test("settings UI focuses on the basic Freightower web workflow", () => {
  assert.match(settingsModule, /\/api\/settings\/freightower/);
  assert.match(settingsModule, /\/api\/settings\/freightower\/test/);
  assert.match(settingsModule, /API Key 直连认证/);
  assert.match(settingsModule, /label="API Key"/);
  assert.match(settingsModule, /Client ID/);
  assert.match(settingsModule, /Iframe Key/);
  assert.doesNotMatch(settingsModule, /label="API Secret"|中国海关 Token 认证/);
  assert.match(settingsModule, /跟踪更新与甩柜预警/);
  assert.match(settingsModule, /Webhook Access Secret/);
  assert.match(settingsModule, /freightowerWebhookCallbackUrl/);
  assert.match(settingsModule, /onChange\("freightowerWebhookCallbackUrl"/);
  assert.match(settingsModule, /https:\/\/www\.nextwood\.net\/api\/freightower\/webhook/);
  assert.doesNotMatch(settingsModule, /value="https:\/\/www\.nextwood\.net\/api\/freightower\/webhook" readOnly/);
  assert.match(settingsModule, /未填写时，推送只会触发 API Key 安全回查/);
  assert.doesNotMatch(integration, /FREIGHTOWER_WEBHOOK_SECRET_REQUIRED/);
  assert.match(settingsModule, /测试 API 连接/);
  assert.match(settingsModule, /SHIPSGO_FEATURE_OPTIONS/);
  assert.doesNotMatch(settingsModule, /label="Secret"|\/auth\/api\/token/);
  assert.doesNotMatch(settingsModule, /客户自动推送|每日自动同步|空运货物跟踪/);
  assert.doesNotMatch(settingsModule, /title="ShipsGo 接口"|启用 ShipsGo|当前使用接口|TRACKING_PROVIDER_OPTIONS/);
});

test("Freightower webhook callback URL is editable and restricted to the public HTTPS route", () => {
  const defaults = normalizeShipsgoIntegrationSettings({});
  assert.equal(defaults.freightowerWebhookCallbackUrl, "https://www.nextwood.net/api/freightower/webhook");

  const custom = normalizeShipsgoIntegrationSettings({
    freightowerWebhookCallbackUrl: "https://TRACKING.EXAMPLE.COM./api/freightower/webhook/",
  });
  assert.equal(custom.freightowerWebhookCallbackUrl, "https://tracking.example.com/api/freightower/webhook");

  for (const invalidUrl of [
    "",
    "http://www.ruscny.com/api/freightower/webhook",
    "/api/freightower/webhook",
    "https://localhost/api/freightower/webhook",
    "https://127.0.0.1/api/freightower/webhook",
    "https://user:password@www.ruscny.com/api/freightower/webhook",
    "https://www.ruscny.com:8443/api/freightower/webhook",
    "https://www.ruscny.com/another/path",
    "https://www.ruscny.com/api/freightower/webhook?secret=value",
    "https://www.ruscny.com/api/freightower/webhook#fragment",
    `https://www.ruscny.com/api/freightower/webhook/${"x".repeat(2048)}`,
  ]) {
    assert.throws(() => normalizeShipsgoIntegrationSettings({ freightowerWebhookCallbackUrl: invalidUrl }));
  }
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
  assert.match(cronConfig, /"path": "\/api\/cron\/freightower-sync"/);
  assert.match(cronConfig, /"schedule": "\*\/30 \* \* \* \*"/);
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
  assert.match(createService, /lockShipsgoTrackingCreation/);
  assert.match(recoveryService, /lockShipsgoTrackingCreation/);
  assert.match(trackingServiceShared, /pg_advisory_xact_lock/);
  assert.match(trackingServiceShared, /pg_advisory_xact_lock[\s\S]*::text AS "locked"/);
  assert.match(freightowerSyncLeaseMigration, /shipsgo_trackings_provider_shipment_unique/);
  assert.match(freightowerSyncLeaseMigration, /"deleted_at" IS NULL/);
  assert.match(createService, /replaceShipsgoTrackingContainers\(savedBase\.id, containerNumbers\)/);
  assert.match(logisticsModule, /开始追踪/);
  assert.match(logisticsModule, /从\$\{activeProviderLabel\}同步已有跟踪/);
});

test("tracking creation keeps port and customs active when comprehensive ocean tracking fails", () => {
  assert.match(createService, /let comprehensiveError: unknown = null/);
  assert.match(createService, /status: "SUPPLEMENTAL_ONLY"/);
  assert.match(createService, /portDirection: "E"/);
  assert.match(createService, /customsDirection: "E"/);
  assert.match(createService, /syncFreightowerPortTracking\(savedBase\.id, settings\)/);
  assert.match(createService, /syncFreightowerCustomsTracking\(savedBase\.id, settings\)/);
  assert.match(createService, /海运综合跟踪暂不可用，已启动中国港区和海关跟踪/);
  assert.doesNotMatch(syncService, /if \(comprehensiveError\) throw comprehensiveError/);
  assert.match(syncService, /海运综合跟踪暂不可用，中国港区和海关已继续同步/);
  assert.match(logisticsModule, /中国起运港（港区跟踪）/);
  assert.match(logisticsModule, /上海港（CNSHA）/);
  assert.match(logisticsModule, /宁波港（CNNGB）/);
  assert.match(logisticsModule, /青岛港（CNTAO）/);
  assert.match(logisticsModule, /其他港口（手动输入）/);
  assert.match(logisticsModule, /请选择中国起运港，或输入其他中国港口代码/);
  assert.match(logisticsModule, /portCode: payload\.portCode \|\| ""/);
  assert.match(logisticsModule, /isExport: "E"/);
  assert.doesNotMatch(logisticsModule, /点击后将分别查询海运、中国港区和中国海关/);
  assert.doesNotMatch(logisticsModule, /本地未保存.*跟踪ID，请先同步已有跟踪/);
});

test("Freightower control tower remains read-only and permission scoped", () => {
  assert.match(trackingService, /export async function listShipsgoControlTowerTrackings/);
  assert.match(trackingService, /while \(page\.length === 300\)/);
  assert.match(trackingService, /cursor: \{ id: afterId \}, skip: 1/);
  assert.match(trackingService, /tracking\.portTrackingStatus/);
  assert.match(trackingService, /tracking\.customsTrackingStatus/);
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
