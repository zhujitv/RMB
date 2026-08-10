import type { NextRequest } from "next/server";
import {
  apiError,
  codedError,
  getShipsgoOceanTracking,
  ok,
  parseJsonBody,
  requireWechatMiniActor,
  WECHAT_MINI_MAP_COOKIE_NAME,
  wechatMiniBearerToken,
} from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAP_SESSION_SECONDS = 5 * 60;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireWechatMiniActor(request);
    const body = await parseJsonBody(request);
    const result = await getShipsgoOceanTracking(actor, body.trackingId);
    if (!result.tracking.mapUrl) {
      throw codedError("飞驼暂未返回这票运输的地图，请先同步最新物流信息。", 404, "FREIGHTOWER_MAP_NOT_AVAILABLE");
    }
    const token = wechatMiniBearerToken(request);
    const response = ok({ success: true, message: "地图访问会话已建立" });
    response.cookies.set(WECHAT_MINI_MAP_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/wechat-mini/tracking-map",
      maxAge: MAP_SESSION_SECONDS,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error: unknown) {
    return apiError(error, "建立小程序地图访问会话失败");
  }
}
