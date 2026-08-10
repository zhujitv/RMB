import type { NextRequest } from "next/server";
import { apiError, createShipsgoOceanTracking, ok, parseJsonBody } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    return ok({ success: true, ...await createShipsgoOceanTracking(request, actor, body) });
  } catch (error: unknown) {
    return apiError(error, "创建飞驼可视跟踪失败");
  }
}
