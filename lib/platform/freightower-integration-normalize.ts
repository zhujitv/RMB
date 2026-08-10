import { DEFAULT_SHIPSGO_INTEGRATION_SETTINGS } from "./shared-constants";
import { codedError, isPlainRecord, nonEmpty } from "./shared-base-utils";

type ShipsgoIntegrationInput = {
  enabled?: unknown;
  freightowerApiBaseUrl?: unknown;
  freightowerApiKey?: unknown;
  freightowerClientId?: unknown;
  freightowerApiSecret?: unknown;
  freightowerIframeKey?: unknown;
  freightowerWebhookAccessSecret?: unknown;
  freightowerSecret?: unknown;
  freightowerAppId?: unknown;
  freightowerAppSecret?: unknown;
  freightowerDataSecret?: unknown;
  freightowerTokenSecret?: unknown;
  freightowerMapKey?: unknown;
  freightowerWebhookSecret?: unknown;
  freightowerDefaultCarrierCode?: unknown;
  freightowerDefaultPortCode?: unknown;
  freightowerDefaultIsExport?: unknown;
  freightowerDefaultLang?: unknown;
  freightowerHiddenReference?: unknown;
  oceanTrackingEnabled?: unknown;
  customsTrackingEnabled?: unknown;
  airTrackingEnabled?: unknown;
  manualSyncEnabled?: unknown;
  autoSyncEnabled?: unknown;
  dailySyncTime?: unknown;
  webhookEnabled?: unknown;
  liveMapEnabled?: unknown;
  customerPushEnabled?: unknown;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const FREIGHTOWER_API_HOSTS = new Set(["openapi.freightower.com"]);

export const FREIGHTOWER_SECRET_FIELDS = [
  "freightowerAppId",
  "freightowerAppSecret",
  "freightowerApiKey",
  "freightowerClientId",
  "freightowerApiSecret",
  "freightowerTokenSecret",
  "freightowerDataSecret",
  "freightowerIframeKey",
  "freightowerWebhookAccessSecret",
  // Keep legacy AAD field names decryptable until the next settings save migrates them.
  "freightowerSecret",
  "freightowerMapKey",
  "freightowerWebhookSecret",
] as const;

export function cleanFreightowerSecret(value: unknown, limit = 500) {
  return nonEmpty(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, limit).trim();
}

function migratedFreightowerApiKey(input: ShipsgoIntegrationInput) {
  const directApiKey = cleanFreightowerSecret(input.freightowerApiKey);
  if (directApiKey) return directApiKey;
  const legacyValue = cleanFreightowerSecret(
    input.freightowerSecret || input.freightowerTokenSecret || input.freightowerAppSecret,
  );
  // Do not reinterpret a short account password as an API key.
  return legacyValue.length >= 20 ? legacyValue : "";
}

function migratedFreightowerApiSecret(input: ShipsgoIntegrationInput) {
  const directSecret = cleanFreightowerSecret(input.freightowerApiSecret);
  if (directSecret) return directSecret;
  const legacySecret = cleanFreightowerSecret(
    input.freightowerSecret || input.freightowerTokenSecret || input.freightowerAppSecret,
  );
  // Recover only unambiguous legacy short secrets; a long legacy value was an API key.
  return legacySecret && legacySecret.length < 20 ? legacySecret : "";
}

function cleanProviderApiUrl(value: unknown, fallback: string) {
  const text = nonEmpty(value || fallback);
  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!["http:", "https:"].includes(url.protocol)) {
      throw codedError("飞驼可视 API 地址只支持 HTTPS", 400, "VALIDATION_INVALID_URL");
    }
    if (url.username || url.password || url.port || !FREIGHTOWER_API_HOSTS.has(hostname)) {
      throw codedError("飞驼可视 API 地址必须使用官方 API 域名", 400, "VALIDATION_INVALID_URL");
    }
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (pathname !== "/") {
      throw codedError("飞驼可视 API 地址路径不受支持", 400, "VALIDATION_INVALID_URL");
    }
    url.protocol = "https:";
    url.hostname = hostname;
    url.pathname = pathname;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (error) {
    if ((error as { status?: number } | null)?.status) throw error;
    throw codedError("飞驼可视 API 地址格式错误", 400, "VALIDATION_INVALID_URL");
  }
}

function cleanProviderCode(value: unknown, fallback = "", limit = 32) {
  return cleanFreightowerSecret(value || fallback, limit).toUpperCase();
}

function cleanFreightowerLang(value: unknown) {
  const lang = nonEmpty(value || DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.freightowerDefaultLang).toLowerCase();
  return ["zh", "en", "jp"].includes(lang) ? lang : "zh";
}

function cleanFreightowerIsExport(value: unknown) {
  const flag = nonEmpty(value).toUpperCase();
  return flag === "E" || flag === "I" ? flag : "";
}

function cleanDailySyncTime(value: unknown) {
  const text = nonEmpty(value || DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.dailySyncTime);
  if (!TIME_PATTERN.test(text)) {
    throw codedError("每日同步时间格式应为 HH:mm", 400, "VALIDATION_INVALID_TIME");
  }
  return text;
}

export function normalizeShipsgoIntegrationSettings(value: unknown = {}) {
  const input: ShipsgoIntegrationInput = isPlainRecord(value) ? value : {};
  return {
    enabled: input.enabled === true,
    activeProvider: "FREIGHTOWER" as const,
    freightowerEnabled: true,
    freightowerApiBaseUrl: cleanProviderApiUrl(
      input.freightowerApiBaseUrl,
      DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.freightowerApiBaseUrl,
    ),
    freightowerApiKey: migratedFreightowerApiKey(input),
    freightowerClientId: cleanFreightowerSecret(input.freightowerClientId, 128),
    freightowerApiSecret: migratedFreightowerApiSecret(input),
    freightowerIframeKey: cleanFreightowerSecret(input.freightowerIframeKey || input.freightowerMapKey),
    freightowerWebhookAccessSecret: cleanFreightowerSecret(input.freightowerWebhookAccessSecret || input.freightowerWebhookSecret),
    freightowerDefaultCarrierCode: cleanProviderCode(input.freightowerDefaultCarrierCode, DEFAULT_SHIPSGO_INTEGRATION_SETTINGS.freightowerDefaultCarrierCode),
    freightowerDefaultPortCode: cleanProviderCode(input.freightowerDefaultPortCode, "", 16),
    freightowerDefaultIsExport: cleanFreightowerIsExport(input.freightowerDefaultIsExport),
    freightowerDefaultLang: cleanFreightowerLang(input.freightowerDefaultLang),
    freightowerHiddenReference: input.freightowerHiddenReference === true,
    oceanTrackingEnabled: input.oceanTrackingEnabled !== false,
    customsTrackingEnabled: input.customsTrackingEnabled === true,
    airTrackingEnabled: false,
    manualSyncEnabled: input.manualSyncEnabled !== false,
    autoSyncEnabled: true,
    dailySyncTime: cleanDailySyncTime(input.dailySyncTime),
    webhookEnabled: input.webhookEnabled === true,
    liveMapEnabled: input.liveMapEnabled === true,
    customerPushEnabled: false,
  };
}
