import type { NextRequest } from "next/server";
import { apiError, listShipsgoControlTowerTrackings, ok } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ success: true, ...await listShipsgoControlTowerTrackings(new URL(request.url).searchParams, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取飞驼可视运输监控失败");
  }
}
