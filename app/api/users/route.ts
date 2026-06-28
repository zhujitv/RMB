import { NextResponse, type NextRequest } from "next/server";
import { apiError, listUsers, ok, parseJsonBody, saveUser } from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ users: await listUsers(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取用户失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const user = await saveUser(request, actor, body);
    return NextResponse.json({ success: true, user, message: "用户已保存" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "保存用户失败");
  }
}
