import crypto from "node:crypto";
import { codedError, isPlainRecord, nonEmpty } from "./shared-base-utils";
import { timingSafeEqualText } from "./shared-auth";
import { recordAt } from "./shipsgo-tracking-mapping-helpers";
import { safeJsonParse, type ShipsgoSettings } from "./shipsgo-tracking-utils";
import { createOutboundTimeoutSignal, readResponseTextLimited } from "./outbound-request-security";

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
  if (statusCode === "40101") {
    return "飞驼可视 API Key 认证失败，请检查 API Key。";
  }
  if (statusCode === "40102") {
    return "飞驼可视 API Key 所属账号已停用，请联系飞驼客服恢复。";
  }
  if (statusCode === "40103") {
    return "飞驼可视 API Key 所属账号不存在，请联系飞驼客服确认授权。";
  }
  if (statusCode === "40300" || responseStatus === 403) {
    const product = path.startsWith("/terminal/") ? "中国港区跟踪产品权限" : "集装箱综合跟踪查询权限";
    return `飞驼可视接口拒绝当前请求：${path} 返回 ${statusCode || responseStatus}。请联系飞驼确认该 API Key 的接口授权、服务器出口 IP 白名单和${product}。`;
  }
  if (statusCode === "40100" || responseStatus === 401) {
    return "飞驼可视 API Key 无效，请检查 API Key 是否完整并已获得接口授权。";
  }
  if (statusCode === "42900" || responseStatus === 429) {
    return "飞驼可视调用频率超过限制，请稍后重试。";
  }
  const message = responseMessage(data);
  const codeSuffix = statusCode ? `（statusCode ${statusCode}）` : "";
  return message ? `${message}${codeSuffix}` : `飞驼可视请求失败${codeSuffix}。`;
}

function isFreightowerAcceptedStatus(statusCode: string) {
  return !statusCode || statusCode === "20000" || statusCode === "20001";
}

export function freightowerSubscribedMessage(payload: unknown) {
  const message = responseMessage(payload);
  return responseStatusCode(payload) === "20001" || /订阅成功|subscription/i.test(message)
    ? "飞驼暂未返回运输数据，系统将继续自动查询。"
    : message;
}

async function executeFreightowerApiRequest(
  settings: ShipsgoSettings,
  path: string,
  body: Record<string, unknown> | undefined,
  method: "GET" | "POST" = "POST",
) {
  if (!settings.freightowerApiKey) {
    throw codedError("请先填写飞驼 API Key。", 400, "FREIGHTOWER_CREDENTIAL_REQUIRED");
  }
  const requestBody = body ? JSON.stringify(body) : undefined;
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${freightowerApiBaseUrl(settings)}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${settings.freightowerApiKey}`,
      },
      ...(requestBody ? { body: requestBody } : {}),
      cache: "no-store",
      redirect: "error",
      signal: createOutboundTimeoutSignal(TRACKING_PROVIDER_TIMEOUT_MS),
    });
    text = await readResponseTextLimited(response, TRACKING_PROVIDER_RESPONSE_MAX_BYTES);
  } catch {
    throw codedError(freightowerApiErrorMessage(path, 502, {}), 502, "FREIGHTOWER_API_ERROR");
  }
  const data = text ? safeJsonParse(text) : {};
  return { response, data };
}

export async function testFreightowerConnection(settings: ShipsgoSettings) {
  const { response, data } = await executeFreightowerApiRequest(settings, "/application/v1/query", {});
  const statusCode = responseStatusCode(data);
  const authenticationAccepted = response.ok
    && ["20000", "20001", "40000", "40020"].includes(statusCode);
  if (!authenticationAccepted) {
    throw codedError(
      freightowerApiErrorMessage("/application/v1/query", response.status, data),
      response.status >= 500 ? 502 : 400,
      "FREIGHTOWER_API_ERROR",
    );
  }
  return {
    success: true,
    message: "连接成功，飞驼 API Key 直连认证正常。",
  };
}

export async function freightowerApiRequest<T>(
  settings: ShipsgoSettings,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const requestPath = path;
  const { response, data } = await executeFreightowerApiRequest(settings, requestPath, body);
  const statusCode = responseStatusCode(data);
  if (!response.ok || !isFreightowerAcceptedStatus(statusCode)) {
    const isPortPermissionDenied = requestPath.startsWith("/terminal/")
      && (statusCode === "40300" || response.status === 403);
    throw codedError(
      freightowerApiErrorMessage(requestPath, response.status, data),
      response.status >= 500 ? 502 : 400,
      isPortPermissionDenied ? "FREIGHTOWER_PORT_PERMISSION_REQUIRED" : "FREIGHTOWER_API_ERROR",
    );
  }
  return data as T;
}

export async function freightowerApiGet<T>(
  settings: ShipsgoSettings,
  path: string,
  query: Record<string, string>,
): Promise<T> {
  const search = new URLSearchParams(query);
  const requestPath = `${path}?${search.toString()}`;
  const { response, data } = await executeFreightowerApiRequest(settings, requestPath, undefined, "GET");
  const statusCode = responseStatusCode(data);
  if (!response.ok || !isFreightowerAcceptedStatus(statusCode)) {
    const isPortPermissionDenied = path.startsWith("/terminal/")
      && (statusCode === "40300" || response.status === 403);
    throw codedError(
      freightowerApiErrorMessage(path, response.status, data),
      response.status >= 500 ? 502 : 400,
      isPortPermissionDenied ? "FREIGHTOWER_PORT_PERMISSION_REQUIRED" : "FREIGHTOWER_API_ERROR",
    );
  }
  return data as T;
}

export function assertFreightowerOceanEnabled(settings: ShipsgoSettings) {
  if (!settings.enabled) throw codedError("物流跟踪接口未启用。", 400, "TRACKING_INTEGRATION_DISABLED");
  if (!settings.freightowerEnabled) throw codedError("飞驼可视接口未启用。", 400, "FREIGHTOWER_PROVIDER_DISABLED");
  if (!settings.freightowerApiKey) {
    throw codedError("飞驼可视 API Key 未配置。", 400, "FREIGHTOWER_CREDENTIAL_REQUIRED");
  }
  if (!settings.oceanTrackingEnabled) throw codedError("飞驼可视海运跟踪功能未启用。", 400, "FREIGHTOWER_OCEAN_DISABLED");
}

export function verifyFreightowerWebhookSignature(settings: ShipsgoSettings, rawBody: string, headers: Headers) {
  if (!settings.freightowerWebhookAccessSecret) return false;
  const timestamp = nonEmpty(headers.get("x-ft-timestamp"));
  const nonce = nonEmpty(headers.get("x-ft-nonce"));
  const client = nonEmpty(headers.get("x-ft-client"));
  const signature = nonEmpty(headers.get("x-ft-signature"));
  if (!timestamp || !nonce || !client || !signature) return false;
  const numericTimestamp = Number(timestamp);
  const timestampMs = numericTimestamp >= 1_000_000_000_000 ? numericTimestamp : numericTimestamp * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return false;
  const expected = crypto
    .createHmac("sha1", settings.freightowerWebhookAccessSecret)
    .update(`${timestamp}/${nonce}/${client}/${rawBody}`)
    .digest("base64");
  return timingSafeEqualText(signature, expected);
}
