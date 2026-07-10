import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const usersAdmin = readFileSync("lib/platform/shared-users-admin.ts", "utf8");
const notificationSettings = readFileSync("lib/platform/notification-settings.ts", "utf8");
const notificationSend = readFileSync("lib/platform/notification-send.ts", "utf8");
const userRegistration = readFileSync("lib/platform/shared-users-registration.ts", "utf8");
const apiPerformanceRoute = readFileSync("app/api/settings/api-performance/route.ts", "utf8");

test("delegated user managers cannot elevate privileges or manage privileged accounts", () => {
  assert.match(usersAdmin, /非管理员只能维护未配置组合权限的业务员账号/);
  assert.match(usersAdmin, /不能修改当前账号自身的角色、权限或启用状态/);
  assert.match(usersAdmin, /非管理员只能修改未配置组合权限的业务员账号状态/);
  assert.match(usersAdmin, /LAST_ACTIVE_ADMIN_REQUIRED/);
  assert.match(usersAdmin, /USER_SELF_STATUS_CHANGE_FORBIDDEN/);
});

test("security-sensitive notifications cannot inherit or accept CC recipients", () => {
  assert.match(notificationSettings, /definition\.securitySensitive[\s\S]*?ccEmails:[\s\S]*?\? \[\]/);
  assert.match(notificationSend, /template\.securitySensitive[\s\S]*?templateCc/);
  assert.match(notificationSend, /const directCc = template\.securitySensitive \? \[\]/);
  assert.match(userRegistration, /USER_EMAIL_VERIFICATION[\s\S]*?ignoreTemplateCc: true/);
});

test("client performance telemetry is persisted only for administrators", () => {
  assert.match(apiPerformanceRoute, /if \(actor\.role !== "管理员"\) return ok\(\{ success: true, recorded: false \}\)/);
  assert.match(apiPerformanceRoute, /actor\.role !== "管理员"[\s\S]*?recordApiPerformanceLog/);
});
