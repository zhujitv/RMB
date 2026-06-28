import crypto from "node:crypto";
import { isIP } from "node:net";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../password-policy";
import { normalizeClientIp, resolveIpGeolocation } from "./ip-geolocation";
import { codedError, logServerTiming, normalizeEmail, sanitizeForLog, timeServerStep } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
export { codedError } from "./shared-base-utils";
import {
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  LOGISTICS_OPERATOR_ROLE,
  isProductSupplierOperatorRole,
  isProductSupplierType,
  runNonCriticalTask,
  BCRYPT_COST,
  INITIAL_ADMIN_EMAIL,
  INITIAL_ADMIN_PASSWORD,
  LEGACY_SESSION_COOKIE_NAME,
  LOGIN_RATE_LIMIT_MAX_FAILURES,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  PASSWORD_MIN_LENGTH,
  PASSWORD_SCRYPT_PARAMS,
  SCRYPT_HASH_PREFIX,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  SESSION_TOKEN_BYTES,
  UNSAFE_INITIAL_ADMIN_EMAILS,
  UNSAFE_INITIAL_ADMIN_PASSWORDS,
} from "./shared-constants";
import {
  USER_AUTH_SELECT,
  ensureDefaultUsers,
  isInitialAdminPasswordLogin,
  publicUser,
  listOwnLoginRecords,
  updateOwnProfile,
} from "./shared-users";
import {
  assertCronSecret,
  assertRead,
  assertWrite,
  canRead,
  canWrite,
  getCronActor,
  getCurrentUserScope,
  permissionError,
  requireAdminGlobal,
  requireDataScope,
  requirePermission,
  rolePermissions,
} from "./shared-access";
import { UNSAFE_METHODS } from "./shared-permission-data";

export {
  USER_AUTH_SELECT,
  ensureDefaultUsers,
  isInitialAdminPasswordLogin,
  publicUser,
  listOwnLoginRecords,
  updateOwnProfile,
  permissionError,
  rolePermissions,
  getCurrentUserScope,
  requirePermission,
  requireDataScope,
  requireAdminGlobal,
  canRead,
  assertRead,
  canWrite,
  assertWrite,
  assertCronSecret,
  getCronActor,
};

