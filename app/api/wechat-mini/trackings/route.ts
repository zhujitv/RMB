import type { NextRequest } from "next/server";
import { apiError, listShipsgoControlTowerTrackings, ok, requireWechatMiniActor } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireWechatMiniActor(request);
    const data = await listShipsgoControlTowerTrackings(new URL(request.url).searchParams, actor);
    return ok({ success: true, ...data });
  } catch (error: unknown) {
    return apiError(error, "读取小程序物流列表失败");
  }
}
