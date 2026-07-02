import type { NextRequest } from "next/server";
import {
  apiError,
  codedError,
  currentSessionInfo,
  getCompanyProfileSettings,
  logServerTiming,
  ok,
  publicUser,
  ROLES,
  rolePermissions,
  roleScopeText,
  sanitizeForLog,
  timeServerStep,
} from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type ErrorLike = {
  status?: number;
  code?: string;
  message?: string;
  stack?: string;
  details?: unknown;
  meta?: unknown;
};

function authInitErrorCode(error: ErrorLike) {
  const code = String(error.code || "");
  const message = String(error.message || "");
  if (error.status === 401) return "AUTH-UNAUTHENTICATED";
  if (error.status === 403 && !code) return "PERMISSION_DENIED";
  if (code === "P1001" || /Can't reach database server|database .*connect|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(message)) {
    return "AUTH-DB-CONNECTION";
  }
  if (
    ["P2021", "P2022", "P2009"].includes(code)
    || /Unknown field|Unknown argument|column .*does not exist|The column .* does not exist|Invalid .*select/i.test(message)
  ) {
    return "AUTH-DB-SCHEMA";
  }
  if (["AUTH_USER_NOT_FOUND", "AUTH_USER_ID_MISSING", "AUTH_ROLE_MISSING"].includes(code)) return code;
  if (["EMAIL_NOT_VERIFIED", "USER_DISABLED", "USER_PENDING_APPROVAL", "PASSWORD_CHANGE_REQUIRED", "PERMISSION_DENIED"].includes(code)) return code;
  return "AUTH-001";
}

function authInitErrorMessage(code: string, error: ErrorLike) {
  const isProduction = process.env.NODE_ENV === "production";
  const originalMessage = String(error.message || "账户初始化失败");
  if (code === "AUTH-DB-CONNECTION") return "数据库连接失败，请检查 DATABASE_URL 和本地 PostgreSQL 状态。";
  if (code === "AUTH-DB-SCHEMA") return "权限数据结构异常，请执行 Prisma migrate / db push。";
  if (!isProduction) {
    return `${originalMessage}（错误代码：${code}）`;
  }
  if (code === "AUTH-UNAUTHENTICATED") return "请先登录";
  if (code === "AUTH_USER_NOT_FOUND") return "登录会话对应的用户不存在，请重新登录或联系管理员。";
  if (code === "EMAIL_NOT_VERIFIED") return "请先完成邮箱验证";
  if (code === "USER_DISABLED") return "账号已停用，请联系管理员。";
  if (code === "USER_PENDING_APPROVAL") return "账号正在等待管理员审核";
  if (code === "PASSWORD_CHANGE_REQUIRED") return originalMessage;
  if (code === "PERMISSION_DENIED") return originalMessage || "没有权限读取账户信息。";
  return "系统暂时无法读取账户信息，请联系管理员。（错误代码：AUTH-001）";
}

function classifyAuthInitError(error: unknown) {
  const typedError = (error || {}) as ErrorLike;
  const code = authInitErrorCode(typedError);
  const status = typedError.status || (code.startsWith("AUTH-DB") || code === "AUTH-001" ? 500 : 403);
  const message = authInitErrorMessage(code, typedError);
  const classified = codedError(message, status, code);
  classified.details = {
    sourceCode: typedError.code || "",
    sourceMessage: typedError.message || "",
  };
  if (status >= 500 && process.env.NODE_ENV === "production") {
    classified.expose = false;
  }
  return classified;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const path = new URL(request.url).pathname;
  const basicOnly = new URL(request.url).searchParams.get("basic") === "1";
  let outcome = "unknown";
  let userId = "";
  let role = "";
  try {
    const user = await timeServerStep("workbench-init-timing", "authMe.requireApiActor", () => (
      requireApiActor(request, { allowPasswordChangeRequired: true })
    ), { path });
    userId = user?.id || "";
    role = user?.role || "";
    const basePayload = {
      user: publicUser(user),
      roles: ROLES,
      permissions: rolePermissions(user),
      scopeText: roleScopeText(user?.role),
    };
    if (basicOnly) {
      outcome = "ready-basic";
      const response = ok(basePayload);
      logServerTiming("workbench-init-timing", startedAt, {
        step: "authMe.total",
        path,
        outcome,
        userId,
        role,
      });
      return response;
    }
    const [session, companyProfile] = await timeServerStep("workbench-init-timing", "authMe.parallelSessionAndCompanyProfile", () => Promise.all([
      currentSessionInfo(request),
      getCompanyProfileSettings(),
    ]), { path, userId, role });
    outcome = "ready";
    const response = ok({
      ...basePayload,
      session,
      companyProfile,
    });
    logServerTiming("workbench-init-timing", startedAt, {
      step: "authMe.total",
      path,
      outcome,
      userId,
      role,
    });
    return response;
  } catch (error: unknown) {
    const typedError = (error || {}) as ErrorLike;
    const classifiedError = classifyAuthInitError(error);
    outcome = classifiedError.status ? `error-${classifiedError.status}` : "error-500";
    logServerTiming("workbench-init-timing", startedAt, {
      step: "authMe.total",
      path,
      outcome,
      userId,
      role,
      code: classifiedError.code,
    });
    console.error("auth me failed: account info load error", sanitizeForLog({
      code: classifiedError.code,
      status: classifiedError.status,
      path,
      userId,
      role,
      error: {
        name: error instanceof Error ? error.name : "Error",
        code: typedError.code || "",
        message: typedError.message || "",
        meta: typedError.meta,
        stack: process.env.NODE_ENV === "production" ? undefined : typedError.stack,
      },
    }));
    return apiError(classifiedError, classifiedError.message || "系统暂时无法读取账户信息，请联系管理员。");
  }
}
