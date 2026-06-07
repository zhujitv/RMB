import { NextResponse } from "next/server";
import { apiError, changeOwnPassword, clearSessionCookies, getActor } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const actor = await getActor(request, { allowPasswordChangeRequired: true });
    const body = await request.json();
    const user = await changeOwnPassword(request, actor, body);
    const response = NextResponse.json({ success: true, ok: true, user, message: "密码已修改，请重新登录。" });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    return apiError(error, "修改密码失败");
  }
}

export async function PATCH(request) {
  return POST(request);
}
