import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decryptSystemSettingSecrets,
  encryptSystemSettingSecrets,
  settingsEncryptionKeyConfigured,
  systemSettingSecretIsEncrypted,
  systemSettingSecretsNeedMigration,
} from "../lib/platform/system-setting-secrets.ts";
import {
  createOutboundTimeoutSignal,
  isBlockedOutboundAddress,
  normalizeAliyunDocMindEndpoint,
  normalizeAliyunOcrApiUrl,
  readResponseTextLimited,
} from "../lib/platform/outbound-request-security.ts";

const SETTING_KEY = "test_integration";
const SECRET_FIELDS = ["apiKey", "webhookSecret"] as const;

function withEncryptionEnvironment<T>(callback: () => T) {
  const previous = {
    key: process.env.SETTINGS_ENCRYPTION_KEY,
    id: process.env.SETTINGS_ENCRYPTION_KEY_ID,
    old: process.env.SETTINGS_ENCRYPTION_PREVIOUS_KEYS,
  };
  try {
    return callback();
  } finally {
    if (previous.key === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = previous.key;
    if (previous.id === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY_ID;
    else process.env.SETTINGS_ENCRYPTION_KEY_ID = previous.id;
    if (previous.old === undefined) delete process.env.SETTINGS_ENCRYPTION_PREVIOUS_KEYS;
    else process.env.SETTINGS_ENCRYPTION_PREVIOUS_KEYS = previous.old;
  }
}

test("system setting secrets use versioned AES-GCM envelopes and round-trip", () => {
  withEncryptionEnvironment(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
    process.env.SETTINGS_ENCRYPTION_KEY_ID = "test-v1";
    delete process.env.SETTINGS_ENCRYPTION_PREVIOUS_KEYS;
    const stored = encryptSystemSettingSecrets(
      { enabled: true, apiKey: "secret-value", webhookSecret: "hook-value" },
      SETTING_KEY,
      SECRET_FIELDS,
    );
    assert.equal(stored.enabled, true);
    assert.equal(systemSettingSecretIsEncrypted(stored.apiKey), true);
    assert.equal(systemSettingSecretIsEncrypted(stored.webhookSecret), true);
    assert.equal(settingsEncryptionKeyConfigured(), true);
    assert.equal(systemSettingSecretsNeedMigration(stored, SECRET_FIELDS), false);
    assert.equal(JSON.stringify(stored).includes("secret-value"), false);
    assert.deepEqual(decryptSystemSettingSecrets(stored, SETTING_KEY, SECRET_FIELDS), {
      enabled: true,
      apiKey: "secret-value",
      webhookSecret: "hook-value",
    });
  });
});

test("secret envelopes are bound to their setting and field", () => {
  withEncryptionEnvironment(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("hex");
    process.env.SETTINGS_ENCRYPTION_KEY_ID = "binding-v1";
    const stored = encryptSystemSettingSecrets({ apiKey: "one", webhookSecret: "two" }, SETTING_KEY, SECRET_FIELDS);
    assert.throws(
      () => decryptSystemSettingSecrets({ webhookSecret: stored.apiKey }, SETTING_KEY, ["webhookSecret"]),
      (error: unknown) => (error as { code?: string }).code === "SETTINGS_SECRET_DECRYPT_FAILED",
    );
  });
});

test("legacy plaintext remains readable and migrates on the next keyed save", () => {
  withEncryptionEnvironment(() => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY_ID;
    delete process.env.SETTINGS_ENCRYPTION_PREVIOUS_KEYS;
    const legacy = { apiKey: "legacy-secret", enabled: true };
    assert.deepEqual(decryptSystemSettingSecrets(legacy, SETTING_KEY, SECRET_FIELDS), legacy);
    assert.equal(systemSettingSecretsNeedMigration(legacy, SECRET_FIELDS), true);
    assert.throws(
      () => encryptSystemSettingSecrets(legacy, SETTING_KEY, SECRET_FIELDS),
      (error: unknown) => (error as { code?: string }).code === "SETTINGS_ENCRYPTION_KEY_REQUIRED",
    );
    process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64url");
    const migrated = encryptSystemSettingSecrets(legacy, SETTING_KEY, SECRET_FIELDS);
    assert.equal(systemSettingSecretIsEncrypted(migrated.apiKey), true);
  });
});

test("old encrypted settings remain decryptable during key rotation", () => {
  withEncryptionEnvironment(() => {
    const oldKey = Buffer.alloc(32, 13).toString("base64url");
    process.env.SETTINGS_ENCRYPTION_KEY = oldKey;
    process.env.SETTINGS_ENCRYPTION_KEY_ID = "old-v1";
    const stored = encryptSystemSettingSecrets({ apiKey: "rotated-secret" }, SETTING_KEY, SECRET_FIELDS);
    process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64url");
    process.env.SETTINGS_ENCRYPTION_KEY_ID = "new-v2";
    process.env.SETTINGS_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ "old-v1": oldKey });
    assert.deepEqual(decryptSystemSettingSecrets(stored, SETTING_KEY, SECRET_FIELDS), { apiKey: "rotated-secret" });
    assert.equal(systemSettingSecretsNeedMigration(stored, SECRET_FIELDS), true);
  });
});

