import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  assertLoginNotRateLimited,
  assertSameOriginRequest,
  createUserSession,
  ensureDefaultUsers,
  isInitialAdminPasswordLogin,
  isUnsafeDefaultAdminEmail,
  logSecurityEvent,
  logServerError,
  normalizeEmail,
  parseJsonBody,
  passwordHashNeedsUpgrade,
  publicUser,
  recordLoginAttempt,
  setSessionCookie,
  sha256Hex,
  upgradePasswordHash,
  verifyPassword,
} from "../../../../lib/platform-db";
import { prisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

type LoginRequestBody = {
  email?: string;
  password?: string;
};

type ErrorLike = {
  status?: number;
  code?: string;
  message?: string;
  stack?: string;
};

const recordLoginAttemptTyped = recordLoginAttempt as (
  request: NextRequest,
  email: string,
  success: boolean,
  userId?: string | null,
) => Promise<void>;

const LOGIN_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  passwordHash: true,
  role: true,
  phone: true,
  avatarInitials: true,
  defaultLanguage: true,
  customPermissions: true,
  mustChangePassword: true,
  approvalStatus: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

const LOGIN_SERVICE_UNAVAILABLE_MESSAGE = "登录服务暂时不可用，请稍后重试或联系管理员。";

function loginFailure(message: string, status: number, code: string) {
  return NextResponse.json({
    success: false,
    error: message,
    message,
    code,
  }, { status });
}

function loginAuditContext(reason: string, email: string, userId?: string | null) {
  return {
    reason,
    loginIdHash: sha256Hex(email).slice(0, 16),
    ...(userId ? { userId } : {}),
  };
}

function classifyLoginServiceError(error: ErrorLike) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (
    code === "P2022"
    || /column .* does not exist/i.test(message)
    || /unknown column/i.test(message)
    || /supplier_id|allow_domestic_logistics_entry|domestic_logistics/i.test(message)
  ) {
    return {
      code: "PRISMA_SCHEMA_MISMATCH",
      message: LOGIN_SERVICE_UNAVAILABLE_MESSAGE,
      diagnostic: "Prisma schema mismatch; run migrations and regenerate the Prisma client.",
    };
  }
  if (["P1000", "P1001", "P1002", "P1010", "P1017"].includes(code) || /database_url|connect|authentication failed/i.test(message)) {
    return {
      code: "DATABASE_CONNECTION_ERROR",
      message: LOGIN_SERVICE_UNAVAILABLE_MESSAGE,
      diagnostic: "Database connection failed; verify runtime database configuration and credentials.",
    };
  }
  return {
    code: code || "LOGIN_SERVICE_ERROR",
    message: LOGIN_SERVICE_UNAVAILABLE_MESSAGE,
    diagnostic: "Unexpected login service error.",
  };
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginRequest(request);
    await ensureDefaultUsers();
    const body = await parseJsonBody(request) as LoginRequestBody;
    const email = normalizeEmail(body.email);
    await assertLoginNotRateLimited(request, email);
    if (isUnsafeDefaultAdminEmail(email)) {
      await recordLoginAttempt(request, email, false, null);
      logSecurityEvent("login failed", loginAuditContext("default_admin_disabled", email));
      return loginFailure("默认管理员账号已禁用，请使用公司管理员账号登录。", 403, "DEFAULT_ADMIN_DISABLED");
    }
    let user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: LOGIN_USER_SELECT,
    });
    if (!user) {
      logSecurityEvent("login failed", loginAuditContext("user_not_found", email));
      await recordLoginAttemptTyped(request, email, false, null);
      return loginFailure("邮箱或密码错误", 401, "INVALID_CREDENTIALS");
    }
    if (!(await verifyPassword(body.password || "", user.passwordHash))) {
      logSecurityEvent("login failed", loginAuditContext("wrong_password", email, user.id));
      await recordLoginAttemptTyped(request, email, false, user.id);
      return loginFailure("邮箱或密码错误", 401, "INVALID_CREDENTIALS");
    }
    const approvalStatus = user.approvalStatus || (user.isActive ? "APPROVED" : "DISABLED");
    if (approvalStatus === "PENDING") {
      logSecurityEvent("login failed", loginAuditContext("user_pending_approval", email, user.id));
      await recordLoginAttemptTyped(request, email, false, user.id);
      return loginFailure("账号待管理员审核", 403, "USER_PENDING_APPROVAL");
    }
    if (approvalStatus === "REJECTED") {
      logSecurityEvent("login failed", loginAuditContext("user_rejected", email, user.id));
      await recordLoginAttemptTyped(request, email, false, user.id);
      return loginFailure("账号审核未通过，请联系管理员。", 403, "USER_REJECTED");
    }
    if (!user.isActive || approvalStatus === "DISABLED") {
      logSecurityEvent("login failed", loginAuditContext("user_disabled", email, user.id));
      await recordLoginAttemptTyped(request, email, false, user.id);
      return loginFailure("账号已停用", 403, "USER_DISABLED");
    }
    if (passwordHashNeedsUpgrade(user.passwordHash)) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: upgradePasswordHash(body.password || "") },
        select: LOGIN_USER_SELECT,
      });
    }
    if (!user.mustChangePassword && isInitialAdminPasswordLogin(user, body.password || "")) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { mustChangePassword: true },
        select: LOGIN_USER_SELECT,
      });
    }
    await recordLoginAttemptTyped(request, email, true, user.id);
    const session = await createUserSession(request, user);
    const safeUser = publicUser(user);
    if (!safeUser) {
      throw new Error("登录成功后未能生成公开用户信息。");
    }
    const response = NextResponse.json({
      success: true,
      user: safeUser,
      mustChangePassword: Boolean(safeUser.mustChangePassword),
      message: Boolean(safeUser.mustChangePassword) ? "请先修改初始密码" : "登录成功",
    });
    setSessionCookie(response, session.token);
    return response;
  } catch (error: unknown) {
    const typedError = (error || {}) as ErrorLike;
    if (typedError.status) return apiError(error, "登录失败");
    const classified = classifyLoginServiceError(typedError);
    logServerError("login failed: service error", typedError, {
      code: classified.code,
      diagnostic: classified.diagnostic,
      prismaCode: typedError.code || "",
    });
    return NextResponse.json({
      success: false,
      error: classified.message,
      message: classified.message,
      code: classified.code,
    }, { status: 500 });
  }
}
