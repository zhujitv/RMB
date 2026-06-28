import type { NextRequest } from "next/server";
import { apiError, listOwnLoginRecords, ok, parseJsonBody, updateOwnProfile } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const loginRecords = await listOwnLoginRecords(actor, 10);
    return ok({ success: true, loginRecords });
  } catch (error: unknown) {
    return apiError(error, "读取个人设置失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const user = await updateOwnProfile(request, actor, body);
    return ok({ success: true, user, message: "个人信息已保存" });
  } catch (error: unknown) {
    return apiError(error, "修改个人信息失败");
  }
}
