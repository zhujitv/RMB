import { apiError, getActor, ok, updateUserStatus } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await request.json();
    const user = await updateUserStatus(request, actor, id, body.status);
    return ok({ success: true, user, message: "用户状态已更新" });
  } catch (error) {
    return apiError(error, "更新用户状态失败");
  }
}
