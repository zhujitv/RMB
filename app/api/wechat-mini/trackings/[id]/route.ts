import type { NextRequest } from "next/server";
import { apiError, getShipsgoOceanTracking, ok, requireWechatMiniActor } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireWechatMiniActor(request);
    const { id } = await context.params;
    return ok({ success: true, ...await getShipsgoOceanTracking(actor, id) });
  } catch (error: unknown) {
    return apiError(error, "读取小程序物流详情失败");
  }
}
