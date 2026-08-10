import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const jiti = createJiti(import.meta.url);
const config = readFileSync("lib/platform/wechat-mini-config.ts", "utf8");
const auth = readFileSync("lib/platform/wechat-mini-auth.ts", "utf8");
const provider = readFileSync("lib/platform/wechat-mini-provider.ts", "utf8");
const subscriptions = readFileSync("lib/platform/wechat-mini-subscriptions.ts", "utf8");
const notifications = readFileSync("lib/platform/wechat-mini-notifications.ts", "utf8");
const trackingNotifications = readFileSync("lib/platform/shipsgo-tracking-notifications.ts", "utf8");
const cron = readFileSync("app/api/cron/notification-outbox/route.ts", "utf8");
const settingsUi = readFileSync("app/modules/settings/wechat-mini-settings-card.tsx", "utf8");
const settingsModule = readFileSync("app/modules/settings/module-tab-content.tsx", "utf8");
const migration = readFileSync("prisma/migrations/20260802150000_wechat_mini_program/migration.sql", "utf8");
const miniApp = readFileSync("miniprogram/app.json", "utf8");
const miniRuntime = readFileSync("miniprogram/app.js", "utf8");
const miniHome = readFileSync("miniprogram/pages/home/index.js", "utf8");
const miniApi = readFileSync("miniprogram/utils/api.js", "utf8");
const miniTrackingDetailRoute = readFileSync("app/api/wechat-mini/trackings/[id]/route.ts", "utf8");
const miniMapSessionRoute = readFileSync("app/api/wechat-mini/map-session/route.ts", "utf8");
const miniMapPage = readFileSync("app/wechat-mini/tracking-map/page.tsx", "utf8");
const miniMapBootstrap = readFileSync("app/wechat-mini/tracking-map/map-session-bootstrap.tsx", "utf8");
const miniTrackingDetail = readFileSync("miniprogram/pages/tracking-detail/index.js", "utf8");
const miniTrackingMap = readFileSync("miniprogram/pages/tracking-map/index.js", "utf8");
const schema = readPrismaSchemaSource();

test("小程序与公众号使用独立配置且服务端不回传 AppSecret", () => {
  assert.match(config, /wechat_mini_program_integration/);
  assert.match(config, /SECRET_FIELDS = \["appSecret"\]/);
  assert.match(config, /encryptSystemSettingSecrets/);
  assert.match(config, /appSecret: ""/);
  assert.match(settingsUi, /微信小程序物流应用/);
  assert.match(settingsModule, /WechatOfficialSettingsCard/);
  assert.match(settingsModule, /WechatMiniSettingsCard/);
});

test("小程序登录绑定微信但仅保存哈希会话令牌", () => {
  assert.match(auth, /exchangeWechatMiniLoginCode\(code\)/);
  assert.match(auth, /verifyLoginPassword/);
  assert.match(auth, /tokenHash: sessionTokenHash\(token\)/);
  assert.match(auth, /WECHAT_MINI_ALREADY_BOUND/);
  assert.match(auth, /mustChangePassword \|\| !user\.passwordPolicyPassed/);
  assert.match(auth, /previousBinding\.openId !== identity\.openId/);
  assert.match(auth, /bindingId: previousBinding\.id, revokedAt: null/);
  assert.match(auth, /status: "REVOKED"/);
  assert.doesNotMatch(auth, /session_key|sessionKey/);
});

test("小程序服务端调用微信登录、稳定 Token 和订阅消息官方接口", () => {
  assert.match(provider, /api\.weixin\.qq\.com\/sns\/jscode2session/);
  assert.match(provider, /api\.weixin\.qq\.com\/cgi-bin\/stable_token/);
  assert.match(provider, /api\.weixin\.qq\.com\/cgi-bin\/message\/subscribe\/send/);
  assert.match(provider, /force_refresh: false/);
  assert.match(provider, /miniprogram_state: "formal"/);
  assert.match(provider, /lang: "zh_CN"/);
});

test("小程序物流接口复用网页端数据权限和安全序列化", () => {
  const listRoute = readFileSync("app/api/wechat-mini/trackings/route.ts", "utf8");
  const detailRoute = readFileSync("app/api/wechat-mini/trackings/[id]/route.ts", "utf8");
  assert.match(listRoute, /requireWechatMiniActor/);
  assert.match(listRoute, /listShipsgoControlTowerTrackings/);
  assert.match(detailRoute, /requireWechatMiniActor/);
  assert.match(detailRoute, /getShipsgoOceanTracking/);
  assert.match(auth, /customPermissions: true/);
  assert.match(auth, /supplierId: true/);
});

