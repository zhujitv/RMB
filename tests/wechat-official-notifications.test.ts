import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const jiti = createJiti(import.meta.url);

const config = readFileSync("lib/platform/wechat-official-config.ts", "utf8");
const provider = readFileSync("lib/platform/wechat-official-provider.ts", "utf8");
const subscriptions = readFileSync("lib/platform/wechat-official-subscriptions.ts", "utf8");
const notifications = readFileSync("lib/platform/wechat-official-notifications.ts", "utf8");
const tracking = readFileSync("lib/platform/shipsgo-tracking-notifications.ts", "utf8");
const cron = readFileSync("app/api/cron/notification-outbox/route.ts", "utf8");
const settingsUi = readFileSync("app/modules/settings/wechat-official-settings-card.tsx", "utf8");
const settingsModule = readFileSync("app/modules/SettingsModule.tsx", "utf8");
const accountUi = readFileSync("app/account-settings/wechat-panel.tsx", "utf8");
const callbackRoute = readFileSync("app/api/wechat-official/subscription/callback/route.ts", "utf8");
const migration = readFileSync("prisma/migrations/20260802110000_wechat_official_notifications/migration.sql", "utf8");
const securityAudit = readFileSync("scripts/security-audit.mjs", "utf8");
const schema = readPrismaSchemaSource();

test("微信公众号密钥只在服务端加密保存且不回传明文", () => {
  assert.match(config, /WECHAT_SECRET_FIELDS = \["appSecret"\]/);
  assert.match(config, /encryptSystemSettingSecrets/);
  assert.match(config, /appSecret: ""/);
  assert.match(settingsUi, /SecretField/);
  assert.doesNotMatch(accountUi, /appSecret/i);
});

