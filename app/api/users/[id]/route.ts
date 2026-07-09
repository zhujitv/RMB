import type { NextRequest } from "next/server";
import { apiError, forceDeleteRejectedUser, ok, parseJsonBody, saveUser, updateUserStatus } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const saveUserTyped = saveUser as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const user = await saveUserTyped(request, actor, body, id);
    return ok({ success: true, user, message: "用户已保存" });
  } catch (error: unknown) {
    return apiError(error, "更新用户失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const searchParams = new URL(request.url).searchParams;
    if (["1", "true"].includes(searchParams.get("forceRejected") || "")) {
      const result = await forceDeleteRejectedUser(request, actor, id);
      return ok({ success: true, ok: true, ...result, message: "拒绝用户已删除" });
    }
    const user = await updateUserStatus(request, actor, id, "DISABLED");
    return ok({ success: true, ok: true, user, message: "用户已停用" });
  } catch (error: unknown) {
    return apiError(error, "停用用户失败");
  }
}
