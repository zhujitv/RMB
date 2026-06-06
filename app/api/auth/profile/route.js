import { apiError, getActor, ok, updateOwnProfile } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    const user = await updateOwnProfile(request, actor, body);
    return ok({ user, message: "个人信息已保存" });
  } catch (error) {
    return apiError(error, "修改个人信息失败");
  }
}
