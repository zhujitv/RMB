import type { NextRequest } from "next/server";
import { apiError, findShipsgoOceanTrackingByContainerNo, getActor, ok } from "../../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ containerNo: string }> }) {
  try {
    const actor = await getActor(request);
    const { containerNo } = await context.params;
    const result = await findShipsgoOceanTrackingByContainerNo(actor, containerNo);
    return ok({ success: true, ...result });
  } catch (error: unknown) {
    return apiError(error, "查询柜号大掌櫃跟踪失败");
  }
}
