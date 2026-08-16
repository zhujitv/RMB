import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  maskPhone,
  normalizeChinaMobilePhone,
} from "../lib/platform/sms-phone-utils.ts";
import { classifyTencentSmsFailure } from "../lib/platform/tencent-sms-retry-policy.ts";

test("SMS integration normalizes mainland mobile numbers and masks logs", () => {
  assert.equal(normalizeChinaMobilePhone("138 0013 8000"), "+8613800138000");
  assert.equal(normalizeChinaMobilePhone("+86-138-0013-8000"), "+8613800138000");
  assert.equal(normalizeChinaMobilePhone("0086 13800138000"), "+8613800138000");
  assert.equal(normalizeChinaMobilePhone("８６１３８００１３８０００"), "+8613800138000");
  assert.equal(normalizeChinaMobilePhone("021-12345678"), null);
  assert.equal(normalizeChinaMobilePhone("1380013800"), null);
  assert.equal(maskPhone("13800138000"), "+86 138****8000");
  assert.equal(maskPhone("invalid"), "未配置");
});

test("Tencent SMS failures expose safe retry and unknown-outcome signals", () => {
  assert.deepEqual(classifyTencentSmsFailure("Ok"), { retryable: false, outcomeUnknown: false });
  assert.deepEqual(classifyTencentSmsFailure("InvalidParameterValue.TemplateParamSet"), {
    retryable: false,
    outcomeUnknown: false,
  });
  assert.deepEqual(classifyTencentSmsFailure("RequestLimitExceeded"), {
    retryable: true,
    outcomeUnknown: false,
  });
  assert.deepEqual(classifyTencentSmsFailure("InternalError"), {
    retryable: true,
    outcomeUnknown: true,
  });
  assert.deepEqual(classifyTencentSmsFailure("ETIMEDOUT", { transportError: true }), {
    retryable: true,
    outcomeUnknown: true,
  });
  assert.deepEqual(classifyTencentSmsFailure("ENOTFOUND", { transportError: true }), {
    retryable: true,
    outcomeUnknown: false,
  });
});

test("SMS settings route and encrypted SystemSetting persistence are wired server-side", () => {
  const constants = readFileSync("lib/platform/shared-settings-constants.ts", "utf8");
  const settings = readFileSync("lib/platform/sms-integration-settings.ts", "utf8");
  const config = readFileSync("lib/platform/sms-integration-config.ts", "utf8");
  const provider = readFileSync("lib/platform/tencent-cloud-sms-provider.ts", "utf8");
  const route = readFileSync("app/api/settings/sms/route.ts", "utf8");
  const shared = readFileSync("lib/platform/shared.ts", "utf8");
  const packageJson = readFileSync("package.json", "utf8");

  assert.match(constants, /SMS_INTEGRATION_SETTING_KEY = "sms_integration"/);
  assert.match(settings, /encryptSystemSettingSecrets\(value, SMS_INTEGRATION_SETTING_KEY, SMS_SECRET_FIELDS\)/);
  assert.match(settings, /readSystemSettingWithEncryptedSecrets/);
  assert.match(config, /TENCENT_SMS_SECRET_ID/);
  assert.match(config, /TENCENT_SMS_SECRET_KEY/);
  assert.match(config, /secretId: ""/);
  assert.match(config, /secretKey: ""/);
  assert.match(config, /secretIdConfigured/);
  assert.match(config, /secretKeyConfigured/);
  assert.match(settings, /assertRead\(actor, "settings"\)/);
  assert.match(settings, /assertWrite\(actor, "settings"\)/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PATCH/);
  assert.match(provider, /sms\.v20210111\.Client/);
  assert.match(provider, /sms\.tencentcloudapi\.com/);
  assert.match(shared, /export \* from "\.\/sms-integration"/);
  assert.match(packageJson, /tencentcloud-sdk-nodejs-sms/);
});
