import type { NextRequest } from "next/server";
import { apiError, logoutWechatMini, ok, requireWechatMiniActor } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireWechatMiniActor(request);
    await logoutWechatMini(request);
    return ok({ success: true, message: "已退出小程序" });
  } catch (error: unknown) {
    return apiError(error, "退出小程序失败");
  }
}
