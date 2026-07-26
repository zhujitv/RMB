import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ENVELOPE_ALGORITHM = "AES-256-GCM";
const ENVELOPE_MARKER = "RMB_SYSTEM_SETTING_SECRET";
const ENVELOPE_VERSION = 1;

type SecretEnvelope = {
  $encrypted: typeof ENVELOPE_MARKER;
  algorithm: typeof ENVELOPE_ALGORITHM;
  version: typeof ENVELOPE_VERSION;
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};

function configurationError(message: string, code: string) {
  const error = new Error(message) as Error & { status: number; code: string; expose: boolean };
  error.status = 503;
  error.code = code;
  error.expose = true;
  return error;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeEncryptionKey(value: string, variableName: string) {
  const trimmed = value.trim();
  let decoded: Buffer;
  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    decoded = Buffer.from(trimmed, "hex");
  } else if (/^[a-z0-9+/_-]+={0,2}$/i.test(trimmed)) {
    decoded = Buffer.from(trimmed.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } else {
    throw configurationError(
      `${variableName} 格式无效，必须是 32 字节 Base64/Base64URL 或 64 位十六进制密钥。`,
      "SETTINGS_ENCRYPTION_KEY_INVALID",
    );
  }
  if (decoded.length !== 32) {
    throw configurationError(
      `${variableName} 长度无效，解码后必须正好为 32 字节。`,
      "SETTINGS_ENCRYPTION_KEY_INVALID",
    );
  }
  return decoded;
}

function primaryKeyId() {
  const value = (process.env.SETTINGS_ENCRYPTION_KEY_ID || "primary-v1").trim();
  if (!/^[a-z0-9._-]{1,64}$/i.test(value)) {
    throw configurationError("SETTINGS_ENCRYPTION_KEY_ID 格式无效。", "SETTINGS_ENCRYPTION_KEY_ID_INVALID");
  }
  return value;
}

function primaryEncryptionKey(required: boolean) {
  const value = (process.env.SETTINGS_ENCRYPTION_KEY || "").trim();
  if (!value) {
    if (!required) return null;
    throw configurationError(
      "服务器未配置 SETTINGS_ENCRYPTION_KEY，不能安全保存第三方密钥。",
      "SETTINGS_ENCRYPTION_KEY_REQUIRED",
    );
  }
  return { id: primaryKeyId(), key: decodeEncryptionKey(value, "SETTINGS_ENCRYPTION_KEY") };
}

function decryptionKeyring() {
  const keys = new Map<string, Buffer>();
  const previous = (process.env.SETTINGS_ENCRYPTION_PREVIOUS_KEYS || "").trim();
  if (previous) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(previous);
    } catch {
      throw configurationError(
        "SETTINGS_ENCRYPTION_PREVIOUS_KEYS 必须是 keyId 到密钥的 JSON 对象。",
        "SETTINGS_ENCRYPTION_PREVIOUS_KEYS_INVALID",
      );
    }
    if (!isPlainRecord(parsed)) {
      throw configurationError(
        "SETTINGS_ENCRYPTION_PREVIOUS_KEYS 必须是 keyId 到密钥的 JSON 对象。",
        "SETTINGS_ENCRYPTION_PREVIOUS_KEYS_INVALID",
      );
    }
    for (const [id, value] of Object.entries(parsed)) {
      if (!/^[a-z0-9._-]{1,64}$/i.test(id) || typeof value !== "string") {
        throw configurationError("历史设置加密密钥配置无效。", "SETTINGS_ENCRYPTION_PREVIOUS_KEYS_INVALID");
      }
      keys.set(id, decodeEncryptionKey(value, `SETTINGS_ENCRYPTION_PREVIOUS_KEYS.${id}`));
    }
  }
  const primary = primaryEncryptionKey(false);
  if (primary) keys.set(primary.id, primary.key);
  return keys;
}

function isSecretEnvelope(value: unknown): value is SecretEnvelope {
  return isPlainRecord(value)
    && value.$encrypted === ENVELOPE_MARKER
    && value.algorithm === ENVELOPE_ALGORITHM
    && value.version === ENVELOPE_VERSION
    && typeof value.keyId === "string"
    && typeof value.iv === "string"
    && typeof value.authTag === "string"
    && typeof value.ciphertext === "string";
}

function additionalAuthenticatedData(settingKey: string, field: string, keyId: string) {
  return Buffer.from(`rmb-system-setting:${ENVELOPE_VERSION}:${settingKey}:${field}:${keyId}`, "utf8");
}

function encryptSecret(value: string, settingKey: string, field: string): SecretEnvelope {
  const primary = primaryEncryptionKey(true)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", primary.key, iv);
  cipher.setAAD(additionalAuthenticatedData(settingKey, field, primary.id));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    $encrypted: ENVELOPE_MARKER,
    algorithm: ENVELOPE_ALGORITHM,
    version: ENVELOPE_VERSION,
    keyId: primary.id,
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function decryptSecret(value: SecretEnvelope, settingKey: string, field: string) {
  const key = decryptionKeyring().get(value.keyId);
  if (!key) {
    throw configurationError(
      "服务器缺少解密第三方设置所需的密钥，请恢复对应密钥版本后重试。",
      "SETTINGS_DECRYPTION_KEY_REQUIRED",
    );
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64url"));
    decipher.setAAD(additionalAuthenticatedData(settingKey, field, value.keyId));
    decipher.setAuthTag(Buffer.from(value.authTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw configurationError("第三方设置密钥解密失败，请检查密钥版本。", "SETTINGS_SECRET_DECRYPT_FAILED");
  }
}

export function decryptSystemSettingSecrets(
  value: unknown,
  settingKey: string,
  secretFields: readonly string[],
) {
  if (!isPlainRecord(value)) return value;
  const output: Record<string, unknown> = { ...value };
  for (const field of secretFields) {
    const stored = output[field];
    if (isSecretEnvelope(stored)) output[field] = decryptSecret(stored, settingKey, field);
  }
  return output;
}

export function encryptSystemSettingSecrets(
  value: Record<string, unknown>,
  settingKey: string,
  secretFields: readonly string[],
) {
  const output: Record<string, unknown> = { ...value };
  for (const field of secretFields) {
    const secret = typeof output[field] === "string" ? output[field].trim() : "";
    if (secret) output[field] = encryptSecret(secret, settingKey, field);
  }
  return output;
}

export function systemSettingSecretIsEncrypted(value: unknown) {
  return isSecretEnvelope(value);
}

export function settingsEncryptionKeyConfigured() {
  return Boolean((process.env.SETTINGS_ENCRYPTION_KEY || "").trim());
}

export function systemSettingSecretsNeedMigration(value: unknown, secretFields: readonly string[]) {
  if (!isPlainRecord(value)) return false;
  return secretFields.some((field) => {
    const stored = value[field];
    if (typeof stored === "string") return Boolean(stored.trim());
    if (!isSecretEnvelope(stored) || !settingsEncryptionKeyConfigured()) return false;
    return stored.keyId !== primaryKeyId();
  });
}
