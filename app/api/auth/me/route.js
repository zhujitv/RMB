import { apiError, getActor, ok, publicUser, ROLES, rolePermissions, roleScopeText } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const user = await getActor(request, { allowPasswordChangeRequired: true });
    return ok({
      user: publicUser(user),
      roles: ROLES,
      permissions: rolePermissions(user),
      scopeText: roleScopeText(user?.role),
    });
  } catch (error) {
    return apiError(error, "请先登录");
  }
}
