import { apiError, getActor, ok, saveUser, updateUserStatus } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await request.json();
    const user = await saveUser(request, actor, body, id);
    return ok({ success: true, user, message: "用户已保存" });
  } catch (error) {
    return apiError(error, "更新用户失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const user = await updateUserStatus(request, actor, id, "DISABLED");
    return ok({ success: true, ok: true, user, message: "用户已停用" });
  } catch (error) {
    return apiError(error, "停用用户失败");
  }
}
