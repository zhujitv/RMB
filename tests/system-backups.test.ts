import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSettingsModuleSource } from "./source-helpers.ts";

const service = readFileSync("lib/platform/system-backups.ts", "utf8");
const shared = readFileSync("lib/platform/shared.ts", "utf8");
const listRoute = readFileSync("app/api/settings/backups/route.ts", "utf8");
const downloadRoute = readFileSync("app/api/settings/backups/[id]/download/route.ts", "utf8");
const settingsModule = readSettingsModuleSource();

test("system backup service stores metadata in system settings and files in private R2", () => {
  assert.match(service, /SYSTEM_BACKUP_RECORDS_SETTING_KEY = "system_backup_records"/);
  assert.match(service, /SYSTEM_BACKUP_VERSION = "NEXTWOOD_BACKUP_V1"/);
  assert.match(service, /uploadToR2\(\{ key: storageKey, body, contentType: "application\/json; charset=utf-8" \}\)/);
  assert.match(service, /readR2Object\(backup\.storageKey\)/);
  assert.match(service, /prisma\.systemSetting\.upsert/);
  assert.match(shared, /export \* from "\.\/system-backups"/);
});

test("system backup service excludes auth secrets and redacts integration secrets", () => {
  assert.match(service, /SENSITIVE_BACKUP_KEY_PATTERN/);
  assert.match(service, /apiKey\|accessKey/);
  assert.match(service, /webhookSecret/);
  assert.match(service, /passwordPolicyPassed: true/);
  assert.match(service, /"用户密码哈希"/);
  assert.match(service, /"登录会话"/);
  assert.match(service, /"邮箱验证码"/);
  assert.match(service, /"登录尝试明细"/);
  assert.doesNotMatch(service, /passwordHash: true/);
  assert.doesNotMatch(service, /emailVerificationToken\.findMany|userSession\.findMany|loginAttempt\.findMany/);
});

test("system backup APIs require settings permissions", () => {
  assert.match(listRoute, /withApiRead\("settings"/);
  assert.match(listRoute, /withApiWrite\("settings"/);
  assert.match(listRoute, /readSystemBackupSettings\(actor\)/);
  assert.match(listRoute, /createSystemBackup\(request, actor\)/);
  assert.match(downloadRoute, /withApiRead<RouteContext>\("settings"/);
  assert.match(downloadRoute, /readSystemBackupFile\(actor, id\)/);
  assert.match(downloadRoute, /Content-Disposition/);
  assert.match(downloadRoute, /X-Content-Type-Options/);
  assert.match(downloadRoute, /no-store/);
});

test("settings module exposes the system backup center", () => {
  assert.match(settingsModule, /"systemBackups"/);
  assert.match(settingsModule, /label: "系统备份"/);
  assert.match(settingsModule, /\/api\/settings\/backups/);
  assert.match(settingsModule, /SystemBackupSettingsCard/);
  assert.match(settingsModule, /系统备份中心/);
  assert.match(settingsModule, /生成系统备份/);
  assert.match(settingsModule, /备份记录/);
  assert.match(settingsModule, /href=\{`\/api\/settings\/backups\/\$\{encodeURIComponent\(backup\.id\)\}\/download`\}/);
  assert.match(settingsModule, /activeTab !== "systemBackups"/);
});
