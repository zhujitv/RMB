import type { NextRequest } from "next/server";
import { apiError, deleteShipsgoOceanTracking, getShipsgoOceanTracking, ok, readShipsgoFeatureFlags } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await context.params;
    const [result, freightower] = await Promise.all([getShipsgoOceanTracking(actor, id), readShipsgoFeatureFlags()]);
    return ok({ success: true, ...result, freightower });
  } catch (error: unknown) {
    return apiError(error, "读取飞驼可视跟踪失败");
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await context.params;
    return ok({ success: true, ...await deleteShipsgoOceanTracking(request, actor, id) });
  } catch (error: unknown) {
    return apiError(error, "删除飞驼可视跟踪失败");
  }
}
