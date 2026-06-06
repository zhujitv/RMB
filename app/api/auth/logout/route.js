import { NextResponse } from "next/server";
import { apiError, clearSessionCookies, revokeCurrentSession } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    await revokeCurrentSession(request);
    const response = NextResponse.json({ ok: true });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    return apiError(error, "退出登录失败");
  }
}
