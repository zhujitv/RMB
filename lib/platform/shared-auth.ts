// @ts-nocheck
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { normalizeEmail } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
export { codedError } from "./shared-base-utils";
import {
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  LOGISTICS_OPERATOR_ROLE,
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

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export function randomToken(bytes = SESSION_TOKEN_BYTES) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sessionTokenHash(token) {
  return sha256Hex(token);
}

export function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function legacySha256PasswordHash(password) {
  return sha256Hex(password);
}

export function isLegacySha256Hash(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

export function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

export function scryptPasswordHash(password) {
  const plain = String(password || "");
  const salt = randomToken(16);
  const { N, r, p, keyLength } = PASSWORD_SCRYPT_PARAMS;
  const derived = crypto.scryptSync(plain, salt, keyLength, { N, r, p }).toString("base64url");
  return `${SCRYPT_HASH_PREFIX}$${N}$${r}$${p}$${salt}$${derived}`;
}

export function bcryptPasswordHash(password) {
  return bcrypt.hashSync(String(password || ""), BCRYPT_COST);
}

export function hashPassword(password) {
  const plain = String(password || "");
  if (plain.length < PASSWORD_MIN_LENGTH) {
    const error = new Error(`密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`);
    error.status = 400;
    throw error;
  }
  return bcryptPasswordHash(plain);
}

export function upgradePasswordHash(password) {
  return hashPassword(password);
}

export function passwordHashNeedsUpgrade(passwordHash) {
  return !isBcryptHash(passwordHash);
}

export async function verifyPassword(password, passwordHash) {
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

export function unsafeInitialAdminConfig(email, password) {
  const normalizedEmail = normalizeEmail(email);
  return UNSAFE_INITIAL_ADMIN_EMAILS.includes(normalizedEmail)
    || UNSAFE_INITIAL_ADMIN_PASSWORDS.includes(String(password || ""));
}

export function isUnsafeDefaultAdminEmail(email) {
  return UNSAFE_INITIAL_ADMIN_EMAILS.includes(normalizeEmail(email));
}

export function assertSafeInitialAdminConfig() {
  if (!INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_PASSWORD) return false;
  if (unsafeInitialAdminConfig(INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD)) {
    const error = new Error("生产环境禁止使用默认管理员账号或默认密码，请重新配置 INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD。");
    error.status = 500;
    error.expose = true;
    throw error;
  }
  return true;
}

export function requestIp(request) {
  return request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request?.headers?.get("x-real-ip")
    || null;
}

export function requestSessionToken(request) {
  return request?.cookies?.get(SESSION_COOKIE_NAME)?.value
    || request?.cookies?.get("fta_session")?.value
    || request?.cookies?.get("__Host-fta_session")?.value
    || "";
}

export function requestOrigin(request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

export function headerOrigin(value) {
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

function localDevelopmentAliases(origin) {
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

function allowedRequestOrigins(expectedOrigin) {
  return new Set([
    expectedOrigin,
    ...originListFromEnv(),
    ...localDevelopmentAliases(expectedOrigin),
    ...originListFromEnv().flatMap(localDevelopmentAliases),
  ].filter(Boolean));
}

export function isAllowedRequestOrigin(candidateOrigin, expectedOrigin) {
  if (!candidateOrigin) return false;
  return allowedRequestOrigins(expectedOrigin).has(candidateOrigin);
}

export function assertSameOriginRequest(request) {
  const method = String(request?.method || "GET").toUpperCase();
  if (!UNSAFE_METHODS.includes(method)) return;
  const expectedOrigin = requestOrigin(request);
  if (!expectedOrigin) return;
  const origin = headerOrigin(request.headers?.get("origin"));
  const referer = headerOrigin(request.headers?.get("referer"));
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

export function setSessionCookie(response, token) {
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

export function clearSessionCookies(response) {
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

export async function createUserSession(request, user) {
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

export async function revokeCurrentSession(request) {
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

export async function revokeUserSessions(userId) {
  if (!userId) return;
  await prisma.userSession.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function currentSessionInfo(request) {
  const sessionToken = requestSessionToken(request);
  if (!sessionToken) return null;
  const session = await prisma.userSession.findFirst({
    where: {
      tokenHash: sessionTokenHash(sessionToken),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      createdAt: true,
      ipAddress: true,
    },
  });
  return session ? {
    loginAt: session.createdAt,
    ipAddress: session.ipAddress || "",
  } : null;
}

export async function getActor(request, { required = true, allowPasswordChangeRequired = false } = {}) {
  await ensureDefaultUsers();
  const sessionToken = requestSessionToken(request);
  if (sessionToken) {
    assertSameOriginRequest(request);
    const session = await prisma.userSession.findFirst({
      where: {
        tokenHash: sessionTokenHash(sessionToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { is: { isActive: true, approvalStatus: "APPROVED" } },
      },
      include: { user: { select: USER_AUTH_SELECT } },
    });
    if (session?.user) {
      if (isUnsafeDefaultAdminEmail(session.user.email)) {
        await revokeUserSessions(session.user.id);
        throw permissionError("默认管理员账号已被禁用，请使用公司管理员账号登录。", 403);
      }
      if (session.user.mustChangePassword && !allowPasswordChangeRequired) {
        const error = permissionError("首次登录必须修改密码", 403);
        error.code = "PASSWORD_CHANGE_REQUIRED";
        throw error;
      }
      if (session.user.role === LOGISTICS_OPERATOR_ROLE) {
        if (!session.user.supplierId) {
          await revokeUserSessions(session.user.id);
          throw permissionError("物流供应商账号未绑定供应商，请联系管理员。", 403);
        }
        const supplier = await prisma.supplier.findFirst({
          where: { id: session.user.supplierId, deletedAt: null, status: "启用" },
          select: { id: true, supplierType: true },
        });
        if (!supplier || !DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
          await revokeUserSessions(session.user.id);
          throw permissionError("绑定供应商不存在或已停用，请联系管理员。", 403);
        }
      }
      return session.user;
    }
  }
  if (!required) return null;
  throw permissionError("请先登录", 401);
}

export function loginAttemptKey(request, email) {
  return sha256Hex(`${requestIp(request) || "unknown"}:${normalizeEmail(email)}`);
}

export async function assertLoginNotRateLimited(request, email) {
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
    const error = new Error("登录失败次数过多，请 15 分钟后再试。");
    error.status = 429;
    throw error;
  }
}

export async function recordLoginAttempt(request, email, success, userId = null) {
  await prisma.loginAttempt.create({
    data: {
      key: loginAttemptKey(request, email),
      email: normalizeEmail(email) || null,
      ipAddress: requestIp(request),
      success: Boolean(success),
      userId,
    },
  });
}

export async function changeOwnPassword(request, actor, input = {}) {
  const currentPassword = String(input.currentPassword || "");
  const newPassword = String(input.newPassword || "");
  const confirmPassword = String(input.confirmPassword || input.newPasswordConfirm || "");
  if (confirmPassword && confirmPassword !== newPassword) {
    const error = new Error("两次输入的新密码不一致");
    error.status = 400;
    throw error;
  }
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user || !user.isActive) throw permissionError("请先登录", 401);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    const error = new Error("当前密码错误");
    error.status = 403;
    throw error;
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    const error = new Error("新密码不能与当前密码相同");
    error.status = 400;
    throw error;
  }
  const before = { id: user.id, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword };
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
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
