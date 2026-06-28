import type { NextRequest } from "next/server";
import {
  apiError,
  listShipsgoControlTowerTrackings,
  ok,
} from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const result = await listShipsgoControlTowerTrackings(new URL(request.url).searchParams, actor);
    return ok({ success: true, ...result });
  } catch (error) {
    return apiError(error, "读取运输监控失败");
  }
}
