import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, recoverShipsgoOceanTracking } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    return ok({ success: true, ...await recoverShipsgoOceanTracking(request, actor, body) });
  } catch (error: unknown) {
    return apiError(error, "从飞驼可视同步已有跟踪失败");
  }
}
