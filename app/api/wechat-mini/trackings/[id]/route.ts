import type { NextRequest } from "next/server";
import { apiError, getShipsgoOceanTracking, ok, readShipsgoFeatureFlags, requireWechatMiniActor } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireWechatMiniActor(request);
    const { id } = await context.params;
    const [{ tracking }, features] = await Promise.all([
      getShipsgoOceanTracking(actor, id),
      readShipsgoFeatureFlags(),
    ]);
    const { mapUrl, ...safeTracking } = tracking;
    return ok({
      success: true,
      tracking: {
        ...safeTracking,
        hasMap: Boolean(mapUrl),
        customsTrackingEnabled: features.customsTrackingEnabled === true,
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取小程序物流详情失败");
  }
}
