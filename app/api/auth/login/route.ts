import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  assertLoginNotRateLimited,
  createUserSession,
  ensureDefaultUsers,
  isInitialAdminPasswordLogin,
  isUnsafeDefaultAdminEmail,
  normalizeEmail,
  passwordHashNeedsUpgrade,
  publicUser,
  recordLoginAttempt,
  setSessionCookie,
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

function loginFailure(message: string, status: number, code: string) {
  return NextResponse.json({
    success: false,
    error: message,
    message,
    code,
  }, { status });
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
      message: "数据库结构未同步，请执行 npx prisma migrate deploy && npx prisma generate。",
    };
  }
  if (["P1000", "P1001", "P1002", "P1017"].includes(code) || /database_url|connect|authentication failed/i.test(message)) {
    return {
      code: "DATABASE_CONNECTION_ERROR",
      message: "数据库连接失败，请检查 DATABASE_URL 和数据库账号密码。",
    };
  }
  return {
    code: code || "LOGIN_SERVICE_ERROR",
    message: "登录服务异常，请联系管理员查看部署日志。",
  };
}

export async function POST(request: NextRequest) {
  try {
    await ensureDefaultUsers();
    const body = (await request.json()) as LoginRequestBody;
    const email = normalizeEmail(body.email);
    await assertLoginNotRateLimited(request, email);
    if (isUnsafeDefaultAdminEmail(email)) {
      await recordLoginAttempt(request, email, false, null);
      console.error("login failed: default admin disabled", { email });
      return loginFailure("默认管理员账号已禁用，请使用公司管理员账号登录。", 403, "DEFAULT_ADMIN_DISABLED");
    }
    let user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: LOGIN_USER_SELECT,
    });
    if (!user) {
      console.error("login failed: user not found", { email });
      await recordLoginAttemptTyped(request, email, false, null);
      return loginFailure("邮箱或密码错误", 401, "INVALID_CREDENTIALS");
    }
    if (!(await verifyPassword(body.password || "", user.passwordHash))) {
      console.error("login failed: wrong password", { email, userId: user.id });
      await recordLoginAttemptTyped(request, email, false, user.id);
      return loginFailure("邮箱或密码错误", 401, "INVALID_CREDENTIALS");
    }
    const approvalStatus = user.approvalStatus || (user.isActive ? "APPROVED" : "DISABLED");
    if (approvalStatus === "PENDING") {
      console.error("login failed: user pending approval", { email, userId: user.id });
      await recordLoginAttemptTyped(request, email, false, user.id);
      return loginFailure("账号待管理员审核", 403, "USER_PENDING_APPROVAL");
    }
    if (approvalStatus === "REJECTED") {
      console.error("login failed: user rejected", { email, userId: user.id });
      await recordLoginAttemptTyped(request, email, false, user.id);
      return loginFailure("账号审核未通过，请联系管理员。", 403, "USER_REJECTED");
    }
    if (!user.isActive || approvalStatus === "DISABLED") {
      console.error("login failed: user disabled", { email, userId: user.id });
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
    console.error("login failed: database error", {
      code: classified.code,
      prismaCode: typedError.code || "",
      message: typedError.message || "",
    });
    return NextResponse.json({
      success: false,
      error: classified.message,
      message: classified.message,
      code: classified.code,
    }, { status: 500 });
  }
}
