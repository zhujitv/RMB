import crypto from "node:crypto";
import { codedError, isPlainRecord, nonEmpty, num } from "./shared-base-utils";
import { timingSafeEqualText } from "./shared-auth";
import { recordAt, textAt } from "./shipsgo-tracking-mapping-helpers";
import { safeJsonParse, type ShipsgoSettings } from "./shipsgo-tracking-utils";
import { createOutboundTimeoutSignal, readResponseTextLimited } from "./outbound-request-security";

type FreightowerTokenCache = {
  token: string;
  tokenType: string;
  expiresAt: number;
};

let tokenCache: FreightowerTokenCache | null = null;
const TRACKING_PROVIDER_TIMEOUT_MS = 15000;
const TRACKING_PROVIDER_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

function freightowerApiBaseUrl(settings: ShipsgoSettings) {
  return String(settings.freightowerApiBaseUrl || "https://openapi.freightower.com").replace(/\/+$/, "");
}

export function responseStatusCode(data: unknown) {
  const status = isPlainRecord(data) ? data.statusCode ?? recordAt(data, "data").statusCode : "";
  return String(status || "");
}

export function responseMessage(data: unknown) {
  if (!isPlainRecord(data)) return "";
  return nonEmpty(data.message || data.alertMessage || recordAt(data, "data").message);
}

function freightowerApiErrorMessage(path: string, responseStatus: number, data: unknown) {
  const statusCode = responseStatusCode(data);
  if (statusCode === "40300" || responseStatus === 403) {
    return `飞驼可视接口拒绝当前请求：${path} 返回 ${statusCode || responseStatus}。请联系飞驼确认该 Client ID 的应用接口授权、服务器出口 IP 白名单和集装箱综合跟踪查询接口权限。`;
  }
  if (statusCode === "40100" || responseStatus === 401) {
    return "飞驼可视登录状态已失效，请重新获取 Token 后再试。";
  }
  const message = responseMessage(data);
  const codeSuffix = statusCode ? `（statusCode ${statusCode}）` : "";
  return message ? `${message}${codeSuffix}` : `飞驼可视请求失败${codeSuffix}。`;
}

function isTokenExpiredResponse(data: unknown) {
  return responseStatusCode(data) === "40100";
}

function isFreightowerSuccessStatus(statusCode: string) {
  return !statusCode || statusCode === "20000" || statusCode === "20001";
}

export function freightowerSubscribedMessage(payload: unknown) {
  const message = responseMessage(payload);
  return /订阅成功|subscription/i.test(message)
    ? "已订阅，等待飞驼推送或船司返回运输节点。"
    : message;
}

async function getFreightowerToken(settings: ShipsgoSettings, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && tokenCache?.token && tokenCache.expiresAt > now + 60_000) return tokenCache;
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${freightowerApiBaseUrl(settings)}/auth/api/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        clientId: settings.freightowerClientId,
        secret: settings.freightowerSecret,
      }),
      cache: "no-store",
      redirect: "error",
      signal: createOutboundTimeoutSignal(TRACKING_PROVIDER_TIMEOUT_MS),
    });
    text = await readResponseTextLimited(response, TRACKING_PROVIDER_RESPONSE_MAX_BYTES);
  } catch {
    throw codedError("飞驼可视 Token 获取失败。", 502, "FREIGHTOWER_TOKEN_FAILED");
  }
  const data = text ? safeJsonParse(text) : {};
  const tokenData = recordAt(data, "data");
  const accessToken = textAt(tokenData, "access_token") || textAt(data, "access_token");
  if (!response.ok || !accessToken) {
    throw codedError(responseMessage(data) || "飞驼可视 Token 获取失败。", response.status >= 500 ? 502 : 400, "FREIGHTOWER_TOKEN_FAILED");
  }
  const expiresInSeconds = num(textAt(tokenData, "expires_in") || textAt(data, "expires_in"), 3600);
  tokenCache = {
    token: accessToken,
    tokenType: textAt(tokenData, "token_type") || textAt(data, "token_type") || "bearer",
    expiresAt: now + Math.max(300, expiresInSeconds) * 1000,
  };
  return tokenCache;
}

export async function freightowerApiRequest<T>(
  settings: ShipsgoSettings,
  path: string,
  body: Record<string, unknown>,
  forceTokenRefresh = false,
): Promise<T> {
  const token = await getFreightowerToken(settings, forceTokenRefresh);
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${freightowerApiBaseUrl(settings)}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `${token.tokenType} ${token.token}`,
        access_token: token.token,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: createOutboundTimeoutSignal(TRACKING_PROVIDER_TIMEOUT_MS),
    });
    text = await readResponseTextLimited(response, TRACKING_PROVIDER_RESPONSE_MAX_BYTES);
  } catch {
    throw codedError(freightowerApiErrorMessage(path, 502, {}), 502, "FREIGHTOWER_API_ERROR");
  }
  const data = text ? safeJsonParse(text) : {};
  if (isTokenExpiredResponse(data) && !forceTokenRefresh) {
    tokenCache = null;
    return freightowerApiRequest<T>(settings, path, body, true);
  }
  const statusCode = responseStatusCode(data);
  if (!response.ok || !isFreightowerSuccessStatus(statusCode)) {
    throw codedError(freightowerApiErrorMessage(path, response.status, data), response.status >= 500 ? 502 : 400, "FREIGHTOWER_API_ERROR");
  }
  return data as T;
}

export function assertFreightowerOceanEnabled(settings: ShipsgoSettings) {
  if (!settings.enabled) throw codedError("物流跟踪接口未启用。", 400, "TRACKING_INTEGRATION_DISABLED");
  if (!settings.freightowerEnabled) throw codedError("飞驼可视接口未启用。", 400, "FREIGHTOWER_PROVIDER_DISABLED");
  if (!settings.freightowerClientId || !settings.freightowerSecret) {
    throw codedError("飞驼可视 Client ID 或 Secret 未配置。", 400, "FREIGHTOWER_CREDENTIAL_REQUIRED");
  }
  if (!settings.oceanTrackingEnabled) throw codedError("飞驼可视海运跟踪功能未启用。", 400, "FREIGHTOWER_OCEAN_DISABLED");
}

export function verifyFreightowerWebhookSignature(settings: ShipsgoSettings, rawBody: string, headers: Headers) {
  if (!settings.freightowerWebhookSecret) return false;
  const timestamp = nonEmpty(headers.get("x-ft-timestamp"));
  const nonce = nonEmpty(headers.get("x-ft-nonce"));
  const client = nonEmpty(headers.get("x-ft-client"));
  const signature = nonEmpty(headers.get("x-ft-signature"));
  if (!timestamp || !nonce || !client || !signature) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return false;
  const expected = crypto
    .createHmac("sha1", settings.freightowerWebhookSecret)
    .update(`${timestamp}/${nonce}/${client}/${rawBody}`)
    .digest("base64");
  return timingSafeEqualText(signature, expected);
}
