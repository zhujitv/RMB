import { NextResponse, type NextRequest } from "next/server";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { loginMiniProgram } from "../../../../../lib/platform/mini-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const result = await loginMiniProgram(request, await parseJsonBody(request));
    return NextResponse.json({
      success: true,
      data: result,
      token: result.token,
      expiresAt: result.expiresAt,
      user: result.user,
      message: "登录成功",
    });
  } catch (error: unknown) {
    return apiError(error, "小程序登录失败");
  }
}