test("Aliyun OCR endpoints require official HTTPS hosts without URL extras", () => {
  assert.equal(
    normalizeAliyunOcrApiUrl("http://ocr-api.cn-shanghai.aliyuncs.com", ""),
    "https://ocr-api.cn-shanghai.aliyuncs.com",
  );
  for (const value of [
    "https://evil.example.com",
    "https://ocr-api.cn-hangzhou.aliyuncs.com.evil.example",
    "https://user:pass@ocr-api.cn-hangzhou.aliyuncs.com",
    "https://ocr-api.cn-hangzhou.aliyuncs.com:8443",
    "https://ocr-api.cn-hangzhou.aliyuncs.com/private",
    "https://ocr-api.cn-hangzhou.aliyuncs.com?token=x",
  ]) {
    assert.throws(() => normalizeAliyunOcrApiUrl(value, ""));
  }
  assert.equal(
    normalizeAliyunDocMindEndpoint("https://docmind-api.cn-hangzhou.aliyuncs.com"),
    "docmind-api.cn-hangzhou.aliyuncs.com",
  );
  assert.throws(() => normalizeAliyunDocMindEndpoint("http://127.0.0.1"));
});

test("outbound address policy blocks private, metadata, loopback and link-local ranges", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "192.168.1.1", "::1", "fd00::1", "fe80::1"]) {
    assert.equal(isBlockedOutboundAddress(address), true, address);
  }
  assert.equal(isBlockedOutboundAddress("8.8.8.8"), false);
  assert.equal(isBlockedOutboundAddress("2606:4700:4700::1111"), false);
});

test("third-party response reader enforces its byte limit", async () => {
  await assert.rejects(
    () => readResponseTextLimited(new Response("0123456789"), 5),
    (error: unknown) => (error as { code?: string }).code === "OUTBOUND_RESPONSE_TOO_LARGE",
  );
  assert.equal(await readResponseTextLimited(new Response("safe"), 5), "safe");
});

test("outbound timeout signal preserves caller cancellation and enforces its deadline", async () => {
  const controller = new AbortController();
  const combined = createOutboundTimeoutSignal(1000, controller.signal);
  controller.abort();
  assert.equal(combined.aborted, true);

  const timed = createOutboundTimeoutSignal(5);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(timed.aborted, true);
});

test("integration persistence and outbound fetches are wired to the security helpers", () => {
  const ocrSettings = readFileSync("lib/platform/ocr-integration-settings.ts", "utf8");
  const shipsgoSettings = readFileSync("lib/platform/freightower-integration.ts", "utf8");
  const ocrReliability = readFileSync("lib/platform/ocr-integration-reliability.ts", "utf8");
  const docMind = readFileSync("lib/platform/ocr-integration-docmind.ts", "utf8");
  const outbound = readFileSync("lib/platform/outbound-request-security.ts", "utf8");
  const migration = readFileSync("lib/platform/system-setting-secret-migration.ts", "utf8");
  const exchangeFetchers = readFileSync("lib/platform/shared-exchange-fetchers.ts", "utf8");
  const resendSecurity = readFileSync("lib/platform/resend-email-security.ts", "utf8");
  assert.match(ocrSettings, /encryptSystemSettingSecrets\(value, OCR_INTEGRATION_SETTING_KEY, OCR_SECRET_FIELDS\)/);
  assert.match(shipsgoSettings, /encryptSystemSettingSecrets\(value, SHIPSGO_INTEGRATION_SETTING_KEY, FREIGHTOWER_SECRET_FIELDS\)/);
  assert.match(ocrReliability, /fetchAliyunOcrApi/);
  assert.match(docMind, /readAliyunDocMindOutputSafely/);
  assert.match(outbound, /redirect: "error"/);
  assert.match(outbound, /AbortController/);
  assert.match(migration, /updateMany/);
  assert.match(migration, /where: \{ key: settingKey, updatedAt: setting\.updatedAt \}/);
  assert.match(migration, /retryOnConflict/);
  assert.match(exchangeFetchers, /createOutboundTimeoutSignal/);
  assert.match(exchangeFetchers, /readResponseTextLimited/);
  assert.doesNotMatch(exchangeFetchers, /response\.(?:text|json)\(\)/);
  assert.match(resendSecurity, /RESEND_ERROR_RESPONSE_MAX_BYTES/);
  assert.match(resendSecurity, /readResponseTextLimited/);
  assert.doesNotMatch(ocrReliability, /responseBody:\s*diagnostics\.responseBody/);
});
