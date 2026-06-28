import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, updateUserStatus } from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type StatusBody = {
  status?: string;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request) as StatusBody;
    const user = await updateUserStatus(request, actor, id, body.status);
    return ok({ success: true, user, message: "用户状态已更新" });
  } catch (error: unknown) {
    return apiError(error, "更新用户状态失败");
  }
}
