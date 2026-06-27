import type { NextRequest } from "next/server";
import { apiError, getActor, ok, syncShipsgoOceanTracking } from "../../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(request);
    const { id } = await context.params;
    const result = await syncShipsgoOceanTracking(request, actor, id);
    return ok({ success: true, ...result });
  } catch (error: unknown) {
    return apiError(error, "同步大掌櫃跟踪失败");
  }
}
