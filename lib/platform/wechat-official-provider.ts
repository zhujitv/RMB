import { codedError, nonEmpty, type AppError } from "./shared-base-utils";
import { getWechatOfficialSettings } from "./wechat-official-config";

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/stable_token";
const SEND_URL = "https://api.weixin.qq.com/cgi-bin/message/template/subscribe";
const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_ERROR_CODES = new Set([40001, 40014, 42001]);
const TRANSIENT_WECHAT_CODES = new Set([-1, 45009, 45011]);

type TokenCache = { appId: string; token: string; expiresAt: number } | null;
type WechatDeliveryOutcome = "rejected" | "unknown";

type WechatApiResponse = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
};

type WechatProviderError = AppError & {
  deliveryOutcome?: WechatDeliveryOutcome;
  retryable?: boolean;
};

type WechatCredentials = {
  appId: string;
  appSecret: string;
};

type WechatProviderDependencies = {
  loadSettings: () => Promise<WechatCredentials>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

export type WechatOneTimeMessage = {
  openId: string;
  templateId: string;
  scene: number;
  title: string;
  content: string;
  url?: string;
};

function withProviderDisposition(
  error: AppError,
  outcome: WechatDeliveryOutcome,
  retryable: boolean,
) {
  const providerError = error as WechatProviderError;
  providerError.deliveryOutcome = outcome;
  providerError.retryable = retryable;
  return providerError;
}

function apiPayloadError(payload: WechatApiResponse, fallback: string) {
  const code = Number(payload.errcode || 0);
  const detail = nonEmpty(payload.errmsg).slice(0, 160);
  return withProviderDisposition(
    codedError(
      `${fallback}${code ? `（微信错误码 ${code}${detail ? `：${detail}` : ""}）` : ""}`,
      502,
      code ? `WECHAT_API_${code}` : "WECHAT_API_ERROR",
    ),
    "rejected",
    TRANSIENT_WECHAT_CODES.has(code),
  );
}

function transportError(message: string, code: string, deliveryRequest: boolean) {
  return withProviderDisposition(
    codedError(message, 502, code),
    deliveryRequest ? "unknown" : "rejected",
    !deliveryRequest,
  );
}

export function isWechatDeliveryOutcomeUnknown(error: unknown) {
  return (error as WechatProviderError | null)?.deliveryOutcome === "unknown";
}

export function isWechatProviderRetryable(error: unknown) {
  return (error as WechatProviderError | null)?.retryable === true;
}

export function createWechatOfficialProvider({
  loadSettings,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: WechatProviderDependencies) {
  let tokenCache: TokenCache = null;
  let tokenRequest: Promise<string> | null = null;

  async function postWechatApi(
    url: string,
    body: Record<string, unknown>,
    deliveryRequest = false,
  ) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw transportError(
        deliveryRequest ? "微信发送请求结果未知，系统不会自动重复发送" : "微信接口暂时无法连接",
        deliveryRequest ? "WECHAT_DELIVERY_OUTCOME_UNKNOWN" : "WECHAT_API_UNAVAILABLE",
        deliveryRequest,
      );
    }

    let payload: WechatApiResponse = {};
    try {
      payload = await response.json() as WechatApiResponse;
    } catch {
      throw transportError(
        deliveryRequest ? "微信发送结果无法确认，系统不会自动重复发送" : "微信接口返回了无法解析的数据",
        deliveryRequest ? "WECHAT_DELIVERY_OUTCOME_UNKNOWN" : "WECHAT_API_INVALID_RESPONSE",
        deliveryRequest,
      );
    }
    if (!response.ok) {
      if (Number.isFinite(Number(payload.errcode)) && Number(payload.errcode) !== 0) {
        throw apiPayloadError(payload, "微信接口请求失败");
      }
      throw transportError(
        deliveryRequest ? "微信发送结果无法确认，系统不会自动重复发送" : "微信接口请求失败",
        deliveryRequest ? "WECHAT_DELIVERY_OUTCOME_UNKNOWN" : "WECHAT_API_HTTP_ERROR",
        deliveryRequest,
      );
    }
    return payload;
  }

  async function requestStableToken(settings: WechatCredentials) {
    const payload = await postWechatApi(TOKEN_URL, {
      grant_type: "client_credential",
      appid: settings.appId,
      secret: settings.appSecret,
      // Stable Token 普通模式会返回账号当前有效 Token；不能在多实例中强制刷新。
      force_refresh: false,
    });
    const token = nonEmpty(payload.access_token);
    const expiresIn = Math.max(60, Number(payload.expires_in || 7200));
    if (!token) throw apiPayloadError(payload, "微信未返回 Access Token");
    tokenCache = {
      appId: settings.appId,
      token,
      expiresAt: now() + expiresIn * 1000,
    };
    return token;
  }

  async function getStableAccessToken(options: { bypassCache?: boolean } = {}) {
    const settings = await loadSettings();
    if (!settings.appId || !settings.appSecret) {
      throw codedError("微信公众号 AppID 或 AppSecret 未配置", 503, "WECHAT_OFFICIAL_CREDENTIAL_REQUIRED");
    }
    if (!options.bypassCache && tokenCache?.appId === settings.appId && tokenCache.expiresAt > now() + 5 * 60_000) {
      return tokenCache.token;
    }
    if (tokenRequest) return tokenRequest;
    tokenRequest = requestStableToken(settings);
    try {
      return await tokenRequest;
    } finally {
      tokenRequest = null;
    }
  }

  async function sendWithToken(message: WechatOneTimeMessage, accessToken: string) {
    const url = `${SEND_URL}?access_token=${encodeURIComponent(accessToken)}`;
    return postWechatApi(url, {
      touser: message.openId,
      template_id: message.templateId,
      url: message.url || undefined,
      scene: String(message.scene),
      title: message.title.slice(0, 15),
      data: { content: { value: message.content.slice(0, 200) } },
    }, true);
  }

  async function sendOneTimeMessage(message: WechatOneTimeMessage) {
    let payload = await sendWithToken(message, await getStableAccessToken());
    if (TOKEN_ERROR_CODES.has(Number(payload.errcode))) {
      tokenCache = null;
      // 失效恢复仍使用普通模式，获取公众号当前 Token，不生成会使其他实例失效的新 Token。
      payload = await sendWithToken(message, await getStableAccessToken({ bypassCache: true }));
    }
    if (Number(payload.errcode || 0) !== 0) throw apiPayloadError(payload, "微信订阅消息发送失败");
    return { success: true, message: "微信公众号连接与发送凭据验证成功" };
  }

  async function testConnection() {
    // 绕过本地缓存以验证当前保存的密钥，但稳定 Token 仍不强制刷新。
    await getStableAccessToken({ bypassCache: true });
    return { success: true, message: "微信公众号 AppID、AppSecret 验证成功" };
  }

  return {
    getStableAccessToken,
    sendOneTimeMessage,
    testConnection,
    clearTokenCache() { tokenCache = null; },
  };
}

const defaultProvider = createWechatOfficialProvider({ loadSettings: getWechatOfficialSettings });

export const getWechatStableAccessToken = defaultProvider.getStableAccessToken;
export const sendWechatOneTimeMessage = defaultProvider.sendOneTimeMessage;
export const testWechatOfficialConnection = defaultProvider.testConnection;

export function clearWechatTokenCacheForTests() {
  defaultProvider.clearTokenCache();
}
