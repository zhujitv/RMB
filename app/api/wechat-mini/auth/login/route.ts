import type { NextRequest } from "next/server";
import { apiError, loginWechatMini, ok, parseJsonBody } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonBody(request) as Record<string, unknown>;
    return ok({ success: true, ...await loginWechatMini(request, body) });
  } catch (error: unknown) {
    return apiError(error, "小程序登录失败");
  }
}
