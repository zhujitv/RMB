import type { NextRequest } from "next/server";
import { apiError, getActor, ok, updateUserStatus } from "../../../../../lib/platform-db";

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
    const actor = await getActor(request);
    const body = (await request.json()) as StatusBody;
    const user = await updateUserStatus(request, actor, id, body.status);
    return ok({ success: true, user, message: "用户状态已更新" });
  } catch (error: unknown) {
    return apiError(error, "更新用户状态失败");
  }
}
