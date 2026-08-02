import { codedError, nonEmpty, type AppError } from "./shared-base-utils";
import { getWechatMiniSettings } from "./wechat-mini-config";

const CODE_SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session";
const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/stable_token";
const SEND_URL = "https://api.weixin.qq.com/cgi-bin/message/subscribe/send";
const TIMEOUT_MS = 15_000;
const TOKEN_ERROR_CODES = new Set([40001, 40014, 42001]);
const TRANSIENT_CODES = new Set([-1, 45009, 45011]);

type ApiResponse = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
  openid?: string;
  unionid?: string;
  session_key?: string;
};

type ProviderError = AppError & { deliveryOutcome?: "rejected" | "unknown"; retryable?: boolean };
type TokenCache = { appId: string; token: string; expiresAt: number } | null;
type MiniCredentials = Awaited<ReturnType<typeof getWechatMiniSettings>>;
type ProviderDependencies = {
  loadSettings?: () => Promise<MiniCredentials>;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type WechatMiniMessage = {
  openId: string;
  templateId: string;
  page?: string;
  orderNo: string;
  statusText: string;
  eventTimeText: string;
  eventText: string;
};

function normalizeTemplateDate(value: string) {
  const match = value.match(/(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})/);
  if (!match) return value.slice(0, 15);
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function templateFieldValue(field: string, value: string) {
  const text = nonEmpty(value);
  const type = field.replace(/\d+$/, "").toLowerCase();
  if (type === "date") return normalizeTemplateDate(text);
  if (type === "phrase" || type === "short_thing") return text.slice(0, 5);
  if (type === "thing") return text.slice(0, 20);
  if (type === "character_string" || type === "number") return text.slice(0, 32);
  return text.slice(0, 32);
}

function disposition(error: AppError, outcome: "rejected" | "unknown", retryable: boolean) {
  const typed = error as ProviderError;
  typed.deliveryOutcome = outcome;
  typed.retryable = retryable;
  return typed;
}

function apiError(payload: ApiResponse, message: string) {
  const code = Number(payload.errcode || 0);
  const detail = nonEmpty(payload.errmsg).slice(0, 160);
  return disposition(codedError(
    `${message}${code ? `（微信错误码 ${code}${detail ? `：${detail}` : ""}）` : ""}`,
    502,
    code ? `WECHAT_MINI_API_${code}` : "WECHAT_MINI_API_ERROR",
  ), "rejected", TRANSIENT_CODES.has(code));
}

function transportError(delivery: boolean) {
  return disposition(codedError(
    delivery ? "小程序消息发送结果未知，系统不会自动重复发送" : "微信小程序接口暂时无法连接",
    502,
    delivery ? "WECHAT_MINI_DELIVERY_OUTCOME_UNKNOWN" : "WECHAT_MINI_API_UNAVAILABLE",
  ), delivery ? "unknown" : "rejected", !delivery);
}

export function isWechatMiniDeliveryOutcomeUnknown(error: unknown) {
  return (error as ProviderError | null)?.deliveryOutcome === "unknown";
}

export function isWechatMiniProviderRetryable(error: unknown) {
  return (error as ProviderError | null)?.retryable === true;
}

export function createWechatMiniProvider({
  loadSettings = getWechatMiniSettings,
  fetchImpl = fetch,
  now = Date.now,
}: ProviderDependencies = {}) {
  let tokenCache: TokenCache = null;
  let tokenRequest: Promise<string> | null = null;

  async function parseResponse(response: Response, delivery = false) {
    try {
      const payload = await response.json() as ApiResponse;
      if (!response.ok && !payload.errcode) throw transportError(delivery);
      return payload;
    } catch (error) {
      if ((error as ProviderError)?.deliveryOutcome) throw error;
      throw transportError(delivery);
    }
  }

  async function request(url: string, init: RequestInit, delivery = false) {
    try {
      return await parseResponse(await fetchImpl(url, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }), delivery);
    } catch (error) {
      if ((error as ProviderError)?.deliveryOutcome) throw error;
      throw transportError(delivery);
    }
  }

  async function exchangeLoginCode(code: string) {
    const settings = await loadSettings();
    if (!settings.enabled || !settings.appId || !settings.appSecret) {
      throw codedError("微信小程序尚未启用", 503, "WECHAT_MINI_DISABLED");
    }
    const url = new URL(CODE_SESSION_URL);
    url.searchParams.set("appid", settings.appId);
    url.searchParams.set("secret", settings.appSecret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");
    const payload = await request(url.toString(), { method: "GET" });
    if (payload.errcode || !nonEmpty(payload.openid)) throw apiError(payload, "微信小程序登录失败");
    return { openId: nonEmpty(payload.openid), unionId: nonEmpty(payload.unionid) || null };
  }

  async function requestAccessToken() {
    const settings = await loadSettings();
    if (!settings.enabled || !settings.appId || !settings.appSecret) {
      throw codedError("微信小程序 AppID 或 AppSecret 未配置", 503, "WECHAT_MINI_CREDENTIAL_REQUIRED");
    }
    const payload = await request(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credential", appid: settings.appId, secret: settings.appSecret, force_refresh: false }),
    });
    if (payload.errcode || !nonEmpty(payload.access_token)) throw apiError(payload, "微信小程序未返回 Access Token");
    tokenCache = {
      appId: settings.appId,
      token: nonEmpty(payload.access_token),
      expiresAt: now() + Math.max(60, Number(payload.expires_in || 7200)) * 1000,
    };
    return tokenCache.token;
  }

  async function getAccessToken(bypassCache = false) {
    const settings = await loadSettings();
    if (!bypassCache && tokenCache?.appId === settings.appId && tokenCache.expiresAt > now() + 5 * 60_000) return tokenCache.token;
    if (tokenRequest) return tokenRequest;
    tokenRequest = requestAccessToken();
    try { return await tokenRequest; } finally { tokenRequest = null; }
  }

  async function sendWithToken(message: WechatMiniMessage, token: string) {
    const settings = await loadSettings();
    return request(`${SEND_URL}?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        touser: message.openId,
        template_id: message.templateId,
        page: message.page || "pages/trackings/index",
        miniprogram_state: "formal",
        lang: "zh_CN",
        data: {
          [settings.orderField]: { value: templateFieldValue(settings.orderField, message.orderNo) },
          [settings.statusField]: { value: templateFieldValue(settings.statusField, message.statusText) },
          [settings.eventTimeField]: { value: templateFieldValue(settings.eventTimeField, message.eventTimeText) },
          [settings.eventField]: { value: templateFieldValue(settings.eventField, message.eventText) },
        },
      }),
    }, true);
  }

  async function sendSubscriptionMessage(message: WechatMiniMessage) {
    let payload = await sendWithToken(message, await getAccessToken());
    if (TOKEN_ERROR_CODES.has(Number(payload.errcode))) {
      tokenCache = null;
      payload = await sendWithToken(message, await getAccessToken(true));
    }
    if (Number(payload.errcode || 0) !== 0) throw apiError(payload, "微信小程序订阅消息发送失败");
    return { success: true };
  }

  async function testConnection() {
    await getAccessToken(true);
    return { success: true, message: "微信小程序 AppID、AppSecret 验证成功" };
  }

  return { exchangeLoginCode, getAccessToken, sendSubscriptionMessage, testConnection };
}

const provider = createWechatMiniProvider();
export const exchangeWechatMiniLoginCode = provider.exchangeLoginCode;
export const sendWechatMiniSubscriptionMessage = provider.sendSubscriptionMessage;
export const testWechatMiniConnection = provider.testConnection;