test("一次性订阅授权严格校验 reserved、模板和场景", () => {
  assert.match(subscriptions, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(subscriptions, /tokenHash\(reserved\)/);
  assert.match(subscriptions, /request\.templateId !== input\.templateId \|\| request\.scene !== input\.scene/);
  assert.match(subscriptions, /status !== "PENDING"/);
  assert.match(subscriptions, /WECHAT_OPENID_ALREADY_BOUND/);
  assert.match(subscriptions, /action", "get_confirm"/);
  assert.match(subscriptions, /#wechat_redirect|url\.hash = "wechat_redirect"/);
  assert.match(callbackRoute, /https:\/\/www\.nextwood\.net\//);
  assert.match(callbackRoute, /workbenchTarget", "\/account"/);
  assert.match(securityAudit, /app\/api\/wechat-official\/subscription\/callback\/route\.ts/);
});

test("微信 provider 使用官方稳定 token 和一次性订阅发送接口", () => {
  assert.match(provider, /https:\/\/api\.weixin\.qq\.com\/cgi-bin\/stable_token/);
  assert.match(provider, /https:\/\/api\.weixin\.qq\.com\/cgi-bin\/message\/template\/subscribe/);
  assert.match(provider, /grant_type: "client_credential"/);
  assert.match(provider, /force_refresh: false/);
  assert.doesNotMatch(provider, /force_refresh: true/);
  assert.match(provider, /title: message\.title\.slice\(0, 15\)/);
  assert.match(provider, /value: message\.content\.slice\(0, 200\)/);
});

test("物流更新按管理员和订单业务员入微信队列并保持邮件通道", () => {
  assert.match(tracking, /enqueueWechatOfficialNotifications/);
  assert.match(tracking, /role: "管理员"/);
  assert.match(tracking, /tracking\.order\.salesperson\.id/);
  assert.match(tracking, /sendNotificationEmail/);
  assert.match(notifications, /idempotencyKey: `wechat:/);
  assert.match(notifications, /status: "RESERVED"/);
  assert.match(notifications, /status: "CONSUMED"/);
  assert.match(cron, /processWechatOfficialNotificationOutbox\(\{ limit: 8 \}\)/);
});

test("数据库模型保证授权与消息幂等", () => {
  for (const model of ["WechatOfficialBinding", "WechatOfficialSubscription", "WechatOfficialDelivery"]) {
    assert.match(schema, new RegExp(`model ${model}`));
  }
  assert.match(schema, /idempotencyKey\s+String\s+@unique/);
  assert.match(schema, /subscriptionId\s+String\s+@unique/);
  assert.match(migration, /wechat_official_deliveries_idempotency_key_key/);
  assert.match(migration, /provider_accepted_at/);
  assert.match(migration, /outcome_unknown_at/);
  assert.match(migration, /ON DELETE CASCADE/);
});

test("个人未认证状态在界面中保持安全停用", () => {
  assert.match(config, /value\.enabled && !value\.accountCertified/);
  assert.match(settingsUi, /企业主体已认证/);
  assert.match(settingsUi, /个人未认证号/);
  assert.match(accountUi, /disabled=\{busy \|\| !status\?\.available\}/);
});

test("微信设置独立保存并纳入工作区未保存与忙碌保护", () => {
  assert.match(settingsUi, /onDirtyChange/);
  assert.match(settingsUi, /onBusyChange/);
  assert.match(settingsUi, /setSavedSettings\(nextSettings\)/);
  assert.match(settingsUi, /disabled=\{saving \|\| testing \|\| dirty/);
  assert.match(settingsModule, /wechatSettingsDirty/);
  assert.match(settingsModule, /wechatSettingsBusy/);
});

test("稳定 Token 并发请求会合并，连接测试也不会强制刷新", async () => {
  process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
  const { createWechatOfficialProvider } = await jiti.import<typeof import("../lib/platform/wechat-official-provider.ts")>("../lib/platform/wechat-official-provider.ts");
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const providerInstance = createWechatOfficialProvider({
    loadSettings: async () => ({ appId: "wx-test", appSecret: "secret" }),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown> });
      return new Response(JSON.stringify({ access_token: `token-${calls.length}`, expires_in: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const [first, second] = await Promise.all([
    providerInstance.getStableAccessToken(),
    providerInstance.getStableAccessToken(),
  ]);
  assert.equal(first, second);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body.force_refresh, false);

  await providerInstance.testConnection();
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.body.force_refresh, false);
});

test("失效 Token 使用普通模式恢复，并成功重试一次发送", async () => {
  process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
  const { createWechatOfficialProvider } = await jiti.import<typeof import("../lib/platform/wechat-official-provider.ts")>("../lib/platform/wechat-official-provider.ts");
  const tokenBodies: Record<string, unknown>[] = [];
  let tokenRequestCount = 0;
  let sendRequestCount = 0;
  const providerInstance = createWechatOfficialProvider({
    loadSettings: async () => ({ appId: "wx-test", appSecret: "secret" }),
    fetchImpl: async (url, init) => {
      if (String(url).includes("stable_token")) {
        tokenRequestCount += 1;
        tokenBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
        return Response.json({ access_token: `token-${tokenRequestCount}`, expires_in: 7200 });
      }
      sendRequestCount += 1;
      return Response.json(sendRequestCount === 1
        ? { errcode: 40014, errmsg: "invalid access token" }
        : { errcode: 0, errmsg: "ok" });
    },
  });

  await providerInstance.sendOneTimeMessage({
    openId: "openid_123456",
    templateId: "template-1",
    scene: 1,
    title: "Logistics update",
    content: "Shipment updated",
  });
  assert.equal(tokenRequestCount, 2);
  assert.equal(sendRequestCount, 2);
  assert.deepEqual(tokenBodies.map((body) => body.force_refresh), [false, false]);
});

test("发送连接中断会标记结果未知，失败策略不会自动重发", async () => {
  process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
  const {
    createWechatOfficialProvider,
    isWechatDeliveryOutcomeUnknown,
  } = await jiti.import<typeof import("../lib/platform/wechat-official-provider.ts")>("../lib/platform/wechat-official-provider.ts");
  const { wechatDeliveryFailureDisposition } = await jiti.import<typeof import("../lib/platform/wechat-official-notifications.ts")>("../lib/platform/wechat-official-notifications.ts");
  let requests = 0;
  const providerInstance = createWechatOfficialProvider({
    loadSettings: async () => ({ appId: "wx-test", appSecret: "secret" }),
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) return Response.json({ access_token: "token-1", expires_in: 7200 });
      throw new TypeError("socket closed after request write");
    },
  });

  await assert.rejects(
    providerInstance.sendOneTimeMessage({
      openId: "openid_123456",
      templateId: "template-1",
      scene: 1,
      title: "Logistics update",
      content: "Shipment updated",
    }),
    (error: unknown) => {
      assert.equal(isWechatDeliveryOutcomeUnknown(error), true);
      assert.equal(wechatDeliveryFailureDisposition(error, 1), "outcome_unknown");
      return true;
    },
  );
  assert.equal(requests, 2);
});

test("微信明确返回的临时错误只在尝试次数未耗尽时重试", async () => {
  process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
  const { createWechatOfficialProvider } = await jiti.import<typeof import("../lib/platform/wechat-official-provider.ts")>("../lib/platform/wechat-official-provider.ts");
  const { wechatDeliveryFailureDisposition } = await jiti.import<typeof import("../lib/platform/wechat-official-notifications.ts")>("../lib/platform/wechat-official-notifications.ts");
  let requests = 0;
  const providerInstance = createWechatOfficialProvider({
    loadSettings: async () => ({ appId: "wx-test", appSecret: "secret" }),
    fetchImpl: async () => {
      requests += 1;
      return requests === 1
        ? Response.json({ access_token: "token-1", expires_in: 7200 })
        : Response.json({ errcode: -1, errmsg: "system busy" });
    },
  });

  await assert.rejects(
    providerInstance.sendOneTimeMessage({
      openId: "openid_123456",
      templateId: "template-1",
      scene: 1,
      title: "Logistics update",
      content: "Shipment updated",
    }),
    (error: unknown) => {
      assert.equal(wechatDeliveryFailureDisposition(error, 1), "retry");
      assert.equal(wechatDeliveryFailureDisposition(error, 6), "permanent_failure");
      return true;
    },
  );
});

test("同一微信授权回调并发处理时只有一个请求能确认", async () => {
  process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
  const { finalizeWechatSubscriptionCallback } = await jiti.import<typeof import("../lib/platform/wechat-official-subscriptions.ts")>("../lib/platform/wechat-official-subscriptions.ts");
  const row = {
    id: "subscription-1",
    userId: "user-1",
    tokenHash: "hash-1",
    openId: null as string | null,
    templateId: "template-1",
    scene: 7,
    status: "PENDING",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    confirmedAt: null as Date | null,
  };
  const bindings = new Map<string, { userId: string; openId: string }>();
  const transaction = {
    wechatOfficialSubscription: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => where.tokenHash === row.tokenHash ? { ...row } : null,
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        if (where.id !== row.id || where.status !== row.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    wechatOfficialBinding: {
      findUnique: async ({ where }: { where: { openId: string } }) => bindings.get(where.openId) || null,
      upsert: async ({ create }: { create: { userId: string; openId: string } }) => {
        bindings.set(create.openId, create);
        return create;
      },
    },
  };
  const input = {
    tokenHash: "hash-1",
    action: "confirm" as const,
    templateId: "template-1",
    scene: 7,
    openId: "openid_123456",
  };

  const results = await Promise.allSettled([
    finalizeWechatSubscriptionCallback(transaction as never, input, new Date("2026-08-02T00:00:00.000Z")),
    finalizeWechatSubscriptionCallback(transaction as never, input, new Date("2026-08-02T00:00:00.000Z")),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(row.status, "CONFIRMED");
  assert.equal(bindings.get("openid_123456")?.userId, "user-1");
});
