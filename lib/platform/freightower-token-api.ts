import crypto from "node:crypto";
import { codedError } from "./shared-base-utils";
import type { ShipsgoSettings } from "./shipsgo-tracking-utils";
import {
  executeFreightowerApiRequest,
  freightowerApiErrorMessage,
  freightowerClientErrorStatus,
  responseStatusCode,
} from "./freightower-api";
import { freightowerAccessTokenFromPayload } from "./freightower-token";

type FreightowerTokenCache = {
  credentialKey: string;
  accessToken: string;
  expiresAt: number;
};

let tokenCache: FreightowerTokenCache | null = null;
let tokenRequest: Promise<FreightowerTokenCache> | null = null;
let tokenRequestKey = "";

function tokenCredentialKey(settings: ShipsgoSettings) {
  return crypto.createHash("sha256").update([
    String(settings.freightowerClientId || ""),
    String(settings.freightowerApiSecret || ""),
  ].join("\0")).digest("hex");
}

async function requestAccessToken(
  settings: ShipsgoSettings,
  credentialKey: string,
): Promise<FreightowerTokenCache> {
  if (!settings.freightowerClientId || !settings.freightowerApiSecret) {
    throw codedError(
      "中国海关跟踪需要飞驼 Client ID 和 API Secret，请先在物流设置中填写。",
      400,
      "FREIGHTOWER_CUSTOMS_CREDENTIAL_REQUIRED",
    );
  }
  const { response, data } = await executeFreightowerApiRequest(
    settings,
    "/auth/api/token",
    { clientId: settings.freightowerClientId, secret: settings.freightowerApiSecret },
    "POST",
    { anonymous: true, credentialKind: "token" },
  );
  const statusCode = responseStatusCode(data);
  const token = freightowerAccessTokenFromPayload(data);
  if (!response.ok || statusCode !== "20000" || !token.accessToken) {
    throw codedError(
      freightowerApiErrorMessage("/auth/api/token", response.status, data, "token"),
      freightowerClientErrorStatus(response.status, data),
      "FREIGHTOWER_TOKEN_ERROR",
    );
  }
  const lifetimeMs = token.expiresIn * 1000;
  const safetyMarginMs = Math.min(5 * 60 * 1000, Math.max(5 * 1000, Math.floor(lifetimeMs * 0.1)));
  return {
    credentialKey,
    accessToken: token.accessToken,
    expiresAt: Date.now() + Math.max(1_000, lifetimeMs - safetyMarginMs),
  };
}

async function accessToken(settings: ShipsgoSettings, forceRefresh = false) {
  const credentialKey = tokenCredentialKey(settings);
  if (forceRefresh && tokenCache?.credentialKey === credentialKey) tokenCache = null;
  if (!forceRefresh && tokenCache
    && tokenCache.credentialKey === credentialKey
    && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }
  // All concurrent callers for one account share the same refresh request.
  if (!tokenRequest || tokenRequestKey !== credentialKey) {
    tokenRequest = requestAccessToken(settings, credentialKey);
    tokenRequestKey = credentialKey;
  }
  const currentRequest = tokenRequest;
  try {
    const next = await currentRequest;
    tokenCache = next;
    return next.accessToken;
  } finally {
    if (tokenRequest === currentRequest) {
      tokenRequest = null;
      tokenRequestKey = "";
    }
  }
}

export async function testFreightowerTokenConnection(settings: ShipsgoSettings) {
  await accessToken(settings, true);
  return { success: true, message: "中国海关 Token 认证正常。" };
}

export async function freightowerTokenApiGet<T>(
  settings: ShipsgoSettings,
  path: string,
  query: Record<string, string>,
): Promise<T> {
  const requestPath = `${path}?${new URLSearchParams(query).toString()}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await accessToken(settings, attempt > 0);
    const { response, data } = await executeFreightowerApiRequest(
      settings,
      requestPath,
      undefined,
      "GET",
      { bearer: token, credentialKind: "token" },
    );
    const statusCode = responseStatusCode(data);
    if ((statusCode === "40100" || response.status === 401) && attempt === 0) {
      tokenCache = null;
      continue;
    }
    const acceptedStatus = statusCode === "20000" || statusCode === "20001";
    if (!response.ok || !acceptedStatus) {
      const permissionDenied = path.startsWith("/terminal/")
        && (statusCode === "40300" || response.status === 403);
      throw codedError(
        freightowerApiErrorMessage(path, response.status, statusCode ? data : {}, "token"),
        freightowerClientErrorStatus(response.status, data),
        permissionDenied ? "FREIGHTOWER_CUSTOMS_PERMISSION_REQUIRED" : "FREIGHTOWER_API_ERROR",
      );
    }
    return data as T;
  }
  throw codedError("飞驼可视 Token 刷新后仍然无效。", 400, "FREIGHTOWER_TOKEN_ERROR");
}
