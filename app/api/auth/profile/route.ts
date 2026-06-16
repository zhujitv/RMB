import type { NextRequest } from "next/server";
import { apiError, getActor, ok, updateOwnProfile } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = (await request.json()) as Record<string, unknown>;
    const user = await updateOwnProfile(request, actor, body);
    return ok({ success: true, user, message: "个人信息已保存" });
  } catch (error: unknown) {
    return apiError(error, "修改个人信息失败");
  }
}
