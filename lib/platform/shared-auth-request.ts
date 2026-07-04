import { isIP } from "node:net";
import { prisma } from "../prisma";
import { normalizeClientIp, resolveIpGeolocation } from "./ip-geolocation";
import { timeServerStep } from "./shared-base-utils";
import { LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "./shared-constants";
import { UNSAFE_METHODS } from "./shared-permission-data";
import { permissionError } from "./shared-access";
import { randomToken, sessionTokenHash } from "./shared-auth-password";

export type RequestLike = {
  url?: string;
  method?: string;
  ip?: string | null;
  headers?: {
    get(name: string): string | null;
  };
  cookies?: {
    get(name: string): { value?: string } | undefined;
  };
} | null | undefined;

export type ResponseLike = {
  cookies: {
    set(name: string, value: string, options: {
      httpOnly: boolean;
      sameSite: "lax";
      secure: boolean;
      path: string;
      maxAge: number;
    }): void;
  };
};

export type SessionUserLike = {
  id: string;
  email?: string | null;
  role?: string | null;
  supplierId?: string | null;
  mustChangePassword?: boolean;
  passwordPolicyPassed?: boolean;
  emailVerified?: boolean;
  isActive?: boolean;
  passwordHash?: string;
};

export type ActorLike = {
  id?: string | null;
  email?: string | null;
  role?: string | null;
} | null | undefined;

export type GetActorOptions = {
  required?: boolean;
  allowPasswordChangeRequired?: boolean;
};

function splitIpHeader(value: string | null | undefined) {
  return String(value || "")
    .split(",")
    .map((part) => normalizeClientIp(part))
    .filter(Boolean);
}

function isPublicClientIp(ip: string) {
  if (!isIP(ip)) return false;
  const geo = resolveIpGeolocation(ip);
  return !["本地", "内网", "保留地址"].includes(geo.country);
}

function isValidClientAddress(ip: string) {
  return Boolean(isIP(ip)) || ip.toLowerCase() === "localhost";
}

function firstPublicOrFirstValidIp(value: string | null | undefined) {
  const candidates = splitIpHeader(value);
  return candidates.find(isPublicClientIp) || candidates.find(isValidClientAddress) || "";
}

export function requestIp(request: RequestLike) {
  const forwardedFor = firstPublicOrFirstValidIp(request?.headers?.get("x-forwarded-for"));
  if (forwardedFor) return forwardedFor;
  const realIp = firstPublicOrFirstValidIp(request?.headers?.get("x-real-ip"));
  if (realIp) return realIp;
  const cfIp = firstPublicOrFirstValidIp(request?.headers?.get("cf-connecting-ip"));
  if (cfIp) return cfIp;
  const vercelIp = firstPublicOrFirstValidIp(request?.headers?.get("vercel-forwarded-for"));
  if (vercelIp) return vercelIp;
  const requestIpValue = firstPublicOrFirstValidIp(request?.ip);
  return requestIpValue || null;
}

export function requestSessionToken(request: RequestLike) {
  return request?.cookies?.get(SESSION_COOKIE_NAME)?.value
    || request?.cookies?.get("fta_session")?.value
    || request?.cookies?.get("__Host-fta_session")?.value
    || "";
}

export function requestOrigin(request: RequestLike) {
  try {
    return new URL(String(request?.url || "")).origin;
  } catch {
    return "";
  }
}

export function headerOrigin(value: unknown) {
  const text = String(value || "").trim();
  if (!text || text === "null") return "";
  try {
    return new URL(text).origin;
  } catch {
    return "";
  }
}

function originListFromEnv() {
  return [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.APP_BASE_URL,
    process.env.ALLOWED_ORIGINS,
  ].flatMap((value) => String(value || "").split(/[\s,;]+/)).map(headerOrigin).filter(Boolean);
}

function localDevelopmentAliases(origin: string) {
  if (process.env.NODE_ENV === "production") return [];
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) return [];
    const port = url.port ? `:${url.port}` : "";
    return [`http://localhost${port}`, `http://127.0.0.1${port}`];
  } catch {
    return [];
  }
}

function allowedRequestOrigins(expectedOrigin: string) {
  return new Set([
    expectedOrigin,
    ...originListFromEnv(),
    ...localDevelopmentAliases(expectedOrigin),
    ...originListFromEnv().flatMap(localDevelopmentAliases),
  ].filter(Boolean));
}

export function isAllowedRequestOrigin(candidateOrigin: string, expectedOrigin: string) {
  if (!candidateOrigin) return false;
  return allowedRequestOrigins(expectedOrigin).has(candidateOrigin);
}

export function assertSameOriginRequest(request: RequestLike) {
  const method = String(request?.method || "GET").toUpperCase();
  if (!UNSAFE_METHODS.includes(method)) return;
  const expectedOrigin = requestOrigin(request);
  if (!expectedOrigin) return;
  const origin = headerOrigin(request?.headers?.get("origin"));
  const referer = headerOrigin(request?.headers?.get("referer"));
  if (origin && !isAllowedRequestOrigin(origin, expectedOrigin)) {
    throw permissionError("请求来源不合法", 403);
  }
  if (!origin && referer && !isAllowedRequestOrigin(referer, expectedOrigin)) {
    throw permissionError("请求来源不合法", 403);
  }
  if (process.env.NODE_ENV === "production" && !origin && !referer) {
    throw permissionError("缺少请求来源校验信息", 403);
  }
}

export function setSessionCookie(response: ResponseLike, token: string) {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  response.cookies.set(LEGACY_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function clearSessionCookies(response: ResponseLike) {
  [SESSION_COOKIE_NAME, "fta_session", "__Host-fta_session", LEGACY_SESSION_COOKIE_NAME].forEach((name) => {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  });
}

export async function createUserSession(request: RequestLike, user: SessionUserLike) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.userSession.create({
    data: {
      userId: user.id,
      tokenHash: sessionTokenHash(token),
      expiresAt,
      userAgent: request?.headers?.get("user-agent")?.slice(0, 500) || null,
      ipAddress: requestIp(request),
    },
  });
  return { token, expiresAt };
}

export async function revokeCurrentSession(request: RequestLike) {
  const token = requestSessionToken(request);
  if (!token) return;
  assertSameOriginRequest(request);
  await prisma.userSession.updateMany({
    where: {
      tokenHash: sessionTokenHash(token),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function revokeUserSessions(userId: string | null | undefined) {
  if (!userId) return;
  await prisma.userSession.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function currentSessionInfo(request: RequestLike) {
  const sessionToken = requestSessionToken(request);
  if (!sessionToken) return null;
  const session = await timeServerStep("workbench-init-timing", "currentSessionInfo.sessionLookup", () => prisma.userSession.findFirst({
    where: {
      tokenHash: sessionTokenHash(sessionToken),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      createdAt: true,
      ipAddress: true,
    },
  }), { sessionPresent: true });
  return session ? {
    loginAt: session.createdAt,
    ipAddress: session.ipAddress || "",
  } : null;
}
