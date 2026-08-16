import { sms } from "tencentcloud-sdk-nodejs-sms";
import { isPlainRecord, redactSensitiveText } from "./shared-base-utils";
import { getSmsIntegrationSettings } from "./sms-integration-settings";
import {
  SMS_PROVIDER_TENCENT_CLOUD,
} from "./sms-integration-config";
import { normalizeChinaMobilePhone } from "./sms-phone-utils";
import { classifyTencentSmsFailure } from "./tencent-sms-retry-policy";
import type { SmsProvider, SmsSendInput, SmsSendResult } from "./sms-provider";

export { classifyTencentSmsFailure } from "./tencent-sms-retry-policy";

const TencentSmsClient = sms.v20210111.Client;
const TENCENT_SMS_ENDPOINT = "sms.tencentcloudapi.com";
const MAX_PHONE_NUMBERS_PER_REQUEST = 200;
const MAX_SESSION_CONTEXT_BYTES = 500;

function cleanProviderText(value: unknown, fallback: string, limit = 300) {
  const text = redactSensitiveText(String(value ?? "").trim(), limit);
  return text || fallback;
}

function cleanProviderCode(value: unknown, fallback: string) {
  const code = String(value ?? "").trim();
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(code) ? code : fallback;
}

function utf8Prefix(value: string, maxBytes: number) {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let output = "";
  let byteLength = 0;
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (byteLength + nextBytes > maxBytes) break;
    output += character;
    byteLength += nextBytes;
  }
  return output;
}

function cleanTemplateParams(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 500));
}

function cleanSessionContext(value: unknown) {
  return utf8Prefix(
    String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim(),
    MAX_SESSION_CONTEXT_BYTES,
  );
}

function resultForConfigurationFailure(
  phoneNumber: string,
  code: string,
  message: string,
): SmsSendResult {
  return {
    phoneNumber,
    accepted: false,
    code,
    message,
    retryable: false,
    outcomeUnknown: false,
  };
}

function resultForPreflightFailure(
  phoneNumber: string,
  code: string,
  message: string,
  retryable: boolean,
): SmsSendResult {
  return {
    phoneNumber,
    accepted: false,
    code,
    message,
    retryable,
    outcomeUnknown: false,
  };
}

function providerExceptionDetails(error: unknown) {
  const record = isPlainRecord(error) ? error : {};
  const code = cleanProviderCode(record.code, "TENCENT_SMS_REQUEST_FAILED");
  const requestId = cleanProviderText(record.requestId, "", 128) || undefined;
  const message = cleanProviderText(
    error instanceof Error ? error.message : record.message,
    "腾讯云短信请求失败",
  );
  const transportError = !requestId && (
    error instanceof TypeError
    || /^(?:E[A-Z_]+|UND_ERR_[A-Z_]+)$/.test(code)
    || /network|socket|timeout|timed out|fetch failed/i.test(message)
  );
  return {
    code,
    requestId,
    message,
    ...classifyTencentSmsFailure(code, { transportError, requestId }),
  };
}

