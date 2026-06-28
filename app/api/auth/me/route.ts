import type { NextRequest } from "next/server";
import {
  apiError,
  currentSessionInfo,
  getCompanyProfileSettings,
  logServerError,
  logServerTiming,
  ok,
  publicUser,
  ROLES,
  rolePermissions,
  roleScopeText,
  timeServerStep,
} from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type ErrorLike = {
  status?: number;
  code?: string;
  message?: string;
  stack?: string;
};

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  let outcome = "unknown";
  let role = "";
  try {
    const user = await timeServerStep("workbench-init-timing", "authMe.requireApiActor", () => (
      requireApiActor(request, { allowPasswordChangeRequired: true })
    ));
    role = user?.role || "";
    const [session, companyProfile] = await timeServerStep("workbench-init-timing", "authMe.parallelSessionAndCompanyProfile", () => Promise.all([
      currentSessionInfo(request),
      getCompanyProfileSettings(),
    ]), { role });
    outcome = "ready";
    const response = ok({
      user: publicUser(user),
      roles: ROLES,
      permissions: rolePermissions(user),
      scopeText: roleScopeText(user?.role),
      session,
      companyProfile,
    });
    logServerTiming("workbench-init-timing", startedAt, {
      step: "authMe.total",
      outcome,
      role,
    });
    return response;
  } catch (error: unknown) {
    const typedError = (error || {}) as ErrorLike;
    outcome = typedError.status ? `error-${typedError.status}` : "error-500";
    logServerTiming("workbench-init-timing", startedAt, {
      step: "authMe.total",
      outcome,
      role,
    });
    if (!typedError.status || typedError.status >= 500) {
      logServerError("auth me failed: account info load error", typedError);
      return apiError(error, "系统暂时无法读取账户信息，请联系管理员。");
    }
    return apiError(error, "请先登录");
  }
}
