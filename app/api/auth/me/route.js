import { getActor, ok, publicUser, ROLES, rolePermissions, roleScopeText } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = await getActor(request, { required: false });
  return ok({
    user: publicUser(user),
    roles: ROLES,
    permissions: rolePermissions(user),
    scopeText: roleScopeText(user?.role),
  });
}
