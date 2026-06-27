import type { NextRequest } from "next/server";
import {
  apiError,
  getActor,
  listShipsgoControlTowerTrackings,
  ok,
} from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const result = await listShipsgoControlTowerTrackings(new URL(request.url).searchParams, actor);
    return ok({ success: true, ...result });
  } catch (error) {
    return apiError(error, "读取海运控制塔失败");
  }
}
