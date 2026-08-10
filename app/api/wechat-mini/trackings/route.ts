import type { NextRequest } from "next/server";
import { apiError, listShipsgoControlTowerTrackings, ok, requireWechatMiniActor } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireWechatMiniActor(request);
    const data = await listShipsgoControlTowerTrackings(new URL(request.url).searchParams, actor);
    const rows = data.rows.map((row) => {
      const { mapUrl, ...safeRow } = row;
      return { ...safeRow, hasMap: Boolean(mapUrl) };
    });
    return ok({ success: true, ...data, rows });
  } catch (error: unknown) {
    return apiError(error, "读取小程序物流列表失败");
  }
}