export async function sendTencentCloudSms(input: SmsSendInput): Promise<SmsSendResult[]> {
  const requestedPhones = Array.isArray(input.phoneNumbers) ? input.phoneNumbers : [];
  const phoneEntries = requestedPhones.map((value) => ({
    original: String(value ?? ""),
    normalized: normalizeChinaMobilePhone(value),
  }));
  if (phoneEntries.length > MAX_PHONE_NUMBERS_PER_REQUEST) {
    return phoneEntries.map((entry) => resultForConfigurationFailure(
      entry.normalized || entry.original,
      "SMS_PHONE_NUMBER_LIMIT_EXCEEDED",
      `单次最多发送 ${MAX_PHONE_NUMBERS_PER_REQUEST} 个手机号`,
    ));
  }

  const validPhones = [...new Set(phoneEntries.flatMap((entry) => entry.normalized ? [entry.normalized] : []))];
  const invalidResults = phoneEntries
    .filter((entry) => !entry.normalized)
    .map((entry) => resultForConfigurationFailure(
      entry.original,
      "SMS_PHONE_NUMBER_INVALID",
      "仅支持有效的中国大陆手机号码",
    ));
  if (validPhones.length === 0) return invalidResults;

  let settings: Awaited<ReturnType<typeof getSmsIntegrationSettings>>;
  try {
    settings = await getSmsIntegrationSettings();
  } catch (error: unknown) {
    const message = cleanProviderText(
      error instanceof Error ? error.message : error,
      "短信设置暂时读取失败",
    );
    return [
      ...invalidResults,
      ...validPhones.map((phoneNumber) => resultForPreflightFailure(
        phoneNumber,
        "SMS_SETTINGS_READ_FAILED",
        message,
        true,
      )),
    ];
  }
  if (!settings.enabled) {
    return [
      ...invalidResults,
      ...validPhones.map((phoneNumber) => resultForConfigurationFailure(
        phoneNumber,
        "SMS_INTEGRATION_DISABLED",
        "短信通知未启用",
      )),
    ];
  }
  if (
    settings.provider !== SMS_PROVIDER_TENCENT_CLOUD
    || !settings.credentialsComplete
    || !settings.tencentSdkAppId
    || !settings.signName
    || !settings.templateId
  ) {
    return [
      ...invalidResults,
      ...validPhones.map((phoneNumber) => resultForConfigurationFailure(
        phoneNumber,
        "SMS_CONFIGURATION_INCOMPLETE",
        "腾讯云短信配置不完整",
      )),
    ];
  }

  let client: InstanceType<typeof TencentSmsClient>;
  try {
    client = new TencentSmsClient({
      credential: {
        secretId: settings.secretId,
        secretKey: settings.secretKey,
      },
      region: settings.region,
      profile: {
        signMethod: "TC3-HMAC-SHA256",
        language: "zh-CN",
        httpProfile: {
          reqMethod: "POST",
          protocol: "https://",
          endpoint: TENCENT_SMS_ENDPOINT,
          reqTimeout: 15,
        },
      },
    });
  } catch (error: unknown) {
    const message = cleanProviderText(
      error instanceof Error ? error.message : error,
      "腾讯云短信客户端初始化失败",
    );
    return [
      ...invalidResults,
      ...validPhones.map((phoneNumber) => resultForPreflightFailure(
        phoneNumber,
        "SMS_CLIENT_INITIALIZATION_FAILED",
        message,
        false,
      )),
    ];
  }

  try {
    const sessionContext = cleanSessionContext(input.sessionContext);
    const response = await client.SendSms({
      PhoneNumberSet: validPhones,
      SmsSdkAppId: settings.tencentSdkAppId,
      SignName: settings.signName,
      TemplateId: settings.templateId,
      TemplateParamSet: cleanTemplateParams(input.templateParams),
      ...(sessionContext ? { SessionContext: sessionContext } : {}),
    });
    const requestId = cleanProviderText(response.RequestId, "", 128) || undefined;
    const statusByPhone = new Map<string, NonNullable<typeof response.SendStatusSet>[number]>();
    for (const status of response.SendStatusSet || []) {
      const phoneNumber = normalizeChinaMobilePhone(status.PhoneNumber);
      if (phoneNumber) statusByPhone.set(phoneNumber, status);
    }
    const providerResults = validPhones.map((phoneNumber, index): SmsSendResult => {
      const status = statusByPhone.get(phoneNumber) || response.SendStatusSet?.[index];
      if (!status) {
        return {
          phoneNumber,
          accepted: false,
          code: "TENCENT_SMS_STATUS_MISSING",
          message: "腾讯云未返回该手机号的发送状态",
          requestId,
          retryable: true,
          outcomeUnknown: true,
        };
      }
      const code = cleanProviderCode(status.Code, "TENCENT_SMS_STATUS_UNKNOWN");
      const accepted = code.toUpperCase() === "OK";
      const classification = classifyTencentSmsFailure(code);
      return {
        phoneNumber,
        accepted,
        code,
        message: cleanProviderText(status.Message, accepted ? "腾讯云已受理" : "腾讯云拒绝发送"),
        serialNo: cleanProviderText(status.SerialNo, "", 128) || undefined,
        requestId,
        retryable: accepted ? false : classification.retryable,
        outcomeUnknown: accepted ? false : classification.outcomeUnknown,
      };
    });
    return [...invalidResults, ...providerResults];
  } catch (error: unknown) {
    const failure = providerExceptionDetails(error);
    return [
      ...invalidResults,
      ...validPhones.map((phoneNumber): SmsSendResult => ({
        phoneNumber,
        accepted: false,
        code: failure.code,
        message: failure.message,
        requestId: failure.requestId,
        retryable: failure.retryable,
        outcomeUnknown: failure.outcomeUnknown,
      })),
    ];
  }
}

export const tencentCloudSmsProvider: SmsProvider = {
  send: sendTencentCloudSms,
};
