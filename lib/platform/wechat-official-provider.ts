import { codedError, nonEmpty, type AppError } from "./shared-base-utils";
import { getWechatOfficialSettings } from "./wechat-official-config";
import { wechatTemplateData, wechatTemplateFieldKeys, type WechatTemplateMessageContent } from "./wechat-official-template";

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/stable_token";
const SEND_URL = "https://api.weixin.qq.com/cgi-bin/message/template/send";
const TEMPLATE_LIST_URL = "https://api.weixin.qq.com/cgi-bin/template/get_all_private_template";
const OAUTH_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token";
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
  openid?: string;
  subscribe?: number;
  template_list?: Array<{ template_id?: string; title?: string; content?: string }>;
};
type WechatProviderError = AppError & {
  deliveryOutcome?: WechatDeliveryOutcome;
  retryable?: boolean;
};
type WechatCredentials = {
  appId: string;
  appSecret: string;
  templateId?: string;
};
type WechatProviderDependencies = {
  loadSettings: () => Promise<WechatCredentials>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};
export type WechatTemplateMessage = WechatTemplateMessageContent & {
  openId: string;
  templateId: string;
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

function isTokenError(error: unknown) {
  const code = nonEmpty((error as { code?: unknown } | null)?.code);
  return Array.from(TOKEN_ERROR_CODES).some((value) => code === `WECHAT_API_${value}`);
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
  const templateFieldCache = new Map<string, { keys: string[]; expiresAt: number }>();

  async function getWechatApi(url: string) {
    let response: Response;
    try {
      response = await fetchImpl(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw transportError("微信接口暂时无法连接", "WECHAT_API_UNAVAILABLE", false);
    }
    let payload: WechatApiResponse = {};
    try {
      payload = await response.json() as WechatApiResponse;
    } catch {
      throw transportError("微信接口返回了无法解析的数据", "WECHAT_API_INVALID_RESPONSE", false);
    }
    if (!response.ok || Number(payload.errcode || 0) !== 0) throw apiPayloadError(payload, "微信接口请求失败");
    return payload;
  }

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

  async function templateFieldKeys(templateId: string, accessToken: string) {
    const cached = templateFieldCache.get(templateId);
    if (cached && cached.expiresAt > now()) return cached.keys;
    const payload = await getWechatApi(`${TEMPLATE_LIST_URL}?access_token=${encodeURIComponent(accessToken)}`);
    const template = (payload.template_list || []).find((item) => nonEmpty(item.template_id) === templateId);
    if (!template) {
      throw codedError("公众号后台未找到当前模板 ID，请在模板消息中添加模板后重新保存", 400, "WECHAT_TEMPLATE_NOT_FOUND");
    }
    const keys = wechatTemplateFieldKeys(template.content);
    templateFieldCache.set(templateId, { keys, expiresAt: now() + 10 * 60_000 });
    return keys;
  }

  async function sendWithToken(message: WechatTemplateMessage, accessToken: string) {
    const url = `${SEND_URL}?access_token=${encodeURIComponent(accessToken)}`;
    const keys = await templateFieldKeys(message.templateId, accessToken);
    return postWechatApi(url, {
      touser: message.openId,
      template_id: message.templateId,
      url: message.url || undefined,
      data: wechatTemplateData(keys, message),
    }, true);
  }

  async function sendTemplateMessage(message: WechatTemplateMessage) {
    let payload: WechatApiResponse;
    try {
      payload = await sendWithToken(message, await getStableAccessToken());
    } catch (error: unknown) {
      if (!isTokenError(error)) throw error;
      tokenCache = null;
      templateFieldCache.delete(message.templateId);
      payload = await sendWithToken(message, await getStableAccessToken({ bypassCache: true }));
    }
    if (TOKEN_ERROR_CODES.has(Number(payload.errcode))) {
      tokenCache = null;
      templateFieldCache.delete(message.templateId);
      // 失效恢复仍使用普通模式，获取公众号当前 Token，不生成会使其他实例失效的新 Token。
      payload = await sendWithToken(message, await getStableAccessToken({ bypassCache: true }));
    }
    if (Number(payload.errcode || 0) !== 0) throw apiPayloadError(payload, "微信模板消息发送失败");
    return { success: true, message: "微信公众号模板消息已被微信接收" };
  }

  async function exchangeOAuthCode(code: string) {
    const settings = await loadSettings();
    if (!settings.appId || !settings.appSecret) {
      throw codedError("微信公众号 AppID 或 AppSecret 未配置", 503, "WECHAT_OFFICIAL_CREDENTIAL_REQUIRED");
    }
    const url = new URL(OAUTH_TOKEN_URL);
    url.searchParams.set("appid", settings.appId);
    url.searchParams.set("secret", settings.appSecret);
    url.searchParams.set("code", code);
    url.searchParams.set("grant_type", "authorization_code");
    const payload = await getWechatApi(url.toString());
    const openId = nonEmpty(payload.openid);
    if (!openId) throw apiPayloadError(payload, "微信网页授权未返回 OpenID");
    return { openId };
  }

  async function assertFollower(openId: string) {
    const accessToken = await getStableAccessToken();
    const url = new URL("https://api.weixin.qq.com/cgi-bin/user/info");
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("openid", openId);
    url.searchParams.set("lang", "zh_CN");
    const payload = await getWechatApi(url.toString());
    if (Number(payload.subscribe || 0) !== 1) {
      throw codedError("请先关注公司公众号，再返回系统完成微信绑定", 400, "WECHAT_OFFICIAL_FOLLOW_REQUIRED");
    }
    return { followed: true };
  }

  async function testConnection() {
    // 绕过本地缓存以验证当前保存的密钥，但稳定 Token 仍不强制刷新。
    const settings = await loadSettings();
    const accessToken = await getStableAccessToken({ bypassCache: true });
    if (settings.templateId) await templateFieldKeys(settings.templateId, accessToken);
    return { success: true, message: "微信公众号凭据和模板消息配置验证成功" };
  }

  return {
    getStableAccessToken,
    sendTemplateMessage,
    exchangeOAuthCode,
    assertFollower,
    testConnection,
    clearTokenCache() { tokenCache = null; },
  };
}

const defaultProvider = createWechatOfficialProvider({ loadSettings: getWechatOfficialSettings });

export const getWechatStableAccessToken = defaultProvider.getStableAccessToken;
export const sendWechatTemplateMessage = defaultProvider.sendTemplateMessage;
export const exchangeWechatOfficialOAuthCode = defaultProvider.exchangeOAuthCode;
export const assertWechatOfficialFollower = defaultProvider.assertFollower;
export const testWechatOfficialConnection = defaultProvider.testConnection;

export function clearWechatTokenCacheForTests() {
  defaultProvider.clearTokenCache();
}
