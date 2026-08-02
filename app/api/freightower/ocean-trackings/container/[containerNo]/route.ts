import type { NextRequest } from "next/server";
import { apiError, findShipsgoOceanTrackingByContainerNo, ok } from "../../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ containerNo: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { containerNo } = await context.params;
    return ok({ success: true, ...await findShipsgoOceanTrackingByContainerNo(actor, containerNo) });
  } catch (error: unknown) {
    return apiError(error, "查询柜号飞驼可视跟踪失败");
  }
}