test("物流变化同时保留邮件、公众号和小程序三条通知通道", () => {
  assert.match(trackingNotifications, /enqueueWechatOfficialNotifications/);
  assert.match(trackingNotifications, /enqueueWechatMiniNotifications/);
  assert.match(trackingNotifications, /sendNotificationEmail/);
  assert.match(notifications, /idempotencyKey = `wechat-mini:/);
  assert.match(notifications, /status: "RESERVED"/);
  assert.match(notifications, /status: "CONSUMED"/);
  assert.match(cron, /processWechatOfficialNotificationOutbox/);
  assert.match(cron, /processWechatMiniNotificationOutbox/);
});

test("一次性订阅额度有上限并由数据库并发预留", () => {
  assert.match(subscriptions, /available >= 20/);
  assert.match(subscriptions, /input\.accepted !== true/);
  assert.match(notifications, /status: "AVAILABLE"/);
  assert.match(notifications, /reserved\.count !== 1/);
  assert.match(schema, /model WechatMiniBinding/);
  assert.match(schema, /model WechatMiniSession/);
  assert.match(schema, /model WechatMiniSubscriptionGrant/);
  assert.match(schema, /model WechatMiniDelivery/);
  assert.match(migration, /wechat_mini_deliveries_idempotency_key_key/);
});

test("原生小程序包含登录、概览、物流、时间轴和个人中心", () => {
  for (const file of [
    "miniprogram/pages/login/index.wxml",
    "miniprogram/pages/home/index.wxml",
    "miniprogram/pages/trackings/index.wxml",
    "miniprogram/pages/tracking-detail/index.wxml",
    "miniprogram/pages/tracking-map/index.wxml",
    "miniprogram/pages/profile/index.wxml",
  ]) assert.equal(existsSync(file), true, file);
  assert.match(miniApp, /pages\/tracking-detail\/index/);
  assert.match(miniApp, /pages\/tracking-map\/index/);
  assert.match(miniHome, /wx\.requestSubscribeMessage/);
  assert.match(miniApi, /Authorization: `Bearer \$\{token\}`/);
  assert.match(miniRuntime, /https:\/\/www\.nextwood\.net\/api\/wechat-mini/);
});

test("小程序地图复用飞驼地图并通过短时服务端会话保护访问", () => {
  assert.match(miniTrackingDetail, /tracking\.hasMap/);
  assert.match(miniTrackingDetail, /pages\/tracking-map\/index/);
  assert.match(miniTrackingMap, /\/wechat-mini\/tracking-map\?trackingId=/);
  assert.match(miniTrackingMap, /#token=/);
  assert.match(miniMapBootstrap, /history\.replaceState/);
  assert.match(miniMapBootstrap, /\/api\/wechat-mini\/map-session/);
  assert.match(miniMapSessionRoute, /requireWechatMiniActor\(request\)/);
  assert.match(miniMapSessionRoute, /getShipsgoOceanTracking\(actor, body\.trackingId\)/);
  assert.match(miniMapSessionRoute, /httpOnly: true/);
  assert.match(miniMapSessionRoute, /maxAge: MAP_SESSION_SECONDS/);
  assert.match(miniMapPage, /requireWechatMiniActorToken\(token\)/);
  assert.match(miniMapPage, /url\.hostname === "i\.saas\.freightower\.com"/);
  assert.match(miniMapPage, /referrerPolicy="no-referrer"/);
  assert.match(miniTrackingDetailRoute, /const \{ mapUrl, \.\.\.safeTracking \} = tracking/);
  assert.match(miniTrackingDetailRoute, /hasMap: Boolean\(mapUrl\)/);
});

test("小程序设置接受微信官方带下划线的订阅模板字段", async () => {
  process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
  const { normalizeWechatMiniSettings } = await jiti.import<typeof import("../lib/platform/wechat-mini-config.ts")>("../lib/platform/wechat-mini-config.ts");
  const settings = normalizeWechatMiniSettings({
    orderField: "character_string9",
    statusField: "short_thing11",
    eventTimeField: "date1",
    eventField: "thing12",
  });
  assert.equal(settings.orderField, "character_string9");
  assert.equal(settings.statusField, "short_thing11");
  assert.equal(settings.eventTimeField, "date1");
  assert.equal(settings.eventField, "thing12");
});

test("小程序 provider 会交换 code、缓存 Token 并发送指定模板字段", async () => {
  process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
  const { createWechatMiniProvider } = await jiti.import<typeof import("../lib/platform/wechat-mini-provider.ts")>("../lib/platform/wechat-mini-provider.ts");
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const instance = createWechatMiniProvider({
    loadSettings: async () => ({
      enabled: true,
      appId: "wx1234567890123456",
      appSecret: "secret",
      trackingTemplateId: "template_123456",
      orderField: "character_string9",
      statusField: "short_thing11",
      eventTimeField: "date1",
      eventField: "thing12",
    }),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} });
      if (String(url).includes("jscode2session")) return Response.json({ openid: "openid-1", session_key: "never-store" });
      if (String(url).includes("stable_token")) return Response.json({ access_token: "token-1", expires_in: 7200 });
      return Response.json({ errcode: 0, errmsg: "ok" });
    },
  });
  assert.deepEqual(await instance.exchangeLoginCode("login-code-123"), { openId: "openid-1", unionId: null });
  await instance.sendSubscriptionMessage({
    openId: "openid-1",
    templateId: "template_123456",
    page: "pages/tracking-detail/index?id=tracking-1",
    orderNo: "PO24-4",
    statusText: "运输状态已发生变化",
    eventTimeText: "2026-08-02 15:30",
    eventText: "已装船",
  });
  assert.equal(calls.filter((call) => call.url.includes("stable_token")).length, 1);
  const send = calls.find((call) => call.url.includes("message/subscribe/send"));
  assert.equal(send?.body.touser, "openid-1");
  const data = send?.body.data as Record<string, { value: string }>;
  assert.equal(data.character_string9.value, "PO24-4");
  assert.equal(data.short_thing11.value, "运输状态已");
  assert.equal(data.date1.value, "2026年8月2日");
  assert.equal(data.thing12.value, "已装船");
});
