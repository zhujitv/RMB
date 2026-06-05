import { getActor, ok, publicUser, ROLES } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = await getActor(request);
  return ok({
    user: publicUser(user),
    roles: ROLES,
    defaultLogin: {
      email: "admin@example.com",
      passwordHint: "admin123456",
    },
  });
}
