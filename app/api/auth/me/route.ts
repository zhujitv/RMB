import type { NextRequest } from "next/server";
import { apiError, currentSessionInfo, getActor, ok, publicUser, ROLES, rolePermissions, roleScopeText } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type ErrorLike = {
  status?: number;
  code?: string;
  message?: string;
  stack?: string;
};

export async function GET(request: NextRequest) {
  try {
    const user = await getActor(request, { allowPasswordChangeRequired: true });
    return ok({
      user: publicUser(user),
      roles: ROLES,
      permissions: rolePermissions(user),
      scopeText: roleScopeText(user?.role),
      session: await currentSessionInfo(request),
    });
  } catch (error: unknown) {
    const typedError = (error || {}) as ErrorLike;
    if (!typedError.status || typedError.status >= 500) {
      console.error("auth me failed: account info load error", {
        message: typedError.message,
        code: typedError.code,
        stack: typedError.stack,
      });
      return apiError(error, "系统暂时无法读取账户信息，请联系管理员。");
    }
    return apiError(error, "请先登录");
  }
}
