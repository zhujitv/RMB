import type { NextRequest } from "next/server";
import { apiError, ok, syncShipsgoOceanTracking } from "../../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await context.params;
    return ok({ success: true, ...await syncShipsgoOceanTracking(request, actor, id) });
  } catch (error: unknown) {
    return apiError(error, "同步飞驼可视跟踪失败");
  }
}
