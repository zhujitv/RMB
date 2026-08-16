import { DEFAULT_SMS_INTEGRATION_SETTINGS } from "./shared-settings-constants";
import { codedError, isPlainRecord, nonEmpty } from "./shared-base-utils";
export { maskPhone, normalizeChinaMobilePhone } from "./sms-phone-utils";

export const SMS_PROVIDER_TENCENT_CLOUD = "TENCENT_CLOUD" as const;
export const SMS_SECRET_FIELDS = ["secretId", "secretKey"] as const;

export type SmsIntegrationInput = {
  enabled?: unknown;
  provider?: unknown;
  tencentSdkAppId?: unknown;
  signName?: unknown;
  templateId?: unknown;
  region?: unknown;
  secretId?: unknown;
  secretKey?: unknown;
};

export type SmsIntegrationSettings = ReturnType<typeof normalizeSmsIntegrationSettings>;
export type RuntimeSmsIntegrationSettings = SmsIntegrationSettings & {
  credentialsComplete: boolean;
  secretIdConfigured: boolean;
  secretKeyConfigured: boolean;
  secretIdFromEnvironment: boolean;
  secretKeyFromEnvironment: boolean;
};

function cleanText(value: unknown, limit: number) {
  return nonEmpty(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

function normalizeProvider(value: unknown) {
  const provider = cleanText(value || DEFAULT_SMS_INTEGRATION_SETTINGS.provider, 40).toUpperCase();
  if (provider === "TENCENT" || provider === "TENCENT_CLOUD") return SMS_PROVIDER_TENCENT_CLOUD;
  throw codedError("当前仅支持腾讯云短信服务。", 400, "SMS_PROVIDER_UNSUPPORTED");
}

function normalizeRegion(value: unknown) {
  const region = cleanText(value || DEFAULT_SMS_INTEGRATION_SETTINGS.region, 64).toLowerCase();
  if (!/^[a-z]{2,16}-[a-z0-9-]{2,48}$/.test(region)) {
    throw codedError("腾讯云短信地域格式无效。", 400, "SMS_REGION_INVALID");
  }
  return region;
}

export function cleanSmsSecret(value: unknown, limit = 500) {
  return cleanText(value, limit);
}

export function normalizeSmsIntegrationSettings(value: unknown = {}) {
  const input: SmsIntegrationInput = isPlainRecord(value) ? value : {};
  return {
    enabled: input.enabled === true,
    provider: normalizeProvider(input.provider),
    tencentSdkAppId: cleanText(input.tencentSdkAppId, 64),
    signName: cleanText(input.signName, 100),
    templateId: cleanText(input.templateId, 64),
    region: normalizeRegion(input.region),
    secretId: cleanSmsSecret(input.secretId),
    secretKey: cleanSmsSecret(input.secretKey),
  };
}

export function applySmsRuntimeCredentials(settings: SmsIntegrationSettings): RuntimeSmsIntegrationSettings {
  const environmentSecretId = cleanSmsSecret(process.env.TENCENT_SMS_SECRET_ID);
  const environmentSecretKey = cleanSmsSecret(process.env.TENCENT_SMS_SECRET_KEY);
  const secretId = environmentSecretId || settings.secretId;
  const secretKey = environmentSecretKey || settings.secretKey;
  return {
    ...settings,
    secretId,
    secretKey,
    credentialsComplete: Boolean(secretId && secretKey),
    secretIdConfigured: Boolean(secretId),
    secretKeyConfigured: Boolean(secretKey),
    secretIdFromEnvironment: Boolean(environmentSecretId),
    secretKeyFromEnvironment: Boolean(environmentSecretKey),
  };
}

export function assertSmsSettingsCanBeEnabled(settings: RuntimeSmsIntegrationSettings) {
  if (!settings.enabled) return;
  if (!settings.credentialsComplete) {
    throw codedError(
      "启用短信通知前请配置腾讯云 SecretId 和 SecretKey。",
      400,
      "SMS_CREDENTIAL_REQUIRED",
    );
  }
  if (!/^\d{5,20}$/.test(settings.tencentSdkAppId)) {
    throw codedError("启用短信通知前请填写正确的腾讯云短信 SdkAppId。", 400, "SMS_SDK_APP_ID_REQUIRED");
  }
  if (!/^\d{1,20}$/.test(settings.templateId)) {
    throw codedError("启用短信通知前请填写已审核通过的短信模板 ID。", 400, "SMS_TEMPLATE_ID_REQUIRED");
  }
  const signLength = Array.from(settings.signName).length;
  if (signLength < 2 || signLength > 12 || /[【】\[\]]/.test(settings.signName)) {
    throw codedError(
      "启用短信通知前请填写已审核通过的短信签名（不要包含【】）。",
      400,
      "SMS_SIGN_NAME_REQUIRED",
    );
  }
}

export function serializeSmsIntegrationSetting(setting: unknown) {
  const normalized = applySmsRuntimeCredentials(normalizeSmsIntegrationSettings(setting));
  const {
    secretId: _secretId,
    secretKey: _secretKey,
    secretIdFromEnvironment: _secretIdFromEnvironment,
    secretKeyFromEnvironment: _secretKeyFromEnvironment,
    secretIdConfigured,
    secretKeyConfigured,
    ...safe
  } = normalized;
  return {
    ...safe,
    secretId: "",
    secretKey: "",
    secretIdConfigured,
    secretKeyConfigured,
  };
}
