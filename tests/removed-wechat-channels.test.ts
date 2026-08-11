import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("微信公众号和小程序入口保持移除且物流通知只走邮件", () => {
  for (const path of [
    "app/account-settings/wechat-panel.tsx",
    "app/api/settings/wechat-official/route.ts",
    "app/api/settings/wechat-mini/route.ts",
    "app/api/wechat-official/subscription/route.ts",
    "app/api/wechat-mini/trackings/route.ts",
    "app/wechat-mini/tracking-map/page.tsx",
    "app/wx/route.ts",
    "miniprogram/app.json",
  ]) assert.equal(existsSync(path), false, path);

  const trackingNotifications = readFileSync("lib/platform/shipsgo-tracking-notifications.ts", "utf8");
  const notificationCron = readFileSync("app/api/cron/notification-outbox/route.ts", "utf8");
  assert.match(trackingNotifications, /sendDurableFreightowerTrackingEmail/);
  assert.doesNotMatch(trackingNotifications, /enqueueWechat/);
  assert.doesNotMatch(notificationCron, /processWechat/);
});