type RequestLike = {
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

type ResponseLike = {
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

type SessionUserLike = {
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

type ActorLike = {
  id?: string | null;
  email?: string | null;
  role?: string | null;
} | null | undefined;

type GetActorOptions = {
  required?: boolean;
  allowPasswordChangeRequired?: boolean;
};

export function sha256Hex(value: unknown) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export function randomToken(bytes = SESSION_TOKEN_BYTES) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sessionTokenHash(token: unknown) {
  return sha256Hex(token);
}

export function timingSafeEqualText(left: unknown, right: unknown) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function legacySha256PasswordHash(password: unknown) {
  return sha256Hex(password);
}

export function isLegacySha256Hash(value: unknown) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

export function isBcryptHash(value: unknown) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

export function scryptPasswordHash(password: unknown) {
  const plain = String(password || "");
  const salt = randomToken(16);
  const { N, r, p, keyLength } = PASSWORD_SCRYPT_PARAMS;
  const derived = crypto.scryptSync(plain, salt, keyLength, { N, r, p }).toString("base64url");
  return `${SCRYPT_HASH_PREFIX}$${N}$${r}$${p}$${salt}$${derived}`;
}

export function bcryptPasswordHash(password: unknown) {
  return bcrypt.hashSync(String(password || ""), BCRYPT_COST);
}

export function hashPassword(password: unknown) {
  const plain = String(password || "");
  if (plain.length < PASSWORD_MIN_LENGTH) {
    throw codedError(`密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`, 400, "PASSWORD_TOO_SHORT");
  }
  return bcryptPasswordHash(plain);
}

export function upgradePasswordHash(password: unknown) {
  return hashPassword(password);
}

export function passwordHashNeedsUpgrade(passwordHash: unknown) {
  return !isBcryptHash(passwordHash);
}

export async function verifyPassword(password: unknown, passwordHash: unknown) {
  const stored = String(passwordHash || "");
  if (isBcryptHash(stored)) {
    try {
      return await bcrypt.compare(String(password || ""), stored);
    } catch {
      return false;
    }
  }
  if (isLegacySha256Hash(stored)) {
    return timingSafeEqualText(legacySha256PasswordHash(password), stored);
  }
  const [prefix, nText, rText, pText, salt, derived] = stored.split("$");
  if (prefix !== SCRYPT_HASH_PREFIX || !salt || !derived) return false;
  try {
    const N = Number(nText);
    const r = Number(rText);
    const p = Number(pText);
    const keyLength = Buffer.from(derived, "base64url").length || PASSWORD_SCRYPT_PARAMS.keyLength;
    const candidate = crypto.scryptSync(String(password || ""), salt, keyLength, { N, r, p }).toString("base64url");
    return timingSafeEqualText(candidate, derived);
  } catch {
    return false;
  }
}

export function unsafeInitialAdminConfig(email: unknown, password: unknown) {
  const normalizedEmail = normalizeEmail(email);
  return UNSAFE_INITIAL_ADMIN_EMAILS.includes(normalizedEmail)
    || UNSAFE_INITIAL_ADMIN_PASSWORDS.includes(String(password || ""));
}

export function isUnsafeDefaultAdminEmail(email: unknown) {
  return UNSAFE_INITIAL_ADMIN_EMAILS.includes(normalizeEmail(email));
}

export function assertSafeInitialAdminConfig() {
  if (!INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_PASSWORD) return false;
  if (unsafeInitialAdminConfig(INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD)) {
    throw codedError("生产环境禁止使用默认管理员账号或默认密码，请重新配置 INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD。", 500, "UNSAFE_INITIAL_ADMIN_CONFIG");
  }
  return true;
}

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

export async function getActor(request: RequestLike, { required = true, allowPasswordChangeRequired = false }: GetActorOptions = {}) {
  const startedAt = Date.now();
  const sessionToken = requestSessionToken(request);
  let outcome = "unknown";
  let role = "";
  const baseContext = {
    required,
    allowPasswordChangeRequired,
    sessionPresent: Boolean(sessionToken),
  };
  try {
    if (!sessionToken) {
      outcome = required ? "missing-session" : "optional-no-session";
      if (!required) return null;
      throw permissionError("请先登录", 401);
    }
    await timeServerStep("workbench-init-timing", "getActor.ensureDefaultUsers", () => ensureDefaultUsers(), baseContext);
    assertSameOriginRequest(request);
    const session = await timeServerStep("workbench-init-timing", "getActor.sessionLookup", () => prisma.userSession.findFirst({
      where: {
        tokenHash: sessionTokenHash(sessionToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: { select: USER_AUTH_SELECT } },
    }), baseContext);
    if (session) {
      if (!session.user) {
        outcome = "user-not-found";
        const error = permissionError("登录会话对应的用户不存在，请重新登录或联系管理员。", 401);
        error.code = "AUTH_USER_NOT_FOUND";
        throw error;
      }
      role = session.user.role || "";
      if (!session.user.id) {
        outcome = "user-id-missing";
        const error = new Error("账户初始化失败：用户ID为空。") as Error & { status?: number; code?: string };
        error.status = 500;
        error.code = "AUTH_USER_ID_MISSING";
        throw error;
      }
      if (!role) {
        outcome = "role-missing";
        const error = new Error("账户初始化失败：用户角色为空，请联系管理员。") as Error & { status?: number; code?: string };
        error.status = 500;
        error.code = "AUTH_ROLE_MISSING";
        throw error;
      }
      if (!session.user.isActive) {
        outcome = "user-disabled";
        const error = permissionError("账号已停用，请联系管理员。", 403);
        error.code = "USER_DISABLED";
        throw error;
      }
      if (session.user.approvalStatus !== "APPROVED") {
        outcome = "approval-pending";
        const error = permissionError("账号正在等待管理员审核", 403);
        error.code = "USER_PENDING_APPROVAL";
        throw error;
      }
      if (isUnsafeDefaultAdminEmail(session.user.email)) {
        await timeServerStep("workbench-init-timing", "getActor.revokeUnsafeDefaultAdminSessions", () => revokeUserSessions(session.user.id), {
          ...baseContext,
          role,
        });
        outcome = "unsafe-default-admin";
        throw permissionError("默认管理员账号已被禁用，请使用公司管理员账号登录。", 403);
      }
      if (session.user.mustChangePassword && !allowPasswordChangeRequired) {
        const error = permissionError("首次登录必须修改密码", 403);
        error.code = "PASSWORD_CHANGE_REQUIRED";
        outcome = "password-change-required";
        throw error;
      }
      if (session.user.emailVerified === false) {
        await timeServerStep("workbench-init-timing", "getActor.revokeEmailUnverifiedSessions", () => revokeUserSessions(session.user.id), {
          ...baseContext,
          role,
        });
        outcome = "email-not-verified";
        const error = permissionError("请先完成邮箱验证", 403);
        error.code = "EMAIL_NOT_VERIFIED";
        throw error;
      }
      if (session.user.passwordPolicyPassed === false && !allowPasswordChangeRequired) {
        const error = permissionError("当前密码安全强度不足，请先修改密码后继续使用平台。", 403);
        error.code = "PASSWORD_CHANGE_REQUIRED";
        outcome = "password-policy-required";
        throw error;
      }
      if (session.user.role === LOGISTICS_OPERATOR_ROLE || isProductSupplierOperatorRole(session.user.role)) {
        const supplierId = session.user.supplierId;
        if (!supplierId) {
          await timeServerStep("workbench-init-timing", "getActor.revokeUnboundSupplierSessions", () => revokeUserSessions(session.user.id), {
            ...baseContext,
            role,
          });
          outcome = "supplier-unbound";
          throw permissionError(`${session.user.role}未绑定供应商，请联系管理员。`, 403);
        }
        const supplier = await timeServerStep("workbench-init-timing", "getActor.supplierLookup", () => prisma.supplier.findFirst({
          where: { id: supplierId, deletedAt: null, status: "启用" },
          select: { id: true, supplierType: true, allowFactoryDocumentUpload: true },
        }), { ...baseContext, role });
        const supplierMatchesRole = session.user.role === LOGISTICS_OPERATOR_ROLE
          ? Boolean(supplier && DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType))
          : Boolean(supplier && isProductSupplierType(supplier.supplierType) && supplier.allowFactoryDocumentUpload);
        if (!supplierMatchesRole) {
          await timeServerStep("workbench-init-timing", "getActor.revokeInvalidSupplierSessions", () => revokeUserSessions(session.user.id), {
            ...baseContext,
            role,
          });
          outcome = "supplier-invalid";
          throw permissionError("绑定供应商不存在、已停用或未开启对应供应商门户权限，请联系管理员。", 403);
        }
      }
      outcome = "ready";
      return session.user;
    }
    outcome = required ? "invalid-session" : "optional-invalid-session";
    if (!required) return null;
    throw permissionError("请先登录", 401);
  } finally {
    logServerTiming("workbench-init-timing", startedAt, {
      ...baseContext,
      step: "getActor.total",
      outcome,
      role,
    });
  }
}

export function loginAttemptKey(request: RequestLike, email: unknown) {
  return sha256Hex(`${requestIp(request) || "unknown"}:${normalizeEmail(email)}`);
}

export async function assertLoginNotRateLimited(request: RequestLike, email: unknown) {
  const key = loginAttemptKey(request, email);
  const since = new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW_MS);
  const failures = await prisma.loginAttempt.count({
    where: {
      key,
      success: false,
      createdAt: { gte: since },
    },
  });
  if (failures >= LOGIN_RATE_LIMIT_MAX_FAILURES) {
    throw codedError("登录失败次数过多，请 15 分钟后再试。", 429, "LOGIN_RATE_LIMITED");
  }
}

export async function recordLoginAttempt(request: RequestLike, email: unknown, success: unknown, userId: string | null = null, failureReason: string | null = null) {
  const ipAddress = requestIp(request);
  const ipGeo = resolveIpGeolocation(ipAddress);
  const userAgent = request?.headers?.get("user-agent") || null;
  console.info("login attempt captured", sanitizeForLog({
    ipAddress,
    userAgent,
    success: Boolean(success),
    failureReason: success ? null : failureReason,
    geo: {
      country: ipGeo.country,
      region: ipGeo.region,
      city: ipGeo.city,
      source: ipGeo.source,
    },
  }));
  await prisma.loginAttempt.create({
    data: {
      key: loginAttemptKey(request, email),
      email: normalizeEmail(email) || null,
      ipAddress,
      userAgent,
      failureReason: success ? null : failureReason,
      geoCountry: ipGeo.country || null,
      geoRegion: ipGeo.region || null,
      geoCity: ipGeo.city || null,
      geoIsp: ipGeo.isp || null,
      geoSource: ipGeo.source || null,
      geoResolvedAt: new Date(),
      success: Boolean(success),
      userId,
    },
  });
}

export async function changeOwnPassword(request: RequestLike, actor: ActorLike, input: Record<string, unknown> = {}) {
  if (!actor?.id) throw permissionError("请先登录", 401);
  const currentPassword = String(input.currentPassword || "");
  const newPassword = String(input.newPassword || "");
  const confirmPassword = String(input.confirmPassword || input.newPasswordConfirm || "");
  if (!confirmPassword || confirmPassword !== newPassword) {
    throw codedError("两次输入的新密码不一致。", 400, "PASSWORD_CONFIRM_MISMATCH");
  }
  if (!passwordMeetsPolicy(newPassword)) {
    throw codedError(PASSWORD_POLICY_MESSAGE, 400, "PASSWORD_POLICY_WEAK");
  }
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user || !user.isActive) throw permissionError("请先登录", 401);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw codedError("当前密码错误", 403, "CURRENT_PASSWORD_INVALID");
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw codedError("新密码不能与当前密码相同", 400, "PASSWORD_REUSED");
  }
  const before = { id: user.id, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword };
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
      passwordPolicyPassed: true,
      passwordChangedAt: new Date(),
    },
  });
  await revokeUserSessions(user.id);
  await runNonCriticalTask("密码修改操作日志写入", () => writeAudit(request, actor, "修改本人密码", "users", user.id, before, {
    id: updated.id,
    email: updated.email,
    role: updated.role,
    mustChangePassword: updated.mustChangePassword,
  }));
  return publicUser(updated);
}
